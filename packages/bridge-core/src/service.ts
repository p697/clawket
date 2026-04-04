import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const SERVICE_LABEL = 'ai.clawket.bridge.cli';
const SYSTEMD_UNIT_NAME = `${SERVICE_LABEL}.service`;
const WINDOWS_RUN_KEY = 'ClawketBridgeCli';
const SERVICE_DIR = join(homedir(), '.clawket');
const LOG_DIR = join(SERVICE_DIR, 'logs');
const SERVICE_STATE_PATH = join(SERVICE_DIR, 'bridge-service.json');
const RUNTIME_REGISTRY_PATH = join(SERVICE_DIR, 'bridge-runtime-processes.json');
const SERVICE_LAUNCHER_PATH = join(SERVICE_DIR, 'clawket-launcher.sh');
const LINUX_CRON_RECORD_PATH = join(SERVICE_DIR, 'bridge-service.cron');
const SERVICE_LOG_PATH = join(LOG_DIR, 'bridge-cli.log');
const SERVICE_ERROR_LOG_PATH = join(LOG_DIR, 'bridge-cli-error.log');
const MACOS_PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
const LINUX_SERVICE_PATH = join(homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT_NAME);
const LINUX_CRON_MARKER = '# clawket-bridge-cli';

export type ServiceMethod = 'launchagent' | 'systemd-user' | 'linux-crontab' | 'windows-run-registry' | 'unsupported';

export interface ServiceLaunchContext {
  nodePath?: string;
  scriptPath?: string;
}

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
  method: ServiceMethod;
  servicePath: string;
  logPath: string;
  errorLogPath: string;
  pid: number | null;
}

interface ServiceState {
  pid: number;
  startedAt: string;
}

export interface RuntimeProcessRecord {
  pid: number;
  startedAt: string;
  gatewayId: string;
  instanceId: string;
  serviceMode: boolean;
  scriptPath: string;
}

export function getServiceProgramArgs(
  context: ServiceLaunchContext = {},
  platform: NodeJS.Platform = process.platform,
): string[] {
  const nodePath = context.nodePath?.trim() || process.execPath;
  const scriptPath = resolveScriptPath(context.scriptPath);
  if (!scriptPath) {
    throw new Error('Unable to resolve CLI script path for service installation.');
  }
  if (platform !== 'win32') {
    const launcherPath = writeServiceLauncher({
      nodePath,
      scriptPath,
      pathEnv: process.env.PATH ?? '',
    });
    ensureLaunchScriptExecutable(launcherPath, platform);
    return [launcherPath];
  }
  return [nodePath, scriptPath, 'run', '--service'];
}

export function getServiceStatus(): ServiceStatus {
  ensureServiceDirs();
  const pid = readServiceState()?.pid ?? null;
  const method = detectServiceMethod();
  const base: ServiceStatus = {
    installed: false,
    running: pid != null && isPidRunning(pid),
    method,
    servicePath: getServicePath(method),
    logPath: SERVICE_LOG_PATH,
    errorLogPath: SERVICE_ERROR_LOG_PATH,
    pid,
  };

  if (base.pid != null && !base.running) {
    clearServiceState(base.pid);
    base.pid = null;
  }

  switch (base.method) {
    case 'launchagent':
      base.installed = existsSync(MACOS_PLIST_PATH);
      if (base.installed) {
        base.running = commandSucceeds('launchctl', ['list', SERVICE_LABEL]) || base.running;
      }
      return base;
    case 'systemd-user':
      base.installed = existsSync(LINUX_SERVICE_PATH);
      if (base.installed) {
        base.running = commandSucceeds('systemctl', ['--user', 'is-active', '--quiet', SYSTEMD_UNIT_NAME]) || base.running;
      }
      return base;
    case 'linux-crontab':
      base.installed = hasLinuxCronRegistration();
      return base;
    case 'windows-run-registry':
      base.installed = commandSucceeds('reg', [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        '/v',
        WINDOWS_RUN_KEY,
      ]);
      return base;
    default:
      return base;
  }
}

