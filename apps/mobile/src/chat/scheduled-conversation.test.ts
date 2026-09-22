import type { UiMessage } from '../types/chat';
import { scheduledConversationPrompt } from './scheduled-conversation';

const messages = [
  { id: 'u1', role: 'user', text: 'Summarize AI news.', timestampMs: 1 },
  { id: 'a1', role: 'assistant', text: 'Old result', timestampMs: 2 },
  { id: 'tool', role: 'tool', text: 'secret tool output', timestampMs: 3 },
  { id: 'u2', role: 'user', text: 'Exclude funding. Link the originals.', timestampMs: 4 },
  { id: 'a2', role: 'assistant', text: 'Updated result', timestampMs: 5 },
] as UiMessage[];

it('includes corrections and the selected completed result, excluding tools and later turns', () => {
  const prompt = scheduledConversationPrompt([...messages, { id: 'future', role: 'user', text: 'Unrelated future request', timestampMs: 6 }], 'a2');
  expect(prompt).toContain('Summarize AI news.');
  expect(prompt).toContain('Exclude funding. Link the originals.');
  expect(prompt).toContain('Updated result');
  expect(prompt).not.toContain('secret tool output');
  expect(prompt).not.toContain('Unrelated future request');
  expect(prompt).toContain('Do not create another scheduled task');
});

it('rejects incomplete, missing, oversized and contextless selections', () => {
  expect(scheduledConversationPrompt(messages, 'missing')).toBeNull();
  expect(scheduledConversationPrompt([{ ...messages[0], streaming: true }], 'u1')).toBeNull();
  expect(scheduledConversationPrompt([{ ...messages[0], delivery: 'queued' }], 'u1')).toBeNull();
  expect(scheduledConversationPrompt([{ ...messages[0], text: 'x'.repeat(25_000) }], 'u1')).toBeNull();
  expect(scheduledConversationPrompt([messages[1]], 'a1')).toBeNull();
});

it('does not offer to recreate a scheduled task confirmed by the backend', () => {
  const alreadyScheduled = messages.map((message) => message.id === 'tool' ? { ...message, toolName: 'cron', toolStatus: 'success' as const, toolArgs: JSON.stringify({ action: 'add' }) } : message);
  expect(scheduledConversationPrompt(alreadyScheduled, 'a2')).toBeNull();
  expect(scheduledConversationPrompt(alreadyScheduled.map((message) => message.id === 'tool' ? { ...message, toolStatus: 'error' as const } : message), 'a2')).not.toBeNull();
});

it('uses timeline order for later corrections even without reliable clocks', () => {
  const prompt = scheduledConversationPrompt([
    { id: 'first', role: 'user', text: 'Original requirement', timestampMs: 100 },
    { id: 'second', role: 'user', text: 'Later correction' },
    { id: 'result', role: 'assistant', text: 'Final result', timestampMs: 1 },
  ], 'result');
  expect(prompt).not.toBeNull();
  expect(prompt!.indexOf('Original requirement')).toBeLessThan(prompt!.indexOf('Later correction'));
});
