import type { GatewayBackendKind, SessionInfo } from '../types';
import { selectByBackend } from './gateway-backends';

export type LiveMemberRole = 'main' | 'subagent' | 'cron' | 'channel' | 'session';
export type LiveMemberStatus = 'working' | 'error' | 'completed' | 'recent' | 'standby';

export type LiveToolActivity = {
  name: string;
  status: 'running' | 'success' | 'error';
  updatedAt: number;
};

export type LiveOutcome = {
  status: 'completed' | 'error' | 'aborted';
  updatedAt: number;
};

export type LiveDailyReport = {
  mainMessages: number;
  dmMessages: number;
  subagentMessages: number;
  cronMessages: number;
  channelMessages: Record<string, number>;
};

export type LiveUsage = {
  todayCost: number | null;
  todayTokens: number | null;
  toolCalls: number | null;
};

export type LiveMember = {
  id: string;
  sessionKey: string;
  role: LiveMemberRole;
  label: string | null;
  channel: string | null;
  updatedAt: number | null;
  status: LiveMemberStatus;
  tool: LiveToolActivity | null;
};

export type LiveAttentionItem =
  | { id: 'cron_failures'; kind: 'cron_failures'; count: number }
  | { id: 'pair_requests'; kind: 'pair_requests'; count: number }
  | { id: string; kind: 'session_error'; count: 1; sessionKey: string; label: string | null };

export type LiveDashboardSnapshot = {
  workingCount: number;
  attentionCount: number;
  activeTodayCount: number;
  totalMessages: number | null;
  usage: LiveUsage;
  members: LiveMember[];
  recentSessions: LiveMember[];
  attentionItems: LiveAttentionItem[];
  hasActivity: boolean;
};

export type BuildLiveDashboardInput = {
  backendKind: GatewayBackendKind;
  currentAgentId: string;
  currentAgentName: string | null;
  mainSessionKey: string;
  sessions: SessionInfo[];
  activeSessionKeys: ReadonlySet<string>;
  toolActivityBySession: Readonly<Record<string, LiveToolActivity>>;
  outcomesBySession: Readonly<Record<string, LiveOutcome>>;
  dailyReport: LiveDailyReport | null;
  usage: LiveUsage;
  cronFailureCount: number;
  pendingPairCount: number;
  now?: number;
};

const WORKING_WINDOW_MS = 2 * 60_000;
const RECENT_WINDOW_MS = 10 * 60_000;
const OUTCOME_WINDOW_MS = 10 * 60_000;
const MAX_MEMBERS = 6;
const MAX_RECENT_SESSIONS = 5;

export function isLiveSessionInScope(
  backendKind: GatewayBackendKind,
  currentAgentId: string,
  session: SessionInfo,
): boolean {
  return selectByBackend<boolean>(backendKind, {
    openclaw: session.key.startsWith(`agent:${currentAgentId}:`),
    hermes: true,
    youmind: false,
  });
}

function classifyRole(session: SessionInfo, mainSessionKey: string): LiveMemberRole {
  if (session.key === mainSessionKey || /^agent:[^:]+:main$/.test(session.key)) return 'main';
  if (session.key.includes(':subagent:') || session.key.includes(':sub:')) return 'subagent';
  if (session.key.includes(':cron:')) return 'cron';
  if (session.channel) return 'channel';
  return 'session';
}

function sessionLabel(session: SessionInfo): string | null {
  return session.label?.trim()
    || session.displayName?.trim()
    || session.title?.trim()
    || session.derivedTitle?.trim()
    || null;
}

function resolveStatus(
  session: SessionInfo,
  activeSessionKeys: ReadonlySet<string>,
  outcome: LiveOutcome | undefined,
  now: number,
): LiveMemberStatus {
  if (outcome && now - outcome.updatedAt <= OUTCOME_WINDOW_MS) {
    if (outcome.status === 'error') return 'error';
    if (outcome.status === 'completed') return 'completed';
  }
  if (activeSessionKeys.has(session.key)) return 'working';
  if (session.updatedAt && now - session.updatedAt <= WORKING_WINDOW_MS) return 'working';
  if (session.updatedAt && now - session.updatedAt <= RECENT_WINDOW_MS) return 'recent';
  return 'standby';
}

function toMember(
  session: SessionInfo,
  input: BuildLiveDashboardInput,
  now: number,
): LiveMember {
  const role = classifyRole(session, input.mainSessionKey);
  return {
    id: session.key,
    sessionKey: session.key,
    role,
    label: role === 'main' ? input.currentAgentName : sessionLabel(session),
    channel: session.channel?.trim() || null,
    updatedAt: session.updatedAt ?? null,
    status: resolveStatus(session, input.activeSessionKeys, input.outcomesBySession[session.key], now),
    tool: input.toolActivityBySession[session.key] ?? null,
  };
}

function sumDailyMessages(report: LiveDailyReport | null): number | null {
  if (!report) return null;
  return report.mainMessages
    + report.dmMessages
    + report.subagentMessages
    + report.cronMessages
    + Object.values(report.channelMessages).reduce((sum, count) => sum + count, 0);
}

export function buildLiveDashboard(
  input: BuildLiveDashboardInput,
): LiveDashboardSnapshot {
  const now = input.now ?? Date.now();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();

  const scopedSessions = input.sessions
    .filter((session) => isLiveSessionInScope(input.backendKind, input.currentAgentId, session))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const sessionMembers = scopedSessions.map((session) => toMember(session, input, now));
  const existingMainMember = sessionMembers.find((member) => member.role === 'main');
  const mainMember = existingMainMember ?? toMember({
    key: input.mainSessionKey,
    label: input.currentAgentName ?? undefined,
    updatedAt: null,
  }, input, now);
  const allMembers = existingMainMember ? sessionMembers : [mainMember, ...sessionMembers];
  const otherMembers = allMembers.filter((member) => member.role !== 'main');
  const members = [
    mainMember,
    ...otherMembers,
  ].slice(0, MAX_MEMBERS);

  const attentionItems: LiveAttentionItem[] = [];
  if (input.cronFailureCount > 0) {
    attentionItems.push({ id: 'cron_failures', kind: 'cron_failures', count: input.cronFailureCount });
  }
  if (input.pendingPairCount > 0) {
    attentionItems.push({ id: 'pair_requests', kind: 'pair_requests', count: input.pendingPairCount });
  }
  for (const member of allMembers) {
    if (member.status !== 'error') continue;
    attentionItems.push({
      id: `session_error:${member.sessionKey}`,
      kind: 'session_error',
      count: 1,
      sessionKey: member.sessionKey,
      label: member.label,
    });
  }

  const activeToday = allMembers.filter(
    (member) => member.updatedAt != null && member.updatedAt >= todayStart,
  );
  const recentSessions = allMembers
    .filter((member) => member.updatedAt != null)
    .slice(0, MAX_RECENT_SESSIONS);

  return {
    workingCount: allMembers.filter((member) => member.status === 'working').length,
    attentionCount: attentionItems.reduce((sum, item) => sum + item.count, 0),
    activeTodayCount: activeToday.length,
    totalMessages: sumDailyMessages(input.dailyReport),
    usage: input.usage,
    members,
    recentSessions,
    attentionItems,
    hasActivity: activeToday.length > 0 || input.activeSessionKeys.size > 0,
  };
}
