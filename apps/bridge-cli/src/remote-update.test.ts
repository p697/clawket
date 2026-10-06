import { afterEach, describe, expect, it, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  createRemoteUpdateControl, installedBundleEntry, launchRemoteUpdater, readRemoteUpdateStatus, remoteUpdateOptOutPath,
  remoteUpdateStatusPath, writeRemoteUpdateProgress,
} from './remote-update.js';
import { handleUpdateCommand } from './update.js';

vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal<typeof childProcess>();
  return { ...original, spawn: vi.fn(original.spawn) };
});

const id = '5b0c7a0e-3c1f-4e8e-9b2a-6f1d2c3b4a59';
const entry = '/installed/node_modules/@p697/clawket/dist/index.js';
const seed = (value: Record<string, unknown>) => { mkdirSync(dirname(remoteUpdateStatusPath()), { recursive: true }); writeFileSync(remoteUpdateStatusPath(), JSON.stringify(value)); };
const stored = () => JSON.parse(readFileSync(remoteUpdateStatusPath(), 'utf8'));
const lockPath = () => join(homedir(), '.clawket', 'runtime', 'update.lock');
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
function fakeChild(): childProcess.ChildProcess {
  return Object.assign(new EventEmitter(), { unref: vi.fn() }) as unknown as childProcess.ChildProcess;
}
afterEach(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.mocked(childProcess.spawn).mockReset();
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  for (const path of [remoteUpdateStatusPath(), remoteUpdateOptOutPath(), lockPath()]) rmSync(path, { force: true });
});

describe('phone-started update control', () => {
  it('is unavailable without an installed bundle or when the computer opted out', async () => {
    expect(createRemoteUpdateControl({ entry: null }).available()).toBe(false);
    expect(await createRemoteUpdateControl({ entry: null }).start()).toEqual({ accepted: false, reason: 'disabled' });
    const launch = vi.fn();
    const control = createRemoteUpdateControl({ entry, launch });
    expect(control.available()).toBe(true);
    mkdirSync(dirname(remoteUpdateOptOutPath()), { recursive: true }); writeFileSync(remoteUpdateOptOutPath(), '');
    expect(control.available()).toBe(false);
    expect(await control.start()).toEqual({ accepted: false, reason: 'disabled' });
    expect(launch).not.toHaveBeenCalled();
  });

  it('starts one run from its own bundle and refuses a second while one is in progress', async () => {
    const launch = vi.fn();
    const control = createRemoteUpdateControl({ entry, launch });
    const first = await control.start();
    expect(first).toMatchObject({ accepted: true, status: { state: 'checking' } });
    if (!first.accepted) throw new Error('not accepted');
    expect(launch).toHaveBeenCalledExactlyOnceWith(first.status.id, entry);
    expect(await control.start()).toEqual({ accepted: false, reason: 'running', status: first.status });
    rmSync(remoteUpdateStatusPath());
    writeFileSync(lockPath(), JSON.stringify({ pid: process.pid }));
    expect(await control.start()).toEqual({ accepted: false, reason: 'running' });
    expect(launch).toHaveBeenCalledOnce();
  });

  it('lets only one of several simultaneous starts launch an updater', async () => {
    const launch = vi.fn();
    const controls = [createRemoteUpdateControl({ entry, launch }), createRemoteUpdateControl({ entry, launch })];
    const results = await Promise.all(controls.map(control => control.start()));
    expect(results.filter(result => result.accepted)).toHaveLength(1);
    expect(launch).toHaveBeenCalledOnce();
    mkdirSync(dirname(remoteUpdateStatusPath()), { recursive: true });
    rmSync(remoteUpdateStatusPath());
    writeFileSync(`${remoteUpdateStatusPath()}.lock`, '');
    expect(await controls[0].start()).toEqual({ accepted: false, reason: 'running' });
    rmSync(`${remoteUpdateStatusPath()}.lock`);
  });

  it('accepts a new run once the previous one finished', async () => {
    seed({ id, state: 'failed', startedAt: 1, finishedAt: 2, reason: 'busy' });
    const launch = vi.fn();
    expect(await createRemoteUpdateControl({ entry, launch }).start()).toMatchObject({ accepted: true });
    expect(stored().id).not.toBe(id);
  });
});

