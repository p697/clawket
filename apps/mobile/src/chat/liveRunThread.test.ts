import { UiMessage } from '../types/chat';
import { buildLiveRunListData, finalReplyTail, finishLiveRunPresentation, liveReplyRenderKey, mergeNewestFirstMessages, recoverLiveRunPresentation } from './liveRunThread';

describe('buildLiveRunListData', () => {
  const sameRunHistory = (): UiMessage[] => [
    { id: 'main', role: 'user', text: 'Main task', idempotencyKey: 'main-key', turnId: 'native-main' },
    { id: 'a', role: 'assistant', text: 'Checking.', timestampMs: 1000, turnId: 'native-main' },
    { id: 'toolcall_1', role: 'tool', text: '', toolName: 'exec', toolStatus: 'success', turnId: 'native-main' },
    { id: 'guide1', role: 'user', text: 'Keep waiting', turnId: 'native-main' },
    { id: 'b', role: 'assistant', text: 'Continuing.', timestampMs: 2000, turnId: 'native-main' },
    { id: 'toolcall_2', role: 'tool', text: '', toolName: 'exec', toolStatus: 'running', turnId: 'native-main' },
    { id: 'guide2', role: 'user', text: 'Keep waiting', turnId: 'native-main' },
    { id: 'c', role: 'assistant', text: 'Still waiting.', timestampMs: 3000, turnId: 'native-main' },
  ];

  it('keeps two same-turn guides between the original live paragraphs and tools without duplication', () => {
    const history = sameRunHistory();
    const rows = buildLiveRunListData({ historyMessages: history,
      streamSegments: [{ id: 'a', text: 'Checking.', timestampMs: 1000, afterToolCount: 0 },
        { id: 'b', text: 'Continuing.', timestampMs: 2000, afterToolCount: 1 }],
      toolMessages: history.filter(message => message.role === 'tool'),
      liveStreamText: 'Still waiting. More text.', liveStreamStartedAt: 1000,
      activeRunId: 'bridge-main', activeTurnId: 'native-main', inputMessageId: 'main' }).reverse();
    expect(rows.map(row => row.text)).toEqual(['Main task', 'Checking.', '', 'Keep waiting',
      'Continuing.', '', 'Keep waiting', 'Still waiting. More text.']);
    expect(new Set(rows.map(row => row.renderKey ?? row.id)).size).toBe(rows.length);
    expect(rows.filter(row => row.role === 'user').map(row => row.id)).toEqual(['main', 'guide1', 'guide2']);
  });

  it('recovers the original task across two guides using its explicit native turn', () => {
    const recovered = recoverLiveRunPresentation('Checking.\nContinuing.\nStill waiting.', sameRunHistory(), 'native-main', 'main');
    expect(recovered.tools.map(tool => tool.id)).toEqual(['toolcall_1', 'toolcall_2']);
    expect(recovered.segments.map(segment => [segment.id, segment.afterToolCount, segment.timestampMs]))
      .toEqual([['a', 0, 1000], ['b', 1, 2000]]);
    expect(recovered.tail).toBe('Still waiting.');
  });

  it('does not attach old live content to an identical next-turn send', () => {
    const history = [...sameRunHistory(), { id: 'next', role: 'user' as const, text: 'Keep waiting',
      idempotencyKey: 'next-key', turnId: 'native-next' },
    { id: 'next-answer', role: 'assistant' as const, text: 'Next turn answer.', turnId: 'native-next' }];
    const recovered = recoverLiveRunPresentation('Checking.\nContinuing.\nStill waiting.', history, 'native-main', 'main');
    expect(recovered.tools.map(tool => tool.id)).toEqual(['toolcall_1', 'toolcall_2']);
    const rows = buildLiveRunListData({ historyMessages: history,
      streamSegments: recovered.segments, toolMessages: recovered.tools,
      liveStreamText: recovered.tail, liveStreamStartedAt: 1000,
      activeRunId: 'bridge-main', activeTurnId: 'native-main', inputMessageId: 'main' }).reverse();
    expect(rows.at(-2)?.id).toBe('next');
    expect(rows.at(-1)?.id).toBe('next-answer');
    expect(rows.filter(row => row.text === 'Checking.')).toHaveLength(1);
  });

  it('keeps same-run guides between canonical paragraphs even when no tool separates them', () => {
    const history = sameRunHistory().filter(row => row.role !== 'tool');
    const text = 'Checking.\n\nContinuing.\n\nStill waiting.';
    const recovered = recoverLiveRunPresentation(text, history, 'native-main', 'main');
    expect(recovered.segments.map(row => row.id)).toEqual(['a', 'b']);
    expect(recovered.tailTimestampMs).toBe(3000);
    expect(recovered.tail).toBe('Still waiting.');
    const rows = buildLiveRunListData({ historyMessages: history, streamSegments: [], toolMessages: [],
      liveStreamText: text, liveStreamStartedAt: 1000, activeRunId: 'bridge-main', activeTurnId: 'native-main', inputMessageId: 'main', includePlaceholder: true }).reverse();
    expect(rows.map(row => row.text)).toEqual(['Main task', 'Checking.', 'Keep waiting', 'Continuing.', 'Keep waiting', 'Still waiting.']);
    expect(rows.filter(row => row.role === 'assistant').map(row => row.timestampMs)).toEqual([1000, 2000, 3000]);
    expect(rows.at(-1)?.renderKey).toBe(liveReplyRenderKey(1000, 'bridge-main', 2));
  });

  it('keeps distinct native paragraphs without tools or guides out of the growing cumulative bubble', () => {
    const history = sameRunHistory().filter(row => row.role === 'assistant' || row.id === 'main');
    const text = 'Checking.\n\nContinuing.\n\nStill waiting. More text.';
    const recovered = recoverLiveRunPresentation(text, history, 'native-main', 'main');
    expect(recovered.segments.map(row => row.id)).toEqual(['a', 'b']);
    expect(recovered.tail).toBe('Still waiting. More text.');
    const rows = buildLiveRunListData({ historyMessages: history, streamSegments: [], toolMessages: [],
      liveStreamText: text, liveStreamStartedAt: 1000, activeRunId: 'bridge-main',
      activeTurnId: 'native-main', inputMessageId: 'main' }).reverse();
    expect(rows.map(row => row.text)).toEqual(['Main task', 'Checking.', 'Continuing.', 'Still waiting. More text.']);
  });

  it('retains intentional repeated native prose as separate paragraphs within the confirmed turn', () => {
    const history: UiMessage[] = [{ id: 'main', role: 'user', text: 'Task', turnId: 'turn' },
      { id: 'a', role: 'assistant', text: 'Still checking.', turnId: 'turn' },
      { id: 'b', role: 'assistant', text: 'Still checking.', turnId: 'turn' }];
    const text = 'Still checking.\n\nStill checking. More text.';
    const recovered = recoverLiveRunPresentation(text, history, 'turn', 'main');
    expect(recovered.segments.map(row => row.id)).toEqual(['a']);
    expect(recovered.tail).toBe('Still checking. More text.');
  });

  it.each([undefined, 0, Number.NaN])('keeps an unreported or invalid canonical tail clock on the established fallback (%s)', timestampMs => {
    const history = sameRunHistory().filter(row => row.role !== 'tool');
    history.at(-1)!.timestampMs = timestampMs;
    const text = 'Checking.\n\nContinuing.\n\nStill waiting.';
    expect(recoverLiveRunPresentation(text, history, 'native-main', 'main').tailTimestampMs).toBeUndefined();
    const rows = buildLiveRunListData({ historyMessages: history, streamSegments: [], toolMessages: [],
      liveStreamText: text, liveStreamStartedAt: 1000, activeRunId: 'bridge-main', activeTurnId: 'native-main', inputMessageId: 'main' }).reverse();
    expect(rows.at(-1)?.timestampMs).toBe(1000);
  });

  it('anchors a warm optimistic main only through its proven native client key', () => {
    const history = sameRunHistory();
    history[0] = { id: 'optimistic-main', role: 'user', text: 'Main task', idempotencyKey: 'main-key' };
    const recovered = recoverLiveRunPresentation('Checking.\nContinuing.\nStill waiting.', history, 'native-main', 'native-original', 'main-key');
    expect(recovered.tools.map(tool => tool.id)).toEqual(['toolcall_1', 'toolcall_2']);
    const rows = buildLiveRunListData({ historyMessages: history, streamSegments: recovered.segments,
      toolMessages: recovered.tools, liveStreamText: recovered.tail, liveStreamStartedAt: 1000,
      activeRunId: 'bridge-main', activeTurnId: 'native-main', inputMessageId: 'native-original', inputMessageKey: 'main-key' }).reverse();
    expect(rows.filter(row => row.text === 'Checking.')).toHaveLength(1);
    expect(rows.filter(row => row.role === 'user').map(row => row.id)).toEqual(['optimistic-main', 'guide1', 'guide2']);
  });

  it('does not mistake the first visible guide in a partial page for the main input', () => {
    const history = sameRunHistory().slice(3);
    const recovered = recoverLiveRunPresentation('Checking.\nContinuing.\nStill waiting.', history, 'native-main', 'main');
    expect(recovered.segments).toEqual([]);
    expect(recovered.tools).toEqual([]);
    expect(recovered.tail).toBe('Checking.\nContinuing.\nStill waiting.');
  });

  it('keeps the legacy latest-user boundary when turn evidence is missing', () => {
    const history = sameRunHistory().map(({ turnId: _turnId, ...message }) => message);
    const recovered = recoverLiveRunPresentation('Checking.\nContinuing.\nStill waiting.', history);
    expect(recovered.tools).toEqual([]);
    expect(recovered.segments).toEqual([]);
    expect(recovered.tail).toBe('Checking.\nContinuing.\nStill waiting.');
  });

  it('recovers only current-turn snapshot prefixes and tool order', () => {
    const history: UiMessage[] = [
      { id: 'old', role: 'assistant', text: 'Earlier reply.' },
      { id: 'user', role: 'user', text: 'Check' },
      { id: 'a', role: 'assistant', text: 'Checking.', timestampMs: 1000 },
      { id: 'tool', role: 'tool', text: '', toolStatus: 'success' },
      { id: 'b', role: 'assistant', text: 'Found it.', timestampMs: 2000 },
      { id: 'tool2', role: 'tool', text: '', toolStatus: 'success' },
    ];
    const recovered = recoverLiveRunPresentation('Checking.\nFound it.\nWriting the answer.', history);
    expect(recovered.tail).toBe('Writing the answer.');
    expect(recovered.segments.map(segment => segment.afterToolCount)).toEqual([0, 1]);
    const rows = buildLiveRunListData({ historyMessages: history, streamSegments: recovered.segments,
      toolMessages: recovered.tools, liveStreamText: recovered.tail, liveStreamStartedAt: 1000, activeRunId: 'run' }).reverse();
    expect(rows.map(row => row.text)).toEqual(['Earlier reply.', 'Check', 'Checking.', '', 'Found it.', '', 'Writing the answer.']);
    expect(recoverLiveRunPresentation('Different reply.', history).segments).toEqual([]);
    const partial = recoverLiveRunPresentation('Checking.\nFound it. More text.', history.slice(0, -1));
    expect(partial.segments.map(segment => segment.text)).toEqual(['Checking.']);
    expect(partial.tail).toBe('Found it. More text.');
  });

  it('keeps a growing live tail once when history contains its partial prefix', () => {
    const rows = buildLiveRunListData({ historyMessages: [
      { id: 'u', role: 'user', text: 'Check' },
      { id: 'h', role: 'assistant', text: 'Writing' },
    ], streamSegments: [], toolMessages: [], liveStreamText: 'Writing the complete answer.',
    liveStreamStartedAt: 1000, activeRunId: 'run' }).reverse();
    expect(rows.map(row => row.text)).toEqual(['Check', 'Writing the complete answer.']);
    expect(rows[1].streaming).toBe(true);
  });
  it('interleaves stream segments and tool cards after stable history', () => {
    const historyMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Check status', timestampMs: 1000 },
    ];
    const list = buildLiveRunListData({
      historyMessages,
      streamSegments: [
        { id: 'seg_1', text: 'First streamed sentence.', timestampMs: 2000 },
      ],
      toolMessages: [
        { id: 'toolcall_1', role: 'tool', text: '', toolName: 'search', toolStatus: 'success' },
      ],
      liveStreamText: 'Second streamed sentence.',
      liveStreamStartedAt: 3000,
      activeRunId: 'run_1',
      nowMs: 3200,
    });

    expect(list.map((item) => item.id)).toEqual([
      'streaming',
      'toolcall_1',
      'seg_1',
      'u1',
    ]);
  });

  it('prefers stable history tool rows over transient tool rows with the same id', () => {
    const historyMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Check status', timestampMs: 1000 },
      { id: 'toolcall_1', role: 'tool', text: '', toolName: 'search', toolStatus: 'success' },
    ];
    const list = buildLiveRunListData({
      historyMessages,
      streamSegments: [],
      toolMessages: [
        { id: 'toolcall_1', role: 'tool', text: '', toolName: 'search', toolStatus: 'running' },
      ],
      liveStreamText: null,
      liveStreamStartedAt: null,
      activeRunId: 'run_1',
      nowMs: 3200,
    });

    expect(list.filter((item) => item.id === 'toolcall_1')).toHaveLength(1);
    expect(list.find((item) => item.id === 'toolcall_1')?.toolStatus).toBe('success');
  });

  it('hides the live stream bubble once a terminal message for the run exists in history', () => {
    const historyMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Check status', timestampMs: 1000 },
      { id: 'final_run_1', role: 'assistant', text: 'Done.', timestampMs: 2000 },
    ];
    const list = buildLiveRunListData({
      historyMessages,
      streamSegments: [],
      toolMessages: [],
      liveStreamText: 'Streaming text that should not render.',
      liveStreamStartedAt: 1500,
      activeRunId: 'run_1',
      nowMs: 3200,
    });

    expect(list.some((item) => item.id === 'streaming')).toBe(false);
  });

  it('hides the live stream bubble when the latest history message is already terminal', () => {
    const historyMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Check status', timestampMs: 1000 },
      { id: 'final_run_1', role: 'assistant', text: 'Done.', timestampMs: 2000 },
    ];
    const list = buildLiveRunListData({
      historyMessages,
      streamSegments: [],
      toolMessages: [],
      liveStreamText: 'Done.',
      liveStreamStartedAt: 1500,
      activeRunId: null,
      nowMs: 3260,
    });

    expect(list.some((item) => item.id === 'streaming')).toBe(false);
  });

  it('delays showing a very short live stream bubble until it has existed briefly', () => {
    const historyMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Check status', timestampMs: 1000 },
    ];

    const immediateList = buildLiveRunListData({
      historyMessages,
      streamSegments: [],
      toolMessages: [],
      liveStreamText: 'Hi',
      liveStreamStartedAt: 3000,
      activeRunId: 'run_1',
      nowMs: 3200,
    });
    const delayedList = buildLiveRunListData({
      historyMessages,
      streamSegments: [],
      toolMessages: [],
      liveStreamText: 'Hi',
      liveStreamStartedAt: 3000,
      activeRunId: 'run_1',
      nowMs: 3260,
    });

    expect(immediateList.some((item) => item.id === 'streaming')).toBe(false);
    expect(delayedList.some((item) => item.id === 'streaming')).toBe(true);
  });

  it('never renders silent NO_REPLY lead fragments as transient assistant bubbles', () => {
    const historyMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Check status', timestampMs: 1000 },
    ];

    const list = buildLiveRunListData({
      historyMessages,
      streamSegments: [
        { id: 'seg_1', text: 'NO', timestampMs: 2000 },
      ],
      toolMessages: [],
      liveStreamText: 'NO_REPLY',
      liveStreamStartedAt: 3000,
      activeRunId: 'run_1',
      nowMs: 3300,
    });

    expect(list.some((item) => item.role === 'assistant' && item.streaming)).toBe(false);
  });
});

