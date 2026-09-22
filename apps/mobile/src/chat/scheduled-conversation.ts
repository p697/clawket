import type { UiMessage } from '../types/chat';

const MAX_TASK_CHARACTERS = 24_000;
const MAX_CONTEXT_MESSAGES = 12;

/** A reviewable standalone brief. Never copies tools, hidden history, attachments or a live reply. */
export function scheduledConversationPrompt(messages: readonly UiMessage[], selectedId: string): string | null {
  // The timeline already carries backend order; clocks may be missing or skewed.
  const chronological = messages;
  const index = chronological.findIndex((message) => message.id === selectedId);
  const selected = chronological[index];
  if (!selected || selected.streaming || selected.delivery || !selected.text.trim()
    || (selected.role !== 'assistant' && selected.role !== 'user')) return null;
  const recent = chronological.slice(Math.max(0, index - MAX_CONTEXT_MESSAGES), index + 1);
  // A confirmed scheduler creation in this brief already has a management entry.
  if (recent.some((message) => {
    if (message.role !== 'tool' || message.toolStatus !== 'success' || !/cron|schedule/i.test(message.toolName ?? '')) return false;
    try { const args = JSON.parse(message.toolArgs ?? '{}'); return args.action === 'add' || args.action === 'create'; } catch { return false; }
  })) return null;
  const context = chronological.slice(0, index + 1).filter((message) => !message.streaming && !message.delivery
    && (message.role === 'user' || message.role === 'assistant') && message.text.trim()).slice(-MAX_CONTEXT_MESSAGES);
  const requests = context.filter((message) => message.role === 'user');
  if (!requests.length) return null;
  const instructions = requests.map((message) => message.text.trim()).join('\n\n');
  const result = selected.role === 'assistant' ? `\n\nPrevious result (reference only; obtain fresh information):\n${selected.text.trim()}` : '';
  const prompt = `Repeat the task described below at each scheduled run. Apply the user's later corrections to earlier requirements. Use current information; do not repeat obsolete dates or facts from the previous result. Do not create another scheduled task.\n\nUser requirements, oldest to newest:\n${instructions}${result}`;
  return prompt.length <= MAX_TASK_CHARACTERS ? prompt : null;
}
