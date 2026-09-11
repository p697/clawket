import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesLocalBridge } from './index.js';
import { cleanupTempDirectories, createTempDirectory, initializeHermesStateDb } from './test-helpers.js';

afterEach(async () => {
  vi.unstubAllGlobals();
  await cleanupTempDirectories();
});

describe('Hermes stream request mapping', () => {
  it('sends only prior turns in conversation_history', async () => {
    const directory = await createTempDirectory();
    const dbPath = join(directory, 'state.db');
    initializeHermesStateDb(dbPath);
    const bridge = new HermesLocalBridge({
      hermesStateDbPath: dbPath,
      hermesHomePath: join(directory, 'home'),
      hermesSourcePath: join(directory, 'missing'),
      hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
      sessionStorePath: join(directory, 'sessions.json'),
      usageLedgerPath: join(directory, 'usage.json'),
    });
    const created = await bridge.dispatchRequest('sessions.create', { title: 'Thread' }) as any;
    bridge.sessionStore.appendMessage(created.session.key, {
      role: 'user',
      content: 'prior',
      ts: 1,
    });
    let startBody: any;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/v1/runs')) {
        startBody = JSON.parse(String(init?.body));
        return Response.json({ run_id: 'run-prior' });
      }
      return new Response('data: {"event":"run.completed","output":"done"}\n\n');
    }));

    await bridge.dispatchRequest('chat.send', {
      sessionKey: created.session.key,
      message: 'current',
    });
    expect(startBody.input).toBe('current');
    expect(startBody.conversation_history).toEqual([{ role: 'user', content: 'prior' }]);
  });

  it('restores native prior turns after restart without duplicating the current turn', async () => {
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
    const firstBridge = new HermesLocalBridge(options);
    const created = await firstBridge.dispatchRequest('sessions.create', { title: 'Restarted' }) as any;
    await firstBridge.sessionStore.flush();
    initializeHermesStateDb(dbPath, [{ id: created.session.sessionId, source: 'api_server' }], [
      { sessionId: created.session.sessionId, role: 'user', content: 'before restart', timestamp: 1 },
      { sessionId: created.session.sessionId, role: 'assistant', content: 'prior answer', timestamp: 2 },
    ]);

    let startBody: any;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/v1/runs')) {
        startBody = JSON.parse(String(init?.body));
        return Response.json({ run_id: 'run-restart' });
      }
      return new Response('data: {"event":"run.completed","output":"done"}\n\n');
    }));
    const restarted = new HermesLocalBridge(options);
    await restarted.dispatchRequest('chat.send', {
      sessionKey: created.session.key,
      message: 'after restart',
    });

    expect(startBody.conversation_history).toEqual([
      { role: 'user', content: 'before restart' },
      { role: 'assistant', content: 'prior answer' },
    ]);
    expect(startBody.conversation_history).not.toContainEqual({
      role: 'user',
      content: 'after restart',
    });
  });
});
