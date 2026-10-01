import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { extractHostname, extractPort, isRecord } from './internal.js';

const GATEWAY_RUN_COMMAND = /\bgateway\s+run\b/;
// `ps -o lstart` under LC_ALL=C/TZ=UTC, e.g. "Wed Oct  1 01:39:23 2026".
const PS_IDENTITY_LINE = /^\s*([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(\S.*?)\s*$/;

type HermesProcessIdentity = { startedAt: string; command: string };
type InspectHermesProcess = (pid: number) => Promise<HermesProcessIdentity | null>;

/**
 * Evidence that Clawket started one gateway process. It names the process
 * by PID plus OS start time, so a reused PID never inherits ownership, and
 * holds no credential.
 */
type HermesGatewayOwnerRecord = {
  version: 1;
  pid: number;
  startedAt: string;
  apiBaseUrl: string;
  hermesHomePath: string;
};

export type HermesGatewayScope = {
  ownerPath: string;
  apiBaseUrl: string;
  hermesHomePath: string;
};

export type HermesGatewayOwnership =
  | { owned: true; pid: number }
  | { owned: false; reason: 'no_record' | 'invalid_record' | 'other_scope' | 'process_changed' };

/** Starts a Clawket-managed gateway; `--replace` lets Hermes retire this HERMES_HOME's previous gateway itself. */
export function spawnHermesGateway(input: {
  command: string;
  apiBaseUrl: string;
  apiKey: string;
  hermesHomePath: string;
  log: (line: string) => void;
}): ChildProcess {
  // Hermes gateway stdout/stderr may contain prompts, assistant replies,
  // tool invocations, and other session data. Clawket must not persist
  // that content to its log files, so by default we route the child's
  // stdio to /dev/null via `stdio: 'ignore'`. Diagnostic metadata
  // (startup, health probe, exit code) is emitted via the bridge's own
  // logger and is unaffected. For local debugging, opt in with
  // `CLAWKET_HERMES_VERBOSE=1`; verbose output may contain sensitive data
  // and must not be shared.
  const verbose = process.env.CLAWKET_HERMES_VERBOSE === '1';
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HERMES_HOME: input.hermesHomePath,
    API_SERVER_ENABLED: 'true',
    API_SERVER_KEY: input.apiKey,
    API_SERVER_HOST: extractHostname(input.apiBaseUrl),
    API_SERVER_PORT: String(extractPort(input.apiBaseUrl)),
  };
  // Strip the bridge token before inheriting env into hermes gateway.
  // Hermes does not need it, and we keep its blast radius minimal.
  delete env.CLAWKET_HERMES_BRIDGE_TOKEN;
  const child = spawn(input.command, ['gateway', 'run', '--replace'], {
    env,
    stdio: verbose ? 'pipe' : 'ignore',
  });
  if (verbose) {
    input.log(
      'CLAWKET_HERMES_VERBOSE=1: forwarding hermes gateway stdio to bridge logs. ' +
        'Output may contain prompts, responses, and other session data; do not share these logs.',
    );
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) input.log(`[hermes] ${text}`);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) input.log(`[hermes] ${text}`);
    });
  }
  return child;
}

/** Reads a live process's OS start time and command line; null when it is gone or cannot be inspected. */
export function inspectHermesProcess(pid: number): Promise<HermesProcessIdentity | null> {
  if (process.platform === 'win32' || !Number.isSafeInteger(pid) || pid <= 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('ps', ['-ww', '-o', 'lstart=', '-o', 'args=', '-p', String(pid)], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
      timeout: 3_000,
      windowsHide: true,
    }, (error, stdout) => {
      const line = error ? '' : stdout.split('\n').find((candidate) => candidate.trim()) ?? '';
      const match = PS_IDENTITY_LINE.exec(line);
      resolve(match ? { startedAt: match[1].replace(/\s+/g, ' '), command: match[2] } : null);
    });
  });
}

/** Records a gateway this bridge just spawned. Returns false when its identity cannot be read or saved. */
export async function recordClawketHermesGateway(
  scope: HermesGatewayScope,
  pid: number,
  inspect: InspectHermesProcess = inspectHermesProcess,
): Promise<boolean> {
  const identity = await inspect(pid);
  if (!identity || !GATEWAY_RUN_COMMAND.test(identity.command)) return false;
  const record: HermesGatewayOwnerRecord = {
    version: 1,
    pid,
    startedAt: identity.startedAt,
    apiBaseUrl: scope.apiBaseUrl,
    hermesHomePath: scope.hermesHomePath,
  };
  const temporaryPath = `${scope.ownerPath}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(scope.ownerPath), { recursive: true, mode: 0o700 });
    await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, scope.ownerPath);
    return true;
  } catch {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    return false;
  }
}

/**
 * Proves that the recorded gateway for this API and Hermes home is still the
 * exact process Clawket started. A user-started gateway, a replaced gateway or
 * a reused PID is never Clawket-owned.
 */
export async function proveClawketHermesGateway(
  scope: HermesGatewayScope,
  inspect: InspectHermesProcess = inspectHermesProcess,
): Promise<HermesGatewayOwnership> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(scope.ownerPath, 'utf8'));
  } catch (error) {
    return { owned: false, reason: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no_record' : 'invalid_record' };
  }
  const record = readOwnerRecord(value);
  if (!record) return { owned: false, reason: 'invalid_record' };
  if (record.apiBaseUrl !== scope.apiBaseUrl || record.hermesHomePath !== scope.hermesHomePath) {
    return { owned: false, reason: 'other_scope' };
  }
  const identity = await inspect(record.pid);
  if (!identity || identity.startedAt !== record.startedAt || !GATEWAY_RUN_COMMAND.test(identity.command)) {
    return { owned: false, reason: 'process_changed' };
  }
  return { owned: true, pid: record.pid };
}

function readOwnerRecord(value: unknown): HermesGatewayOwnerRecord | null {
  if (!isRecord(value) || value.version !== 1) return null;
  const { pid, startedAt, apiBaseUrl, hermesHomePath } = value;
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return null;
  if (typeof startedAt !== 'string' || !startedAt || typeof apiBaseUrl !== 'string' || !apiBaseUrl
    || typeof hermesHomePath !== 'string' || !hermesHomePath) return null;
  return { version: 1, pid, startedAt, apiBaseUrl, hermesHomePath };
}
