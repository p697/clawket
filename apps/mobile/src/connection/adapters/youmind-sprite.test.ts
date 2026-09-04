import type { PromptInput, SessionUpdate } from '@clawket/agent-protocol';
import fixture from '../../../../../tests/fixtures/youmind-sprite/session-stream-v1.json';
import type { YouMindAuthSession } from '../../services/storage';
import { YouMindSpriteAdapter } from './youmind-sprite';
import type {
  YouMindSprite,
  YouMindSpriteApi,
} from './youmind-sprite-api';
import type { YouMindCompletionChunk } from './youmind-sprite-codec';

const session: YouMindAuthSession = {
  accessToken: 'access-fixture',
  refreshToken: 'refresh-fixture',
  expiresIn: 3_600,
  createdAtMs: 1,
  user: { id: 'user-fixture', email: 'fixture@example.invalid' },
};

function createApi(overrides: Partial<YouMindSpriteApi> = {}): YouMindSpriteApi {
  return {
    getStoredSession: jest.fn(async () => session),
    clearSession: jest.fn(async () => undefined),
    sendOtp: jest.fn(async () => undefined),
    verifyOtp: jest.fn(async () => session),
    ensureDefaultSprite: jest.fn(async () => fixture.ensureDefault.sprite as YouMindSprite),
    loadSpriteSession: jest.fn(async () => fixture.sessionLoad as Record<string, unknown>),
    streamSpriteMessage: jest.fn(async () => chunks(fixture.stream as YouMindCompletionChunk[])),
    abortSprite: jest.fn(async () => fixture.abort.response),
    ...overrides,
  };
}

function createAdapter(api: YouMindSpriteApi, options: {
  opened?: boolean;
  language?: string;
  delay?: (milliseconds: number) => Promise<void>;
} = {}): YouMindSpriteAdapter {
  let opened = options.opened ?? true;
  return new YouMindSpriteAdapter({
    id: 'connection-youmind',
    backendKind: 'youmind',
    transportKind: 'https',
    label: 'Fixture Sprite',
    createdAt: 1,
    url: 'https://youmind.example.invalid',
    youmind: { authScopeKey: 'fixture-account' },
  }, {
    api,
    language: () => options.language ?? 'en',
    delay: options.delay,
    openingStore: {
      hasOpened: jest.fn(async () => opened),
      markOpened: jest.fn(async () => { opened = true; }),
    },
  });
}

