import { formatThreadTimestamp } from './timestamps';
import type { AdapterErrorCode, Capabilities, CronJob } from '@clawket/agent-protocol';
import type { UiMessage } from '../../types/chat';
import {
  buildCronRunSeeds,
  buildThreadTimelineItems,
  areThreadRunSeedsEqual,
  deriveThreadContentState,
  groupThreadTools,
  withThreadRhythm,
  formatThreadLocalTime,
  resolveContextRemainingPercent,
  resolveThreadErrorCode,
  resolveThreadErrorDetail,
  resolveThreadHeaderName,
  resolveThreadHeaderSubtitle,
  THREAD_ERROR_COPY,
} from './model';

const CAPABILITIES = {
  models: true,
} as Capabilities;

const ADAPTER_ERROR_CODES = [
  'unauthorized',
  'pairing_required',
  'pairing_expired',
  'bridge_offline',
  'gateway_offline',
  'network',
  'timeout',
  'rate_limited',
  'frame_too_large',
  'unsupported',
  'server',
] as const satisfies readonly AdapterErrorCode[];

describe('Thread model', () => {
  it('shows a resumable paused state instead of waiting forever for an absent adapter', () => {
    expect(deriveThreadContentState({ paused: true, historyLoaded: false, hasMessages: false, connectionState: 'idle', targetSessionReady: false })).toEqual({ kind: 'offline' });
  });
  it('prioritizes locked and actionable error states over runtime content', () => {
    expect(deriveThreadContentState({
      locked: true,
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'ready',
      error: { code: 'network', message: 'No network' },
    })).toEqual({ kind: 'locked' });

    expect(deriveThreadContentState({
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'ready',
      error: { code: 'timeout', message: 'Connection timed out', actionLabel: 'Retry' },
    })).toEqual({
      kind: 'error',
      code: 'timeout',
      message: 'Connection timed out',
      actionLabel: 'Retry',
    });
  });

  it('holds the first frame while local timeline snapshots are still hydrating', () => {
    expect(deriveThreadContentState({
      hydrating: true,
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'ready',
    })).toEqual({ kind: 'loading' });
    expect(deriveThreadContentState({
      hydrating: true,
      historyLoaded: true,
      hasMessages: false,
      connectionState: 'ready',
    })).toEqual({ kind: 'loading' });
    // Connection problems and locks still win over the local read.
    expect(deriveThreadContentState({
      hydrating: true,
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'offline',
    })).toEqual({ kind: 'offline' });
    expect(deriveThreadContentState({
      hydrating: true,
      locked: true,
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'ready',
    })).toEqual({ kind: 'locked' });
    expect(deriveThreadContentState({
      hydrating: false,
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'ready',
    })).toEqual({ kind: 'ready' });
  });

  it('compares activity snapshots by what their cards would render', () => {
    const run = {
      id: 'nightly:1', kind: 'cron' as const, title: 'Nightly', status: 'succeeded' as const, updatedAt: 1,
      jobId: 'nightly', agentId: 'atlas', sessionKey: 'agent:atlas:cron:nightly',
      cronRun: { ts: 1, jobId: 'nightly', action: 'finished' as const },
    };
    expect(areThreadRunSeedsEqual([run], [{ ...run, cronRun: { ...run.cronRun, durationMs: 5 } }])).toBe(true);
    expect(areThreadRunSeedsEqual([run], [{ ...run, status: 'failed' }])).toBe(false);
    expect(areThreadRunSeedsEqual([run], [{ ...run, summary: 'changed' }])).toBe(false);
    expect(areThreadRunSeedsEqual([run], [run, { ...run, id: 'nightly:2', updatedAt: 2 }])).toBe(false);
    expect(areThreadRunSeedsEqual([], [])).toBe(true);
  });

  it('distinguishes loading, empty, ready, and cache-preserving offline states', () => {
    expect(deriveThreadContentState({
      switching: true,
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'ready',
    })).toEqual({ kind: 'loading' });
    expect(deriveThreadContentState({
      targetSessionReady: false,
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'ready',
    })).toEqual({ kind: 'loading' });
    expect(deriveThreadContentState({
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'connecting',
    })).toEqual({ kind: 'ready' });
    expect(deriveThreadContentState({
      historyLoaded: true,
      hasMessages: false,
      connectionState: 'ready',
    })).toEqual({ kind: 'empty' });
    expect(deriveThreadContentState({
      historyLoaded: true,
      hasMessages: true,
      connectionState: 'ready',
    })).toEqual({ kind: 'ready' });
    expect(deriveThreadContentState({
      historyLoaded: false,
      hasMessages: true,
      connectionState: 'reconnecting',
    })).toEqual({ kind: 'offline' });
  });

  it('clamps context remaining and rejects unusable context windows', () => {
    expect(resolveContextRemainingPercent(46, 100)).toBe(54);
    expect(resolveContextRemainingPercent(-20, 100)).toBe(100);
    expect(resolveContextRemainingPercent(200, 100)).toBe(0);
    expect(resolveContextRemainingPercent(Number.NaN, 100)).toBeNull();
    expect(resolveContextRemainingPercent(20, 0)).toBeNull();
    expect(resolveContextRemainingPercent(undefined, 100)).toBeNull();
  });

  it('uses capability metadata to suppress model copy and prioritizes activity states', () => {
    const base = {
      capabilities: CAPABILITIES,
      state: { kind: 'ready' } as const,
      isRunning: false,
      model: 'Sonnet',
      contextUsed: 46,
      contextWindow: 100,
      offlineLabel: 'Offline · reconnecting',
      thinkingLabel: 'Thinking…',
      formatModelContext: (model: string, remaining: number) => `${model} · ${remaining}% left`,
    };

    expect(resolveThreadHeaderSubtitle(base)).toBe('Sonnet · 54% left');
    expect(resolveThreadHeaderSubtitle({
      ...base,
      capabilities: { ...CAPABILITIES, models: false },
    })).toBe('');
    expect(resolveThreadHeaderSubtitle({
      ...base,
      isRunning: true,
      activityLabel: 'Using exec…',
    })).toBe('Using exec…');
    expect(resolveThreadHeaderSubtitle({
      ...base,
      state: { kind: 'offline' },
      isRunning: true,
    })).toBe('Offline · reconnecting');
  });

  it('adds a session title only for non-main sessions', () => {
    expect(resolveThreadHeaderName('Atlas', 'Main', true)).toBe('Atlas');
    expect(resolveThreadHeaderName('Atlas', 'Build release', false)).toBe('Atlas · Build release');
    expect(resolveThreadHeaderName('Atlas', '  ', false)).toBe('Atlas');
  });

  it('defines product copy for the complete adapter error-code union', () => {
    expect(Object.keys(THREAD_ERROR_COPY).sort()).toEqual([...ADAPTER_ERROR_CODES].sort());
    for (const code of ADAPTER_ERROR_CODES) {
      expect(resolveThreadErrorCode({ code })).toBe(code);
      expect(THREAD_ERROR_COPY[code].messageKey.trim()).not.toBe('');
    }
  });

  it('falls back unknown and string failures to network while retaining useful detail', () => {
    expect(resolveThreadErrorCode({ code: 'future_error' })).toBe('network');
    expect(resolveThreadErrorCode(new Error('socket closed'))).toBe('network');
    expect(resolveThreadErrorDetail('  relay unavailable  ')).toBe('relay unavailable');
    expect(resolveThreadErrorDetail({ message: '  handshake failed  ' }))
      .toBe('handshake failed');
  });

  it('projects only Cron runs owned by the current thread and preserves failure state', () => {
    const currentSessionKey = 'agent:atlas:main';
    const createJob = (id: string, agentId: string, name: string): CronJob => ({
      id,
      agentId,
      sessionKey: `agent:${agentId}:cron:${id}`,
      name,
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: 'cron', expr: '0 * * * *' },
      sessionTarget: 'isolated',
      wakeMode: 'now',
      payload: { kind: 'agentTurn', message: 'Run' },
      state: {},
    });

    expect(buildCronRunSeeds({
      entries: [
        {
          ts: 300,
          jobId: 'daily-report',
          action: 'finished',
          status: 'error',
          jobName: '[Cron] Daily report',
          sessionKey: 'agent:atlas:cron:daily-report',
        },
        {
          ts: 400,
          jobId: 'heartbeat',
          action: 'finished',
          status: 'ok',
          jobName: 'Cron: Heartbeat',
          sessionKey: 'agent:atlas:cron:heartbeat',
        },
        {
          ts: 200,
          jobId: 'daily-report',
          action: 'finished',
          status: 'ok',
        },
        {
          ts: 500,
          jobId: 'other-job',
          action: 'finished',
          status: 'error',
          sessionKey: 'agent:other:cron:other-job',
        },
      ],
      jobs: [
        createJob('daily-report', 'atlas', 'Daily report'),
        createJob('heartbeat', 'atlas', 'Heartbeat'),
        createJob('other-job', 'other', 'Other job'),
      ],
      currentSessionKey,
      currentAgentId: 'atlas',
      isMainAgent: false,
      fallbackTitle: 'Cron',
    })).toEqual([
      expect.objectContaining({
        id: 'heartbeat:400',
        sessionKey: 'agent:atlas:cron:heartbeat',
        agentId: 'atlas',
        title: 'Heartbeat',
        status: 'succeeded',
      }),
      expect.objectContaining({
        id: 'daily-report:300',
        sessionKey: 'agent:atlas:cron:daily-report',
        agentId: 'atlas',
        title: 'Daily report',
        status: 'failed',
      }),
    ]);
  });

  it('keeps a main-agent Cron result visible without inventing a Hermes session target', () => {
    const job: CronJob = {
      id: 'hermes-digest',
      name: 'Digest',
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: 'every', everyMs: 60_000 },
      sessionTarget: 'main',
      wakeMode: 'now',
      payload: { kind: 'systemEvent', text: 'Digest' },
      state: {},
    };
    const params = {
      entries: [{
        ts: 500,
        jobId: job.id,
        action: 'finished' as const,
        status: 'ok' as const,
        jobName: 'Digest',
      }],
      jobs: [job],
      currentSessionKey: 'main',
      currentAgentId: 'main',
      fallbackTitle: 'Cron',
    };

    expect(buildCronRunSeeds({ ...params, isMainAgent: true })).toEqual([
      expect.objectContaining({
        id: 'hermes-digest:500',
        jobId: 'hermes-digest',
        status: 'succeeded',
      }),
    ]);
    expect(buildCronRunSeeds({ ...params, currentAgentId: 'worker', isMainAgent: false }))
      .toEqual([]);
    expect(buildCronRunSeeds({ ...params, isMainAgent: true })[0])
      .not.toHaveProperty('sessionKey');
  });

  it('builds a stable newest-first inverted timeline with local-date separators', () => {
    const older = new Date(2026, 8, 4, 10, 15).getTime();
    const runAt = new Date(2026, 8, 5, 9, 30).getTime();
    const newer = new Date(2026, 8, 5, 10, 45).getTime();
    const messages: UiMessage[] = [
      { id: 'newer', role: 'assistant', text: 'Newer', timestampMs: newer },
      { id: 'older', role: 'assistant', text: 'Older', timestampMs: older },
    ];
    const timeline = buildThreadTimelineItems({
      messages,
      runs: [{
        id: 'agent:atlas:subagent:worker',
        kind: 'subagent',
        sessionKey: 'agent:atlas:subagent:worker',
        agentId: 'atlas',
        title: 'Worker',
        status: 'streaming',
        statusLabel: 'Running',
        timeLabel: formatThreadLocalTime(runAt, 'en-US'),
        updatedAt: runAt,
      }],
      locale: 'en-US',
    });

    expect(timeline.map((item) => item.key)).toEqual([
      'message:newer',
      'date:message:newer',
      'run:subagent:agent:atlas:subagent:worker',
      'date:run:subagent:agent:atlas:subagent:worker',
      'message:older',
      'date:message:older',
    ]);
    expect(timeline.filter((item) => item.type === 'date').map((item) => item.label)).toEqual([
      formatThreadTimestamp(newer, 'en-US'),
      formatThreadTimestamp(runAt, 'en-US'),
      formatThreadTimestamp(older, 'en-US'),
    ]);
    expect(formatThreadLocalTime(runAt, 'en-US')).toBe(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(runAt),
    );
  });

  it('spaces rows by voice: stacked within a turn, apart across turns, sectioned by time labels', () => {
    const at = (minute: number) => new Date(2026, 8, 5, 12, minute).getTime();
    const timeline = groupThreadTools(buildThreadTimelineItems({
      messages: [
        { id: 'reply', role: 'assistant', text: 'Done', timestampMs: at(10) },
        { id: 'exec-2', role: 'tool', text: '', toolStatus: 'success', timestampMs: at(10) },
        { id: 'exec-1', role: 'tool', text: '', toolStatus: 'success', timestampMs: at(10) },
        { id: 'failed', role: 'tool', text: '', toolStatus: 'error', timestampMs: at(10) },
        { id: 'ask', role: 'user', text: 'Check it', timestampMs: at(10) },
        { id: 'again', role: 'user', text: 'Correction', timestampMs: at(0) },
        { id: 'first', role: 'user', text: 'Hello', timestampMs: at(0) },
        { id: 'notice', role: 'system', text: 'Context compacted', timestampMs: at(0) },
      ],
      runs: [],
      locale: 'en-US',
    }), new Set());

    // Newest first, as the list data is built before it is reversed.
    expect(withThreadRhythm(timeline).map((row) => [row.key, row.gapAbove])).toEqual([
      ['message:reply', 'stack'],
      ['tools:exec-1', 'stack'],
      ['message:failed', 'turn'],
      ['message:ask', 'none'],
      ['date:message:ask', 'section'],
      ['message:again', 'stack'],
      ['message:first', 'none'],
      ['date:message:first', 'section'],
      // An untimed system notice gets no time label and sits under the list inset.
      ['message:notice', 'none'],
    ]);
  });

  it('keeps an approval prompt inside the Agent turn regardless of its wire role', () => {
    const approval = { id: 'a', kind: 'exec', command: 'ls', status: 'pending', expiresAtMs: 1 } as NonNullable<UiMessage['approval']>;
    const rows = withThreadRhythm([
      { type: 'message', key: 'reply', message: { id: 'reply', role: 'assistant', text: 'Sure' } },
      { type: 'message', key: 'approval', message: { id: 'approval', role: 'system', text: '', approval } },
      { type: 'message', key: 'ask', message: { id: 'ask', role: 'user', text: 'Run it' } },
    ]);
    expect(rows.map((row) => row.gapAbove)).toEqual(['stack', 'turn', 'none']);
  });

  it('keeps input order stable when timeline timestamps are equal or absent', () => {
    const timestampMs = new Date(2026, 8, 5, 12).getTime();
    const timeline = buildThreadTimelineItems({
      messages: [
        { id: 'first', role: 'assistant', text: 'First', timestampMs },
        { id: 'second', role: 'assistant', text: 'Second', timestampMs },
        { id: 'without-time', role: 'system', text: 'Legacy event' },
      ],
      runs: [],
      locale: 'en-US',
    });

    expect(timeline.map((item) => item.key)).toEqual([
      'message:first',
      'message:second',
      'date:message:second',
      'message:without-time',
    ]);
  });
});


it('preserves cached content during recovery before surfacing a failure', () => {
  expect(deriveThreadContentState({ recovering: true, switching: true, historyLoaded: true, hasMessages: true, connectionState: 'reconnecting', error: { code: 'timeout', message: 'health timed out' } })).toEqual({ kind: 'reconnecting' });
  expect(deriveThreadContentState({ paused: true, recovering: true, historyLoaded: true, hasMessages: true, connectionState: 'idle' })).toEqual({ kind: 'offline' });
});
