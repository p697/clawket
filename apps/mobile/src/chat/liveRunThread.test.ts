import { UiMessage } from '../types/chat';
import { buildLiveRunListData, finalReplyTail, finishLiveRunPresentation, liveReplyRenderKey, mergeNewestFirstMessages, recoverLiveRunPresentation } from './liveRunThread';

describe('buildLiveRunListData', () => {
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