describe('phone-started update status', () => {
  it('never exposes the updater pid and reports a vanished updater as interrupted', () => {
    const now = 1_000_000_000;
    seed({ id, state: 'installing', startedAt: now - 1000, version: '3.1.14', pid: process.pid });
    expect(readRemoteUpdateStatus(now)).toMatchObject({ state: 'failed', reason: 'interrupted' });
    writeFileSync(lockPath(), JSON.stringify({ pid: process.pid }));
    expect(readRemoteUpdateStatus(now)).toEqual({ id, state: 'installing', startedAt: now - 1000, version: '3.1.14' });
    rmSync(lockPath());
    seed({ id, state: 'restarting', startedAt: now - 1000, pid: 2 ** 30 });
    expect(readRemoteUpdateStatus(now)).toEqual({ id, state: 'failed', startedAt: now - 1000, reason: 'interrupted', finishedAt: now });
    seed({ id, state: 'checking', startedAt: now - 30_000 });
    expect(readRemoteUpdateStatus(now)?.state).toBe('checking');
    seed({ id, state: 'checking', startedAt: now - 61_000 });
    expect(readRemoteUpdateStatus(now)).toMatchObject({ state: 'failed', reason: 'interrupted' });
    seed({ id, state: 'updated', startedAt: 1, finishedAt: 2, pid: 2 ** 30, results: [{ backend: 'codex', state: 'updated' }] });
    expect(readRemoteUpdateStatus(now)).toEqual({ id, state: 'updated', startedAt: 1, finishedAt: 2, results: [{ backend: 'codex', state: 'updated' }] });
    writeFileSync(remoteUpdateStatusPath(), '{bad');
    expect(readRemoteUpdateStatus(now)).toBeNull();
  });

  it('writes progress only for the current unfinished run', () => {
    seed({ id, state: 'checking', startedAt: 1 });
    writeRemoteUpdateProgress('00000000-0000-0000-0000-000000000000', { state: 'installing' });
    expect(stored().state).toBe('checking');
    writeRemoteUpdateProgress(id, { state: 'waiting', waitingFor: 'codex' });
    expect(stored()).toMatchObject({ state: 'waiting', waitingFor: 'codex' });
    writeRemoteUpdateProgress(id, { state: 'updated', results: [{ backend: 'codex', state: 'updated' }] });
    expect(stored()).toMatchObject({ state: 'updated', finishedAt: expect.any(Number) });
    writeRemoteUpdateProgress(id, { state: 'failed', reason: 'error' });
    expect(stored().state).toBe('updated');
  });
});

describe('phone-started updater launch', () => {
  it('only trusts installed Clawket bundle layouts', () => {
    expect(installedBundleEntry('/missing/node_modules/@p697/clawket/dist/index.js')).toBeNull();
    expect(installedBundleEntry(join(homedir(), 'random.js'))).toBeNull();
  });

  it('leaves the requesting runtime\'s service cgroup or process tree on every platform', () => {
    vi.stubEnv('CLAWKET_UPDATE_ACTIVATION', '1');
    const spawn = vi.mocked(childProcess.spawn).mockImplementation(() => fakeChild());
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    launchRemoteUpdater(id, entry, '/node');
    expect(spawn).toHaveBeenLastCalledWith('/node', [entry, 'update', '--remote', id], expect.objectContaining({ detached: true }));
    expect((spawn.mock.lastCall![2] as { env: NodeJS.ProcessEnv }).env.CLAWKET_UPDATE_ACTIVATION).toBeUndefined();
    Object.defineProperty(process, 'platform', { value: 'win32' });
    launchRemoteUpdater(id, entry, '/node');
    expect(spawn).toHaveBeenLastCalledWith('/node', [entry, 'update', '--remote', id, '--relaunch'], expect.objectContaining({ detached: true, windowsHide: true }));
    Object.defineProperty(process, 'platform', { value: 'linux' });
    launchRemoteUpdater(id, entry, '/node');
    expect(spawn).toHaveBeenLastCalledWith('/node', [entry, 'update', '--remote', id], expect.anything());
    vi.stubEnv('INVOCATION_ID', 'systemd-unit');
    const scoped = fakeChild(); spawn.mockImplementationOnce(() => scoped);
    launchRemoteUpdater(id, entry, '/node');
    expect(spawn).toHaveBeenLastCalledWith('systemd-run', ['--user', '--scope', '--quiet', '--collect', '/node', entry, 'update', '--remote', id], expect.objectContaining({ detached: true }));
    scoped.emit('error', new Error('ENOENT'));
    expect(spawn).toHaveBeenLastCalledWith('/node', [entry, 'update', '--remote', id], expect.objectContaining({ detached: true }));
  });
});

describe('phone-started updater command', () => {
  it('validates the run id and relays the Windows launch', async () => {
    await expect(handleUpdateCommand(['--remote', 'not-an-id'])).rejects.toThrow('Invalid remote update');
    await expect(handleUpdateCommand(['--relaunch'])).rejects.toThrow('requires --remote');
    const spawn = vi.mocked(childProcess.spawn).mockImplementation(() => fakeChild());
    await handleUpdateCommand(['--remote', id, '--relaunch']);
    expect(spawn).toHaveBeenCalledExactlyOnceWith(process.execPath, [expect.any(String), 'update', '--remote', id], expect.objectContaining({ detached: true }));
  });

  it('records a fixed failure category and releases the lock', async () => {
    mkdirSync(join(homedir(), '.clawket'), { recursive: true });
    writeFileSync(join(homedir(), '.clawket', 'hermes-bridge.json'), JSON.stringify({ port: 9, token: 'hermes-token', host: '127.0.0.1', apiBaseUrl: 'http://127.0.0.1:9' }));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline /private/path'); }));
    seed({ id, state: 'checking', startedAt: Date.now() });
    try {
      await expect(handleUpdateCommand(['--remote', id])).rejects.toThrow('offline');
      expect(stored()).toMatchObject({ id, state: 'failed', reason: 'download', pid: process.pid, finishedAt: expect.any(Number) });
      expect(JSON.stringify(stored())).not.toContain('/private/path');
      expect(existsSync(lockPath())).toBe(false);
      writeFileSync(lockPath(), JSON.stringify({ pid: process.pid }));
      seed({ id, state: 'checking', startedAt: Date.now() });
      await expect(handleUpdateCommand(['--remote', id])).rejects.toThrow('still running');
      expect(stored()).toMatchObject({ state: 'failed', reason: 'running' });
    } finally { rmSync(join(homedir(), '.clawket', 'hermes-bridge.json'), { force: true }); }
  });
});
