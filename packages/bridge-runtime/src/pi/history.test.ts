import { expect, it } from 'vitest';
import { piBranch, piMessages } from './history.js';
it('walks only the active branch, tolerates a cycle, and excludes abandoned messages', () => {
  const entries = [{ id: 'a', parentId: null }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'a' }];
  expect(piBranch(entries).map(e => e.id)).toEqual(['a', 'c']);
  expect(piBranch([{ id: 'a', parentId: 'a' }])).toHaveLength(1);
});
it('preserves image-only inputs, text/tool boundaries and failed tool results', () => {
  const messages = piMessages([
    { id: 'u', message: { role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }] } },
    { id: 'a', message: { role: 'assistant', content: [{ type: 'text', text: 'Before' }, { type: 'toolCall', id: 't', name: 'read', arguments: { path: 'a' } }] } },
    { id: 'r', message: { role: 'toolResult', toolCallId: 't', toolName: 'read', isError: true, content: [{ type: 'text', text: 'missing' }] } },
  ]);
  expect(messages).toHaveLength(3); expect(messages[0].attachments?.[0].content).toBe('AAAA');
  expect(messages[1].text).toBe('Before'); expect(messages[2].tool).toMatchObject({ callId: 't', status: 'error', output: 'missing' });
});

it('keeps context edits out of the visible transcript and renders only visible extension messages and summaries', () => {
  const messages = piMessages([
    { id: 'a', message: { role: 'user', content: 'Original' } },
    { id: 'edit', type: 'context_edit', targetId: 'a', replacement: null },
    { id: 'hidden', type: 'custom_message', content: 'Hidden', display: false },
    { id: 'visible', type: 'custom_message', content: 'Visible', display: true },
    { id: 'summary', type: 'compaction', summary: 'Summary' },
  ]);
  expect(messages.map(message => message.text)).toEqual(['Original', 'Visible', 'Summary']);
});