export function installService(context: ServiceLaunchContext = {}): ServiceStatus {
  ensureServiceDirs();
  const args = getServiceProgramArgs(context);

  switch (process.platform) {
    case 'darwin':
      writeFileSync(MACOS_PLIST_PATH, buildMacosPlist(args, SERVICE_LOG_PATH, SERVICE_ERROR_LOG_PATH), 'utf8');
      execIgnoreFailure('launchctl', ['unload', '-w', MACOS_PLIST_PATH]);
      execFileSync('launchctl', ['load', '-w', MACOS_PLIST_PATH], { stdio: 'ignore' });
      break;
    case 'linux':
      installLinuxService(args);
      break;
    case 'win32':
      stopRunningProcess();
      execFileSync('reg', [
        'add',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        '/v',
        WINDOWS_RUN_KEY,
        '/t',
        'REG_SZ',
        '/d',
        buildWindowsRunCommand(args),
        '/f',
      ], { stdio: 'ignore' });
      startDetachedWindowsService(args);
      break;
    default:
      throw new Error(`Unsupported platform for CLI service installation: ${process.platform}`);
  }

  return getServiceStatus();
}

export function restartService(context: ServiceLaunchContext = {}): ServiceStatus {
  ensureServiceDirs();
  const args = getServiceProgramArgs(context);

  switch (process.platform) {
    case 'darwin':
      if (!existsSync(MACOS_PLIST_PATH)) {
        return installService(context);
      }
      writeFileSync(MACOS_PLIST_PATH, buildMacosPlist(args, SERVICE_LOG_PATH, SERVICE_ERROR_LOG_PATH), 'utf8');
      execIgnoreFailure('launchctl', ['unload', '-w', MACOS_PLIST_PATH]);
      execFileSync('launchctl', ['load', '-w', MACOS_PLIST_PATH], { stdio: 'ignore' });
      break;
    case 'linux':
      restartLinuxService(args);
      break;
    case 'win32':
      stopRunningProcess();
      execFileSync('reg', [
        'add',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        '/v',
        WINDOWS_RUN_KEY,
        '/t',
        'REG_SZ',
        '/d',
        buildWindowsRunCommand(args),
        '/f',
      ], { stdio: 'ignore' });
      startDetachedWindowsService(args);
      break;
    default:
      throw new Error(`Unsupported platform for CLI service restart: ${process.platform}`);
  }

  return getServiceStatus();
}

export async function startTransientRuntime(context: ServiceLaunchContext = {}): Promise<ServiceStatus> {
  ensureServiceDirs();
  const args = getServiceProgramArgs(context);

  switch (process.platform) {
    case 'darwin':
    case 'linux':
      startDetachedPosixService(args);
      break;
    case 'win32':
      startDetachedWindowsService(args);
      break;
    default:
      throw new Error(`Unsupported platform for transient CLI runtime start: ${process.platform}`);
  }

  return waitForRuntimeState();
}

