import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesLocalBridge } from './index.js';
import {
  appendHermesMessage,
  cleanupTempDirectories,
  createTempDirectory,
  initializeHermesStateDb,
} from './test-helpers.js';

const bridges: HermesLocalBridge[] = [];

function trackBridge(bridge: HermesLocalBridge): HermesLocalBridge {
  bridges.push(bridge);
  return bridge;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()));
  await cleanupTempDirectories();
});

async function createBridgeWithDb(input?: {
  sessions?: Array<{ id: string; title?: string; source?: string }>;
  messages?: Array<{ sessionId: string; role: string; content: string; timestamp: number }>;
}): Promise<{ bridge: HermesLocalBridge; dbPath: string; directory: string }> {
  const directory = await createTempDirectory();
  const dbPath = join(directory, 'state.db');
  initializeHermesStateDb(dbPath, input?.sessions, input?.messages);
  return {
    directory,
    dbPath,
    bridge: trackBridge(new HermesLocalBridge({
      hermesStateDbPath: dbPath,
      hermesHomePath: join(directory, 'home'),
      hermesSourcePath: join(directory, 'missing-source'),
      hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
      sessionStorePath: join(directory, 'sessions.json'),
      usageLedgerPath: join(directory, 'usage.json'),
      startHermesIfNeeded: false,
    })),
  };
}

