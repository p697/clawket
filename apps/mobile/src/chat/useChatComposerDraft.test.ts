import { act, renderHook } from '@testing-library/react-native';
import { createElement, StrictMode, type PropsWithChildren } from 'react';
import { StorageService } from '../services/storage';
import { useChatComposerDraft } from './useChatComposerDraft';

jest.mock('../services/storage', () => ({
  StorageService: {
    getComposerDraft: jest.fn().mockResolvedValue(''),
    setComposerDraft: jest.fn().mockResolvedValue(undefined),
    clearComposerDraftIfMatches: jest.fn().mockResolvedValue(true),
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
      connectionId: 'connection', currentAgentId: 'main',
      input: '',
      sessionKey: 'agent:main:main',
      setInput,
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedStorage.getComposerDraft).toHaveBeenCalledWith('main', 'agent:main:main', 'connection');
    expect(setInput).toHaveBeenCalledWith('saved draft');
  });

  it('saves draft changes after the initial draft has been loaded', async () => {
    const mockedStorage = StorageService as jest.Mocked<typeof StorageService>;
    const setInput = jest.fn();

    const { rerender } = renderHook(
      ({ input }: { input: string }) => useChatComposerDraft({
        connectionId: 'connection', currentAgentId: 'main',
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
      'connection',
    );
  });
});

describe('composer draft departure', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
  afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });
  it('flushes the last edit before the debounce when leaving the conversation', async () => {
    const setInput = jest.fn();
    const { rerender, unmount } = renderHook(({ input }: { input: string }) => useChatComposerDraft({
      connectionId: 'connection', currentAgentId: 'main', sessionKey: 'agent:main:main', input, setInput,
    }), { initialProps: { input: '' } });
    await act(async () => { await Promise.resolve(); });
    rerender({ input: '最后输入的几个字' });
    expect(StorageService.setComposerDraft).not.toHaveBeenCalled();
    unmount();
    expect(StorageService.setComposerDraft).toHaveBeenCalledWith('main', 'agent:main:main', '最后输入的几个字', 'connection');
  });
  it('does not restore a submitted draft from a pending debounce or cleanup', async () => {
    const setInput = jest.fn();
    const { result, rerender, unmount } = renderHook(({ input }: { input: string }) => useChatComposerDraft({
      connectionId: 'connection', currentAgentId: 'main', sessionKey: 'agent:main:main', input, setInput,
    }), { initialProps: { input: '' } });
    await act(async () => { await Promise.resolve(); });
    rerender({ input: 'Ready to send' });
    act(() => result.current.clearPersistedDraft());
    unmount();
    await act(async () => { jest.advanceTimersByTime(300); });
    expect(StorageService.setComposerDraft).toHaveBeenCalledTimes(1);
    expect(StorageService.setComposerDraft).toHaveBeenCalledWith('main', 'agent:main:main', '', 'connection');
  });
});

describe('connection isolation and legacy recovery', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
  afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });
  it('never fills an unowned legacy draft automatically and persists the explicit destination before consuming it', async () => {
    jest.mocked(StorageService.getComposerDraft).mockImplementation(async (_agent, _session, connection) => connection ? null : 'Legacy text');
    const setInput = jest.fn();
    const { result } = renderHook(() => useChatComposerDraft({ connectionId: 'A', currentAgentId: 'main', sessionKey: 'main', input: '', setInput }));
    await act(async () => { await Promise.resolve(); });
    expect(setInput).not.toHaveBeenCalled();
    expect(result.current.recoverableDraft).toBe('Legacy text');
    await act(async () => { await result.current.recoverLegacyDraft(); });
    expect(setInput).toHaveBeenCalledWith('Legacy text');
    expect(StorageService.setComposerDraft).toHaveBeenNthCalledWith(1, 'main', 'main', 'Legacy text', 'A');
    expect(StorageService.clearComposerDraftIfMatches).toHaveBeenCalledWith('main', 'main', 'Legacy text');
  });
  it('preserves legacy text on storage failure and refuses to replace an existing composer', async () => {
    jest.mocked(StorageService.getComposerDraft).mockImplementation(async (_agent, _session, connection) => connection ? null : 'Legacy text');
    const setInput = jest.fn();
    const { result, rerender } = renderHook(({ input }: { input: string }) => useChatComposerDraft({ connectionId: 'A', currentAgentId: 'main', sessionKey: 'main', input, setInput }), { initialProps: { input: 'New text' } });
    await act(async () => { await Promise.resolve(); });
    await expect(result.current.recoverLegacyDraft()).resolves.toBe(false);
    expect(setInput).not.toHaveBeenCalled();
    rerender({ input: '' });
    jest.mocked(StorageService.setComposerDraft).mockRejectedValueOnce(new Error('full'));
    await act(async () => { await expect(result.current.recoverLegacyDraft()).rejects.toThrow('full'); });
    expect(result.current.recoverableDraft).toBe('Legacy text');
    expect(StorageService.clearComposerDraftIfMatches).not.toHaveBeenCalled();
  });
  it('ignores late storage reads and recovery callbacks after changing connections', async () => {
    let resolveA!: (value: string) => void;
    jest.mocked(StorageService.getComposerDraft).mockImplementation(async (_agent, _session, connection) => connection === 'A' ? new Promise<string>(resolve => { resolveA = resolve; }) : connection === 'B' ? 'B draft' : 'legacy');
    const setInput = jest.fn();
    const { result, rerender } = renderHook(({ connectionId }: { connectionId: string }) => useChatComposerDraft({ connectionId, currentAgentId: 'main', sessionKey: 'main', input: '', setInput }), { initialProps: { connectionId: 'A' } });
    const recoverA = result.current.recoverLegacyDraft;
    rerender({ connectionId: 'B' });
    await act(async () => { await Promise.resolve(); resolveA('A draft'); });
    expect(setInput).toHaveBeenCalledWith('B draft');
    expect(setInput).not.toHaveBeenCalledWith('A draft');
    await expect(recoverA()).resolves.toBe(false);
  });
});

test('a failed scoped read does not delete an unread draft with the empty initial composer', async () => {
  jest.useFakeTimers(); jest.clearAllMocks();
  jest.mocked(StorageService.getComposerDraft).mockRejectedValue(new Error('read failed'));
  const setInput = jest.fn();
  const { result, unmount } = renderHook(() => useChatComposerDraft({ connectionId: 'A', currentAgentId: 'main', sessionKey: 'main', input: '', setInput }));
  await act(async () => { await Promise.resolve(); });
  expect(result.current.draftReadFailed).toBe(true);
  act(() => { jest.advanceTimersByTime(500); });
  unmount();
  expect(StorageService.setComposerDraft).not.toHaveBeenCalled();
  jest.useRealTimers();
});

test('strict effect cleanup and setup still restore the current scoped draft', async () => {
  jest.useFakeTimers(); jest.clearAllMocks();
  jest.mocked(StorageService.getComposerDraft).mockImplementation(async (_agent, _session, connection) => connection ? 'Saved text' : null);
  const setInput = jest.fn();
  const { result, unmount } = renderHook(() => useChatComposerDraft({
    connectionId: 'one', currentAgentId: 'main', sessionKey: 'main', input: '', setInput,
  }), { wrapper: ({ children }: PropsWithChildren) => createElement(StrictMode, null, children) });
  await act(async () => { await Promise.resolve(); });
  expect(result.current.draftReady).toBe(true);
  expect(setInput).toHaveBeenCalledWith('Saved text');
  unmount();
  jest.useRealTimers();
});
