import { act, renderHook } from '@testing-library/react-native';
import { StorageService } from '../services/storage';
import { useChatComposerDraft } from './useChatComposerDraft';

jest.mock('../services/storage', () => ({
  StorageService: {
    getComposerDraft: jest.fn().mockResolvedValue(''),
    setComposerDraft: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('useChatComposerDraft', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('loads the persisted draft for the current agent and session', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    const setInput = jest.fn();
    mockedStorage.getComposerDraft.mockResolvedValueOnce('saved draft');

    renderHook(() => useChatComposerDraft({
      currentAgentId: 'main',
      input: '',
      sessionKey: 'agent:main:main',
      setInput,
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedStorage.getComposerDraft).toHaveBeenCalledWith('main', 'agent:main:main');
    expect(setInput).toHaveBeenCalledWith('saved draft');
  });

  it('saves draft changes after the initial draft has been loaded', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    const setInput = jest.fn();

    const { rerender } = renderHook(
      ({ input }: { input: string }) => useChatComposerDraft({
        currentAgentId: 'main',
        input,
        sessionKey: 'agent:main:main',
        setInput,
      }),
      { initialProps: { input: '' } },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    rerender({ input: 'hello world' });

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(mockedStorage.setComposerDraft).toHaveBeenCalledWith(
      'main',
      'agent:main:main',
      'hello world',
    );
  });
});
