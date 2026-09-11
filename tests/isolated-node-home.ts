import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, vi } from 'vitest';

// Every Node test starts in a disposable profile. A test that restores its own
// HOME stub returns here, never to the developer's actual pairing credentials.
const originalHome = process.env.HOME;
const originalProfile = process.env.USERPROFILE;
const directory = mkdtempSync(join(tmpdir(), 'clawket-test-profile-'));
process.env.HOME = directory;
process.env.USERPROFILE = directory;
vi.mock('node:os', async importOriginal => {
  const original = await importOriginal<typeof import('node:os')>();
  return { ...original, homedir: () => process.env.HOME ?? original.homedir() };
});
afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalProfile;
  rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
