import { renderHook } from '@testing-library/react-native';
import type { UiMessage } from '../types/chat';
import { useThreadMessageEntrance } from './useThreadMessageEntrance';

const old: UiMessage = { id: 'old', role: 'assistant', text: 'Earlier' };
const pending: UiMessage = { id: 'usr_1', renderKey: 'usr_1', role: 'user', text: 'Hello', delivery: 'sending' };

describe('conversation entrance ownership', () => {
  it('lets a live row claim its entrance once despite echo IDs, removal and remount', () => {
    const view = renderHook<ReturnType<typeof useThreadMessageEntrance>, { messages: UiMessage[]; scope: string }>(({ messages, scope }) => useThreadMessageEntrance(messages, scope), {
      initialProps: { messages: [old], scope: 'session-a' },
    });
    expect(view.result.current.claimEntrance('old')).toBe(false);
    view.rerender({ messages: [pending, old], scope: 'session-a' });
    expect(view.result.current.entranceIds.has('usr_1')).toBe(true);
    expect(view.result.current.claimEntrance('usr_1')).toBe(true);
    view.rerender({ messages: [{ ...pending, id: 'server-1', delivery: undefined }, old], scope: 'session-a' });
    expect(view.result.current.claimEntrance('usr_1')).toBe(false);
    view.rerender({ messages: [old], scope: 'session-a' });
    view.rerender({ messages: [pending, old], scope: 'session-a' });
    expect(view.result.current.claimEntrance('usr_1')).toBe(false);
  });
  it('resets on session change without animating the destination history or honoring an old claim', () => {
    const view = renderHook<ReturnType<typeof useThreadMessageEntrance>, { messages: UiMessage[]; scope: string }>(({ messages, scope }) => useThreadMessageEntrance(messages, scope), {
      initialProps: { messages: [old], scope: 'session-a' },
    });
    view.rerender({ messages: [pending, old], scope: 'session-a' });
    const oldClaim = view.result.current.claimEntrance;
    view.rerender({ messages: [pending, old], scope: 'session-b' });
    expect(view.result.current.entranceIds.size).toBe(0);
    expect(oldClaim('usr_1')).toBe(false);
    expect(view.result.current.claimEntrance('usr_1')).toBe(false);
  });
});
