import {
  clearSessionRunState,
  markSessionRunDelta,
  markSessionRunStarted,
  rememberSessionRunIdentity,
  rememberSessionRunTool,
  settleSessionRunTool,
} from './sessionRunState';
import type { UiMessage } from '../types/chat';

describe('sessionRunState', () => {
  it('retains in-memory paragraph rows only for the same run and clears them on retirement', () => {
    const map = new Map();
    const state = markSessionRunDelta(map, 'chat', 'run', 'A.\n\nB.', 1000);
    const presentation = { owner: {}, segments: [{ id: 'a', text: 'A.', timestampMs: 1000 }], tools: [] };
    state.presentation = presentation;
    expect(markSessionRunStarted(map, 'chat', 'run', 2000).presentation).toBe(presentation);
    const next = markSessionRunDelta(map, 'chat', 'run', 'A.\n\nB. More.', 3000, true);
    expect(next.presentation).toBe(presentation);
    expect(next.streamText).toBe('A.\n\nB. More.');
    expect(markSessionRunStarted(map, 'chat', 'new-run', 4000).presentation).toBeUndefined();
    clearSessionRunState(map, 'chat', 'new-run');
    expect(map.has('chat')).toBe(false);
  });
  it('enriches only the original run and retains its text and clock across repeated starts', () => {
    const map = new Map();
    markSessionRunDelta(map, 'chat', 'run', 'A before the tool', 1000);
    rememberSessionRunIdentity(map, 'chat', 'run', 'native-turn', 'original-input');
    markSessionRunStarted(map, 'chat', 'run', 2000);
    markSessionRunDelta(map, 'chat', 'run', 'A before the tool. B after.', 3000);
    rememberSessionRunIdentity(map, 'chat', 'run', undefined, undefined);
    rememberSessionRunIdentity(map, 'chat', 'run', 'conflicting-turn', 'guide');
    expect(map.get('chat')).toEqual({ runId: 'run', streamText: 'A before the tool. B after.', startedAt: 1000,
      turnId: 'native-turn', inputMessageId: 'original-input' });
    markSessionRunStarted(map, 'chat', 'next', 4000);
    rememberSessionRunIdentity(map, 'chat', 'run', 'native-turn', 'original-input');
    expect(map.get('chat')).toEqual({ runId: 'next', streamText: null, startedAt: 4000 });
  });

  it('starts a run and keeps empty stream text by default', () => {
    const map = new Map();
    const state = markSessionRunStarted(map, 'agent:main', 'run_1', 1000);

    expect(state).toEqual({
      runId: 'run_1',
      streamText: null,
      startedAt: 1000,
    });
  });

  it('updates stream text for the same run', () => {
    const map = new Map();
    markSessionRunStarted(map, 'agent:main', 'run_1', 1000);
    markSessionRunDelta(map, 'agent:main', 'run_1', 'hello', 1100);
    const next = markSessionRunDelta(map, 'agent:main', 'run_1', 'hello world', 1200);

    expect(next).toEqual({
      runId: 'run_1',
      streamText: 'hello world',
      startedAt: 1000,
    });
  });

  it('ignores shorter delta text for the same run', () => {
    const map = new Map();
    markSessionRunDelta(map, 'agent:main', 'run_1', 'hello world', 1000);
    const next = markSessionRunDelta(map, 'agent:main', 'run_1', 'hello', 1100);

    expect(next.streamText).toBe('hello world');
    expect(next.startedAt).toBe(1000);
  });
  it('accepts a shorter authoritative snapshot without changing the run start', () => {
    const map = new Map();
    markSessionRunDelta(map, 'agent:main', 'run_1', 'Draft with a correction', 1000);
    const next = markSessionRunDelta(map, 'agent:main', 'run_1', 'Corrected', 1100, true);
    expect(next).toEqual({ runId: 'run_1', streamText: 'Corrected', startedAt: 1000 });
  });

  it('replaces state when a new run id arrives for the same session', () => {
    const map = new Map();
    markSessionRunDelta(map, 'agent:main', 'run_1', 'hello world', 1000);
    const next = markSessionRunStarted(map, 'agent:main', 'run_2', 2000);

    expect(next).toEqual({
      runId: 'run_2',
      streamText: null,
      startedAt: 2000,
    });
  });

  it('clears matching run state and keeps mismatched run state', () => {
    const map = new Map();
    markSessionRunStarted(map, 'agent:main', 'run_1', 1000);

    const mismatchCleared = clearSessionRunState(map, 'agent:main', 'run_2');
    const exactCleared = clearSessionRunState(map, 'agent:main', 'run_1');

    expect(mismatchCleared).toBe(false);
    expect(exactCleared).toBe(true);
    expect(map.has('agent:main')).toBe(false);
  });

  describe('noncurrent Codex tool boundaries', () => {
    const owner = {};
    const tool = (id: string, extra: Partial<UiMessage> = {}): UiMessage => ({ id: `toolcall_${id}`, role: 'tool', text: '', toolName: 'exec', toolStatus: 'running', ...extra });

    it('commits each paragraph before its tool with that paragraph\'s first clock', () => {
      const map = new Map();
      markSessionRunStarted(map, 'chat', 'run', 1_000);
      markSessionRunDelta(map, 'chat', 'run', 'First.', 1_000, true, 4_000);
      rememberSessionRunTool(map, 'chat', 'run', owner, tool('one'), 10_000);
      markSessionRunDelta(map, 'chat', 'run', 'First.\n\nSecond.', 1_000, true, 95_000);
      rememberSessionRunTool(map, 'chat', 'run', owner, tool('two'), 100_000);
      rememberSessionRunTool(map, 'chat', 'run', owner, tool('three'), 110_000);
      const state = map.get('chat');
      expect(state.streamTimestampMs).toBeUndefined();
      expect(state.presentation.segments).toEqual([
        { id: 'stream_segment_4000_0', renderKey: 'reply:1000:0', text: 'First.', timestampMs: 4_000, afterToolCount: 0 },
        { id: 'stream_segment_95000_1', renderKey: 'reply:1000:1', text: 'Second.', timestampMs: 95_000, afterToolCount: 1 },
      ]);
      expect(state.presentation.tools.map((row: UiMessage) => row.id)).toEqual(['toolcall_one', 'toolcall_two', 'toolcall_three']);
    });

    it('dates text without a reported clock by its commit time and ignores replays, other runs and other owners', () => {
      const map = new Map();
      markSessionRunDelta(map, 'chat', 'run', 'Text.', 1_000, true);
      map.get('chat').streamTimestampMs = undefined;
      rememberSessionRunTool(map, 'chat', 'run', owner, tool('one'), 7_000);
      const committed = map.get('chat').presentation;
      expect(committed.segments).toEqual([expect.objectContaining({ text: 'Text.', timestampMs: 7_000 })]);
      rememberSessionRunTool(map, 'chat', 'run', owner, { ...tool('one'), id: 'toolresult_one' }, 8_000);
      rememberSessionRunTool(map, 'chat', 'other-run', owner, tool('two'), 9_000);
      rememberSessionRunTool(map, 'missing', 'run', owner, tool('two'), 9_000);
      expect(map.get('chat').presentation).toBe(committed);
      expect(map.has('missing')).toBe(false);
      rememberSessionRunTool(map, 'chat', 'run', {}, tool('two'), 9_000);
      expect(map.get('chat').presentation.tools.map((row: UiMessage) => row.id)).toEqual(['toolcall_two']);
    });

    it('settles only a remembered call from the same run and owner', () => {
      const map = new Map();
      markSessionRunStarted(map, 'chat', 'run', 1_000);
      rememberSessionRunTool(map, 'chat', 'run', owner, tool('one', { toolStartedAt: 2_000 }), 2_000);
      const settle = (previous: UiMessage) => ({ ...previous, toolStatus: 'success' as const, toolFinishedAt: 5_000, toolDurationMs: 3_000 });
      settleSessionRunTool(map, 'chat', 'run', owner, { id: 'toolcall_missing', role: 'tool', text: '' }, settle);
      settleSessionRunTool(map, 'chat', 'other-run', owner, tool('one'), settle);
      settleSessionRunTool(map, 'chat', 'run', {}, tool('one'), settle);
      expect(map.get('chat').presentation.tools[0]).toMatchObject({ toolStatus: 'running', toolStartedAt: 2_000 });
      settleSessionRunTool(map, 'chat', 'run', owner, { id: 'toolresult_one', role: 'tool', text: '' }, previous => ({ ...settle(previous), id: 'toolresult_one' }));
      expect(map.get('chat').presentation.tools).toEqual([
        expect.objectContaining({ id: 'toolcall_one', toolStatus: 'success', toolStartedAt: 2_000, toolFinishedAt: 5_000, toolDurationMs: 3_000 }),
      ]);
    });
  });
});
