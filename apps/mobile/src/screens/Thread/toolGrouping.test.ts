import { groupThreadTools, type ThreadTimelineItem } from './model';

const tool = (id: string, status: 'running' | 'success' | 'error' = 'success'): ThreadTimelineItem => ({
  type: 'message', key: `message:${id}`, message: { id, role: 'tool', text: '', toolStatus: status },
});
const reply: ThreadTimelineItem = { type: 'message', key: 'reply', message: { id: 'reply', role: 'assistant', text: 'Hello' } };

it('groups only adjacent tools, leaving chat and failed actions visible', () => {
  const items = [reply, tool('c'), tool('b'), tool('a'), tool('failed', 'error')];
  expect(groupThreadTools(items, new Set()).map((item) => item.key)).toEqual(['reply', 'tools:a', 'message:failed']);
  expect(groupThreadTools(items, new Set(['tools:a'])).map((item) => item.key))
    .toEqual(['reply', 'message:c', 'message:b', 'message:a', 'tools:a', 'message:failed']);
});

it('keeps the oldest call as a stable group identity while streaming adds calls', () => {
  expect(groupThreadTools([tool('b'), tool('a')], new Set())[0]?.key).toBe('tools:a');
  expect(groupThreadTools([tool('c', 'running'), tool('b'), tool('a')], new Set())[0]?.key).toBe('tools:a');
});

it('never combines activity across a reply or date boundary', () => {
  expect(groupThreadTools([tool('b'), reply, tool('a')], new Set())).toHaveLength(3);
});

it('keeps a group and its expanded state when history replaces a live call id', () => {
  const rendered = (id: string, renderKey: string): ThreadTimelineItem => ({
    type: 'message', key: `message:${renderKey}`, message: { id, renderKey, role: 'tool', text: '', toolStatus: 'success' },
  });
  const live = [rendered('toolcall_b', 'toolcall_b'), rendered('toolcall_a', 'toolcall_a')];
  const settled = [rendered('toolresult_b', 'toolcall_b'), rendered('toolresult_a', 'toolcall_a')];
  expect(groupThreadTools(live, new Set())[0]?.key).toBe('tools:toolcall_a');
  expect(groupThreadTools(settled, new Set())[0]?.key).toBe('tools:toolcall_a');
  expect(groupThreadTools(settled, new Set(['tools:toolcall_a'])).map((item) => item.key))
    .toEqual(['message:toolcall_b', 'message:toolcall_a', 'tools:toolcall_a']);
});
