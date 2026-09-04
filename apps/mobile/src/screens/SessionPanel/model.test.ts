import type {
  AgentDescriptor,
  Capabilities,
  ConnectionDescriptor,
  SessionDescriptor,
} from '@clawket/agent-protocol';

import type { RosterConnectionGroup } from '../../connection';
import {
  availableSessionActions,
  buildSessionPanelGroups,
  buildSessionPanelRows,
  filterSessionPanelRows,
  normalizeSessionRenameTitle,
  resolveSessionPanelPageState,
  shouldShowSessionPanelQuickFilters,
  summarizeSessionPanelRows,
} from './model';

function connection(): ConnectionDescriptor {
  return {
    id: 'connection',
    backendKind: 'openclaw',
    transportKind: 'relay',
    label: 'Studio',
    createdAt: 1,
    isFreeSlot: true,
  };
}

function agent(agentId: string): AgentDescriptor {
  return {
    connectionId: 'connection',
    agentId,
    name: agentId === 'main' ? 'Main' : 'Builder',
    isMain: agentId === 'main',
    mainSessionKey: `agent:${agentId}:main`,
  };
}

function session(
  agentId: string,
  kind: SessionDescriptor['kind'],
  suffix: string,
  patch: Partial<SessionDescriptor> = {},
): SessionDescriptor {
  return {
    connectionId: 'connection',
    agentId,
    key: kind === 'main' ? `agent:${agentId}:main` : `agent:${agentId}:${kind}:${suffix}`,
    kind,
    title: `${kind} ${suffix}`,
    updatedAt: 1_000,
    hasActiveRun: false,
    attention: null,
    allowedActions: { pin: true, rename: true, reset: true, delete: true },
    ...patch,
  };
}

function roster(): RosterConnectionGroup {
  const mainAgent = agent('main');
  const builder = agent('builder');
  const mainSessions = [
    session('main', 'main', 'main', { updatedAt: 990_000 }),
    session('main', 'channel', 'one', { channel: 'telegram', attention: 'approval', updatedAt: 800_000 }),
    session('main', 'channel', 'two', { channel: 'discord', updatedAt: 700_000 }),
    session('main', 'direct', 'friend', { updatedAt: 600_000 }),
    session('main', 'subagent', 'working', { hasActiveRun: true, updatedAt: 980_000 }),
    session('main', 'subagent', 'done', { updatedAt: 500_000 }),
    session('main', 'cron', 'daily', { updatedAt: 400_000 }),
  ];
  const builderSessions = [session('builder', 'main', 'main', { updatedAt: 300_000 })];
  return {
    connection: connection(),
    source: 'live',
    syncedAt: 1_000_000,
    agents: [
      {
        agent: mainAgent,
        sessions: mainSessions,
        preview: 'hello',
        updatedAt: 990_000,
        lastActivityAt: 990_000,
        unreadCount: 0,
        hasUnread: false,
        attentionCount: 1,
        attention: 'approval',
      },
      {
        agent: builder,
        sessions: builderSessions,
        preview: 'build',
        updatedAt: 300_000,
        lastActivityAt: 300_000,
        unreadCount: 0,
        hasUnread: false,
        attentionCount: 0,
        attention: null,
      },
    ],
    unreadCount: 0,
    attentionCount: 1,
    lastActivityAt: 990_000,
  };
}

const mutationCapabilities = {
  sessionRename: true,
  sessionReset: true,
  sessionDelete: true,
} satisfies Pick<Capabilities, 'sessionRename' | 'sessionReset' | 'sessionDelete'>;

