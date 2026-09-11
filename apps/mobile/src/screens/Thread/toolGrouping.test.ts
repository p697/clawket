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