describe('mergeNewestFirstMessages', () => {
  it('stably interleaves pair cards without moving untimed live rows', () => {
    const sessionMessages: UiMessage[] = [
      { id: 'streaming', role: 'assistant', text: 'Current live text' },
      { id: 'session-new', role: 'assistant', text: 'New', timestampMs: 300 },
      { id: 'session-old', role: 'user', text: 'Old', timestampMs: 100 },
    ];
    const pairMessages: UiMessage[] = [
      { id: 'pair-new', role: 'system', text: '', timestampMs: 400 },
      { id: 'pair-middle', role: 'system', text: '', timestampMs: 200 },
      { id: 'pair-tied', role: 'system', text: '', timestampMs: 100 },
    ];

    expect(mergeNewestFirstMessages(sessionMessages, pairMessages).map((message) => message.id))
      .toEqual([
        'streaming',
        'pair-new',
        'session-new',
        'pair-middle',
        'session-old',
        'pair-tied',
      ]);
  });
});


it('keeps one reply row through waiting, server run adoption, text and finalization', () => {
  const base = { historyMessages: [] as UiMessage[], streamSegments: [], toolMessages: [], liveStreamStartedAt: 1000, activeRunId: 'optimistic', includePlaceholder: true, nowMs: 1200 };
  const waiting = buildLiveRunListData({ ...base, liveStreamText: null })[0];
  const early = buildLiveRunListData({ ...base, activeRunId: 'server', liveStreamText: 'Hi' })[0];
  const streaming = buildLiveRunListData({ ...base, activeRunId: 'server', liveStreamText: 'Hello, here is the answer.' })[0];
  expect(waiting.text).toBe('');
  expect(early.text).toBe('');
  expect(streaming.text).toBe('Hello, here is the answer.');
  expect(early.renderKey).toBe(waiting.renderKey);
  expect(streaming.renderKey).toBe(waiting.renderKey);
  const final: UiMessage = { id: 'final_server', role: 'assistant', text: streaming.text, renderKey: liveReplyRenderKey(1000, 'server', 0) };
  expect(buildLiveRunListData({ ...base, activeRunId: null, liveStreamText: null, historyMessages: [final] })).toEqual([final]);
  expect(final.renderKey).toBe(streaming.renderKey);
});

