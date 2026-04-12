import { CachedSessionMeta } from '../../services/chat-cache';
import { SessionInfo } from '../../types';
import { isSessionKeyInAgentScope } from '../../utils/agent-session-scope';
import { sanitizeSilentPreviewText } from '../../utils/chat-message';

export type SessionSidebarTabKey = 'sessions' | 'subagents' | 'cron';

export type SidebarSessionItem = SessionInfo & {
  pinned: boolean;
  localOnly: boolean;
  previewText?: string;
  sortUpdatedAt: number;
  cachedMeta?: CachedSessionMeta;
};

const CHANNEL_PRIORITY = ['telegram', 'discord', 'slack', 'feishu', 'lark', 'whatsapp'];

export function normalizeChannelId(channel?: string): string | undefined {
  const normalized = channel?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

export function isMainSession(key: string): boolean {
  return /^agent:[^:]+:main$/.test(key) || key === 'main';
}

export function isSubagentSession(key: string): boolean {
  return key.includes(':subagent:');
}

export function isCronSession(session: SessionInfo): boolean {
  return !!(session.key.includes(':cron:')
    || session.label?.startsWith('[Cron]')
    || session.derivedTitle?.startsWith('[Cron]')
    || session.title?.startsWith('[Cron]'));
}

function mergeSession(remote: SessionInfo | null, cached: CachedSessionMeta | null, pinnedKeys: Set<string>): SidebarSessionItem {
  const key = remote?.key ?? cached?.sessionKey ?? '';
  const updatedAt = Math.max(remote?.updatedAt ?? 0, cached?.lastMessageMs ?? 0, cached?.updatedAt ?? 0);
  return {
    key,
    kind: remote?.kind ?? 'unknown',
    label: remote?.label ?? cached?.sessionLabel,
    title: remote?.title,
    displayName: remote?.displayName,
    derivedTitle: remote?.derivedTitle,
    channel: remote?.channel,
    model: remote?.model ?? cached?.lastModelLabel,
    modelProvider: remote?.modelProvider,
    updatedAt,
    lastMessagePreview: sanitizeSilentPreviewText(remote?.lastMessagePreview ?? cached?.lastMessagePreview),
    pinned: pinnedKeys.has(key),
    localOnly: !remote,
    previewText: sanitizeSilentPreviewText(remote?.lastMessagePreview ?? cached?.lastMessagePreview),
    sortUpdatedAt: updatedAt,
    cachedMeta: cached ?? undefined,
  };
}

export function buildSidebarSessionItems(params: {
  sessions: SessionInfo[];
  cachedSessions: CachedSessionMeta[];
  currentAgentId: string;
  mainSessionKey?: string;
  activeTab: SessionSidebarTabKey;
  activeChannel: string;
  searchText: string;
  pinnedSessionKeys: string[];
}): SidebarSessionItem[] {
  const pinnedKeys = new Set(params.pinnedSessionKeys);
  const remoteSessions = params.sessions.filter((session) => (
    isSessionKeyInAgentScope(session.key, params.currentAgentId, { mainSessionKey: params.mainSessionKey })
  ));
  const cacheSessions = params.cachedSessions.filter((session) => (
    isSessionKeyInAgentScope(session.sessionKey, params.currentAgentId, { mainSessionKey: params.mainSessionKey })
  ));
  const remoteByKey = new Map(remoteSessions.map((session) => [session.key, session]));
  const cacheByKey = new Map(cacheSessions.map((session) => [session.sessionKey, session]));
  const keys = new Set<string>([
    ...remoteSessions.map((session) => session.key),
    ...cacheSessions.map((session) => session.sessionKey),
  ]);

  let items = Array.from(keys)
    .map((key) => mergeSession(remoteByKey.get(key) ?? null, cacheByKey.get(key) ?? null, pinnedKeys))
    .filter((session) => {
      if (params.activeTab === 'subagents') return isSubagentSession(session.key);
      if (params.activeTab === 'cron') return isCronSession(session);
      return !isSubagentSession(session.key) && !isCronSession(session);
    })
    .filter((session) => {
      if (params.activeTab !== 'sessions' || params.activeChannel === 'all') return true;
      return normalizeChannelId(session.channel) === params.activeChannel;
    });

  const query = params.searchText.trim().toLowerCase();
  if (query) {
    items = items.filter((session) => {
      const haystack = [
        session.key,
        session.label,
        session.title,
        session.displayName,
        session.derivedTitle,
        session.channel,
        session.previewText,
        session.model,
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n')
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  return items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (isMainSession(a.key) !== isMainSession(b.key)) return isMainSession(a.key) ? -1 : 1;
    return b.sortUpdatedAt - a.sortUpdatedAt;
  });
}

export function buildChannelOptions(
  sessions: SidebarSessionItem[],
  options?: { allLabel?: string },
): Array<{ key: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const channelId = normalizeChannelId(session.channel);
    if (!channelId) continue;
    counts.set(channelId, (counts.get(channelId) ?? 0) + 1);
  }

  const orderedKeys = [
    ...CHANNEL_PRIORITY.filter((key) => counts.has(key)),
    ...Array.from(counts.keys())
      .filter((key) => !CHANNEL_PRIORITY.includes(key))
      .sort((a, b) => a.localeCompare(b)),
  ];

  return [
    { key: 'all', label: options?.allLabel ?? 'All', count: sessions.length },
    ...orderedKeys.map((key) => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      count: counts.get(key) ?? 0,
    })),
  ];
}
