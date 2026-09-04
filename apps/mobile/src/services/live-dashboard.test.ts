import { buildLiveDashboard, isLiveSessionInScope } from './live-dashboard';

const NOW = new Date('2026-09-04T12:00:00.000Z').getTime();

describe('buildLiveDashboard', () => {
  it('uses backend-aware session scope rules', () => {
    expect(isLiveSessionInScope('openclaw', 'main', { key: 'agent:main:main' })).toBe(true);
    expect(isLiveSessionInScope('openclaw', 'main', { key: 'agent:other:main' })).toBe(false);
    expect(isLiveSessionInScope('hermes', 'main', { key: 'main' })).toBe(true);
  });

  it('keeps OpenClaw sessions inside the selected agent scope', () => {
    const snapshot = buildLiveDashboard({
      backendKind: 'openclaw',
      currentAgentId: 'main',
      currentAgentName: 'Claw',
      mainSessionKey: 'agent:main:main',
      sessions: [
        { key: 'agent:main:main', updatedAt: NOW - 30_000 },
        { key: 'agent:main:subagent:one', label: 'Research', updatedAt: NOW - 10_000 },
        { key: 'agent:other:main', updatedAt: NOW - 1_000 },
      ],
      activeSessionKeys: new Set(['agent:main:subagent:one']),
      toolActivityBySession: {
        'agent:main:subagent:one': { name: 'Browser', status: 'running', updatedAt: NOW - 1_000 },
      },
      outcomesBySession: {},
      dailyReport: null,
      usage: { todayCost: null, todayTokens: null, toolCalls: null },
      cronFailureCount: 0,
      pendingPairCount: 0,
      now: NOW,
    });

    expect(snapshot.members).toHaveLength(2);
    expect(snapshot.members[0]).toMatchObject({ role: 'main', label: 'Claw' });
    expect(snapshot.members[1]).toMatchObject({ role: 'subagent', status: 'working' });
    expect(snapshot.members[1].tool?.name).toBe('Browser');
  });

  it('supports Hermes global session keys without OpenClaw prefix assumptions', () => {
    const snapshot = buildLiveDashboard({
      backendKind: 'hermes',
      currentAgentId: 'main',
      currentAgentName: 'Hermes',
      mainSessionKey: 'main',
      sessions: [{ key: 'main', updatedAt: NOW - 20_000 }],
      activeSessionKeys: new Set(),
      toolActivityBySession: {},
      outcomesBySession: {},
      dailyReport: null,
      usage: { todayCost: 1, todayTokens: 100, toolCalls: 2 },
      cronFailureCount: 0,
      pendingPairCount: 0,
      now: NOW,
    });

    expect(snapshot.members).toHaveLength(1);
    expect(snapshot.members[0]).toMatchObject({ role: 'main', label: 'Hermes', status: 'working' });
  });

  it('builds actionable attention counts from failures, pairs, and live run errors', () => {
    const snapshot = buildLiveDashboard({
      backendKind: 'openclaw',
      currentAgentId: 'main',
      currentAgentName: null,
      mainSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main', label: 'Main', updatedAt: NOW - 5_000 }],
      activeSessionKeys: new Set(),
      toolActivityBySession: {},
      outcomesBySession: {
        'agent:main:main': { status: 'error', updatedAt: NOW - 1_000 },
      },
      dailyReport: {
        mainMessages: 4,
        dmMessages: 2,
        subagentMessages: 3,
        cronMessages: 1,
        channelMessages: { channel1: 5 },
      },
      usage: { todayCost: 2, todayTokens: 200, toolCalls: 3 },
      cronFailureCount: 2,
      pendingPairCount: 1,
      now: NOW,
    });

    expect(snapshot.attentionCount).toBe(4);
    expect(snapshot.attentionItems.map((item) => item.kind)).toEqual([
      'cron_failures',
      'pair_requests',
      'session_error',
    ]);
    expect(snapshot.totalMessages).toBe(15);
  });
});
