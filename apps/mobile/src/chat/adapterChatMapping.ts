import type { SessionDescriptor } from '@clawket/agent-protocol';
import type { SessionInfo } from '../types';

export function mapAdapterSession(session: SessionDescriptor): SessionInfo {
  return mapAdapterSessionPatch(session);
}

export function mapAdapterSessionPatch(
  session: Partial<SessionDescriptor> & Pick<SessionDescriptor, 'key'>,
): SessionInfo {
  const mapped: SessionInfo = { key: session.key };
  if (session.connectionId !== undefined) mapped.connectionId = session.connectionId;
  if (session.agentId !== undefined) mapped.agentId = session.agentId;
  if (session.kind !== undefined) mapped.kind = session.kind;
  if (session.title !== undefined) {
    mapped.label = session.title;
    mapped.title = session.title;
  }
  if (session.preview !== undefined) mapped.lastMessagePreview = session.preview;
  if (session.updatedAt !== undefined) mapped.updatedAt = session.updatedAt;
  if (session.channel !== undefined) mapped.channel = session.channel;
  if (session.model !== undefined) mapped.model = session.model;
  if (session.modelProvider !== undefined) mapped.modelProvider = session.modelProvider;
  if (session.sessionId !== undefined) mapped.sessionId = session.sessionId;
  if (session.hasActiveRun !== undefined) mapped.hasActiveRun = session.hasActiveRun;
  if (session.attention !== undefined) mapped.attention = session.attention;
  if (session.parentSessionKey !== undefined) {
    mapped.parentSessionKey = session.parentSessionKey;
    mapped.spawnedBy = session.parentSessionKey;
  }
  if (session.source !== undefined) mapped.source = session.source;
  if (session.allowedActions !== undefined) {
    mapped.allowedActions = { ...session.allowedActions };
  }
  return mapped;
}
