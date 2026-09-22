import type { AgentAdapter, SessionDescriptor } from '@clawket/agent-protocol';
import type { UiMessage } from '../types/chat';
import { sanitizeDisplayText } from '../utils/chat-message';
import { ManualSessions } from './manual-sessions';
import { StorageService } from './storage';

type Attempt = { session?: SessionDescriptor; flight?: Promise<SessionDescriptor> };
const attempts = new WeakMap<AgentAdapter, Map<string, Attempt>>();
export function replyConversationDraft(message: UiMessage): string | null {
  if (message.role !== 'assistant' || message.streaming || message.delivery || message.toolName) return null;
  const text = sanitizeDisplayText(message.text).trim();
  return text && text.length <= 24_000 ? text : null;
}
/** A selected reply seeds an editable new conversation. No prompt is sent or source session changed. */
export function createReplyConversation(adapter: AgentAdapter, agentId: string, sourceKey: string, message: UiMessage): Promise<SessionDescriptor> {
  const draft = replyConversationDraft(message);
  if (!draft || !adapter.capabilities.sessionCreate || !adapter.createSession) return Promise.reject(new Error('reply_conversation_unavailable'));
  const key = JSON.stringify([agentId, sourceKey, message.id, draft]);
  const pending = attempts.get(adapter) ?? new Map<string, Attempt>(); attempts.set(adapter, pending);
  const attempt = pending.get(key) ?? {}; pending.set(key, attempt);
  if (attempt.flight) return attempt.flight;
  const flight = (async () => {
    attempt.session ??= await ManualSessions.create(adapter, agentId, key);
    if (attempt.session.key === sourceKey) throw new Error('reply_conversation_invalid_target');
    const existing = await StorageService.getComposerDraft(agentId, attempt.session.key, adapter.connection.id);
    if (existing && existing !== draft) throw new Error('reply_conversation_draft_conflict');
    await StorageService.setComposerDraft(agentId, attempt.session.key, draft, adapter.connection.id);
    pending.delete(key);
    return attempt.session;
  })();
  attempt.flight = flight;
  void flight.finally(() => { if (attempt.flight === flight) attempt.flight = undefined; }).catch(() => undefined);
  return flight;
}
