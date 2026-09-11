import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import type { PastedFile } from '@mattermost/react-native-paste-input';
import { CAPABILITY_MATRIX } from '@clawket/agent-protocol';
import { preparePastedAttachments } from './preparePastedAttachments';
import { useChatPasteAttachments } from './useChatPasteAttachments';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('./preparePastedAttachments', () => ({
  preparePastedAttachments: jest.fn(),
}));

const prepareMock = preparePastedAttachments as jest.MockedFunction<
  typeof preparePastedAttachments
>;
const file: PastedFile = {
  uri: 'file:///tmp/pasted.png',
  fileName: 'pasted.png',
  fileSize: 512,
  type: 'image/png',
};

describe('useChatPasteAttachments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prepareMock.mockResolvedValue({
      accepted: [{
        uri: file.uri,
        base64: 'base64',
        mimeType: file.type,
        fileName: file.fileName,
      }],
      rejection: null,
    });
  });

  it('appends a successful paste through the existing pending setter', async () => {
    const setPendingAttachments = jest.fn();
    const { result } = renderHook(() => useChatPasteAttachments({
      pendingAttachments: [],
      setPendingAttachments,
      maxAttachments: 6,
      capabilities: CAPABILITY_MATRIX.openclaw,
    }));

    await act(async () => {
      await result.current.onPasteFiles([file]);
    });

    const update = setPendingAttachments.mock.calls[0]?.[0] as (value: unknown[]) => unknown[];
    expect(update([{ uri: 'existing' }])).toHaveLength(2);
  });

  it.each([
    ['limit', 'Attachment limit reached', 'You can attach up to {{count}} files.'],
    ['failed', 'Unable to attach file', 'Please try again later.'],
  ] as const)(
    'keeps partial success and surfaces the %s rejection',
    async (rejection, title, message) => {
      prepareMock.mockResolvedValue({
        accepted: [{
          uri: file.uri,
          base64: 'base64',
          mimeType: file.type,
          fileName: file.fileName,
        }],
        rejection,
      });
      const setPendingAttachments = jest.fn();
      const { result } = renderHook(() => useChatPasteAttachments({
        pendingAttachments: [],
        setPendingAttachments,
        maxAttachments: 6,
        capabilities: CAPABILITY_MATRIX.openclaw,
      }));

      await act(async () => {
        await result.current.onPasteFiles([file]);
      });

      expect(setPendingAttachments).toHaveBeenCalledTimes(1);
      expect(Alert.alert).toHaveBeenCalledWith(title, message);
    },
  );

  it('shows capacity feedback when all slots are occupied', async () => {
    prepareMock.mockResolvedValue({ accepted: [], rejection: 'limit' });
    const { result } = renderHook(() => useChatPasteAttachments({
      pendingAttachments: [],
      setPendingAttachments: jest.fn(),
      maxAttachments: 6,
      capabilities: CAPABILITY_MATRIX.openclaw,
    }));

    await act(async () => {
      await result.current.onPasteFiles([file]);
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Attachment limit reached',
      'You can attach up to {{count}} files.',
    );
  });

  it('surfaces preparation and native paste failures', async () => {
    prepareMock.mockResolvedValue({ accepted: [], rejection: 'failed' });
    const { result } = renderHook(() => useChatPasteAttachments({
      pendingAttachments: [],
      setPendingAttachments: jest.fn(),
      maxAttachments: 6,
      capabilities: CAPABILITY_MATRIX.openclaw,
    }));

    await act(async () => {
      await result.current.onPasteFiles([file]);
    });
    result.current.onPasteFailed();

    expect(Alert.alert).toHaveBeenCalledTimes(2);
    expect(Alert.alert).toHaveBeenLastCalledWith(
      'Unable to attach file',
      'Please try again later.',
    );
  });

  it('surfaces the preflight size rejection with the derived limit', async () => {
    prepareMock.mockResolvedValue({ accepted: [], rejection: 'too_large' });
    const { result } = renderHook(() => useChatPasteAttachments({
      pendingAttachments: [],
      setPendingAttachments: jest.fn(),
      maxAttachments: 6,
      capabilities: CAPABILITY_MATRIX.openclaw,
    }));

    await act(async () => {
      await result.current.onPasteFiles([file]);
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Message too large to send',
      'Choose a file no larger than {{size}} MB.',
    );
  });

  it('serializes overlapping paste events instead of dropping the second one', async () => {
    let resolveFirst: ((value: Awaited<ReturnType<typeof preparePastedAttachments>>) => void) | null = null;
    prepareMock
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce({
        accepted: [{
          uri: 'file:///tmp/second.png',
          base64: 'second',
          mimeType: 'image/png',
          fileName: 'second.png',
        }],
        rejection: null,
      });
    const setPendingAttachments = jest.fn();
    const { result } = renderHook(() => useChatPasteAttachments({
      pendingAttachments: [],
      setPendingAttachments,
      maxAttachments: 6,
      capabilities: CAPABILITY_MATRIX.openclaw,
    }));

    let firstTask: Promise<void>;
    let secondTask: Promise<void>;
    await act(async () => {
      firstTask = result.current.onPasteFiles([file]);
      secondTask = result.current.onPasteFiles([{ ...file, uri: 'file:///tmp/second.png' }]);
      await Promise.resolve();
    });
    expect(prepareMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.({
        accepted: [{
          uri: file.uri,
          base64: 'first',
          mimeType: file.type,
          fileName: file.fileName,
        }],
        rejection: null,
      });
      await firstTask!;
      await secondTask!;
    });

    expect(prepareMock).toHaveBeenCalledTimes(2);
    expect(prepareMock.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      pendingCount: 1,
    }));
    expect(setPendingAttachments).toHaveBeenCalledTimes(2);
  });

  it('surfaces an attachment capability rejection without a retry suggestion', async () => {
    prepareMock.mockResolvedValue({ accepted: [], rejection: 'unsupported' });
    const { result } = renderHook(() => useChatPasteAttachments({
      pendingAttachments: [],
      setPendingAttachments: jest.fn(),
      maxAttachments: 6,
      capabilities: CAPABILITY_MATRIX.hermes,
    }));

    await act(async () => {
      await result.current.onPasteFiles([file]);
    });

    expect(Alert.alert).toHaveBeenCalledWith('Unable to attach file');
  });
});
