import fixture from '../../../../../tests/fixtures/youmind-sprite/session-stream-v1.json';
import {
  createYouMindSpriteChunkState,
  mapYouMindSpriteChunk,
  mapYouMindSpriteHistory,
  type YouMindCompletionChunk,
} from './youmind-sprite-codec';

describe('YouMind Sprite recorded contract codec', () => {
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
      { type: 'run_started', sessionKey: 'main', runId: 'assistant-stream-1' },
      {
        type: 'agent_thought_chunk',
        sessionKey: 'main',
        runId: 'assistant-stream-1',
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
        runId: 'assistant-stream-1',
        text: 'Final answer',
      },
      {
        type: 'run_finished',
        sessionKey: 'main',
        runId: 'assistant-stream-1',
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
