import type { UiMessage } from '../../types/chat';
import { foldTurnSteps } from '../../components/chat/turn-work';
import { buildThreadTimelineItems, placeTurnReceipts, type ThreadTimelineItem } from './model';

const prompt = (id: string): UiMessage => ({ id, role: 'user', text: id });
const reply = (id: string): UiMessage => ({ id, role: 'assistant', text: `${id} text` });
const tool = (id: string, status: UiMessage['toolStatus'] = 'success', patch: Partial<UiMessage> = {}): UiMessage => (
  { id, role: 'tool', text: '', toolName: 'exec', toolStatus: status, ...patch }
);
/** The controller's newest-first array from a conversation written oldest first. */
const newestFirst = (...messages: UiMessage[]) => [...messages].reverse();
const timeline = (messages: UiMessage[], live = false): ThreadTimelineItem[] => {
  const folded = foldTurnSteps(messages, live);
  return placeTurnReceipts(buildThreadTimelineItems({ messages: folded.messages, runs: [] }), folded);
};
const keys = (items: ThreadTimelineItem[]) => items.map((item) => item.key);

it('takes a finished turn out of the conversation and leaves its receipt on the last reply', () => {
  const items = timeline(newestFirst(prompt('ask'), tool('a'), reply('said'), tool('b', 'error'), tool('c'), reply('answer')));
  expect(keys(items)).toEqual(['message:answer', 'message:said', 'message:ask']);
  const answer = items[0];
  expect(answer?.type === 'message' ? answer.receipt?.steps.map((step) => step.id) : null).toEqual(['a', 'b', 'c']);
  expect(answer?.type === 'message' ? answer.receipt?.failed : null).toBe(false);
});

it('gives a turn that said nothing a receipt of its own, keyed by its oldest call and standing at its newest', () => {
  const quiet = timeline(newestFirst(prompt('ask'), tool('a'), tool('b')));
  expect(keys(quiet)).toEqual(['receipt:a', 'message:ask']);
  const receipt = quiet[0];
  expect(receipt?.type === 'receipt'
    ? [receipt.receipt.steps.map((message) => message.id), receipt.receipt.failed, receipt.anchorKey] : null)
    .toEqual([['a', 'b'], false, 'b']);
});

it('puts the receipt on words said before the last step, red when the turn ended on a failure', () => {
  const failed = timeline(newestFirst(prompt('ask'), reply('trying'), tool('a', 'error')));
  expect(keys(failed)).toEqual(['message:trying', 'message:ask']);
  const trying = failed[0];
  expect(trying?.type === 'message' ? [trying.receipt?.steps.map((step) => step.id), trying.receipt?.failed] : null)
    .toEqual([['a'], true]);
  expect(failed.some((item) => item.type === 'receipt')).toBe(false);
});

it('shows nothing for the running turn steps: the work dock does', () => {
  const items = timeline(newestFirst(prompt('ask'), tool('a'), reply('said'), tool('b', 'running')), true);
  expect(keys(items)).toEqual(['message:said', 'message:ask']);
  expect(items.some((item) => item.type === 'message' && item.receipt)).toBe(false);
});

it('leaves approval prompts as messages', () => {
  const approval: UiMessage = {
    id: 'approval', role: 'system', text: '',
    approval: { id: 'x', kind: 'exec', command: 'ls', status: 'allowed', expiresAtMs: null },
  };
  expect(keys(timeline(newestFirst(prompt('ask'), tool('a'), approval, tool('b'), reply('done'))))).toEqual([
    'message:done', 'message:approval', 'message:ask',
  ]);
});

it('keeps a standalone receipt in place when history replaces a live call id', () => {
  const live = timeline(newestFirst(prompt('ask'), tool('toolcall_a', 'success', { renderKey: 'toolcall_a' })));
  const settled = timeline(newestFirst(prompt('ask'), tool('toolresult_a', 'success', { renderKey: 'toolcall_a' })));
  expect(live[0]?.key).toBe('receipt:toolcall_a');
  expect(settled[0]?.key).toBe('receipt:toolcall_a');
});
