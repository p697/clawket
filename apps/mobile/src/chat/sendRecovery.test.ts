import { act, renderHook } from '@testing-library/react-native';
import { rememberUncertainSend, recoverUncertainSends, useUncertainSends } from './sendRecovery';
import { resolveUserMessageStatus } from './messageDelivery';
import type { UiMessage } from '../types/chat';
const message: UiMessage = { id: 'usr_recovery', role: 'user', text: 'Keep me', idempotencyKey: 'request', imageUris: ['file:///photo'], timestampMs: 10 };

it('keeps late failures in their source scope across navigation and remount', () => {
  const first = renderHook<readonly UiMessage[], { scope: string }>(({ scope }) => useUncertainSends(scope), { initialProps: { scope: 'source' } });
  first.rerender({ scope: 'other' });
  act(() => rememberUncertainSend('source', message));
  expect(first.result.current).toEqual([]);
  first.unmount();
  const reopened = renderHook(() => useUncertainSends('source'));
  expect(reopened.result.current).toEqual([{ ...message, sendUncertain: true }]);
  reopened.unmount();
});
it('shows one uncertain bubble even after history refresh, never a sent check', () => {
  for (const history of [[], [message]]) {
    const recovered = recoverUncertainSends(history, [message]);
    expect(recovered).toHaveLength(1);
    expect(resolveUserMessageStatus({ messages: recovered, index: 0, runAcknowledged: true })).toBe('uncertain');
  }
});
it('uses only a matching backend identity to replace uncertainty', () => {
  const echo = { ...message, id: 'server-confirmed' };
  expect(recoverUncertainSends([message, echo], [message])).toEqual([echo]);
  const unrelated = { ...echo, idempotencyKey: 'other' };
  expect(recoverUncertainSends([unrelated], [message])).toHaveLength(2);
});
