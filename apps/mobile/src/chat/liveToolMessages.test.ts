import { sameLiveToolCall, withToolMessage } from './liveToolMessages';
import type { UiMessage } from '../types/chat';

it('updates a recovered tool result in place when a live completion arrives', () => {
  const restored: UiMessage = { id: 'toolresult_call_1', role: 'tool', text: '', toolName: 'bash', toolStatus: 'running', renderKey: 'stable' };
  const completion: UiMessage = { ...restored, id: 'toolcall_call_1', toolStatus: 'success', toolDetail: 'OK' };
  expect(sameLiveToolCall(restored, completion)).toBe(true);
  expect(withToolMessage([restored], completion)).toEqual([{ ...completion, id: restored.id }]);
  expect(sameLiveToolCall(restored, { ...completion, id: 'toolcall_call_2' })).toBe(false);
  expect(sameLiveToolCall(restored, { ...completion, role: 'assistant' })).toBe(false);
  expect(sameLiveToolCall({ ...restored, id: 'call_1' }, completion)).toBe(false);
});
