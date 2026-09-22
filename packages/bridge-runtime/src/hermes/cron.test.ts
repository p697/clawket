import { createHash } from 'node:crypto';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesLocalBridge } from './index.js';
import { supportsHermesCronModels } from './cron.js';
import { cleanupTempDirectories, createTempDirectory, initializeHermesStateDb } from './test-helpers.js';

afterEach(cleanupTempDirectories);

describe('Hermes cron validation', () => {
  it('requires positive native model-parameter support and forwards explicit model pins', async () => {
    expect(await supportsHermesCronModels(vi.fn(async () => true) as any)).toBe(true);
    expect(await supportsHermesCronModels(vi.fn(async () => ({})) as any)).toBe(false);
    expect(await supportsHermesCronModels(vi.fn(async () => { throw new Error('old'); }) as any)).toBe(false);
    const { bridge } = await createCronBridge();
    bridge.runHermesPython = vi.fn(async () => ({ success: true, job_id: 'qa-job' })) as any;
    bridge.readHermesCronJobsFromDisk = vi.fn(() => ({ 'qa-job': { id: 'qa-job' } })) as any;
    await bridge.createHermesCronJob({ name: 'QA', prompt: 'Test', schedule: '@daily', model: 'deepseek-flash', provider: 'deepseek' });
    expect(bridge.runHermesPython).toHaveBeenLastCalledWith(expect.stringContaining('**model_fields'), expect.objectContaining({ model: 'deepseek-flash', provider: 'deepseek' }));
    await bridge.updateHermesCronJob('qa-job', { model: '', provider: '', base_url: '' });
    expect(bridge.runHermesPython).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ model: '', provider: '', base_url: '' }));
    const calls = vi.mocked(bridge.runHermesPython).mock.calls.length;
    await expect(bridge.updateHermesCronJob('qa-job', { model: '\u0000bad' })).rejects.toThrow('Invalid task model');
    expect(bridge.runHermesPython).toHaveBeenCalledTimes(calls);
  });

  it('confines output reads to bounded regular files in one job directory', async () => {
    const { bridge } = await createCronBridge();
    const root = join(bridge.hermesHomePath, 'cron', 'output');
    const directory = join(root, 'qa-job');
    const outside = join(bridge.hermesHomePath, 'private');
    await mkdir(directory, { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, 'secret.md'), 'Private');
    await symlink(outside, join(root, 'linked-job'), process.platform === 'win32' ? 'junction' : 'dir');
    await symlink(join(outside, 'secret.md'), join(directory, 'linked.md'));
    await writeFile(join(directory, 'large.md'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
    await writeFile(join(directory, 'invalid.md'), Buffer.from([0xff]));
    for (const job of ['../../private', 'linked-job', '..', '/private']) {
      expect(bridge.getHermesCronOutput(job, 'secret.md')).toBeNull();
      expect(bridge.listHermesCronOutputs({ jobId: job })).toEqual([]);
    }
    for (const name of ['../secret.md', 'linked.md', 'large.md', 'invalid.md']) {
      expect(bridge.getHermesCronOutput('qa-job', name)).toBeNull();
    }
    expect(bridge.listHermesCronOutputs({})).toEqual([]);
  });

  it.each([
    ['# Cron Job: Test\n\n**Status:** BLOCKED (configuration)\n\nNo agent ran.', 'error'],
    ['# Cron Job: Test (FAILED)\n\n## Response\n\nFailed.', 'error'],
    ['# Cron Job: Test\n\n**Status:** script failed\n\nMissing script.', 'error'],
    ['# Cron Job: Test\n\n## Response\n\nCompleted.', 'ok'],
    ['# Cron Job: Test\n\n**Status:** silent (empty output)\n', 'ok'],
    ['Unexpected output', 'unknown'],
  ])('reads the native outcome instead of assuming every file succeeded', async (content, status) => {
    const { bridge } = await createCronBridge();
    const directory = join(bridge.hermesHomePath, 'cron', 'output', 'qa-job');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, '2026-09-21_04-44-25.md'), content);
    expect(bridge.getHermesCronOutput('qa-job', '2026-09-21_04-44-25.md')?.status).toBe(status);
  });

  it('maps legacy no-delivery writes to the native local target', async () => {
    const { bridge } = await createCronBridge();
    bridge.runHermesPython = vi.fn(async () => ({ success: true, job_id: 'qa-job' })) as any;
    bridge.readHermesCronJobsFromDisk = vi.fn(() => ({ 'qa-job': { id: 'qa-job' } })) as any;
    await bridge.createHermesCronJob({ name: 'QA', prompt: 'Test', schedule: '@daily', deliver: 'none' });
    expect(bridge.runHermesPython).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ action: 'create', deliver: 'local' }));
    await bridge.updateHermesCronJob('qa-job', { deliver: 'none' });
    expect(bridge.runHermesPython).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ action: 'update', deliver: 'local' }));
  });

  it('repairs only an existing legacy none target before an explicit run', async () => {
    const { bridge } = await createCronBridge();
    const job = { id: 'qa-job', deliver: 'none' };
    bridge.readHermesCronJobsFromDisk = vi.fn(() => ({ 'qa-job': job })) as any;
    const python = vi.fn(async (_script: string, payload: Record<string, unknown>) => {
      if (payload.action === 'update') job.deliver = String(payload.deliver);
      return { success: true, job: { executed: true, execution_success: true, last_status: 'ok' } };
    });
    bridge.runHermesPython = python as any;
    await bridge.runHermesCronJob('qa-job');
    expect(python.mock.calls.map(call => call[1])).toEqual([
      { action: 'update', jobId: 'qa-job', deliver: 'local' }, { action: 'run', jobId: 'qa-job' },
    ]);
    job.deliver = 'telegram:original'; python.mockClear();
    await bridge.runHermesCronJob('qa-job');
    expect(python).toHaveBeenCalledTimes(1);
    expect(job.deliver).toBe('telegram:original');
  });

  it.each([
    [{ success: true, job: { executed: false, execution_skipped: 'Job is paused/disabled; resume it before running.' } }, 'paused/disabled'],
    [{ success: true, job: { executed: true, execution_success: false, execution_error: 'Model unavailable' } }, 'Model unavailable'],
    [{ success: true, job: { executed: true, execution_success: true, last_status: 'blocked_config', last_error: 'Invalid delivery' } }, 'Invalid delivery'],
    [{}, 'Failed'],
  ])('does not report a skipped or failed native run as accepted', async (result, error) => {
    const { bridge } = await createCronBridge();
    bridge.runHermesPython = vi.fn(async () => result) as any;
    await expect(bridge.runHermesCronJob('qa-job')).rejects.toThrow(error as string);
  });

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
      hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
      hermesStateDbPath: dbPath,
      sessionStorePath: join(directory, 'sessions.json'),
      usageLedgerPath: join(directory, 'usage.json'),
    }),
  };
}

async function checksum(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}
