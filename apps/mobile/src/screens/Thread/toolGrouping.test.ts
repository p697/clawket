import { groupThreadTools, type ThreadTimelineItem } from './model';

const tool = (id: string, status: 'running' | 'success' | 'error' = 'success'): ThreadTimelineItem => ({
  type: 'message', key: `message:${id}`, message: { id, role: 'tool', text: '', toolStatus: status },
});
const reply: ThreadTimelineItem = { type: 'message', key: 'reply', message: { id: 'reply', role: 'assistant', text: 'Hello' } };
const keys = (items: ThreadTimelineItem[]) => items.map((item) => item.key);

it('folds adjacent tools into one pill and gives a failed call its own', () => {
  const grouped = groupThreadTools([reply, tool('c'), tool('b'), tool('a'), tool('failed', 'error')]);
  expect(keys(grouped)).toEqual(['reply', 'tools:a', 'tools:failed']);
  const pill = grouped[1];
  expect(pill?.type === 'tools' ? pill.messages.map((message) => message.id) : null).toEqual(['c', 'b', 'a']);
});

it('turns a single call into a pill as well', () => {
  expect(keys(groupThreadTools([reply, tool('only', 'running')]))).toEqual(['reply', 'tools:only']);
});

it('keeps the oldest call as a stable pill identity while streaming adds calls', () => {
  expect(groupThreadTools([tool('b'), tool('a')])[0]?.key).toBe('tools:a');
  expect(groupThreadTools([tool('c', 'running'), tool('b'), tool('a')])[0]?.key).toBe('tools:a');
});

it('never combines activity across a reply, a failure or a call with media', () => {
  expect(keys(groupThreadTools([tool('b'), reply, tool('a')]))).toEqual(['tools:b', 'reply', 'tools:a']);
  expect(keys(groupThreadTools([tool('c'), tool('b', 'error'), tool('a')]))).toEqual(['tools:c', 'tools:b', 'tools:a']);
  const media: ThreadTimelineItem = { type: 'message', key: 'message:m', message: { id: 'm', role: 'tool', text: '', toolStatus: 'success', imageUris: ['file:///shot.png'] } };
  expect(keys(groupThreadTools([tool('c'), media, tool('a')]))).toEqual(['tools:c', 'tools:m', 'tools:a']);
});

it('leaves approval prompts as messages', () => {
  const approval: ThreadTimelineItem = {
    type: 'message', key: 'message:approval',
    message: { id: 'approval', role: 'tool', text: '', approval: { id: 'x', kind: 'exec', command: 'ls', status: 'pending', expiresAtMs: null } as never },
  };
  expect(keys(groupThreadTools([tool('b'), approval, tool('a')]))).toEqual(['tools:b', 'message:approval', 'tools:a']);
});

it('keeps a pill when history replaces a live call id', () => {
  const rendered = (id: string, renderKey: string): ThreadTimelineItem => ({
    type: 'message', key: `message:${renderKey}`, message: { id, renderKey, role: 'tool', text: '', toolStatus: 'success' },
  });
  const live = [rendered('toolcall_b', 'toolcall_b'), rendered('toolcall_a', 'toolcall_a')];
  const settled = [rendered('toolresult_b', 'toolcall_b'), rendered('toolresult_a', 'toolcall_a')];
  expect(groupThreadTools(live)[0]?.key).toBe('tools:toolcall_a');
  expect(groupThreadTools(settled)[0]?.key).toBe('tools:toolcall_a');
});
