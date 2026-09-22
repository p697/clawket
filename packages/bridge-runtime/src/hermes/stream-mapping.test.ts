import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesLocalBridge } from './index.js';
import { cleanupTempDirectories, createTempDirectory, initializeHermesStateDb } from './test-helpers.js';

const bridges: HermesLocalBridge[] = [];
afterEach(async () => {
  for (const bridge of bridges.splice(0)) await bridge.stop();
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
    bridges.push(bridge);
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

  it.each([false, true])('restores native prior turns after restart (native context=%s)', async nativeContext => {
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
    bridges.push(firstBridge);
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
    bridges.push(restarted);
    if (nativeContext) restarted.hermesRunCapabilities = new Set(['hermes.native-run-context.v1']);
    await restarted.dispatchRequest('chat.send', {
      sessionKey: created.session.key,
      message: 'after restart',
    });

    if (nativeContext) {
      expect(startBody).not.toHaveProperty('conversation_history');
      expect(startBody.session_id).toBe(created.session.sessionId);
      return;
    }
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
