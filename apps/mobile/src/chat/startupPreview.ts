import { CachedSessionMeta } from '../services/chat-cache';
import { LastOpenedSessionSnapshot } from '../services/storage';
import { SessionInfo } from '../types';

export function buildCachedPreviewSessions(
  cachedSessions: CachedSessionMeta[],
  gatewayConfigId: string,
  sessionKey: string,
): SessionInfo[] {
  return cachedSessions
    .filter((session) => session.gatewayConfigId === gatewayConfigId && session.sessionKey === sessionKey)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((session) => ({
      key: session.sessionKey,
      kind: 'unknown' as const,
      label: session.sessionLabel,
      title: session.sessionLabel,
      displayName: session.agentName,
      lastMessagePreview: session.lastMessagePreview,
      updatedAt: session.updatedAt,
    }));
}

export function buildSnapshotPreviewSession(
  snapshot: LastOpenedSessionSnapshot | null,
): SessionInfo[] {
  if (!snapshot?.sessionKey) return [];
  return [{
    key: snapshot.sessionKey,
    sessionId: snapshot.sessionId,
    kind: 'unknown' as const,
    label: snapshot.sessionLabel,
    title: snapshot.sessionLabel,
    displayName: snapshot.agentName,
    updatedAt: snapshot.updatedAt,
  }];
}
