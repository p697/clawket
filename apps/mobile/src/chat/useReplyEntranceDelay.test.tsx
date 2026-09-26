import { act, renderHook } from '@testing-library/react-native';
import type { UiMessage } from '../types/chat';
import { useReplyEntranceDelay } from './useReplyEntranceDelay';

const old: UiMessage = { id: 'old', role: 'assistant', text: 'Earlier' };
const user: UiMessage = { id: 'user', role: 'user', text: 'Hello' };
const reply: UiMessage = { id: 'reply', role: 'assistant', text: 'Hi', streaming: true };

afterEach(() => jest.useRealTimers());

it('shows the user immediately and releases the latest buffered reply after 1000ms', () => {
  jest.useFakeTimers();
  const { result, rerender } = renderHook<ReturnType<typeof useReplyEntranceDelay>, { messages: UiMessage[]; at: number | null }>(({ messages, at }) => useReplyEntranceDelay(messages, 'main', at, false), {
    initialProps: { messages: [old], at: null as number | null },
  });
  const at = Date.now();
  rerender({ messages: [reply, user, old], at });
  expect(result.current.messages).toEqual([user, old]);
  act(() => jest.advanceTimersByTime(999));
  expect(result.current.holding).toBe(true);
  const final = { ...reply, text: 'Hi there', streaming: false };
  rerender({ messages: [final, user, old], at });
  act(() => jest.advanceTimersByTime(1));
  expect(result.current.messages).toEqual([final, user, old]);
  expect(result.current.holding).toBe(false);
});

it('does not delay existing history on entry, another session, or reduced motion', () => {
  jest.useFakeTimers();
  const { result, rerender } = renderHook<ReturnType<typeof useReplyEntranceDelay>, { scope: string; at: number; reduced: boolean }>(({ scope, at, reduced }) => useReplyEntranceDelay([reply, user], scope, at, reduced), {
    initialProps: { scope: 'main', at: Date.now(), reduced: false },
  });
  expect(result.current.holding).toBe(false);
  rerender({ scope: 'other', at: Date.now() + 1, reduced: false });
  expect(result.current.holding).toBe(false);
  rerender({ scope: 'other', at: Date.now() + 2, reduced: true });
  expect(result.current.holding).toBe(false);
});

it('keeps the previous reply visible while a post-run refresh swaps its ids during the hold', () => {
  jest.useFakeTimers();
  const settled: UiMessage = { id: 'final_run-1', renderKey: 'reply:1:0', role: 'assistant', text: 'Done' };
  const { result, rerender } = renderHook<ReturnType<typeof useReplyEntranceDelay>, { messages: UiMessage[]; at: number | null }>(({ messages, at }) => useReplyEntranceDelay(messages, 'main', at, false), {
    initialProps: { messages: [settled, user], at: null as number | null },
  });
  const next: UiMessage = { id: 'usr_next', role: 'user', text: 'Next' };
  const at = Date.now();
  rerender({ messages: [next, settled, user], at });
  // History adopts the reply under its server id while the new turn is held.
  const canonical: UiMessage = { ...settled, id: 'h_assistant_7' };
  rerender({ messages: [reply, next, canonical, user], at });
  expect(result.current.holding).toBe(true);
  expect(result.current.messages).toEqual([next, canonical, user]);
});