it('keeps a committed text segment mounted while giving the next segment a separate identity', () => {
  const key = liveReplyRenderKey(1000, 'run', 0);
  const list = buildLiveRunListData({ historyMessages: [], streamSegments: [{ id: 'segment-1', renderKey: key, text: 'Searching now', timestampMs: 2000 }], toolMessages: [], liveStreamStartedAt: 1000, activeRunId: 'run', includePlaceholder: true, liveStreamText: null });
  expect(list.map(message => message.renderKey)).toEqual([liveReplyRenderKey(1000, 'run', 1), key]);
});


it('keeps text after all preceding tools, and commits exactly the live order without duplicate aggregate text', () => {
  const segments = [
    { id: 's0', text: 'First.', timestampMs: 1000, renderKey: 'reply:1:0', afterToolCount: 0 },
    { id: 's1', text: 'Second.', timestampMs: 2000, renderKey: 'reply:1:1', afterToolCount: 2 },
  ];
  const tools: UiMessage[] = ['a', 'b', 'c'].map(id => ({ id, role: 'tool', text: '', toolStatus: 'success' }));
  const live = buildLiveRunListData({ historyMessages: [], streamSegments: segments, toolMessages: tools, liveStreamText: 'Final answer.', liveStreamStartedAt: 1, activeRunId: 'run', includePlaceholder: true }).reverse();
  const tail = finalReplyTail('First.\nSecond.\nFinal answer.', segments, 'Final answer.');
  const finished = finishLiveRunPresentation({ segments, tools, tail, runId: 'run', startedAt: 1 });
  expect(live.map(message => message.id)).toEqual(['s0', 'a', 'b', 's1', 'c', 'streaming']);
  expect(finished.map(message => message.text)).toEqual(live.map(message => message.text));
  expect(finished.map(message => message.renderKey ?? message.id)).toEqual(live.map(message => message.renderKey ?? message.id));
  expect(finished.every(message => !message.streaming)).toBe(true);
  expect(finalReplyTail('First.', segments.slice(0, 1), 'First.')).toBe('First.');
  expect(finalReplyTail('Different final.', segments)).toBe('Different final.');
});