describe('SessionPanel model', () => {
  it('projects canonical descriptors into searchable status-sorted rows', () => {
    const rows = buildSessionPanelRows(roster(), { now: 1_000_000 });
    expect(rows).toHaveLength(8);
    expect(rows.find((row) => row.kind === 'main')).toMatchObject({
      status: 'active',
      agentName: 'Main',
    });
    expect(rows.find((row) => row.kind === 'channel')).toMatchObject({
      channelLabel: 'Telegram',
      attention: 'approval',
    });
  });

  it('filters by query, attention, working, and canonical kind', () => {
    const rows = buildSessionPanelRows(roster(), { now: 1_000_000 });
    expect(filterSessionPanelRows(rows, {
      query: 'telegram', quickFilter: 'all', kindFilter: 'all',
    }).map((row) => row.channelLabel)).toEqual(['Telegram']);
    expect(filterSessionPanelRows(rows, {
      query: '', quickFilter: 'attention', kindFilter: 'all',
    })).toHaveLength(1);
    expect(filterSessionPanelRows(rows, {
      query: '', quickFilter: 'working', kindFilter: 'subagent',
    }).map((row) => row.title)).toEqual(['subagent working']);
  });

  it('puts the current Agent first and creates five semantic sections', () => {
    const source = roster();
    const rows = buildSessionPanelRows(source, { now: 1_000_000 });
    const groups = buildSessionPanelGroups(
      rows,
      source.agents.map((summary) => summary.agent),
      'builder',
    );
    expect(groups.map((group) => group.agent.agentId)).toEqual(['builder', 'main']);
    expect(groups[1]?.sections.map((section) => section.kind)).toEqual([
      'main', 'channel', 'direct_group', 'subagent', 'cron',
    ]);
  });

  it('groups channels and separates completed subagents behind a count', () => {
    const source = roster();
    const rows = buildSessionPanelRows(source, { now: 1_000_000 });
    const [group] = buildSessionPanelGroups(
      rows,
      source.agents.map((summary) => summary.agent),
      'main',
    );
    const channel = group?.sections.find((section) => section.kind === 'channel');
    const subagents = group?.sections.find((section) => section.kind === 'subagent');
    expect(channel?.channelGroups?.map((item) => item.label)).toEqual(['Discord', 'Telegram']);
    expect(subagents?.rows).toHaveLength(1);
    expect(subagents?.completedRows).toHaveLength(1);
  });

  it('summarizes active, recent, and idle rows using the migrated board policy', () => {
    expect(summarizeSessionPanelRows(
      buildSessionPanelRows(roster(), { now: 1_000_000 }),
    )).toEqual({ active: 2, recent: 5, idle: 1 });
  });

  it('gates mutation actions with row permissions and capabilities', () => {
    const [row] = buildSessionPanelRows(roster(), { now: 1_000_000 });
    expect(availableSessionActions(row!, mutationCapabilities)).toEqual([
      'pin', 'rename', 'reset', 'delete',
    ]);
    expect(availableSessionActions(row!, {
      sessionRename: false,
      sessionReset: true,
      sessionDelete: false,
    })).toEqual(['pin', 'reset']);
  });

  it('shows the three quick filters only beyond one visible screen', () => {
    expect(shouldShowSessionPanelQuickFilters(8)).toBe(false);
    expect(shouldShowSessionPanelQuickFilters(9)).toBe(true);
    expect(shouldShowSessionPanelQuickFilters(4, 3)).toBe(true);
  });

  it('normalizes rename drafts and rejects blank or unchanged titles', () => {
    expect(normalizeSessionRenameTitle('  Launch review  ', 'Old title')).toBe('Launch review');
    expect(normalizeSessionRenameTitle('   ', 'Old title')).toBeNull();
    expect(normalizeSessionRenameTitle('  Old title ', 'Old title')).toBeNull();
  });

  it.each([
    [{ initialized: false, hasPermission: true, rowCount: 0, activeState: 'idle', hasError: false }, 'loading'],
    [{ initialized: true, hasPermission: false, rowCount: 3, activeState: 'ready', hasError: false }, 'permission'],
    [{ initialized: true, hasPermission: true, rowCount: 3, activeState: 'offline', hasError: true }, 'offline'],
    [{ initialized: true, hasPermission: true, rowCount: 3, activeState: 'ready', hasError: true }, 'error'],
    [{ initialized: true, hasPermission: true, rowCount: 0, activeState: 'ready', hasError: false }, 'empty'],
    [{ initialized: true, hasPermission: true, rowCount: 3, activeState: 'ready', hasError: false }, 'ready'],
  ] as const)('resolves page state %#', (input, expected) => {
    expect(resolveSessionPanelPageState(input)).toBe(expected);
  });
});
