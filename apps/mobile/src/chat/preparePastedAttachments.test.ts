import type { PastedFile } from '@mattermost/react-native-paste-input';
import { CAPABILITY_MATRIX } from '@clawket/agent-protocol';
import { readFileAsBase64 } from './chatControllerUtils';
import {
  PASTED_ATTACHMENT_MAX_RAW_BYTES,
  preparePastedAttachments,
} from './preparePastedAttachments';

jest.mock('./chatControllerUtils', () => ({
  readFileAsBase64: jest.fn(),
}));

const readMock = readFileAsBase64 as jest.MockedFunction<typeof readFileAsBase64>;

function pastedFile(overrides: Partial<PastedFile> = {}): PastedFile {
  return {
    uri: 'file:///tmp/pasted.png',
    fileName: 'pasted.png',
    fileSize: 512,
    type: 'image/png',
    ...overrides,
  };
}

describe('preparePastedAttachments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readMock.mockResolvedValue('base64');
  });

  it('prepares pasted images and files for the pending attachment pipeline', async () => {
    const result = await preparePastedAttachments({
      files: [
        pastedFile(),
        pastedFile({
          uri: 'file:///tmp/notes.pdf',
          fileName: 'notes.pdf',
          type: 'application/pdf',
        }),
      ],
      pendingCount: 0,
      maxAttachments: 6,
      capabilities: CAPABILITY_MATRIX.openclaw,
    });

    expect(result).toEqual({
      accepted: [
        expect.objectContaining({ mimeType: 'image/png', fileName: 'pasted.png' }),
        expect.objectContaining({ mimeType: 'application/pdf', fileName: 'notes.pdf' }),
      ],
      rejection: null,
    });
  });

  it('keeps readable files when another pasted file fails', async () => {
    readMock
      .mockRejectedValueOnce(new Error('unreadable'))
      .mockResolvedValueOnce('second-base64');
    const result = await preparePastedAttachments({
      files: [pastedFile(), pastedFile({ uri: 'file:///tmp/second.png' })],
      pendingCount: 0,
      maxAttachments: 6,
      capabilities: CAPABILITY_MATRIX.openclaw,
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.uri).toBe('file:///tmp/second.png');
    expect(result.rejection).toBe('failed');
  });

  it('respects existing attachment capacity without reading extra files', async () => {
    const result = await preparePastedAttachments({
      files: [pastedFile(), pastedFile({ uri: 'file:///tmp/second.png' })],
      pendingCount: 5,
      maxAttachments: 6,
      capabilities: CAPABILITY_MATRIX.openclaw,
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.rejection).toBe('limit');
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a paste when the composer has no remaining slots', async () => {
    const result = await preparePastedAttachments({
      files: [pastedFile()],
      pendingCount: 6,
      maxAttachments: 6,
      capabilities: CAPABILITY_MATRIX.openclaw,
    });

    expect(result).toEqual({ accepted: [], rejection: 'limit' });
    expect(readMock).not.toHaveBeenCalled();
  });

  it('rejects oversized file metadata before reading and keeps valid files', async () => {
    const result = await preparePastedAttachments({
      files: [
        pastedFile({ fileSize: PASTED_ATTACHMENT_MAX_RAW_BYTES + 1 }),
        pastedFile({
          uri: 'file:///tmp/at-limit.pdf',
          fileName: 'at-limit.pdf',
          fileSize: PASTED_ATTACHMENT_MAX_RAW_BYTES,
          type: 'application/pdf',
        }),
      ],
      pendingCount: 0,
      maxAttachments: 6,
      capabilities: CAPABILITY_MATRIX.openclaw,
    });

    expect(PASTED_ATTACHMENT_MAX_RAW_BYTES).toBe(5 * 1024 * 1024);
    expect(result.accepted).toEqual([
      expect.objectContaining({ uri: 'file:///tmp/at-limit.pdf' }),
    ]);
    expect(result.rejection).toBe('too_large');
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(readMock).toHaveBeenCalledWith('file:///tmp/at-limit.pdf');
  });

  it('keeps a mixed-case image while pre-gating an unsupported Hermes file', async () => {
    const result = await preparePastedAttachments({
      files: [
        pastedFile({ type: ' Image/PNG ' }),
        pastedFile({
          uri: 'file:///tmp/notes.pdf',
          fileName: 'notes.pdf',
          type: 'application/pdf',
        }),
      ],
      pendingCount: 0,
      maxAttachments: 6,
      capabilities: { ...CAPABILITY_MATRIX.hermes, documentAttachments: false },
    });

    expect(result).toEqual({
      accepted: [expect.objectContaining({ mimeType: 'image/png' })],
      rejection: 'unsupported',
    });
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(readMock).toHaveBeenCalledWith('file:///tmp/pasted.png');
  });
});
