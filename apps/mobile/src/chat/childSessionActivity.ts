import { sanitizeSilentPreviewText } from '../utils/chat-message';
import { formatToolActivity } from '../utils/tool-display';
import { SessionInfo } from '../types';
import { agentIdFromSessionKey, truncateForPreview } from './agentActivity';

export type ChildSessionActivityStatus = 'streaming' | 'tool_calling' | 'completed';

export type ChildSessionActivity = {
  sessionKey: string;
  agentId: string | null;
  status: ChildSessionActivityStatus;
  previewText: string | null;
  toolName: string | null;
  updatedAt: number;
};

export type ChildSessionActivityCard = {
  sessionKey: string;
  agentId: string | null;
  title: string;
  previewText: string | null;
  toolName: string | null;
  status: ChildSessionActivityStatus;
  updatedAt: number;
};

export const COMPLETED_CHILD_ACTIVITY_TTL_MS = 8_000;

export function applyChildRunStart(
  map: Map<string, ChildSessionActivity>,
  sessionKey: string,
): void {
  const prev = map.get(sessionKey);
  map.set(sessionKey, {
    sessionKey,
    agentId: prev?.agentId ?? agentIdFromSessionKey(sessionKey),
    status: 'streaming',
    previewText: prev?.previewText ?? null,
    toolName: null,
    updatedAt: Date.now(),
  });
}

export function applyChildDelta(
  map: Map<string, ChildSessionActivity>,
  sessionKey: string,
  text: string,
): void {
  const prev = map.get(sessionKey);
  map.set(sessionKey, {
    sessionKey,
    agentId: prev?.agentId ?? agentIdFromSessionKey(sessionKey),
    status: prev?.status === 'tool_calling' ? 'tool_calling' : 'streaming',
    previewText: sanitizeSilentPreviewText(truncateForPreview(text)) ?? null,
    toolName: prev?.toolName ?? null,
    updatedAt: Date.now(),
  });
}

export function applyChildToolStart(
  map: Map<string, ChildSessionActivity>,
  sessionKey: string,
  toolName: string,
): void {
  const prev = map.get(sessionKey);
  map.set(sessionKey, {
    sessionKey,
    agentId: prev?.agentId ?? agentIdFromSessionKey(sessionKey),
    status: 'tool_calling',
    previewText: prev?.previewText ?? null,
    toolName,
    updatedAt: Date.now(),
  });
}

export function applyChildRunEnd(
  map: Map<string, ChildSessionActivity>,
  sessionKey: string,
): void {
  const prev = map.get(sessionKey);
  map.set(sessionKey, {
    sessionKey,
    agentId: prev?.agentId ?? agentIdFromSessionKey(sessionKey),
    status: 'completed',
    previewText: prev?.previewText ?? null,
    toolName: prev?.toolName ?? null,
    updatedAt: Date.now(),
  });
}

export function pruneChildSessionActivity(
  map: Map<string, ChildSessionActivity>,
  options?: { now?: number; completedTtlMs?: number },
): void {
  const now = options?.now ?? Date.now();
  const completedTtlMs = options?.completedTtlMs ?? COMPLETED_CHILD_ACTIVITY_TTL_MS;
  for (const [sessionKey, value] of map.entries()) {
    if (value.status !== 'completed') continue;
    if (now - value.updatedAt > completedTtlMs) {
      map.delete(sessionKey);
    }
  }
}

export function inferChildSessionOwnership(
  currentSessionKey: string | null,
  currentAgentId: string,
  childSessionKey: string,
  spawnedBy?: string | null,
): boolean {
  if (!currentSessionKey) return false;
  if (spawnedBy && spawnedBy === currentSessionKey) return true;
  if (currentSessionKey === `agent:${currentAgentId}:main`) {
    return childSessionKey.startsWith(`agent:${currentAgentId}:subagent:`);
  }
  return childSessionKey.startsWith(`${currentSessionKey}:subagent:`);
}