describe('YouMindSpriteAdapter', () => {
  it('connects and exposes one credential-free Sprite agent and session', async () => {
    const api = createApi();
    const adapter = createAdapter(api);

    await adapter.connect();

    expect(adapter.state).toBe('ready');
    expect(adapter.connection).not.toHaveProperty('url');
    expect(adapter.connection).not.toHaveProperty('youmind');
    expect(await adapter.listAgents()).toEqual([expect.objectContaining({
      agentId: 'sprite-fixture',
      name: 'Fixture Sprite',
      avatarUrl: 'https://cdn.example.invalid/sprite.png',
      mainSessionKey: 'main',
    })]);
    expect(await adapter.listSessions()).toEqual([expect.objectContaining({
      key: 'main',
      allowedActions: { rename: false, reset: false, delete: false, pin: true },
    })]);
  });

  it('loads a cursor page and replays the recorded stream as canonical updates', async () => {
    const api = createApi();
    const adapter = createAdapter(api);
    const updates: SessionUpdate[] = [];
    adapter.on('update', (update) => updates.push(update));

    const history = await adapter.loadSession('main', { limit: 500, cursor: 'before' });
    await adapter.prompt('main', prompt('hello'));
    await flushAsync(30);

    expect(api.loadSpriteSession).toHaveBeenCalledWith(expect.objectContaining({
      spriteId: 'sprite-fixture',
      limit: 50,
      cursor: 'before',
    }));
    expect(history.nextCursor).toBe('cursor-fixture');
    expect(api.streamSpriteMessage).toHaveBeenCalledWith(expect.objectContaining({
      spriteId: 'sprite-fixture',
      userId: 'user-fixture',
      text: 'hello',
    }));
    expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'run_started', runId: 'assistant-stream-1' }),
      expect.objectContaining({ type: 'agent_message_chunk', text: 'Final answer' }),
      expect.objectContaining({ type: 'run_finished', stopReason: 'end_turn' }),
    ]));
  });

  it('sends the hidden localized opening only once for an empty first history', async () => {
    const streamSpriteMessage = jest.fn(async () => chunks([
      { mode: 'event', event: 'task-ended', data: { status: 'success' } },
    ] as YouMindCompletionChunk[]));
    const api = createApi({
      loadSpriteSession: jest.fn(async () => ({ messages: [], status: 'done' })),
      streamSpriteMessage,
    });
    const adapter = createAdapter(api, { opened: false, language: 'zh-Hans' });

    await adapter.loadSession('main');
    await flushAsync();
    await adapter.loadSession('main');

    expect(streamSpriteMessage).toHaveBeenCalledTimes(1);
    expect(streamSpriteMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: '\u9192\u6765\u5427',
    }));
  });

  it('aborts both the local stream and the server-side persona run', async () => {
    const pending = createPendingStream();
    const api = createApi({ streamSpriteMessage: jest.fn(async () => pending.stream) });
    const adapter = createAdapter(api);
    const updates: SessionUpdate[] = [];
    adapter.on('update', (update) => updates.push(update));

    await adapter.prompt('main', prompt('stop me'));
    await adapter.cancel('main', 'prompt-fixture');

    expect(api.abortSprite).toHaveBeenCalledWith(expect.objectContaining(
      fixture.abort.request,
    ));
    expect(updates).toContainEqual(expect.objectContaining({
      type: 'run_finished',
      runId: 'prompt-fixture',
      stopReason: 'cancelled',
    }));
    pending.finish();
    await flushAsync();
  });

  it('reconciles a broken stream after 3s, 6s and 12s backoff steps', async () => {
    const delay = jest.fn(async (_milliseconds: number) => undefined);
    const loadSpriteSession = jest.fn()
      .mockResolvedValueOnce({ messages: [], sessionStatus: { active: true } })
      .mockResolvedValueOnce({ messages: [], sessionStatus: { active: true } })
      .mockResolvedValueOnce({ messages: [], sessionStatus: { active: false } });
    const api = createApi({
      loadSpriteSession,
      streamSpriteMessage: jest.fn(async () => brokenStream()),
    });
    const adapter = createAdapter(api, { delay });
    const updates: SessionUpdate[] = [];
    adapter.on('update', (update) => updates.push(update));

    await adapter.prompt('main', prompt('recover'));
    await flushAsync(10);

    expect(delay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([3_000, 6_000, 12_000]);
    expect(updates).toContainEqual(expect.objectContaining({
      type: 'run_finished',
      stopReason: 'end_turn',
    }));
  });

  it('rejects unsupported attachments before opening a stream', async () => {
    const api = createApi();
    const adapter = createAdapter(api);
    await expect(adapter.prompt('main', {
      ...prompt('image'),
      attachments: [{ type: 'image', mimeType: 'image/png', content: 'base64' }],
    })).rejects.toMatchObject({ code: 'unsupported' });
    expect(api.streamSpriteMessage).not.toHaveBeenCalled();
  });
});

function prompt(text: string): PromptInput {
  return { text, idempotencyKey: 'prompt-fixture' };
}

async function* chunks(values: YouMindCompletionChunk[]): AsyncGenerator<YouMindCompletionChunk> {
  for (const value of values) yield value;
}

async function* brokenStream(): AsyncGenerator<YouMindCompletionChunk> {
  throw new Error('network interrupted');
}

function createPendingStream(): {
  stream: AsyncGenerator<YouMindCompletionChunk>;
  finish(): void;
} {
  let finish: (() => void) | undefined;
  const completed = new Promise<void>((resolve) => { finish = resolve; });
  return {
    stream: (async function* () {
      await completed;
    })(),
    finish: () => finish?.(),
  };
}

async function flushAsync(turns = 4): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}