export function uninstallService(): ServiceStatus {
  stopRunningProcess();

  switch (process.platform) {
    case 'darwin':
      execIgnoreFailure('launchctl', ['unload', '-w', MACOS_PLIST_PATH]);
      rmIfExists(MACOS_PLIST_PATH);
      break;
    case 'linux':
      if (existsSync(LINUX_SERVICE_PATH)) {
        execIgnoreFailure('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT_NAME]);
        rmIfExists(LINUX_SERVICE_PATH);
        execIgnoreFailure('systemctl', ['--user', 'daemon-reload']);
      }
      removeLinuxCronRegistration();
      break;
    case 'win32':
      execIgnoreFailure('reg', [
        'delete',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        '/v',
        WINDOWS_RUN_KEY,
        '/f',
      ]);
      break;
    default:
      break;
  }

  clearServiceState();
  return getServiceStatus();
}

export function stopService(): ServiceStatus {
  stopRunningProcess();

  switch (process.platform) {
    case 'darwin':
      if (existsSync(MACOS_PLIST_PATH)) {
        execIgnoreFailure('launchctl', ['unload', MACOS_PLIST_PATH]);
      }
      break;
    case 'linux':
      if (existsSync(LINUX_SERVICE_PATH)) {
        execIgnoreFailure('systemctl', ['--user', 'stop', SYSTEMD_UNIT_NAME]);
      }
      break;
    case 'win32':
      break;
    default:
      break;
  }

  clearServiceState();
  return getServiceStatus();
}

export function writeServiceState(pid = process.pid): void {
  ensureServiceDirs();
  const state: ServiceState = {
    pid,
    startedAt: new Date().toISOString(),
  };
  writeFileSync(SERVICE_STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export function registerRuntimeProcess(record: Omit<RuntimeProcessRecord, 'pid' | 'startedAt' | 'scriptPath'> & {
  pid?: number;
  startedAt?: string;
  scriptPath?: string;
}): void {
  ensureServiceDirs();
  const next: RuntimeProcessRecord = {
    pid: record.pid ?? process.pid,
    startedAt: record.startedAt ?? new Date().toISOString(),
    gatewayId: record.gatewayId,
    instanceId: record.instanceId,
    serviceMode: record.serviceMode,
    scriptPath: resolveScriptPath(record.scriptPath),
  };
  const records = readRuntimeRegistry()
    .filter((entry) => entry.pid !== next.pid)
    .concat(next);
  writeRuntimeRegistry(records);
}

export function unregisterRuntimeProcess(pid = process.pid): void {
  const records = readRuntimeRegistry().filter((entry) => entry.pid !== pid);
  writeRuntimeRegistry(records);
}

export function isAutostartUnsupportedError(error: unknown): boolean {
  const message = formatError(error).toLowerCase();
  return message.includes('no crontab fallback is available')
    || message.includes('unsupported platform for cli service');
}

export function listRuntimeProcesses(context: ServiceLaunchContext = {}): RuntimeProcessRecord[] {
  const scriptPath = resolveScriptPath(context.scriptPath);
  const records = readRuntimeRegistry();
  const result = [...records];
  const known = new Set(records.map((entry) => entry.pid));
  for (const pid of listPosixRuntimePids(scriptPath)) {
    if (known.has(pid)) continue;
    result.push({
      pid,
      startedAt: new Date(0).toISOString(),
      gatewayId: '',
      instanceId: '',
      serviceMode: false,
      scriptPath,
    });
  }
  return result
    .filter((entry) => isPidRunning(entry.pid))
    .sort((a, b) => a.pid - b.pid);
}

export function stopRuntimeProcesses(options: {
  scriptPath?: string;
  excludePid?: number;
} = {}): number[] {
  const records = listRuntimeProcesses({ scriptPath: options.scriptPath });
  const victims = records.filter((entry) => entry.pid !== (options.excludePid ?? -1));
  if (process.platform === 'win32') {
    // taskkill /F terminates synchronously — no need to wait.
    for (const entry of victims) {
      execIgnoreFailure('taskkill', ['/PID', String(entry.pid), '/T', '/F']);
    }
  } else {
    // Phase 1: ask for graceful shutdown.
    for (const entry of victims) {
      execIgnoreFailure('kill', ['-TERM', String(entry.pid)]);
    }
    // Phase 2: wait for each process to actually exit before returning,
    // so callers can safely start a replacement without a dual-runtime window.
    // Force-kill anything that doesn't comply within the timeout.
    for (const entry of victims) {
      if (!waitForPidExit(entry.pid, 3000)) {
        execIgnoreFailure('kill', ['-KILL', String(entry.pid)]);
      }
    }
  }
  const remaining = readRuntimeRegistry().filter((entry) => !victims.some((victim) => victim.pid === entry.pid));
  writeRuntimeRegistry(remaining);
  const serviceState = readServiceState();
  if (serviceState && victims.some((entry) => entry.pid === serviceState.pid)) {
    clearServiceState();
  }
  return victims.map((entry) => entry.pid);
}

export function clearServiceState(expectedPid?: number): void {
  if (!existsSync(SERVICE_STATE_PATH)) return;
  if (expectedPid != null) {
    const current = readServiceState();
    if (current && current.pid !== expectedPid) {
      return;
    }
  }
  rmIfExists(SERVICE_STATE_PATH);
}

export function getServicePaths(): { logPath: string; errorLogPath: string; servicePath: string } {
  return {
    logPath: SERVICE_LOG_PATH,
    errorLogPath: SERVICE_ERROR_LOG_PATH,
    servicePath: getServicePath(detectServiceMethod()),
  };
}

export function buildMacosPlist(programArgs: string[], logPath: string, errorLogPath: string): string {
  const argsXml = programArgs.map((arg) => `    <string>${escapeXml(arg)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(errorLogPath)}</string>
</dict>
</plist>
`;
}

export function buildLinuxSystemdUnit(programArgs: string[], logPath: string, errorLogPath: string): string {
  const execStart = programArgs.map(escapeSystemdArg).join(' ');
  return `[Unit]
Description=Clawket Bridge CLI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
Restart=always
RestartSec=2
WorkingDirectory=${SERVICE_DIR}
StandardOutput=append:${logPath}
StandardError=append:${errorLogPath}

[Install]
WantedBy=default.target
`;
}

export function buildLinuxCronEntry(programArgs: string[], logPath: string, errorLogPath: string): string {
  const command = programArgs.map(escapeShellWord).join(' ');
  return `@reboot ${command} >> ${escapeShellWord(logPath)} 2>> ${escapeShellWord(errorLogPath)} ${LINUX_CRON_MARKER}`;
}

function getServicePath(method: ServiceMethod): string {
  switch (process.platform) {
    case 'darwin':
      return MACOS_PLIST_PATH;
    case 'linux':
      return method === 'linux-crontab' ? LINUX_CRON_RECORD_PATH : LINUX_SERVICE_PATH;
    case 'win32':
      return 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\ClawketBridgeCli';
    default:
      return '';
  }
}

function detectServiceMethod(): ServiceMethod {
  switch (process.platform) {
    case 'darwin':
      return 'launchagent';
    case 'linux':
      if (existsSync(LINUX_SERVICE_PATH)) {
        return 'systemd-user';
      }
      if (hasLinuxCronRegistration()) {
        return 'linux-crontab';
      }
      if (commandExists('systemctl')) {
        return 'systemd-user';
      }
      if (commandExists('crontab')) {
        return 'linux-crontab';
      }
      return 'unsupported';
    case 'win32':
      return 'windows-run-registry';
    default:
      return 'unsupported';
  }
}

function readServiceState(): ServiceState | null {
  if (!existsSync(SERVICE_STATE_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(SERVICE_STATE_PATH, 'utf8')) as Partial<ServiceState>;
    if (!parsed.pid || typeof parsed.pid !== 'number') return null;
    return {
      pid: parsed.pid,
      startedAt: parsed.startedAt ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

function readRuntimeRegistry(): RuntimeProcessRecord[] {
  if (!existsSync(RUNTIME_REGISTRY_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(RUNTIME_REGISTRY_PATH, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed
      .map((entry) => normalizeRuntimeProcessRecord(entry))
      .filter((entry): entry is RuntimeProcessRecord => entry != null && isPidRunning(entry.pid));
    writeRuntimeRegistry(normalized);
    return normalized;
  } catch {
    return [];
  }
}

function writeRuntimeRegistry(records: RuntimeProcessRecord[]): void {
  if (records.length === 0) {
    rmIfExists(RUNTIME_REGISTRY_PATH);
    return;
  }
  ensureServiceDirs();
  writeFileSync(RUNTIME_REGISTRY_PATH, JSON.stringify(records, null, 2) + '\n', 'utf8');
}

function normalizeRuntimeProcessRecord(value: unknown): RuntimeProcessRecord | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Partial<RuntimeProcessRecord>;
  if (!entry.pid || typeof entry.pid !== 'number') return null;
  const scriptPath = typeof entry.scriptPath === 'string' ? resolveScriptPath(entry.scriptPath) : '';
  if (!scriptPath) return null;
  return {
    pid: entry.pid,
    startedAt: typeof entry.startedAt === 'string' ? entry.startedAt : new Date(0).toISOString(),
    gatewayId: typeof entry.gatewayId === 'string' ? entry.gatewayId : '',
    instanceId: typeof entry.instanceId === 'string' ? entry.instanceId : '',
    serviceMode: entry.serviceMode === true,
    scriptPath,
  };
}

function stopRunningProcess(): void {
  const state = readServiceState();
  if (!state) return;
  execIgnoreFailure(process.platform === 'win32' ? 'taskkill' : 'kill', process.platform === 'win32'
    ? ['/PID', String(state.pid), '/T', '/F']
    : ['-TERM', String(state.pid)]);
  clearServiceState(state.pid);
}

function listPosixRuntimePids(scriptPath: string): number[] {
  if (!scriptPath || process.platform === 'win32') return [];
  try {
    const output = execFileSync('ps', ['-ax', '-o', 'pid=,args='], { encoding: 'utf8' });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const match = line.match(/^(\d+)\s+(.*)$/);
        if (!match) return [];
        const pid = Number(match[1]);
        const command = match[2];
        if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return [];
        if (!command.includes(scriptPath)) return [];
        if (!/\brun\b/.test(command)) return [];
        return [pid];
      });
  } catch {
    return [];
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Polls until the process exits or the timeout elapses.
 * Returns true if the process exited within the timeout, false otherwise.
 * Uses Atomics.wait for the sleep so the synchronous call stack is not blocked
 * by a busy-poll.
 */
function waitForPidExit(pid: number, timeoutMs: number): boolean {
  const deadline = Date.now() + timeoutMs;
  const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
  while (isPidRunning(pid)) {
    if (Date.now() >= deadline) return false;
    Atomics.wait(sleepBuf, 0, 0, 50);
  }
  return true;
}

function startDetachedWindowsService(programArgs: string[]): void {
  const outFd = openSync(SERVICE_LOG_PATH, 'a');
  const errFd = openSync(SERVICE_ERROR_LOG_PATH, 'a');
  try {
    const [command, ...args] = programArgs;
    const child = spawn(command, args, {
      detached: true,
      stdio: ['ignore', outFd, errFd],
      windowsHide: true,
    });
    child.unref();
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
}

function startDetachedPosixService(programArgs: string[]): void {
  const outFd = openSync(SERVICE_LOG_PATH, 'a');
  const errFd = openSync(SERVICE_ERROR_LOG_PATH, 'a');
  try {
    const [command, ...args] = programArgs;
    const child = spawn(command, args, {
      detached: true,
      stdio: ['ignore', outFd, errFd],
    });
    child.unref();
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
}

async function waitForRuntimeState(timeoutMs = 1_500, pollMs = 50): Promise<ServiceStatus> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = getServiceStatus();
  while (Date.now() < deadline) {
    if (lastStatus.running) return lastStatus;
    await delay(pollMs);
    lastStatus = getServiceStatus();
  }
  return lastStatus;
}

function installLinuxService(programArgs: string[]): void {
  try {
    installLinuxSystemdService(programArgs);
    removeLinuxCronRegistration();
    return;
  } catch (error) {
    installLinuxCronService(programArgs, error);
  }
}

function restartLinuxService(programArgs: string[]): void {
  try {
    restartLinuxSystemdService(programArgs);
    removeLinuxCronRegistration();
    return;
  } catch (error) {
    installLinuxCronService(programArgs, error);
  }
}

function installLinuxSystemdService(programArgs: string[]): void {
  if (!commandExists('systemctl')) {
    throw new Error('systemctl is not available');
  }
  mkdirSync(dirname(LINUX_SERVICE_PATH), { recursive: true });
  writeFileSync(LINUX_SERVICE_PATH, buildLinuxSystemdUnit(programArgs, SERVICE_LOG_PATH, SERVICE_ERROR_LOG_PATH), 'utf8');
  execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  execFileSync('systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT_NAME], { stdio: 'ignore' });
}

function restartLinuxSystemdService(programArgs: string[]): void {
  if (!commandExists('systemctl')) {
    throw new Error('systemctl is not available');
  }
  if (!existsSync(LINUX_SERVICE_PATH)) {
    installLinuxSystemdService(programArgs);
    return;
  }
  writeFileSync(LINUX_SERVICE_PATH, buildLinuxSystemdUnit(programArgs, SERVICE_LOG_PATH, SERVICE_ERROR_LOG_PATH), 'utf8');
  execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
  execFileSync('systemctl', ['--user', 'restart', SYSTEMD_UNIT_NAME], { stdio: 'ignore' });
}

function installLinuxCronService(programArgs: string[], systemdError: unknown): void {
  if (!commandExists('crontab')) {
    throw new Error(`Linux service installation failed and no crontab fallback is available: ${formatError(systemdError)}`);
  }
  rmIfExists(LINUX_SERVICE_PATH);
  const entry = buildLinuxCronEntry(programArgs, SERVICE_LOG_PATH, SERVICE_ERROR_LOG_PATH);
  writeLinuxCrontabEntry(entry);
  writeFileSync(LINUX_CRON_RECORD_PATH, entry + '\n', 'utf8');
  stopRunningProcess();
  startDetachedPosixService(programArgs);
}

function hasLinuxCronRegistration(): boolean {
  if (process.platform !== 'linux') return false;
  return readLinuxCrontab().some((line) => line.includes(LINUX_CRON_MARKER));
}

function removeLinuxCronRegistration(): void {
  if (process.platform !== 'linux') return;
  if (commandExists('crontab')) {
    const filtered = readLinuxCrontab().filter((line) => !line.includes(LINUX_CRON_MARKER));
    writeLinuxCrontab(filtered);
  }
  rmIfExists(LINUX_CRON_RECORD_PATH);
}

function writeLinuxCrontabEntry(entry: string): void {
  const filtered = readLinuxCrontab().filter((line) => !line.includes(LINUX_CRON_MARKER));
  filtered.push(entry);
  writeLinuxCrontab(filtered);
}

function readLinuxCrontab(): string[] {
  if (!commandExists('crontab')) return [];
  try {
    const output = execFileSync('crontab', ['-l'], { encoding: 'utf8' });
    return output
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
  } catch (error) {
    if (isMissingCrontabError(error)) {
      return [];
    }
    throw error;
  }
}

function writeLinuxCrontab(lines: string[]): void {
  if (!commandExists('crontab')) return;
  if (lines.length === 0) {
    execIgnoreFailure('crontab', ['-r']);
    return;
  }
  execFileSync('crontab', ['-'], {
    input: `${lines.join('\n')}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'ignore', 'ignore'],
  });
}

function resolveScriptPath(scriptPath?: string): string {
  const value = scriptPath?.trim() || process.argv[1]?.trim() || '';
  if (!value) return '';
  try {
    return realpathSync(value);
  } catch {
    return value;
  }
}

function ensureLaunchScriptExecutable(scriptPath: string, platform: NodeJS.Platform): void {
  if (platform === 'win32' || !existsSync(scriptPath)) return;
  try {
    chmodSync(scriptPath, 0o755);
  } catch {
    // Best-effort only. If this fails, service installation may still succeed
    // when the script is already executable.
  }
}

function writeServiceLauncher(input: {
  nodePath: string;
  scriptPath: string;
  pathEnv: string;
}): string {
  ensureServiceDirs();
  const lines = [
    '#!/bin/sh',
    `export PATH="${escapeShellDoubleQuoted(input.pathEnv)}"`,
    `NODE_PATH="${escapeShellDoubleQuoted(input.nodePath)}"`,
    `SCRIPT_PATH="${escapeShellDoubleQuoted(input.scriptPath)}"`,
    'if [ -x "$NODE_PATH" ]; then',
    '  exec "$NODE_PATH" "$SCRIPT_PATH" run --service',
    'fi',
    'if command -v node >/dev/null 2>&1; then',
    '  exec node "$SCRIPT_PATH" run --service',
    'fi',
    'echo "node runtime not found for Clawket Bridge service" >&2',
    'exit 127',
    '',
  ];
  writeFileSync(SERVICE_LAUNCHER_PATH, lines.join('\n'), 'utf8');
  return SERVICE_LAUNCHER_PATH;
}

function escapeShellDoubleQuoted(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$').replaceAll('`', '\\`');
}

function escapeShellWord(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function buildWindowsRunCommand(programArgs: string[]): string {
  return programArgs.map(escapeWindowsArg).join(' ');
}

function ensureServiceDirs(): void {
  mkdirSync(SERVICE_DIR, { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeSystemdArg(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function escapeWindowsArg(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function commandSucceeds(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function commandExists(command: string): boolean {
  if (process.platform === 'win32') {
    return commandSucceeds('where', [command]);
  }
  return commandSucceeds('sh', ['-c', `command -v ${escapeShellWord(command)}`]);
}

function execIgnoreFailure(command: string, args: string[]): void {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
  } catch {
    // ignore stop/unload failures
  }
}

function rmIfExists(path: string): void {
  if (!existsSync(path)) return;
  rmSync(path, { force: true });
}

function isMissingCrontabError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  const stderrValue = (error as Error & { stderr?: unknown }).stderr;
  const stderr = typeof stderrValue === 'string'
    ? stderrValue.toLowerCase()
    : Buffer.isBuffer(stderrValue)
      ? stderrValue.toString('utf8').toLowerCase()
      : '';
  return message.includes('no crontab for') || stderr.includes('no crontab for');
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