function fallbackChildSessionTitle(sessionKey: string): string {
  if (sessionKey.includes(':subagent:')) return 'Subagent';
  const parts = sessionKey.split(':');
  const leaf = parts[parts.length - 1]?.trim();
  if (!leaf) return 'Session';
  return leaf.length > 12 ? `${leaf.slice(0, 12)}…` : leaf;
}

function stripChildSessionPrefix(text: string): string {
  return text.replace(/^(Subagent|Cron):\s*/i, '').trim();
}

function compactChildSessionTitle(text: string): string {
  const trimmed = stripChildSessionPrefix(text).trim();
  if (!trimmed) return 'Subagent';
  if (trimmed.includes('agent:') || trimmed.includes(':subagent:')) return 'Subagent';
  if (/^[a-f0-9_-]{12,}$/i.test(trimmed)) return 'Subagent';
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 18)}…`;
}

function resolveChildSessionTitle(
  session: SessionInfo | undefined,
  fallbackSessionKey: string,
  resolveSessionTitle: (session: SessionInfo, options?: { currentAgentName?: string | null }) => string,
  currentAgentName?: string | null,
): string {
  if (!session) return fallbackChildSessionTitle(fallbackSessionKey);

  const candidates = [
    session.label,
    session.displayName,
    session.derivedTitle,
    session.title,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);

  for (const candidate of candidates) {
    const compact = compactChildSessionTitle(candidate);
    if (compact !== 'Subagent' || !session.key.includes(':subagent:')) {
      return compact;
    }
  }

  return compactChildSessionTitle(
    resolveSessionTitle(session, { currentAgentName }),
  );
}

export function buildChildSessionActivityCards(params: {
  currentSessionKey: string | null;
  currentAgentId: string;
  currentAgentName?: string | null;
  sessions: SessionInfo[];
  activityMap: Map<string, ChildSessionActivity>;
  now?: number;
  completedTtlMs?: number;
  resolveSessionTitle: (session: SessionInfo, options?: { currentAgentName?: string | null }) => string;
}): ChildSessionActivityCard[] {
  const {
    currentSessionKey,
    currentAgentId,
    currentAgentName,
    sessions,
    activityMap,
    now = Date.now(),
    completedTtlMs = COMPLETED_CHILD_ACTIVITY_TTL_MS,
    resolveSessionTitle,
  } = params;

  if (!currentSessionKey) return [];

  const sessionsByKey = new Map(sessions.map((session) => [session.key, session]));

  return Array.from(activityMap.values())
    .filter((activity) => {
      if (
        activity.status === 'completed'
        && now - activity.updatedAt > completedTtlMs
      ) {
        return false;
      }
      const known = sessionsByKey.get(activity.sessionKey);
      return inferChildSessionOwnership(
        currentSessionKey,
        currentAgentId,
        activity.sessionKey,
        known?.parentSessionKey ?? known?.spawnedBy ?? null,
      );
    })
    .map((activity) => {
      const session = sessionsByKey.get(activity.sessionKey);
      return {
        sessionKey: activity.sessionKey,
        agentId: session?.agentId ?? activity.agentId,
        title: resolveChildSessionTitle(
          session,
          activity.sessionKey,
          resolveSessionTitle,
          currentAgentName,
        ),
        previewText: activity.previewText,
        toolName: activity.toolName,
        status: activity.status,
        updatedAt: activity.updatedAt,
      } satisfies ChildSessionActivityCard;
    })
    .sort((a, b) => {
      const rank = (status: ChildSessionActivityStatus) =>
        status === 'tool_calling' ? 3 : status === 'streaming' ? 2 : 1;
      if (rank(a.status) !== rank(b.status)) return rank(b.status) - rank(a.status);
      return b.updatedAt - a.updatedAt;
    });
}

export function getChildSessionStatusLabel(
  status: ChildSessionActivityStatus,
  _previewText: string | null,
  toolName: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (status === 'tool_calling') {
    return toolName ? formatToolActivity(toolName, t) : t('Using tool', { ns: 'chat' });
  }
  if (status === 'streaming') {
    return t('Running', { ns: 'chat' });
  }
  return t('Completed', { ns: 'chat' });
}
