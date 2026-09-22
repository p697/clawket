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
  it('reads the exact legacy Bridge tool repr as a tool without rewriting native data or parsing ordinary text', async () => {
    const directory = await createTempDirectory(); const dbPath = join(directory, 'state.db');
    const id = 'run_a27e2f1c7bd94a3f8b6e5d0a1c2b3d4e:tool:1';
    const content = `[{\'type\': \'toolCall\', \'id\': \'${id}\', \'name\': \'terminal\', \'arguments\': \'{"command":"sleep 45"}\'}]`;
    const ordinary = content.replace(id, 'example');
    initializeHermesStateDb(dbPath, [{ id: 'legacy' }], [
      { sessionId: 'legacy', role: 'assistant', content, timestamp: 1 },
      { sessionId: 'legacy', role: 'assistant', content: ordinary, timestamp: 2 },
      { sessionId: 'legacy', role: 'user', content, timestamp: 3 },
    ]);
    const before = await checksum(dbPath);
    const runner = new HermesPythonRunner({ hermesSourcePath: join(directory, 'missing'), hermesHomePath: directory, hermesPythonPath: process.platform === 'win32' ? 'python' : 'python3' });
    const result = await new HermesNativeSessionReader(dbPath, runner).readHistoryBySessionId('legacy');
    expect(result?.messages[0].content).toEqual([{ type: 'toolCall', id, name: 'terminal', arguments: '{"command":"sleep 45"}' }]);
    expect(result?.messages[1].content).toBe(ordinary);
    expect(result?.messages[2].content).toBe(content);
    expect(await checksum(dbPath)).toBe(before);
  });
  it('keeps an interrupted command failed after rebuilding the native reader', async () => {
    const directory = await createTempDirectory();
    const dbPath = join(directory, 'state.db');
    initializeHermesStateDb(dbPath, [{ id: 'stop-fixture', title: 'Stop fixture' }], [
      { sessionId: 'stop-fixture', role: 'tool', content: JSON.stringify({ output: '[Command interrupted]', exit_code: 130, error: null }), timestamp: 1 },
    ]);
    const runner = new HermesPythonRunner({ hermesSourcePath: join(directory, 'missing'), hermesHomePath: directory,
      hermesPythonPath: process.platform === 'win32' ? 'python' : 'python3' });
    for (let pass = 0; pass < 2; pass += 1) {
      const history = await new HermesNativeSessionReader(dbPath, runner).readHistoryBySessionId('stop-fixture');
      expect(history?.messages[0]).toMatchObject({ role: 'toolResult', isError: true });
    }
  });

  it('uses read-only SQLite, excludes the Bridge namespace, and keeps only local pin available', async () => {
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
      hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
    });
    const reader = new HermesNativeSessionReader(dbPath, runner);

    const sessions = await reader.listSessions(20);
    expect(sessions).toEqual([
      expect.objectContaining({
        key: 'main',
        sessionId: 'main',
        source: 'native',
        kind: 'main',
        preview: 'two',
        lastMessagePreview: 'two',
        allowedActions: { rename: false, reset: false, delete: false, pin: true },
      }),
    ]);
    const history = await reader.readHistoryBySessionId('main');
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
      hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
    }));
    expect(await reader.listSessions(5)).toEqual([]);
    expect(reader.consumeWarnings()[0]).toMatch(/read-only query failed/);
  });
});

async function checksum(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
