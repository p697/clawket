import type { SessionDescriptor } from '@clawket/agent-protocol';
import { SessionInfo } from '../../types';
import { sanitizeSilentPreviewText, sessionLabel } from '../../utils/chat-message';

/** Shared list-mode projection used by the 3.0 SessionPanel. */

export type SessionBoardStatus = 'active' | 'recent' | 'idle';
export type SessionBoardKind = 'main' | 'channel' | 'subagent' | 'cron' | 'group' | 'direct' | 'other';

export type SessionBoardRow = {
  key: string;
  sessionId?: string;
  title: string;
  preview: string;
  channelLabel: string | null;
  modelLabel: string | null;
  updatedAt: number;
  status: SessionBoardStatus;
  kind: SessionBoardKind;
  searchableText: string;
};

const ACTIVE_WINDOW_MS = 60_000;
const RECENT_WINDOW_MS = 10 * 60_000;

function normalizeChannelLabel(channel?: string): string | null {
  const normalized = channel?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'feishu' || normalized === 'lark') return 'Feishu';
  if (normalized === 'whatsapp') return 'WhatsApp';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function resolveStatus(updatedAt: number, now: number): SessionBoardStatus {
  const age = Math.max(0, now - updatedAt);
  if (age <= ACTIVE_WINDOW_MS) return 'active';
  if (age <= RECENT_WINDOW_MS) return 'recent';
  return 'idle';
}

function resolveKind(session: SessionInfo): SessionBoardKind {
  if (/^agent:[^:]+:main$/.test(session.key)) return 'main';
  if (session.key.includes(':subagent:')) return 'subagent';
  if (
    session.key.includes(':cron:')
    || session.label?.startsWith('[Cron]')
    || session.derivedTitle?.startsWith('[Cron]')
    || session.title?.startsWith('[Cron]')
  ) {
    return 'cron';
  }
  if (session.kind === 'group') return 'group';
  if (session.kind === 'direct') return 'direct';
  return 'other';
}

function resolveModelLabel(session: SessionInfo): string | null {
  const provider = session.modelProvider?.trim();
  const model = session.model?.trim();
  if (provider && model) return `${provider}/${model}`;
  if (model) return model;
  return null;
}

function sortSessionBoardRows(a: SessionBoardRow, b: SessionBoardRow): number {
  const statusScore = { active: 3, recent: 2, idle: 1 };
  if (statusScore[a.status] !== statusScore[b.status]) {
    return statusScore[b.status] - statusScore[a.status];
  }
  return b.updatedAt - a.updatedAt || a.key.localeCompare(b.key);
}

export function buildSessionBoardRows(
  sessions: SessionInfo[],
  options?: {
    now?: number;
    currentAgentName?: string | null;
  },
): SessionBoardRow[] {
  const now = options?.now ?? Date.now();
  return sessions
    .map((session) => {
      const updatedAt = session.updatedAt ?? 0;
      const title = sessionLabel(session, { currentAgentName: options?.currentAgentName });
      const preview = sanitizeSilentPreviewText(session.lastMessagePreview)?.replace(/\s+/g, ' ').trim() ?? '';
      const channelLabel = normalizeChannelLabel(session.channel);
      const modelLabel = resolveModelLabel(session);
      const kind = resolveKind(session);
      const status = resolveStatus(updatedAt, now);
      const searchableText = [
        session.key,
        session.sessionId,
        title,
        preview,
        channelLabel,
        modelLabel,
        session.label,
        session.displayName,
        session.derivedTitle,
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n')
        .toLowerCase();

      return {
        key: session.key,
        sessionId: session.sessionId,
        title,
        preview,
        channelLabel,
        modelLabel,
        updatedAt,
        status,
        kind,
        searchableText,
      } satisfies SessionBoardRow;
    })
    .sort(sortSessionBoardRows);
}

/** Canonical adapter projection used by the 3.0 panel without reviving Gateway shapes. */
export function buildSessionDescriptorBoardRows(
  sessions: ReadonlyArray<SessionDescriptor>,
  options?: { now?: number },
): SessionBoardRow[] {
  const now = options?.now ?? Date.now();
  return sessions
    .map((session) => {
      const updatedAt = session.updatedAt ?? 0;
      const channelLabel = normalizeChannelLabel(session.channel);
      const modelLabel = session.model?.trim() || null;
      const preview = sanitizeSilentPreviewText(session.preview)?.replace(/\s+/g, ' ').trim() ?? '';
      const searchableText = [
        session.key,
        session.title,
        preview,
        channelLabel,
        modelLabel,
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n')
        .toLowerCase();

      return {
        key: session.key,
        title: session.title,
        preview,
        channelLabel,
        modelLabel,
        updatedAt,
        status: resolveStatus(updatedAt, now),
        kind: session.kind,
        searchableText,
      } satisfies SessionBoardRow;
    })
    .sort(sortSessionBoardRows);
}

export function filterSessionBoardRows(
  rows: SessionBoardRow[],
  options: {
    query: string;
    status: 'all' | SessionBoardStatus;
    kind: 'all' | SessionBoardKind;
  },
): SessionBoardRow[] {
  const query = options.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (options.status !== 'all' && row.status !== options.status) return false;
    if (options.kind !== 'all' && row.kind !== options.kind) return false;
    if (!query) return true;
    return row.searchableText.includes(query);
  });
}

export function summarizeSessionBoardRows(rows: SessionBoardRow[]): {
  active: number;
  recent: number;
  idle: number;
} {
  return rows.reduce(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { active: 0, recent: 0, idle: 0 },
  );
}
