import { UiMessage } from '../types/chat';
import { buildLiveRunListData, mergeNewestFirstMessages } from './liveRunThread';

describe('buildLiveRunListData', () => {
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
