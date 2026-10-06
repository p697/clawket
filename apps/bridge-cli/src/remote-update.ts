import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isBridgeUpdateFinished, parseBridgeUpdateStatus, type BridgeUpdateStart, type BridgeUpdateStatus, type RemoteUpdateControl } from '@clawket/bridge-runtime';

/**
 * Phone-started official update (owner decision 2026-10-06). A runtime only launches
 * `clawket update --remote <id>` from its own installed bundle and reports the shared status file;
 * the phone never chooses a version, package, path or command.
 */
const clawketHome = () => join(homedir(), '.clawket');
export const remoteUpdateStatusPath = () => join(clawketHome(), 'runtime', 'remote-update.json');
/** Creating this file refuses phone-started updates on this computer. */
export const remoteUpdateOptOutPath = () => join(clawketHome(), 'disable-remote-update');
const updateLockPath = () => join(clawketHome(), 'runtime', 'update.lock');
/** Launch without an updater-written pid, or an updater that died, reads as interrupted after this. */
const LAUNCH_GRACE_MS = 60_000;
const ID = /^[a-f0-9-]{36}$/;
type StoredStatus = BridgeUpdateStatus & { pid?: number };
export type RemoteUpdateFailure = NonNullable<BridgeUpdateStatus['reason']>;
/** Updater-side fields; results keep the activation's own shape and are validated when read. */
export type RemoteUpdateProgress = {
  pid?: number;
  state?: BridgeUpdateStatus['state'];
  version?: string;
  waitingFor?: string;
  reason?: RemoteUpdateFailure;
  results?: readonly { backend: string; state: string; reason?: string; version?: string }[];
};

function alive(pid: unknown): boolean {
  if (!Number.isInteger(pid) || (pid as number) <= 0) return false;
  try { process.kill(pid as number, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

function readStored(): StoredStatus | null {
  const path = remoteUpdateStatusPath();
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.size > 16_384) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown };
    const status = parseBridgeUpdateStatus(raw);
    return status ? { ...status, ...(Number.isInteger(raw.pid) ? { pid: raw.pid as number } : {}) } : null;
  } catch { return null; }
}

function writeStored(status: Record<string, unknown>): void {
  const path = remoteUpdateStatusPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const pending = `${path}.${randomUUID()}`;
  writeFileSync(pending, JSON.stringify(status), { mode: 0o600 });
  renameSync(pending, path);
}

/** The phone-visible projection: no pid, and a vanished updater reads as interrupted. */
export function readRemoteUpdateStatus(now = Date.now()): BridgeUpdateStatus | null {
  const stored = readStored();
  if (!stored) return null;
  const { pid, ...status } = stored;
  if (isBridgeUpdateFinished(status)) return status;
  // The updater records its pid only after taking the update lock, and releases the lock after its result.
  const vanished = pid === undefined ? now - status.startedAt > LAUNCH_GRACE_MS : !alive(pid) || !updateRunning();
  return vanished ? { ...status, state: 'failed', reason: 'interrupted', finishedAt: now } : status;
}

/** Updater-side progress; a newer run or a finished one is never overwritten. */
export function writeRemoteUpdateProgress(id: string, patch: RemoteUpdateProgress): void {
  const current = readStored();
  if (!current || current.id !== id || isBridgeUpdateFinished(current)) return;
  writeStored({ ...current, ...patch, ...(patch.state === 'updated' || patch.state === 'failed' ? { finishedAt: Date.now() } : {}) });
}

function updateRunning(): boolean {
  try { return alive(JSON.parse(readFileSync(updateLockPath(), 'utf8')).pid); } catch { return false; }
}

/** The installed Clawket bundle this process runs from, or null in development/unknown layouts. */
export function installedBundleEntry(argv1 = process.argv[1]): string | null {
  try {
    const entry = realpathSync(argv1);
    return /[\\/](?:@p697[\\/]clawket|apps[\\/]bridge-cli)[\\/]dist[\\/]index\.js$/.test(entry) && lstatSync(entry).isFile() ? entry : null;
  } catch { return null; }
}

/** Makes the check-and-write of a new run atomic across this computer's runtimes. */
function withStartLock<T>(action: () => T): T | null {
  const path = `${remoteUpdateStatusPath()}.lock`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const take = () => { closeSync(openSync(path, 'wx', 0o600)); };
  try { take(); } catch {
    try { if (Date.now() - statSync(path).mtimeMs <= 10_000) return null; unlinkSync(path); take(); } catch { return null; }
  }
  try { return action(); } finally { try { unlinkSync(path); } catch { /* Already released. */ } }
}

const updateLogPath = () => join(clawketHome(), 'logs', 'bridge-update.log');
/** Spawns a detached child logging to the update log; the descriptor is opened per spawn. */
function spawnLogged(command: string, args: string[], env: NodeJS.ProcessEnv, onError?: () => void): void {
  mkdirSync(dirname(updateLogPath()), { recursive: true, mode: 0o700 });
  const fd = openSync(updateLogPath(), 'a', 0o600);
  try { spawn(command, args, { detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env }).once('error', () => onError?.()).unref(); }
  finally { closeSync(fd); }
}

/**
 * Starts the updater outside the requesting runtime's process tree and service cgroup: a systemd
 * user service stop kills its whole cgroup, and Windows `taskkill /T` follows parent process IDs.
 */
export function launchRemoteUpdater(id: string, entry: string, node = process.execPath): void {
  const env = { ...process.env };
  delete env.CLAWKET_UPDATE_ACTIVATION;
  const args = [entry, 'update', '--remote', id];
  const plain = () => spawnLogged(node, args, env);
  // Without systemd-run, a detached child is the best remaining option.
  if (process.platform === 'linux' && env.INVOCATION_ID) spawnLogged('systemd-run', ['--user', '--scope', '--quiet', '--collect', node, ...args], env, plain);
  else if (process.platform === 'win32') spawnLogged(node, [...args, '--relaunch'], env);
  else plain();
}

/** Windows relay: started by the runtime, it starts the real updater and exits at once. */
export function relaunchRemoteUpdater(id: string, entry = realpathSync(process.argv[1])): void {
  spawnLogged(process.execPath, [entry, 'update', '--remote', id], process.env);
}

export function createRemoteUpdateControl(options: { entry?: string | null; launch?: typeof launchRemoteUpdater } = {}): RemoteUpdateControl {
  const entry = options.entry === undefined ? installedBundleEntry() : options.entry;
  const launch = options.launch ?? launchRemoteUpdater;
  return {
    available: () => entry !== null && !existsSync(remoteUpdateOptOutPath()),
    async start(): Promise<BridgeUpdateStart> {
      if (entry === null || existsSync(remoteUpdateOptOutPath())) return { accepted: false, reason: 'disabled' };
      const claimed = withStartLock((): { claimed: BridgeUpdateStatus } | { running: BridgeUpdateStatus | null } => {
        const current = readRemoteUpdateStatus();
        if (updateRunning() || (current && !isBridgeUpdateFinished(current))) return { running: current };
        const status: BridgeUpdateStatus = { id: randomUUID(), state: 'checking', startedAt: Date.now() };
        writeStored(status);
        return { claimed: status };
      });
      if (!claimed || !('claimed' in claimed)) {
        const current = claimed ? claimed.running : readRemoteUpdateStatus();
        return { accepted: false, reason: 'running', ...(current ? { status: current } : {}) };
      }
      launch(claimed.claimed.id, entry);
      return { accepted: true, status: claimed.claimed };
    },
    status: () => readRemoteUpdateStatus(),
  };
}

export function isRemoteUpdateId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}
