import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesLocalBridge } from './index.js';
import { cleanupTempDirectories, createTempDirectory, initializeHermesStateDb } from './test-helpers.js';

afterEach(cleanupTempDirectories);

describe('Hermes cron validation', () => {
  it.each([
    [{ schedule: '* * * * *', prompt: 'x', skills: [] }],
    [{ name: 'x', schedule: '', prompt: 'x', skills: [] }],
    [{ name: 'x', schedule: '* * * * *', prompt: '', skills: [] }],
    [{ name: 'x', schedule: '* * * * *', prompt: 'x', skills: [''] }],
    [{ name: 'x', schedule: '* * * * *', prompt: 'x', skills: [], repeat: 1.5 }],
    [{ name: 'x', schedule: '* * * * *', prompt: 'x', skills: [], startAt: 'not-iso' }],
    [{ name: 'x', schedule: '* * * * *', prompt: 'x', skills: [], startAt: '' }],
    [{ name: 'x', schedule: '* * * * *', prompt: 'x', skills: [], startAt: 'September 5, 2026' }],
    [{ name: 'x', schedule: '* * * * *', prompt: 'x', skills: [], startAt: '2026-02-30T00:00:00Z' }],
    [{ name: 'x', schedule: '* * * * *', prompt: 'x', skills: [], deliver: 42 }],
    [{ name: 'x', schedule: '* * * * *', prompt: 'x', skills: [], scheduleDisplay: {} }],
  ])('rejects malformed create input before Python or disk mutation', async (payload) => {
    const { bridge, jobsPath } = await createCronBridge();
    const before = await checksum(jobsPath);
    const python = vi.fn();
    bridge.runHermesPython = python;
    await expect(bridge.dispatchRequest('hermes.cron.jobs.create', payload)).rejects.toThrow();
    expect(python).not.toHaveBeenCalled();
    expect(await checksum(jobsPath)).toBe(before);
  });

  it('allows prompt-only requests with skills=[] but fails closed without job_id', async () => {
    const { bridge } = await createCronBridge();
    const python = vi.fn(() => ({ success: true }));
    bridge.runHermesPython = python as any;
    await expect(bridge.dispatchRequest('hermes.cron.jobs.create', {
      name: 'Prompt task',
      schedule: '* * * * *',
      prompt: 'Do it',
      skills: [],
    })).rejects.toThrow(/job_id/);
    expect(python).toHaveBeenCalledTimes(1);
  });

  it('allows skills-only requests', async () => {
    const { bridge } = await createCronBridge();
    bridge.runHermesPython = vi.fn(() => ({ success: true, job_id: 'job-1' })) as any;
    bridge.readHermesCronJobsFromDisk = vi.fn(() => ({
      'job-1': { id: 'job-1', name: 'Skill task' },
    })) as any;
    await expect(bridge.dispatchRequest('hermes.cron.jobs.create', {
      name: 'Skill task',
      schedule: '@daily',
      skills: ['research'],
    })).resolves.toMatchObject({ job: { id: 'job-1' } });
  });
});

async function createCronBridge(): Promise<{ bridge: HermesLocalBridge; jobsPath: string }> {
  const directory = await createTempDirectory();
  const hermesHomePath = join(directory, 'home');
  const jobsPath = join(hermesHomePath, 'cron', 'jobs.json');
  await mkdir(join(hermesHomePath, 'cron'), { recursive: true });
  await writeFile(jobsPath, '{}\n');
  const dbPath = join(directory, 'state.db');
  initializeHermesStateDb(dbPath);
  return {
    jobsPath,
    bridge: new HermesLocalBridge({
      hermesHomePath,
      hermesSourcePath: join(directory, 'missing'),
      hermesPythonPath: 'python3',
      hermesStateDbPath: dbPath,
      sessionStorePath: join(directory, 'sessions.json'),
      usageLedgerPath: join(directory, 'usage.json'),
    }),
  };
}

async function checksum(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
