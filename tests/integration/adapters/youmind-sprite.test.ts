// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import youMindFixture from '../../fixtures/youmind-sprite/session-stream-v1.json';
import './mobile-node-mocks';
import { flushMicrotasks } from './recorded-gateway';

type StreamRequest = {
  spriteId: string;
  userId: string;
  text: string;
  signal?: AbortSignal;
};

describe('YouMindSpriteAdapter Node integration', () => {
  it('connects, starts one recorded message stream, and cancels it', async () => {
    const { YouMindSpriteAdapter } = await import('../../../apps/mobile/src/connection/adapters/youmind-sprite');
    const updates: Array<Record<string, unknown>> = [];
    const promptText = youMindFixture.sessionLoad.messages[0].content;
    const streamRequests: StreamRequest[] = [];
    const abortSprite = vi.fn(async () => youMindFixture.abort.response);
    const api = {
      getStoredSession: vi.fn(async () => ({
        accessToken: 'fixture-access',
        refreshToken: 'fixture-refresh',
        expiresIn: 3_600,
        createdAtMs: 1,
        user: { id: 'user-fixture', email: 'fixture@example.invalid' },
      })),
      clearSession: vi.fn(async () => undefined),
      sendOtp: vi.fn(async () => undefined),
      verifyOtp: vi.fn(async () => {
        throw new Error('OTP is outside this integration boundary.');
      }),
      ensureDefaultSprite: vi.fn(async () => youMindFixture.ensureDefault.sprite),
      loadSpriteSession: vi.fn(async () => youMindFixture.sessionLoad),
      streamSpriteMessage: vi.fn(async (request: StreamRequest) => {
        streamRequests.push(request);
        return replayFirstRecordedChunkUntilAbort(
          youMindFixture.stream[0] as Record<string, unknown>,
          request.signal,
        );
      }),
      abortSprite,
    };

    const adapter = new YouMindSpriteAdapter({
      id: 'youmind-node-recording',
      backendKind: 'youmind',
      transportKind: 'https',
      label: 'Recorded Sprite',
      createdAt: 1_700_000_000_000,
      url: 'https://youmind.fixture.invalid',
      youmind: { authScopeKey: 'fixture-account' },
    }, {
      api: api as never,
      language: () => 'en',
      openingStore: {
        hasOpened: vi.fn(async () => true),
        markOpened: vi.fn(async () => undefined),
      },
    });
    adapter.on('update', (update) => updates.push(update as unknown as Record<string, unknown>));

    await adapter.connect();
    const sent = await adapter.prompt('main', {
      text: promptText,
      idempotencyKey: 'youmind-node-run',
    });
    await flushMicrotasks();
    await adapter.cancel('main', sent.runId);
    await flushMicrotasks();

    expect(adapter.state).toBe('ready');
    expect(streamRequests).toHaveLength(1);
    expect(streamRequests[0]).toEqual(expect.objectContaining({
      spriteId: youMindFixture.ensureDefault.sprite.id,
      userId: youMindFixture.ensureDefault.sprite.creatorId,
      text: promptText,
      signal: expect.any(AbortSignal),
    }));
    expect(abortSprite).toHaveBeenCalledTimes(1);
    expect(abortSprite).toHaveBeenCalledWith(expect.objectContaining(youMindFixture.abort.request));
    // Stream message IDs identify messages, not the adapter run being cancelled.
    expect(sent.runId).toBe('youmind-node-run');
    expect(updates.filter(update => update.type === 'run_started')).toHaveLength(1);
    expect(updates).toContainEqual(expect.objectContaining({
      type: 'run_started',
      runId: sent.runId,
    }));
    expect(updates).toContainEqual({
      type: 'run_finished',
      sessionKey: 'main',
      runId: 'youmind-node-run',
      stopReason: 'cancelled',
    });

    adapter.disconnect();
  });
});

async function* replayFirstRecordedChunkUntilAbort(
  firstChunk: Record<string, unknown>,
  signal?: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
  yield firstChunk;
  await new Promise<void>((_resolve, reject) => {
    const abort = () => reject(createAbortError());
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function createAbortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}
