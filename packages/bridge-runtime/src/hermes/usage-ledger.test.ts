import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HermesLocalBridge } from './index.js';
import { cleanupTempDirectories, createTempDirectory, initializeHermesStateDb } from './test-helpers.js';

afterEach(cleanupTempDirectories);

describe('Hermes usage read model', () => {
  it('queries state.db read-only and returns an empty aggregate', async () => {
    const directory = await createTempDirectory();
    const dbPath = join(directory, 'state.db');
    initializeHermesStateDb(dbPath);
    const before = createHash('sha256').update(await readFile(dbPath)).digest('hex');
    const bridge = new HermesLocalBridge({
      hermesStateDbPath: dbPath,
      hermesHomePath: join(directory, 'home'),
      hermesSourcePath: join(directory, 'missing'),
      sessionStorePath: join(directory, 'sessions.json'),
      usageLedgerPath: join(directory, 'usage.json'),
    });
    await expect(bridge.dispatchRequest('sessions.usage', {
      startDate: '2026-01-01',
      endDate: '2026-01-02',
    })).resolves.toMatchObject({
      sessions: [],
      totals: { totalTokens: 0, totalCost: 0 },
    });
    const after = createHash('sha256').update(await readFile(dbPath)).digest('hex');
    expect(after).toBe(before);
  });
});
