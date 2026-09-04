import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HermesNativeSessionReader } from './native-sessions.js';
import { HermesPythonRunner } from './python-runner.js';
import {
  cleanupTempDirectories,
  createTempDirectory,
  initializeHermesStateDb,
} from './test-helpers.js';

afterEach(cleanupTempDirectories);

describe('HermesNativeSessionReader', () => {
  it('uses read-only SQLite, excludes the Bridge namespace, and reports native actions as disabled', async () => {
    const directory = await createTempDirectory();
    const dbPath = join(directory, 'state.db');
    initializeHermesStateDb(dbPath, [
      { id: 'main', title: 'Native main' },
      { id: 'clawket-hermes:main:old', title: 'Old Bridge main', source: 'api_server' },
    ], [
      { sessionId: 'main', role: 'user', content: 'one', timestamp: 1 },
      { sessionId: 'main', role: 'assistant', content: 'two', timestamp: 1 },
    ]);
    const before = await checksum(dbPath);
    const runner = new HermesPythonRunner({
      hermesSourcePath: join(directory, 'missing-source'),
      hermesHomePath: join(directory, 'home'),
      hermesPythonPath: 'python3',
    });
    const reader = new HermesNativeSessionReader(dbPath, runner);

    const sessions = reader.listSessions(20);
    expect(sessions).toEqual([
      expect.objectContaining({
        key: 'main',
        sessionId: 'main',
        source: 'native',
        kind: 'main',
        preview: 'two',
        lastMessagePreview: 'two',
        allowedActions: { rename: false, reset: false, delete: false, pin: false },
      }),
    ]);
    const history = reader.readHistoryBySessionId('main');
    expect(history?.messages.map((message) => message.content)).toEqual(['one', 'two']);
    expect(new Set(history?.messages.map((message) => message._cursorId)).size).toBe(2);
    expect(await checksum(dbPath)).toBe(before);
  });

  it('degrades with a warning when the native DB cannot be read', async () => {
    const directory = await createTempDirectory();
    const dbPath = join(directory, 'state.db');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(dbPath, 'not sqlite'));
    const reader = new HermesNativeSessionReader(dbPath, new HermesPythonRunner({
      hermesSourcePath: directory,
      hermesHomePath: directory,
      hermesPythonPath: 'python3',
    }));
    expect(reader.listSessions(5)).toEqual([]);
    expect(reader.consumeWarnings()[0]).toMatch(/read-only query failed/);
  });
});

async function checksum(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
