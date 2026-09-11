import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HermesBridgeSessionStore } from './session-store.js';
import { cleanupTempDirectories, createTempDirectory } from './test-helpers.js';

afterEach(cleanupTempDirectories);

describe('HermesBridgeSessionStore', () => {
  it('advertises every action for a Bridge-owned main session', async () => {
    const directory = await createTempDirectory();
    const store = new HermesBridgeSessionStore(join(directory, 'sessions.json'));
    store.createSession({ key: 'main', title: 'Hermes' });

    expect(store.listSessions(1)[0]).toMatchObject({
      key: 'main',
      source: 'bridge',
      kind: 'main',
      allowedActions: { rename: true, reset: true, delete: true, pin: true },
    });
    await store.flush();
  });

  it('keeps one key-to-current-session index and rotates the id on reset', async () => {
    const directory = await createTempDirectory();
    const store = new HermesBridgeSessionStore(join(directory, 'sessions.json'));
    const created = store.createSession({ key: 'work', title: 'Work' });
    const originalSessionId = created.sessionId;
    store.appendMessage('work', { role: 'user', content: 'secret', ts: 10 });
    const reset = store.resetSession('work');

    expect(reset.key).toBe('work');
    expect(reset.title).toBe('Work');
    expect(reset.sessionId).not.toBe(originalSessionId);
    expect(reset.sessionId).toMatch(/^clawket-hermes:work:/);
    expect(store.getHistory('work').messages).toEqual([]);

    await store.flush();
    const persisted = await readFile(join(directory, 'sessions.json'), 'utf8');
    expect(persisted).not.toContain('secret');
    expect(JSON.parse(persisted).sessions).toHaveLength(1);
  });

  it('does not auto-create sessions during mutation or deletion', async () => {
    const directory = await createTempDirectory();
    const store = new HermesBridgeSessionStore(join(directory, 'sessions.json'));
    expect(() => store.appendMessage('native', { role: 'user', content: 'x', ts: 1 })).toThrow(/not found/);
    expect(store.deleteSession('native')).toBe(false);
    expect(store.count()).toBe(0);
  });
});
