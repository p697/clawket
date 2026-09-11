import type {
  AgentDescriptor,
  Capabilities,
  ConnectionDescriptor,
  SessionDescriptor,
} from '@clawket/agent-protocol';

import type { RosterConnectionGroup } from '../../connection';
import {
  availableSessionActions,
  buildSessionPanelAgents,
  buildSessionPanelChips,
  buildSessionPanelListItems,
  buildSessionPanelRows,
  channelFilterKey,
  filterSessionPanelRows,
  normalizeSessionRenameTitle,
  resolveSessionPanelFilterKind,
  resolveSessionPanelPageState,
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
    session('main', 'main', 'main', { updatedAt: 990_000, preview: 'hello' }),
    session('main', 'channel', 'one', { channel: 'telegram', attention: 'approval', updatedAt: 800_000 }),
    session('main', 'channel', 'two', { channel: 'discord', updatedAt: 700_000, preview: 'ping' }),
    session('main', 'channel', 'three', { channel: 'discord', updatedAt: 650_000 }),
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
        unreadSessionKeys: ['agent:main:channel:two'],
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

const pinnedSessionKeys = { 'connection:main': ['agent:main:cron:daily'] };
const mutationCapabilities = {
  sessionRename: true,
  sessionReset: true,
  sessionDelete: true,
} satisfies Pick<Capabilities, 'sessionRename' | 'sessionReset' | 'sessionDelete'>;

describe('SessionPanel model', () => {
  it('projects canonical descriptors into rows with pin and unread state', () => {
    const rows = buildSessionPanelRows(roster(), { now: 1_000_000, pinnedSessionKeys });
    expect(rows).toHaveLength(9);
    expect(rows.find((row) => row.kind === 'main' && row.agentId === 'main')).toMatchObject({
      status: 'active',
      agentName: 'Main',
      preview: 'hello',
      pinned: false,
      unread: false,
    });
    expect(rows.find((row) => row.key === 'agent:main:channel:two')).toMatchObject({
      channelLabel: 'Discord',
      unread: true,
      pinned: false,
    });
    expect(rows.find((row) => row.kind === 'cron')).toMatchObject({ pinned: true });
    expect(rows.find((row) => row.kind === 'channel' && row.channelLabel === 'Telegram')).toMatchObject({
      attention: 'approval',
    });
  });

  it('orders the main conversation first, then pinned rows, then activity', () => {
    const rows = buildSessionPanelRows(roster(), { now: 1_000_000, pinnedSessionKeys });
    const mainRows = rows.filter((row) => row.agentId === 'main').map((row) => row.key);
    expect(mainRows.slice(0, 3)).toEqual([
      'agent:main:main',
      'agent:main:cron:daily',
      'agent:main:subagent:working',
    ]);
    expect(mainRows.at(-1)).toBe('agent:main:subagent:done');
  });

  it('counts sessions per Agent for the header switcher', () => {
    const source = roster();
    const rows = buildSessionPanelRows(source, { now: 1_000_000 });
    expect(buildSessionPanelAgents(rows, source.agents.map((summary) => summary.agent))).toEqual([
      { agent: source.agents[0]?.agent, count: 8 },
      { agent: source.agents[1]?.agent, count: 1 },
    ]);
  });

  it('builds channel chips busiest-first and kind chips after them', () => {
    const rows = buildSessionPanelRows(roster(), { now: 1_000_000 });
    const chips = buildSessionPanelChips(rows.filter((row) => row.agentId === 'main'));
    expect(chips).toEqual([
      { key: 'all', label: null, count: 8 },
      { key: 'channel:discord', label: 'Discord', count: 2 },
      { key: 'channel:telegram', label: 'Telegram', count: 1 },
      { key: 'direct_group', label: null, count: 1 },
      { key: 'subagent', label: null, count: 2 },
      { key: 'cron', label: null, count: 1 },
    ]);
    expect(buildSessionPanelChips(rows.filter((row) => row.agentId === 'builder'))).toEqual([]);
  });

  it('filters by Agent, chip and query', () => {
    const rows = buildSessionPanelRows(roster(), { now: 1_000_000 });
    expect(filterSessionPanelRows(rows, {
      agentId: 'main', filter: 'all', query: '',
    })).toHaveLength(8);
    expect(filterSessionPanelRows(rows, {
      agentId: 'builder', filter: 'all', query: '',
    }).map((row) => row.key)).toEqual(['agent:builder:main']);
    expect(filterSessionPanelRows(rows, {
      agentId: 'main', filter: channelFilterKey('Discord'), query: '',
    }).map((row) => row.title)).toEqual(['channel two', 'channel three']);
    expect(filterSessionPanelRows(rows, {
      agentId: 'main', filter: 'subagent', query: '',
    }).map((row) => row.title)).toEqual(['subagent working', 'subagent done']);
    expect(filterSessionPanelRows(rows, {
      agentId: 'main', filter: 'all', query: 'telegram',
    }).map((row) => row.channelLabel)).toEqual(['Telegram']);
    expect(filterSessionPanelRows(rows, {
      agentId: 'main', filter: 'cron', query: 'nothing',
    })).toEqual([]);
  });

  it('folds finished sub-agent runs into one trailing item only in the unfiltered list', () => {
    const rows = buildSessionPanelRows(roster(), { now: 1_000_000 });
    const mainRows = filterSessionPanelRows(rows, { agentId: 'main', filter: 'all', query: '' });
    const items = buildSessionPanelListItems(mainRows, 'all');
    expect(items).toHaveLength(8);
    expect(items.at(-1)).toEqual({ type: 'subagents', count: 1 });
    expect(items.filter((item) => item.type === 'row' && item.row.kind === 'subagent')).toHaveLength(1);

    const subagentRows = filterSessionPanelRows(rows, { agentId: 'main', filter: 'subagent', query: '' });
    expect(buildSessionPanelListItems(subagentRows, 'subagent')).toEqual([
      { type: 'row', row: subagentRows[0] },
      { type: 'row', row: subagentRows[1] },
    ]);
  });

  it('maps filters to low-cardinality analytics kinds', () => {
    expect(resolveSessionPanelFilterKind('all')).toBe('all');
    expect(resolveSessionPanelFilterKind(channelFilterKey('Slack'))).toBe('channel');
    expect(resolveSessionPanelFilterKind('cron')).toBe('cron');
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
