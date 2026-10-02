import { formatThreadTimestamp } from './timestamps';
import type { AdapterErrorCode, Capabilities, CronJob } from '@clawket/agent-protocol';
import type { UiMessage } from '../../types/chat';
import {
  buildCronRunSeeds,
  buildThreadTimelineItems,
  areThreadRunSeedsEqual,
  copiedSessionTitle,
  deriveThreadContentState,
  groupThreadTools,
  withThreadRhythm,
  stabilizeThreadRows,
  formatThreadLocalTime,
  resolveContextRemainingPercent,
  resolveThreadErrorCode,
  resolveThreadErrorDetail,
  resolveThreadHeaderName,
  resolveThreadHeaderSubtitle,
  displayProjectPath,
  THREAD_ERROR_COPY,
  groupThreadRuns,
  isToolRunningInTurn,
  resolveThreadWorkingStatus,
  type ThreadRunCard,
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

  it('reads Online while idle and prioritizes activity states', () => {
    const base = {
      state: { kind: 'ready' } as const,
      isRunning: false,
      offlineLabel: 'Offline · reconnecting',
      thinkingLabel: 'Thinking…',
      onlineLabel: 'Online',
    };

    expect(resolveThreadHeaderSubtitle(base)).toBe('Online');
    expect(resolveThreadHeaderSubtitle({ ...base, state: { kind: 'empty' } })).toBe('Online');
    expect(resolveThreadHeaderSubtitle({ ...base, state: { kind: 'loading' } })).toBe('');
    expect(resolveThreadHeaderSubtitle({
      ...base,
      isRunning: true,
      activityLabel: 'Using exec…',
    })).toBe('Using exec…');
    expect(resolveThreadHeaderSubtitle({ ...base, isRunning: true })).toBe('Thinking…');
    expect(resolveThreadHeaderSubtitle({
      ...base,
      state: { kind: 'offline' },
      isRunning: true,
    })).toBe('Offline · reconnecting');
  });

  it('shows project paths home-relative on macOS, Linux and Windows', () => {
    expect(displayProjectPath('/Users/lucy/Documents/Clawket/Chats')).toBe('~/Documents/Clawket/Chats');
    expect(displayProjectPath('/home/dev/app ')).toBe('~/app');
    expect(displayProjectPath('/Users/lucy')).toBe('~');
    expect(displayProjectPath('C:\\Users\\Lucy\\repo')).toBe('~\\repo');
    expect(displayProjectPath('/opt/work/app')).toBe('/opt/work/app');
    expect(displayProjectPath('/Users2/lucy/app')).toBe('/Users2/lucy/app');
  });

  it('titles a copied conversation within the Bridge title limit without splitting characters', () => {
    const format = (title: string) => `${title} (copy)`;
    expect(copiedSessionTitle('  Fix login  ', format)).toBe('Fix login (copy)');
    expect(copiedSessionTitle(`${'a'.repeat(195)}😀😀`, format)).toBe(`${'a'.repeat(192)}… (copy)`);
    expect(copiedSessionTitle(`${'a'.repeat(190)}${'😀'.repeat(5)}`, format)).toBe(`${'a'.repeat(190)}😀… (copy)`);
    expect(copiedSessionTitle(`${'a'.repeat(193)}`, format)).toBe(`${'a'.repeat(193)} (copy)`);
    // No usable source title, or a format that cannot fit, keeps the Bridge's own default title.
    expect(copiedSessionTitle('   ', format)).toBeUndefined();
    expect(copiedSessionTitle(null, format)).toBeUndefined();
    expect(copiedSessionTitle('abc', (title) => `${title}${'x'.repeat(300)}`)).toBeUndefined();
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

  it('puts the time label of the message a transcript boundary opened above that boundary', () => {
    const at = (hour: number, minute: number) => new Date(2026, 9, 2, hour, minute).getTime();
    const messages: UiMessage[] = [
      { id: 'reply', role: 'assistant', text: 'Light rain.', timestampMs: at(8, 7) },
      { id: 'question', role: 'user', text: 'Weather?', timestampMs: at(8, 6) },
      { id: 'system_history_reset', role: 'system', text: 'Session reset', timestampMs: at(8, 6) - 1 },
      // Other notices stay with the block they report on.
      { id: 'notice', role: 'system', text: 'The model is rate limited. Try again shortly.', timestampMs: at(4, 55) },
      { id: 'earlier', role: 'user', text: 'Test', timestampMs: at(4, 54) },
    ];
    expect(buildThreadTimelineItems({ messages, runs: [], locale: 'en-US' }).map((item) => item.key)).toEqual([
      'message:reply',
      'message:question',
      'message:system_history_reset',
      'date:message:question',
      'message:notice',
      'message:earlier',
      'date:message:earlier',
    ]);
  });

  it('spaces rows by voice: joined within a speaker group, apart across turns, sectioned by time labels', () => {
    const at = (minute: number) => new Date(2026, 8, 5, 12, minute).getTime();
    const timeline = groupThreadTools(buildThreadTimelineItems({
      messages: [
        { id: 'follow-up', role: 'assistant', text: 'Anything else?', timestampMs: at(10) },
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
    }));

    // Newest first, as the list data is built before it is reversed.
    expect(withThreadRhythm(timeline).map((row) => [row.key, row.gapAbove, row.joinsOlder, row.joinsNewer])).toEqual([
      ['message:follow-up', 'joined', true, false],
      ['message:reply', 'stack', false, true],
      ['tools:exec-1', 'stack', false, false],
      ['tools:failed', 'turn', false, false],
      ['message:ask', 'none', false, false],
      ['date:message:ask', 'section', false, false],
      ['message:again', 'joined', true, false],
      ['message:first', 'turn', false, true],
      // A boundary notice opens the rows after it: their time label sits above
      // it, and the oldest label under the list inset.
      ['message:notice', 'none', false, false],
      ['date:message:first', 'none', false, false],
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
    // An approval card is not a bubble: the reply after it starts a new group.
    expect(rows.map((row) => row.joinsOlder)).toEqual([false, false, false]);
  });

  it('joins a reply to its speaker only once it has words', () => {
    const rows = (text: string) => withThreadRhythm([
      { type: 'message', key: 'live', message: { id: 'streaming', role: 'assistant', text, streaming: true } },
      { type: 'message', key: 'earlier', message: { id: 'earlier', role: 'assistant', text: 'Checking.' } },
    ]).map((row) => [row.gapAbove, row.joinsOlder, row.joinsNewer]);
    // The live pill is not a bubble: the reply above keeps its tail.
    expect(rows('')).toEqual([['stack', false, false], ['none', false, false]]);
    expect(rows('Found it')).toEqual([['joined', true, false], ['none', false, true]]);
  });

  it('never joins bubbles from different participants', () => {
    const attribution = (id: string): UiMessage['attribution'] => ({ channel: 'telegram', sender: { id, name: id } });
    const rows = withThreadRhythm([
      { type: 'message', key: 'bob', message: { id: 'bob', role: 'user', text: 'Hi', attribution: attribution('bob') } },
      { type: 'message', key: 'alice', message: { id: 'alice', role: 'user', text: 'Hey', attribution: attribution('alice') } },
    ]);
    expect(rows.map((row) => [row.joinsOlder, row.joinsNewer])).toEqual([[false, false], [false, false]]);
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

describe('stabilizeThreadRows', () => {
  const rows = (messages: UiMessage[]) => withThreadRhythm(groupThreadTools(buildThreadTimelineItems({ messages, runs: [] }))).reverse();
  const tool = (id: string, status: UiMessage['toolStatus'] = 'success'): UiMessage => ({ id, role: 'tool', text: '', toolName: 'bash', toolStatus: status });

  it('returns the previous array when every row renders the same', () => {
    const messages: UiMessage[] = [{ id: 'a', role: 'assistant', text: 'Hi' }, { id: 'u', role: 'user', text: 'Hello' }];
    const previous = rows(messages);
    expect(stabilizeThreadRows(previous, rows(messages.map((message) => ({ ...message }))))).toBe(previous);
    expect(stabilizeThreadRows(previous, previous)).toBe(previous);
  });

  it('reuses unchanged rows and replaces only the rows whose content, rhythm or grouping changed', () => {
    const user: UiMessage = { id: 'u', role: 'user', text: 'Run it' };
    const previous = rows([{ id: 'streaming', renderKey: 'reply:1:0', role: 'assistant', text: 'Wor', streaming: true }, tool('t2', 'running'), tool('t1'), user]);
    const next = stabilizeThreadRows(previous, rows([
      { id: 'streaming', renderKey: 'reply:1:0', role: 'assistant', text: 'World', streaming: true },
      tool('t2'), tool('t1'), { ...user },
    ]));
    expect(next).not.toBe(previous);
    expect(next.map((row) => row.key)).toEqual(previous.map((row) => row.key));
    const changed = next.filter((row, index) => row !== previous[index]).map((row) => row.key);
    expect(changed).toEqual(['tools:t1', 'message:reply:1:0']);
    expect(next[0]).toBe(previous[0]);
  });

  it('replaces a bubble row whose group changed so its corners and tail follow', () => {
    const first: UiMessage = { id: 'a', role: 'assistant', text: 'One' };
    const previous = rows([first]);
    const next = stabilizeThreadRows(previous, rows([{ id: 'b', role: 'assistant', text: 'Two' }, first]));
    const before = previous.find((row) => row.key === 'message:a')!;
    const after = next.find((row) => row.key === 'message:a')!;
    expect(before.joinsNewer).toBe(false);
    expect(after.joinsNewer).toBe(true);
    expect(after).not.toBe(before);
  });

  it('never reuses a row across a change of key, type or order', () => {
    const first: UiMessage = { id: 'a', role: 'assistant', text: 'One' };
    const second: UiMessage = { id: 'b', role: 'assistant', text: 'Two' };
    const previous = rows([second, first]);
    const reordered = stabilizeThreadRows(previous, rows([first, second]));
    expect(reordered).not.toBe(previous);
    expect(reordered.map((row) => row.key)).toEqual(['message:b', 'message:a']);
    // A message that gains a field is a different row even when the rest matches.
    const favorite = stabilizeThreadRows(previous, rows([{ ...second, usage: { totalTokens: 2 } } as UiMessage, first]));
    expect(favorite.find((row) => row.key === 'message:b')).not.toBe(previous.find((row) => row.key === 'message:b'));
    expect(favorite.find((row) => row.key === 'message:a')).toBe(previous.find((row) => row.key === 'message:a'));
  });
});

describe('A+ presence and scheduled digests', () => {
  const t = (key: string) => key;
  const prompt: UiMessage = { id: 'ask', role: 'user', text: 'Go' };
  const tool = (id: string, toolName: string, toolStatus: UiMessage['toolStatus']): UiMessage => ({ id, role: 'tool', text: '', toolName, toolStatus });

  it('says what the running step of this turn does, then typing, then the activity or thinking', () => {
    const status = (messages: UiMessage[], activityLabel?: string) => resolveThreadWorkingStatus({ messages, activityLabel, thinkingLabel: 'Thinking…', t });
    expect(status([tool('b', 'exec', 'running'), prompt])).toBe('Running a command…');
    expect(status([tool('b', 'Read', 'running'), prompt])).toBe('Reading files…');
    expect(status([tool('b', 'apply_patch', 'running'), prompt])).toBe('Editing files…');
    expect(status([tool('b', 'web_search', 'running'), prompt])).toBe('Searching…');
    expect(status([tool('b', 'browser', 'running'), prompt])).toBe('Browsing the web…');
    expect(status([tool('b', 'mcp__linear__save_issue', 'running'), prompt])).toBe('Using tools…');
    expect(status([{ id: 'r', role: 'assistant', text: 'Hel', streaming: true }, tool('b', 'exec', 'success'), prompt])).toBe('Typing…');
    expect(status([{ id: 'r', role: 'assistant', text: '', streaming: true }, prompt], 'Using exec…')).toBe('Using exec…');
    expect(status([prompt])).toBe('Thinking…');
    // An orphaned call from an earlier turn never speaks for this one.
    expect(status([prompt, tool('old', 'exec', 'running')])).toBe('Thinking…');
    expect(isToolRunningInTurn([prompt, tool('old', 'exec', 'running')])).toBe(false);
    expect(isToolRunningInTurn([tool('now', 'exec', 'running'), prompt])).toBe(true);
  });

  it('merges adjacent scheduled results of one day into one digest keyed by the oldest', () => {
    const day = new Date(2026, 8, 5).getTime();
    const cron = (id: string, hour: number, dayOffset = 0): ThreadRunCard => ({
      id, kind: 'cron', title: id, status: 'succeeded', statusLabel: 'Succeeded', timeLabel: `${hour}:00`,
      updatedAt: day + dayOffset * 86_400_000 + hour * 3_600_000,
    });
    const subagent: ThreadRunCard = { id: 'worker', kind: 'subagent', title: 'Worker', status: 'completed', statusLabel: 'Done', timeLabel: '9:30', updatedAt: day + 9.5 * 3_600_000 };
    const timeline = buildThreadTimelineItems({
      messages: [{ id: 'reply', role: 'assistant', text: 'Hi', timestampMs: day + 12 * 3_600_000 }],
      runs: [cron('late', 11), cron('b', 8), cron('a', 7), cron('yesterday', 22, -1)],
      locale: 'en-US',
    });
    // Results carry their own times: hours apart on one day, no labels between them.
    // Newest first: each label follows the row it heads.
    expect(timeline.map((item) => item.key)).toEqual([
      'message:reply', 'date:message:reply', 'run:cron:late', 'run:cron:b', 'run:cron:a', 'date:run:cron:a', 'run:cron:yesterday', 'date:run:cron:yesterday',
    ]);
    const grouped = groupThreadRuns(timeline);
    expect(grouped.map((item) => item.key)).toEqual([
      'message:reply', 'date:message:reply', 'cron:a', 'date:run:cron:a', 'cron:yesterday', 'date:run:cron:yesterday',
    ]);
    const digest = grouped.find((item) => item.key === 'cron:a');
    expect(digest?.type === 'cron' ? digest.runs.map((run) => run.id) : null).toEqual(['late', 'b', 'a']);
    // Sub-agent runs keep their own cards and break a digest.
    const mixed = groupThreadRuns([
      { type: 'run', key: 'run:cron:b', timestampMs: 2, run: cron('b', 8) },
      { type: 'run', key: 'run:subagent:worker', timestampMs: 1, run: subagent },
      { type: 'run', key: 'run:cron:a', timestampMs: 0, run: cron('a', 7) },
    ]);
    expect(mixed.map((item) => item.key)).toEqual(['cron:b', 'run:subagent:worker', 'cron:a']);
  });

  it('marks jobs the conversation may run again, as the editor does', () => {
    const job = (id: string, kind: string) => ({ id, name: id, agentId: 'main', enabled: true, sessionKey: 'agent:main:main',
      schedule: { kind: 'every', everyMs: 60_000 }, payload: { kind } } as unknown as CronJob);
    const seeds = buildCronRunSeeds({
      entries: [
        { ts: 2, runAtMs: 2, jobId: 'daily', action: 'finished', status: 'error', sessionKey: 'agent:main:main' },
        { ts: 1, runAtMs: 1, jobId: 'beat', action: 'finished', status: 'ok', sessionKey: 'agent:main:main' },
      ],
      jobs: [job('daily', 'agentTurn'), job('beat', 'heartbeat')],
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      isMainAgent: true,
      fallbackTitle: 'Task',
    });
    expect(seeds.map((seed) => [seed.id.split(':')[0], seed.runnable])).toEqual([['daily', true], ['beat', false]]);
  });
});