describe('HermesLocalBridge multi-session protocol', () => {
  it('does not replace a running gateway that rejects the configured credential', async () => {
    const bridge = trackBridge(new HermesLocalBridge({ startHermesIfNeeded: true }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const start = vi.spyOn(bridge, 'startHermesGatewayProcess');
    await expect(bridge.ensureHermesApiReady()).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(bridge.snapshot.lastError).toContain('rejected the configured API key');
  });
  it('keeps the managed API credential stable across Bridge restarts and isolated by scope', () => {
    const options = { bridgeToken: 'persistent-random-bridge-token', hermesHomePath: '/tmp/hermes-qa' };
    const first = trackBridge(new HermesLocalBridge(options));
    const restarted = trackBridge(new HermesLocalBridge(options));
    const another = trackBridge(new HermesLocalBridge({ ...options, apiBaseUrl: 'http://127.0.0.1:8643' }));
    expect(first.apiKey).toMatch(/^[a-f0-9]{64}$/);
    expect(restarted.apiKey).toBe(first.apiKey);
    expect(first.apiKey).not.toBe(first.bridgeToken);
    expect(another.apiKey).not.toBe(first.apiKey);
    expect(trackBridge(new HermesLocalBridge({ ...options, apiKey: 'explicit-key' })).apiKey).toBe('explicit-key');
  });

  it('reports a missing Hermes executable without an unhandled child-process error', async () => {
    const root = await createTempDirectory();
    const bridge = trackBridge(new HermesLocalBridge({
      hermesCommand: join(root, 'missing-hermes'), hermesSourcePath: root, hermesHomePath: root,
      sessionStorePath: join(root, 'sessions.json'), usageLedgerPath: join(root, 'usage.json'),
    }));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unreachable')));
    await expect(bridge.startHermesGatewayProcess()).resolves.toBe(false);
    expect(bridge.hermesChild).toBeNull();
    expect(bridge.snapshot.lastError).toMatch(/Hermes command was not found/);
    expect(bridge.apiKey).toBeTruthy();
  });

  it('creates, renames through title and legacy label, resets, and deletes only Bridge-owned sessions', async () => {
    const { bridge } = await createBridgeWithDb({
      sessions: [
        { id: 'native', title: 'Native' },
        { id: 'clawket-hermes:deleted:old', title: 'Deleted Bridge row', source: 'api_server' },
      ],
    });
    const created = await bridge.dispatchRequest('sessions.create', { title: 'Draft' }) as any;
    const key = created.session.key as string;
    const originalId = created.session.sessionId as string;
    expect(created.session).toMatchObject({ source: 'bridge', kind: 'direct', title: 'Draft' });

    await expect(bridge.dispatchRequest('sessions.patch', { key, title: 'Final' })).resolves.toEqual({ ok: true, key });
    await expect(bridge.dispatchRequest('sessions.patch', { key, label: 'Legacy' })).resolves.toEqual({ ok: true, key });
    const reset = await bridge.dispatchRequest('sessions.reset', { key }) as any;
    expect(reset).toMatchObject({ ok: true, key });
    expect(reset.sessionId).not.toBe(originalId);
    expect(reset.sessionId).toMatch(new RegExp(`^clawket-hermes:${key}:`));
    await expect(bridge.dispatchRequest('sessions.delete', { key })).resolves.toEqual({ ok: true, key });

    const listed = await bridge.dispatchRequest('sessions.list', { limit: 20 }) as any;
    expect(listed.sessions.map((session: any) => session.key)).toEqual(['native']);
    expect(listed.sessions[0]).toMatchObject({
      preview: '',
      source: 'native',
      allowedActions: { rename: false, reset: false, delete: false, pin: true },
    });
    await expect(bridge.dispatchRequest('sessions.delete', { key: 'native' })).rejects.toThrow(/read-only/);
    await expect(bridge.dispatchRequest('sessions.patch', { title: 'oops' })).rejects.toThrow(/requires key/);
    await expect(bridge.dispatchRequest('sessions.reset', {})).rejects.toThrow(/requires key/);
  });

  it('paginates with a same-timestamp keyset cursor that does not drift after concurrent inserts', async () => {
    const messages = Array.from({ length: 5 }, (_, index) => ({
      sessionId: 'history',
      role: 'user',
      content: `m${index + 1}`,
      timestamp: 100,
    }));
    const { bridge, dbPath } = await createBridgeWithDb({
      sessions: [{ id: 'history', title: 'History' }, { id: 'other', title: 'Other' }],
      messages,
    });
    const first = await bridge.dispatchRequest('chat.history', { sessionKey: 'history', limit: 2 }) as any;
    expect(first.messages.map((message: any) => message.content)).toEqual(['m4', 'm5']);
    expect(first.nextCursor).toEqual(expect.any(String));

    appendHermesMessage(dbPath, { sessionId: 'history', role: 'user', content: 'new', timestamp: 200 });
    const second = await bridge.dispatchRequest('chat.history', {
      sessionKey: 'history',
      limit: 2,
      cursor: first.nextCursor,
    }) as any;
    expect(second.messages.map((message: any) => message.content)).toEqual(['m2', 'm3']);
    expect(second.messages.map((message: any) => message.content)).not.toContain('new');
    const third = await bridge.dispatchRequest('chat.history', {
      sessionKey: 'history',
      limit: 2,
      cursor: second.nextCursor,
    }) as any;
    expect(third.messages.map((message: any) => message.content)).toEqual(['m1']);
    await expect(bridge.dispatchRequest('chat.history', {
      sessionKey: 'other',
      cursor: first.nextCursor,
    })).rejects.toThrow(/another session/);
    await expect(bridge.dispatchRequest('chat.history', {
      sessionKey: 'history',
      cursor: 'not-a-cursor',
    })).rejects.toThrow(/invalid/);
  });

  it('keeps an old cursor stable while local same-timestamp messages are partially persisted', async () => {
    const directory = await createTempDirectory();
    const dbPath = join(directory, 'state.db');
    const bridge = trackBridge(new HermesLocalBridge({
      hermesStateDbPath: dbPath,
      hermesHomePath: join(directory, 'home'),
      hermesSourcePath: join(directory, 'missing'),
      hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
      sessionStorePath: join(directory, 'sessions.json'),
    }));
    const created = await bridge.dispatchRequest('sessions.create', { title: 'Migrating' }) as any;
    for (let index = 1; index <= 5; index += 1) {
      bridge.sessionStore.appendMessage(created.session.key, {
        role: 'user',
        content: `local-${index}`,
        ts: 100_000,
      });
    }
    initializeHermesStateDb(dbPath, [{ id: created.session.sessionId, source: 'api_server' }], [1, 2, 3].map((index) => ({
      sessionId: created.session.sessionId,
      role: 'user',
      content: `local-${index}`,
      timestamp: 100,
    })));

    const first = await bridge.dispatchRequest('chat.history', {
      sessionKey: created.session.key,
      limit: 2,
    }) as any;
    expect(first.messages.map((message: any) => message.content)).toEqual(['local-4', 'local-5']);
    appendHermesMessage(dbPath, {
      sessionId: created.session.sessionId,
      role: 'user',
      content: 'local-5',
      timestamp: 100,
    });
    const second = await bridge.dispatchRequest('chat.history', {
      sessionKey: created.session.key,
      limit: 2,
      cursor: first.nextCursor,
    }) as any;
    expect(second.messages.map((message: any) => message.content)).toEqual(['local-2', 'local-3']);
  });

  it('preserves repeated role/content messages at different timestamps', async () => {
    const { bridge } = await createBridgeWithDb({
      sessions: [{ id: 'repeat' }],
      messages: [
        { sessionId: 'repeat', role: 'user', content: 'same', timestamp: 1 },
        { sessionId: 'repeat', role: 'user', content: 'same', timestamp: 2 },
      ],
    });
    const history = await bridge.dispatchRequest('chat.history', {
      sessionKey: 'repeat',
      limit: 10,
    }) as any;
    expect(history.messages.map((message: any) => message.content)).toEqual(['same', 'same']);
    expect(history.messages.map((message: any) => message.timestamp)).toEqual([1_000, 2_000]);
  });

  it('matches a partially persisted repeated message to the nearest local timestamp', async () => {
    const directory = await createTempDirectory();
    const dbPath = join(directory, 'state.db');
    const bridge = trackBridge(new HermesLocalBridge({
      hermesStateDbPath: dbPath,
      hermesHomePath: join(directory, 'home'),
      hermesSourcePath: join(directory, 'missing'),
      hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
      sessionStorePath: join(directory, 'sessions.json'),
    }));
    const created = await bridge.dispatchRequest('sessions.create', { title: 'Repeated' }) as any;
    bridge.sessionStore.appendMessage(created.session.key, {
      role: 'user',
      content: 'yes',
      ts: 1_000,
      _nativeBoundaryId: '0',
    });
    bridge.sessionStore.appendMessage(created.session.key, {
      role: 'user',
      content: 'yes',
      ts: 2_000,
      _nativeBoundaryId: '0',
    });
    initializeHermesStateDb(dbPath, [{ id: created.session.sessionId, source: 'api_server' }], [{
      sessionId: created.session.sessionId,
      role: 'user',
      content: 'yes',
      timestamp: 2,
    }]);

    const history = await bridge.dispatchRequest('chat.history', {
      sessionKey: created.session.key,
      limit: 10,
    }) as any;
    expect(history.messages.map((message: any) => message.content)).toEqual(['yes', 'yes']);
    expect(history.messages.map((message: any) => message.timestamp)).toEqual([1_000, 2_000]);
  });

  it('keeps a repeated local cursor stable when a later same-timestamp native row appears', async () => {
    const directory = await createTempDirectory();
    const dbPath = join(directory, 'state.db');
    const bridge = trackBridge(new HermesLocalBridge({
      hermesStateDbPath: dbPath,
      hermesHomePath: join(directory, 'home'),
      hermesSourcePath: join(directory, 'missing'),
      hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
      sessionStorePath: join(directory, 'sessions.json'),
    }));
    const created = await bridge.dispatchRequest('sessions.create', { title: 'Repeated cursor' }) as any;
    for (let index = 1; index <= 4; index += 1) {
      bridge.sessionStore.appendMessage(created.session.key, {
        role: 'user',
        content: 'same',
        ts: 100_000,
        idempotencyKey: `i${index}`,
      });
    }
    initializeHermesStateDb(
      dbPath,
      [{ id: created.session.sessionId, source: 'api_server' }],
      Array.from({ length: 4 }, () => ({
        sessionId: created.session.sessionId,
        role: 'user',
        content: 'same',
        timestamp: 100,
      })),
    );

    const first = await bridge.dispatchRequest('chat.history', {
      sessionKey: created.session.key,
      limit: 1,
    }) as any;
    expect(first.messages).toEqual([
      expect.objectContaining({ content: 'same', idempotencyKey: 'i4' }),
    ]);

    appendHermesMessage(dbPath, {
      sessionId: created.session.sessionId,
      role: 'user',
      content: 'same',
      timestamp: 100,
    });
    const second = await bridge.dispatchRequest('chat.history', {
      sessionKey: created.session.key,
      limit: 1,
      cursor: first.nextCursor,
    }) as any;
    expect(second.messages).toEqual([
      expect.objectContaining({ content: 'same', idempotencyKey: 'i3' }),
    ]);
  });

  it('retains a repeated user message after restart and reconciles only its newer native row', async () => {
    const directory = await createTempDirectory();
    const dbPath = join(directory, 'state.db');
    const options = {
      hermesStateDbPath: dbPath,
      hermesHomePath: join(directory, 'home'),
      hermesSourcePath: join(directory, 'missing'),
      hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
      sessionStorePath: join(directory, 'sessions.json'),
      usageLedgerPath: join(directory, 'usage.json'),
    };
    const firstBridge = trackBridge(new HermesLocalBridge(options));
    const created = await firstBridge.dispatchRequest('sessions.create', { title: 'Repeat' }) as any;
    await firstBridge.sessionStore.flush();
    initializeHermesStateDb(dbPath, [{ id: created.session.sessionId, source: 'api_server' }], [{
      sessionId: created.session.sessionId,
      role: 'user',
      content: 'same',
      timestamp: 1,
    }]);

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => (
      String(input).endsWith('/v1/runs')
        ? Response.json({ run_id: 'repeat-run' })
        : new Response('data: {"event":"run.completed","output":"done"}\n\n')
    )));
    const restarted = trackBridge(new HermesLocalBridge(options));
    await restarted.dispatchRequest('chat.send', {
      sessionKey: created.session.key,
      message: 'same',
    });
    const localMessage = restarted.sessionStore.findSession(created.session.key)!.messages[0]!;
    const beforePersistence = await restarted.dispatchRequest('chat.history', {
      sessionKey: created.session.key,
      limit: 10,
    }) as any;
    expect(beforePersistence.messages.filter((message: any) => (
      message.role === 'user' && message.content === 'same'
    ))).toHaveLength(2);

    appendHermesMessage(dbPath, {
      sessionId: created.session.sessionId,
      role: 'user',
      content: 'same',
      timestamp: localMessage.ts / 1_000,
    });
    const afterPersistence = await restarted.dispatchRequest('chat.history', {
      sessionKey: created.session.key,
      limit: 10,
    }) as any;
    expect(afterPersistence.messages.filter((message: any) => (
      message.role === 'user' && message.content === 'same'
    ))).toHaveLength(2);
  });

  it('rejects a cursor whose timestamp was changed independently of its boundary id', async () => {
    const { bridge } = await createBridgeWithDb({
      sessions: [{ id: 'tamper' }],
      messages: [
        { sessionId: 'tamper', role: 'user', content: 'old', timestamp: 1 },
        { sessionId: 'tamper', role: 'user', content: 'new', timestamp: 2 },
      ],
    });
    const first = await bridge.dispatchRequest('chat.history', {
      sessionKey: 'tamper',
      limit: 1,
    }) as any;
    const decoded = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString('utf8'));
    decoded.beforeTimestamp += 1;
    const tampered = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');
    await expect(bridge.dispatchRequest('chat.history', {
      sessionKey: 'tamper',
      limit: 1,
      cursor: tampered,
    })).rejects.toThrow(/timestamp/);
  });

  it('keeps native main readable until a legacy main send creates an independent Bridge session', async () => {
    const { bridge } = await createBridgeWithDb({
      sessions: [{ id: 'main', title: 'Native main' }],
      messages: [{ sessionId: 'main', role: 'user', content: 'native message', timestamp: 1 }],
    });
    const before = await bridge.dispatchRequest('chat.history', { sessionKey: 'main' }) as any;
    expect(before.messages[0].content).toBe('native message');

    const requests: Array<{ url: string; body?: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/v1/runs')) return Response.json({ run_id: 'run-1' });
      return new Response('data: {"event":"run.completed","output":"ok"}\n\n');
    }));

    await bridge.dispatchRequest('chat.send', {
      sessionKey: 'main',
      message: 'look',
      attachments: [{ type: 'image', mimeType: 'image/png', content: 'aGk=' }],
    });
    const start = requests.find((request) => request.url.endsWith('/v1/runs'))!;
    expect(start.body.conversation_history).toEqual([]);
    expect(start.body.session_id).toMatch(/^clawket-hermes:main:/);
    expect(bridge.sessionStore.findSession('main')?.messages[0]).toMatchObject({
      role: 'user', content: 'look', _imageCount: 1,
    });
    expect(start.body.input).toEqual([{
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,aGk=' } },
      ],
    }]);
  });

  it('uses exact native lookup even when the key is outside the list limit', async () => {
    const { bridge } = await createBridgeWithDb({
      sessions: [{ id: 'visible' }, { id: 'hidden' }],
      messages: [
        { sessionId: 'visible', role: 'user', content: 'new', timestamp: 20 },
        { sessionId: 'hidden', role: 'user', content: 'old', timestamp: 1 },
      ],
    });
    const listed = await bridge.dispatchRequest('sessions.list', { limit: 1 }) as any;
    expect(listed.sessions[0].key).toBe('visible');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(bridge.dispatchRequest('chat.send', {
      sessionKey: 'hidden',
      message: 'must not shadow',
    })).rejects.toThrow(/read-only/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(bridge.sessionStore.owns('hidden')).toBe(false);
  });

  it('never creates a non-main shadow when native lookup is unavailable', async () => {
    const directory = await createTempDirectory();
    const dbPath = join(directory, 'state.db');
    await writeFile(dbPath, 'broken sqlite');
    const bridge = trackBridge(new HermesLocalBridge({
      hermesStateDbPath: dbPath,
      hermesHomePath: join(directory, 'home'),
      hermesSourcePath: join(directory, 'missing'),
      hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
      sessionStorePath: join(directory, 'sessions.json'),
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(bridge.dispatchRequest('chat.send', {
      sessionKey: 'possibly-native',
      message: 'no shadow',
    })).rejects.toThrow(/create it before sending/);
    expect(bridge.sessionStore.owns('possibly-native')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hydrates a persisted Bridge descriptor preview from its read-only backing row after restart', async () => {
    const directory = await createTempDirectory();
    const dbPath = join(directory, 'state.db');
    const sessionStorePath = join(directory, 'sessions.json');
    const options = {
      hermesStateDbPath: dbPath,
      hermesHomePath: join(directory, 'home'),
      hermesSourcePath: join(directory, 'missing-source'),
      hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
      sessionStorePath,
      usageLedgerPath: join(directory, 'usage.json'),
      startHermesIfNeeded: false,
    };
    const first = trackBridge(new HermesLocalBridge(options));
    const created = await first.dispatchRequest('sessions.create', { title: 'Persisted' }) as any;
    await first.sessionStore.flush();
    initializeHermesStateDb(dbPath, [{
      id: created.session.sessionId,
      title: 'Hermes upstream title',
      source: 'api_server',
    }], [{
      sessionId: created.session.sessionId,
      role: 'assistant',
      content: 'restored preview',
      timestamp: 50,
    }]);

    const restarted = trackBridge(new HermesLocalBridge(options));
    const listed = await restarted.dispatchRequest('sessions.list', { limit: 10 }) as any;
    expect(listed.sessions).toEqual([
      expect.objectContaining({
        key: created.session.key,
        title: 'Persisted',
        preview: 'restored preview',
        lastMessagePreview: 'restored preview',
        source: 'bridge',
      }),
    ]);
  });

  it.each([
    [{ type: 'file', mimeType: 'text/plain', content: 'aGk=' }],
    [{ type: 'image', mimeType: 'image/png;name=x', content: 'aGk=' }],
    [{ type: 'image', mimeType: 'image/png', content: '***' }],
  ])('rejects invalid attachments before upstream fetch', async (attachments) => {
    const { bridge } = await createBridgeWithDb();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(bridge.dispatchRequest('chat.send', {
      sessionKey: 'main',
      message: 'bad',
      attachments,
    })).rejects.toThrow(/attachment/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not let an abort runId cancel another session', async () => {
    const { bridge } = await createBridgeWithDb();
    const controller = new AbortController();
    bridge.activeRuns.set('run-a', {
      runId: 'run-a',
      sessionKey: 'a',
      sessionId: 'clawket-hermes:a:1',
      abortController: controller,
    });
    await expect(bridge.dispatchRequest('chat.abort', { sessionKey: 'b', runId: 'run-a' })).resolves.toEqual({
      ok: true,
      abortedRunIds: [],
      upstreamCancelled: false,
    });
    expect(controller.signal.aborted).toBe(false);
    expect(bridge.activeRuns.has('run-a')).toBe(true);
  });

  it.each(['reset', 'delete', 'stop'] as const)(
    'cancels a pending /v1/runs start during session %s',
    async (action) => {
      const { bridge } = await createBridgeWithDb();
      vi.stubGlobal('fetch', vi.fn((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      })));
      const send = bridge.dispatchRequest('chat.send', { sessionKey: 'main', message: 'slow' });
      const rejectedSend = expect(send).rejects.toThrow(/aborted/);
      await vi.waitFor(() => expect(bridge.pendingRunStarts.size).toBe(1));
      if (action === 'reset') {
        await bridge.dispatchRequest('sessions.reset', { key: 'main' });
      } else if (action === 'delete') {
        await bridge.dispatchRequest('sessions.delete', { key: 'main' });
      } else {
        await bridge.stop();
      }
      await rejectedSend;
      expect(bridge.pendingRunStarts.size).toBe(0);
      expect(bridge.activeRuns.size).toBe(0);
    },
  );
});
