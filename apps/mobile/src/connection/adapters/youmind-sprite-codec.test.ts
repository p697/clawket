import fixture from '../../../../../tests/fixtures/youmind-sprite/session-stream-v1.json';
import {
  createYouMindSpriteChunkState,
  mapYouMindSpriteChunk,
  mapYouMindSpriteHistory,
  type YouMindCompletionChunk,
} from './youmind-sprite-codec';

describe('YouMind Sprite recorded contract codec', () => {
  it('keeps one run identity across task, generation and assistant message events', () => {
    const state = createYouMindSpriteChunkState('requested-run');
    const chunks: YouMindCompletionChunk[] = [
      { mode: 'event', event: 'task-started' },
      { mode: 'insert', dataType: 'Generation', data: { id: 'generation-id' } },
      { mode: 'insert', dataType: 'Message', data: { id: 'assistant-id', role: 'assistant', blocks: [] } },
      { mode: 'insert', dataType: 'CompletionBlock', data: { id: 'block-id', type: 'content', data: 'Hello' } },
      { mode: 'event', event: 'task-ended' },
    ];
    const updates = chunks.flatMap((chunk) => mapYouMindSpriteChunk(chunk, 'main', state));
    expect(updates.map((update) => 'runId' in update && update.runId)).toEqual([
      'requested-run', 'requested-run', 'requested-run',
    ]);
    expect(updates.filter((update) => update.type === 'run_started')).toHaveLength(1);
    expect(updates.filter((update) => update.type === 'run_finished')).toHaveLength(1);
  });
  it('maps paginated history without leaking transport fields', () => {
    expect(mapYouMindSpriteHistory(fixture.sessionLoad, 'main')).toEqual({
      key: 'main',
      messages: [
        expect.objectContaining({ id: 'user-fixture-1', role: 'user', text: 'Hello' }),
        expect.objectContaining({ id: 'assistant-fixture-1', role: 'assistant', text: 'Hi there' }),
      ],
      nextCursor: 'cursor-fixture',
      hasActiveRun: false,
    });
  });

  it('maps the recorded stream to the canonical run lifecycle', () => {
    const state = createYouMindSpriteChunkState('local-run');
    const updates = fixture.stream.flatMap((chunk) => mapYouMindSpriteChunk(
      chunk as YouMindCompletionChunk,
      'main',
      state,
    ));

    expect(updates).toEqual(expect.arrayContaining([
      { type: 'run_started', sessionKey: 'main', runId: 'local-run' },
      {
        type: 'agent_thought_chunk',
        sessionKey: 'main',
        runId: 'local-run',
        text: 'Thinking',
      },
      expect.objectContaining({
        type: 'tool_call',
        toolCallId: 'tool-stream-1',
        title: 'googleSearch',
      }),
      expect.objectContaining({
        type: 'tool_call_update',
        toolCallId: 'tool-stream-1',
        status: 'success',
      }),
      {
        type: 'agent_message_chunk',
        sessionKey: 'main',
        runId: 'local-run',
        text: 'Final answer',
      },
      {
        type: 'run_finished',
        sessionKey: 'main',
        runId: 'local-run',
        stopReason: 'end_turn',
      },
    ]));
  });

  it('maps the recorded abort to a single cancelled terminal update', () => {
    const state = createYouMindSpriteChunkState('assistant-stream-1');
    expect(mapYouMindSpriteChunk(
      fixture.abort.event as YouMindCompletionChunk,
      'main',
      state,
    )).toEqual([{
      type: 'run_finished',
      sessionKey: 'main',
      runId: 'assistant-stream-1',
      stopReason: 'cancelled',
    }]);
    expect(mapYouMindSpriteChunk(
      fixture.abort.event as YouMindCompletionChunk,
      'main',
      state,
    )).toEqual([]);
  });
});
