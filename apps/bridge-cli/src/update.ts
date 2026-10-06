import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, isAbsolute, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { getServiceStatus, installService, updateStoppedService, listRuntimeProcesses, readPairingConfig, readHermesRelayConfig, getHermesRelayConfigPath, stopService, stopRuntimeProcesses } from '@clawket/bridge-core';
import { discoverAgentTargets, readAgentConfig, selectAgentTarget, option, type AgentBackend } from './agent-inventory.js';
import { codexControl, startCodexBackground } from './codex-lifecycle.js';
import { claudeControl, startClaudeBackground } from './claude-code-lifecycle.js';
import { piControl, startPiBackground } from './pi-lifecycle.js';
import { readRuntimeOwner, queryRuntimeOwner, runtimeOwnerPath } from './runtime-owner.js';
import { readCliVersion } from './metadata.js';
import { requestedBackend } from './operations.js';
import { activateUpdate, type UpdateTarget, type UpdateResult } from './update-transaction.js';
import { isRemoteUpdateId, relaunchRemoteUpdater, writeRemoteUpdateProgress, type RemoteUpdateFailure } from './remote-update.js';

export const BRIDGE_NPM_METADATA_URL = 'https://registry.npmjs.org/@p697%2fclawket/latest';
export function stableBridgeVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
    && value.split('.').every(part => Number.isSafeInteger(Number(part)));
}
const runtimeRoot = () => join(homedir(), '.clawket', 'runtime');
const UPDATE_BACKENDS = ['openclaw', 'hermes', 'hermes-relay', 'codex', 'claude-code', 'pi', 'local-model'];
/** Published Codex Bridges whose update admission kept every settled turn start and stayed busy after one turn. */
const CODEX_IDLE_LEAK_VERSIONS = new Set(['3.1.11', '3.1.12', '3.1.13']);
/** Busy replies (about one per second) before such a Codex owner is checked through its sessions instead. */
const CODEX_IDLE_LEAK_GRACE_POLLS = 10;
const UPDATE_PROGRESS_PREFIX = 'clawket-update-progress ';
export type UpdateProgress = { backend: string; event: 'waiting' };

/** Activation reports fixed progress categories on stderr; stdout stays reserved for the JSON result. */
function reportUpdateProgress(progress: UpdateProgress): void {
  process.stderr.write(UPDATE_PROGRESS_PREFIX + JSON.stringify(progress) + '\n');
}
export function parseUpdateProgress(line: string): UpdateProgress | null {
  if (!line.startsWith(UPDATE_PROGRESS_PREFIX) || line.length > 256) return null;
  try {
    const value = JSON.parse(line.slice(UPDATE_PROGRESS_PREFIX.length));
    return value && UPDATE_BACKENDS.includes(value.backend) && value.event === 'waiting' ? { backend: value.backend, event: 'waiting' } : null;
  } catch { return null; }
}
export function describeUpdateResult(row: UpdateResult): string {
  const version = stableBridgeVersion(row.version) ? row.version : undefined;
  const outcome = row.state === 'updated' ? 'running the updated Bridge'
    : row.state === 'manual' ? 'manual update required: use the original deployment method and preserve configuration'
    : row.state === 'stopped' ? 'kept stopped'
    : row.state === 'restored' ? `restarted${version ? ` on ${version}` : ' on its previous installation'}`
    : row.reason === 'busy' ? 'still running a task, so it was not updated'
    : row.reason === 'update_not_applied' ? 'not changed'
    : 'needs attention: check it with clawket status';
  return `${row.backend}: ${outcome}`;
}

function run(node: string, args: string[], cwd?: string, allowFailure = false, onProgress?: (progress: UpdateProgress) => void): Promise<string> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(node, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '', tooLarge = false, errors = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Bridge update command timed out.')); }, allowFailure ? 30 * 60_000 : 180_000);
    child.stdout.on('data', data => { output += data.toString(); if (Buffer.byteLength(output) > 128 * 1024) { tooLarge = true; child.kill(); } });
    // Consume npm/native diagnostics without copying potentially sensitive output into update summaries;
    // only fixed activation progress categories are recognized.
    child.stderr.on('data', data => {
      if (!onProgress) return;
      errors += data.toString();
      for (let newline = errors.indexOf('\n'); newline >= 0; newline = errors.indexOf('\n')) {
        const progress = parseUpdateProgress(errors.slice(0, newline)); errors = errors.slice(newline + 1);
        if (progress) onProgress(progress);
      }
      if (errors.length > 4096) errors = '';
    });
    child.once('error', () => { clearTimeout(timer); reject(new Error('Could not run the Bridge update command.')); });
    child.once('exit', code => { clearTimeout(timer); (code === 0 || allowFailure) && !tooLarge ? resolveRun(output) : reject(new Error('Bridge update command failed. Inspect the selected runtime logs.')); });
  });
}

export function npmCliPath(): string {
  const supplied = process.env.npm_execpath;
  const candidates = [supplied && join(dirname(supplied), 'npm-cli.js'), join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  for (const candidate of candidates) if (candidate && existsSync(candidate) && lstatSync(candidate).isFile()) return realpathSync(candidate);
  throw new Error('npm CLI was not found. Run this command with npx, or restore your Node/npm installation.');
}

/** A fresh immutable directory per attempt; failed installs never mutate an active release. */
export async function stageBridgeRelease(version: string): Promise<string> {
  if (!stableBridgeVersion(version)) throw new Error('Choose a stable Bridge version.');
  const directory = join(runtimeRoot(), 'releases', `${version}-${randomUUID()}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  await run(process.execPath, [npmCliPath(), 'install', '--prefix', directory, '--registry=https://registry.npmjs.org', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--save-exact', `@p697/clawket@${version}`]);
  const packageDirectory = join(directory, 'node_modules', '@p697', 'clawket');
  const metadata = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'));
  if (metadata.name !== '@p697/clawket' || metadata.version !== version || metadata.clawket?.updateProtocol !== 1) throw new Error('This published Bridge does not support the unified updater yet. No running Bridge was changed.');
  const entry = join(packageDirectory, 'dist', 'index.js');
  if (!lstatSync(entry).isFile() || !(await run(process.execPath, [entry, '--help'])).includes('clawket update')) throw new Error('The installed Bridge could not be validated. No running Bridge was changed.');
  return entry;
}

/** Legacy migration captures a known Clawket entry, never an arbitrary process occupying a port. */
export function legacyEntryFromCommands(lines: string, backend: string, configPath?: string): { pid: number; entry: string } | null {
  const matches = lines.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+\S+\s+(\S+)\s+(.*)$/);
    if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) <= 0) return [];
    const args = match[3];
    const commandMatches = backend === 'openclaw' ? /^run(?:\s|$)/.test(args)
      : backend === 'hermes-relay' ? /^hermes\s+relay\s+run(?:\s|$)/.test(args)
      : backend === 'hermes' ? /^hermes\s+(run|dev)(?:\s|$)/.test(args)
      : args.startsWith(`${backend} `) && /^(?:codex|claude-code|pi)\s+(?:run|pair)(?:\s|$)/.test(args);
    if (!commandMatches || (configPath && !args.split(/\s+--/).some(segment => segment === `config ${configPath}` || segment === `config "${configPath}"`))) return [];
    const entry = legacyRuntimeEntry(match[2]);
    return entry ? [{ pid: Number(match[1]), entry }] : [];
  });
  if (matches.length > 1) throw new Error(`Multiple legacy ${backend} Bridge owners match this scope. Stop the duplicate runtimes before updating.`);
  return matches[0] ?? null;
}

function legacyRuntimeEntry(invoked: string): string | null {
  const knownBundle = /\/(?:@p697\/clawket|apps\/bridge-cli)\/dist\/index\.js$/;
  if (knownBundle.test(invoked)) return invoked;
  if (!/\/(?:\.bin|bin)\/clawket$/.test(invoked)) return null;
  try {
    if (!lstatSync(invoked).isSymbolicLink()) return null;
    const entry = realpathSync(invoked);
    if (!knownBundle.test(entry.replace(/\\/g, '/')) || !lstatSync(entry).isFile()) return null;
    const packageDirectory = dirname(dirname(entry)), metadataPath = join(packageDirectory, 'package.json');
    const info = lstatSync(metadataPath);
    if (!info.isFile() || info.size > 16_384) return null;
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
    const bin = typeof metadata?.bin === 'string' ? metadata.bin : metadata?.bin?.clawket;
    if (metadata?.name !== '@p697/clawket' || typeof bin !== 'string' || resolve(packageDirectory, bin) !== entry) return null;
    return entry;
  } catch { return null; }
}

function legacyEntry(backend: string, configPath?: string): { pid: number; entry: string } | null {
  if (backend === 'openclaw') {
    const processes = listRuntimeProcesses();
    if (processes.length > 1) throw new Error('Multiple OpenClaw runtimes are running. Inspect them before updating.');
    if (processes[0]?.scriptPath && existsSync(processes[0].scriptPath)) return { pid: processes[0].pid, entry: processes[0].scriptPath };
  }
  if (process.platform === 'win32') return null;
  return legacyEntryFromCommands(execFileSync('ps', ['-ax', '-o', 'pid=,args='], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }), backend, configPath);
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw error; }
    await delay(100);
  }
  throw new Error('The owned Bridge has not exited. No replacement was started.');
}
function idleSessions(value: unknown): void {
  const rows = Array.isArray(value) ? value : (value as { sessions?: unknown } | null)?.sessions;
  if (!Array.isArray(rows) || rows.length > 10_000 || rows.some(row => !row || typeof row !== 'object' || typeof row.hasActiveRun !== 'boolean')) throw new Error('The older Bridge cannot prove idle state. Finish tasks and stop this Bridge explicitly before updating.');
  if (rows.some(row => row.hasActiveRun)) throw Object.assign(new Error('A Bridge task is still active.'), { code: 'BRIDGE_BUSY' });
}

function hermesRpc(config: { port: number; token: string }, method: string): Promise<any> {
  return new Promise((resolveRpc, reject) => {
    const id = randomUUID(), socket = new WebSocket(`ws://127.0.0.1:${config.port}/v1/hermes/ws?token=${encodeURIComponent(config.token)}`, { handshakeTimeout: 3000, maxPayload: 8 * 1024 * 1024 });
    let settled = false;
    const finish = (error?: Error, value?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); socket.terminate(); error ? reject(error) : resolveRpc(value); };
    const timer = setTimeout(() => finish(new Error('Hermes update health could not be verified.')), 10_000);
    socket.on('error', error => finish(Object.assign(new Error('Hermes update control is unavailable.'), { code: (error as NodeJS.ErrnoException).code })));
    socket.on('close', () => finish(new Error('Hermes update control closed.')));
    socket.on('open', () => socket.send(JSON.stringify({ type: 'req', id, method })));
    socket.on('message', raw => { try { const frame = JSON.parse(raw.toString()); if (frame.type === 'res' && frame.id === id) frame.ok ? finish(undefined, frame.payload) : finish(new Error('Hermes rejected update health.')); } catch { finish(new Error('Invalid Hermes update health.')); } });
  });
}

function detached(entry: string, args: string[], logPath: string, env?: NodeJS.ProcessEnv, node = process.execPath): void {
  mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
  const fd = openSync(logPath, 'a', 0o600);
  const child = spawn(node, [entry, ...args], { detached: true, stdio: ['ignore', fd, fd], windowsHide: true, env });
  closeSync(fd); child.on('error', () => {}); child.unref();
}

export async function createUpdateTarget(input: { backend: string; configPath?: string; probe: (method?: string) => Promise<any>; start: (entry: string, node: string) => Promise<void>; legacyStop?: (pid: number) => Promise<void> }): Promise<UpdateTarget> {
  const ownerPath = runtimeOwnerPath(input.backend, input.configPath);
  let owner = readRuntimeOwner(ownerPath), legacy: { pid: number; entry: string } | null = null;
  let running = false;
  if (owner) {
    if (owner.backend !== input.backend || owner.configPath !== input.configPath) throw new Error('Unexpected update owner scope.');
    try { await queryRuntimeOwner(owner, 'info'); running = true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED' && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      try { process.kill(owner.pid, 0); } catch (probeError) { if ((probeError as NodeJS.ErrnoException).code === 'ESRCH') owner = null; else throw probeError; }
      if (owner) throw new Error('The runtime owner cannot be verified.');
    }
  }
  if (!owner) {
    try { await input.probe(); running = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ECONNREFUSED') throw error; }
    if (running) legacy = legacyEntry(input.backend, input.backend === 'hermes' || input.backend === 'hermes-relay' ? undefined : input.configPath);
  }
  if (running && !owner && (!legacy || !existsSync(legacy.entry))) throw new Error(`The legacy ${input.backend} Bridge runtime entry could not be verified (${input.configPath ? 'selected configuration' : 'shared service'}). Stop that Bridge explicitly, then rerun update.`);
  const previousEntry = owner?.entry ?? legacy?.entry ?? null;
  let expectedEntry = previousEntry;
  const previousNode = owner?.node ?? process.execPath, previousVersion = owner?.version;
  const verifyPrevious = async () => {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const next = legacyEntry(input.backend, input.backend === 'hermes' || input.backend === 'hermes-relay' ? undefined : input.configPath);
      if (next && next.entry === previousEntry) { await input.probe(); return; }
      await delay(200);
    }
    throw new Error('The restored runtime could not be verified.');
  };
  return {
    backend: input.backend, running, previousEntry, previousVersion,
    async preflight() {
      if (!running) return;
      if (owner) { await queryRuntimeOwner(owner, 'info'); return; }
      if (input.backend !== 'openclaw' && input.backend !== 'hermes-relay') idleSessions(await input.probe('sessions.list'));
    },
    async stop() {
      const current = readRuntimeOwner(ownerPath);
      if (current) {
        if (current.backend !== input.backend || current.configPath !== input.configPath || (current.entry !== expectedEntry && current.entry !== previousEntry)) throw new Error('The runtime owner changed during update.');
        if (owner && current.token !== owner.token) throw new Error('The runtime owner changed during update.');
        if (input.backend === 'openclaw' && input.legacyStop) {
          // Disable launchd/systemd/task recovery before stopping its transport process.
          // OpenClaw's native Gateway/tasks are independent of this Bridge.
          await queryRuntimeOwner(current, 'info');
          await input.legacyStop(current.pid); await waitForExit(current.pid); owner = null; return;
        }
        const deadline = Date.now() + 120_000;
        for (let busy = 1; !(await queryRuntimeOwner(current, 'stop')).stopped; busy++) {
          if (busy === 1) reportUpdateProgress({ backend: input.backend, event: 'waiting' });
          // Prove idle sessions the same way as for legacy owners, then use the authenticated lifecycle stop.
          if (input.backend === 'codex' && CODEX_IDLE_LEAK_VERSIONS.has(current.version) && input.legacyStop && busy >= CODEX_IDLE_LEAK_GRACE_POLLS) {
            let idle = true;
            try { idleSessions(await input.probe('sessions.list')); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'BRIDGE_BUSY') throw error; idle = false; }
            if (idle) { await input.legacyStop(current.pid); await waitForExit(current.pid); owner = null; return; }
          }
          if (Date.now() >= deadline) throw Object.assign(new Error('Finish the active task, then rerun update.'), { code: 'BRIDGE_BUSY' });
          await delay(1000);
        }
        await waitForExit(current.pid); owner = null;
      } else {
        try { await input.probe(); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') return; throw error; }
        if (!legacy || !input.legacyStop) throw new Error('The runtime owner is unverified. No replacement was started.');
        if (input.backend !== 'openclaw' && input.backend !== 'hermes-relay') idleSessions(await input.probe('sessions.list'));
        await input.legacyStop(legacy.pid); await waitForExit(legacy.pid);
      }
    },
    async start(entry) { expectedEntry = entry; await input.start(entry, entry === previousEntry ? previousNode : process.execPath); },
    verifyPrevious,
    async verifyRestored() {
      // A legacy source without owner records is verified through its captured process entry.
      if (!previousVersion) { await verifyPrevious(); return undefined; }
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const next = readRuntimeOwner(ownerPath);
        if (next) {
          if (next.entry !== previousEntry || next.backend !== input.backend || next.configPath !== input.configPath) throw new Error('Unexpected restored owner.');
          await queryRuntimeOwner(next, 'info'); owner = next;
          await input.probe(); return next.version;
        }
        await delay(200);
      }
      throw new Error('The restored runtime could not be verified.');
    },
    async verify(version) {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const next = readRuntimeOwner(ownerPath);
        if (next) {
          if (next.entry !== expectedEntry || next.backend !== input.backend || next.configPath !== input.configPath) throw new Error('Unexpected replacement owner.');
          await queryRuntimeOwner(next, 'info'); owner = next;
          if (next.version !== version) throw new Error('The running Bridge version does not match the installed update.');
          await input.probe(); return;
        }
        await delay(200);
      }
      throw new Error('The updated runtime did not become ready.');
    },
  };
}

export async function collectUpdateTargets(args: string[]): Promise<UpdateTarget[]> {
  const backend = requestedBackend(args), home = join(homedir(), '.clawket'), targets: UpdateTarget[] = [];
  if (backend === 'local-model' && (option(args, '--project') || args.includes('--device'))) throw new Error('Local model update uses its original --config.');
  if (backend && ['openclaw', 'hermes'].includes(backend) && (option(args, '--config') || option(args, '--project') || args.includes('--device'))) throw new Error('This backend does not accept a project/config scope.');
  if (!backend && (option(args, '--config') || option(args, '--project') || args.includes('--device'))) throw new Error('Select --backend with an explicit update scope.');
  if ((!backend || backend === 'openclaw') && (readPairingConfig() || readPairingConfig('preview'))) {
    if (listRuntimeProcesses().length > 1) throw new Error('Multiple OpenClaw runtimes are running. Inspect them before updating.');
    const target = await createUpdateTarget({ backend: 'openclaw', probe: async () => { if (!getServiceStatus().running) throw Object.assign(new Error(), { code: 'ECONNREFUSED' }); return {}; },
      start: async (entry, node) => { installService({ scriptPath: entry, nodePath: node }); }, legacyStop: async () => { stopService(); stopRuntimeProcesses(); } });
    target.prepareStopped = async entry => updateStoppedService({ scriptPath: entry, nodePath: process.execPath });
    targets.push(target);
  }
  const hermesPath = join(home, 'hermes-bridge.json');
  if ((!backend || backend === 'hermes') && !args.includes('--preview') && existsSync(hermesPath)) {
    const config = JSON.parse(readFileSync(hermesPath, 'utf8'));
    if (!Number.isInteger(config.port) || typeof config.token !== 'string' || !config.token || typeof config.host !== 'string' || typeof config.apiBaseUrl !== 'string') throw new Error('Invalid Hermes configuration.');
    if (readHermesRelayConfig()) targets.push(await createUpdateTarget({ backend: 'hermes-relay', configPath: getHermesRelayConfigPath(),
      probe: async () => { const owner = readRuntimeOwner(runtimeOwnerPath('hermes-relay', getHermesRelayConfigPath())); if (owner) return queryRuntimeOwner(owner, 'info'); if (process.platform === 'win32') throw new Error('Legacy Windows Hermes Relay ownership is unverified. Restart it with the latest CLI using its original deployment method before unified update.'); const legacy = legacyEntry('hermes-relay'); if (!legacy) throw Object.assign(new Error(), { code: 'ECONNREFUSED' }); return {}; },
      start: async (entry, node) => detached(entry, ['hermes', 'relay', 'run'], join(home, 'logs', 'hermes-relay.log'), undefined, node),
      legacyStop: async pid => { process.kill(pid, 'SIGTERM'); } }));
    targets.push(await createUpdateTarget({ backend: 'hermes', configPath: hermesPath, probe: method => hermesRpc(config, method ?? 'health'),
      start: async (entry, node) => detached(entry, ['hermes', 'run', '--host', config.host, '--port', String(config.port), '--api-url', config.apiBaseUrl], join(home, 'logs', 'hermes-bridge.log'), { ...process.env, CLAWKET_HERMES_BRIDGE_TOKEN: config.token }, node),
      legacyStop: async pid => { process.kill(pid, 'SIGTERM'); } }));
  }
  const controls = { codex: codexControl, 'claude-code': claudeControl, pi: piControl };
  const starts = { codex: startCodexBackground, 'claude-code': startClaudeBackground, pi: startPiBackground };
  const agentBackend = backend && backend in controls ? backend as AgentBackend : undefined;
  const agents = agentBackend ? [selectAgentTarget(agentBackend, args)] : !backend ? discoverAgentTargets(undefined, args.includes('--preview')) : [];
  for (const agent of agents) {
    const config = readAgentConfig(agent.configPath);
    targets.push(await createUpdateTarget({ backend: agent.backend, configPath: agent.configPath, probe: method => controls[agent.backend](config, method),
      start: (entry, node) => starts[agent.backend](['run', '--config', agent.configPath], join(dirname(agent.configPath), `${agent.backend}.log`), undefined, node, entry, true),
      legacyStop: async () => { await controls[agent.backend](config, 'bridge.stop'); } }));
  }
  if (!backend || backend === 'local-model') {
    const configPath = resolve(option(args, '--config') ?? join(home, 'local-model-preview', 'runtime.json'));
    if (existsSync(configPath)) {
      // Terminal-owned and independently supervised installations retain their original lifecycle.
      const owner = readRuntimeOwner(runtimeOwnerPath('local-model', configPath));
      if (!owner) targets.push({ backend: 'local-model', running: false, previousEntry: null, manual: true, preflight: async () => {}, stop: async () => {}, start: async () => {}, verify: async () => {} });
      else targets.push(await createUpdateTarget({ backend: 'local-model', configPath, probe: async () => { const current = readRuntimeOwner(runtimeOwnerPath('local-model', configPath)); if (!current) throw Object.assign(new Error(), { code: 'ECONNREFUSED' }); return queryRuntimeOwner(current, 'info'); }, start: async (entry, node) => detached(entry, ['local-model', 'run', '--config', configPath, ...(owner.port ? ['--port', String(owner.port)] : [])], join(dirname(configPath), 'bridge.log'), undefined, node) }));
    }
  }
  if (!targets.length) throw new Error('No saved Bridge configurations match this scope. Use the original --backend / --config.');
  return targets;
}

export async function handleUpdateCommand(args: string[]): Promise<void> {
  const allowed = new Set(['--backend', '--config', '--project', '--device', '--preview', '--version', '--json', '--activate', '--remote', '--relaunch']);
  for (let i = 0; i < args.length; i++) { const flag = args[i]; if (!allowed.has(flag)) throw new Error('Unknown update option. Use clawket update --help.'); if (['--backend', '--config', '--project', '--version', '--remote'].includes(flag)) { if (!args[++i] || args[i].startsWith('--')) throw new Error(`${flag} requires a value`); } }
  // `--remote <id>` is the phone-started run a runtime launched; only it reports to the shared status file.
  const remote = option(args, '--remote');
  if (remote !== undefined && (!isRemoteUpdateId(remote) || args.includes('--activate'))) throw new Error('Invalid remote update.');
  if (args.includes('--relaunch')) {
    if (!remote) throw new Error('--relaunch requires --remote.');
    relaunchRemoteUpdater(remote); return;
  }
  if (args.includes('--activate')) {
    const entry = realpathSync(process.argv[1]);
    const inside = relative(realpathSync(join(runtimeRoot(), 'releases')), entry);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Update activation requires a validated managed release.');
    const targets = await collectUpdateTargets(args), version = readCliVersion();
    for (const target of targets) if (target.previousVersion && compareStableVersions(version, target.previousVersion) < 0) throw new Error('The runtime version changed during update. No downgrade was applied.');
    process.env.CLAWKET_UPDATE_ACTIVATION = '1';
    const results = await activateUpdate(targets, entry, version);
    console.log(JSON.stringify({ version, results }));
    if (results.some(r => r.state === 'failed' || r.state === 'restored')) process.exitCode = 1;
    return;
  }
  const report: typeof writeRemoteUpdateProgress = (id, patch) => { if (remote) writeRemoteUpdateProgress(id, patch); };
  const id = remote ?? '';
  mkdirSync(runtimeRoot(), { recursive: true, mode: 0o700 });
  const lock = join(runtimeRoot(), 'update.lock');
  try { acquireUpdateLock(lock); } catch (error) { report(id, { state: 'failed', reason: 'running' }); throw error; }
  // Only a lock holder records its pid, so a live pid always means a live update.
  report(id, { pid: process.pid });
  let failure: RemoteUpdateFailure = 'error';
  try {
    // Validate scope/owners before downloading, then revalidate in the replacement CLI.
    const selected = await collectUpdateTargets(args);
    let version = option(args, '--version');
    if (!version) {
      failure = 'download';
      const response = await fetch(BRIDGE_NPM_METADATA_URL, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
      if (!response.ok) throw new Error('Could not check the latest Bridge release.');
      const metadata = await readReleaseMetadata(response);
      if (metadata.name !== '@p697/clawket' || metadata.clawket?.updateProtocol !== 1) { failure = 'unsupported'; throw new Error('The published Bridge does not support unified update yet. No runtime was changed.'); }
      version = metadata.version;
      failure = 'error';
    }
    if (!stableBridgeVersion(version)) throw new Error('Invalid stable Bridge release version.');
    for (const selectedTarget of selected) if (selectedTarget.previousVersion && compareStableVersions(version, selectedTarget.previousVersion) < 0) throw new Error('Downgrades require explicit rollback outside the updater.');
    report(id, { state: 'installing', version });
    // A phone may act on a stale saved version: never restart runtimes that already run this release.
    if (remote && selected.some(target => target.running) && selected.every(target => !target.running || target.previousVersion === version)) {
      console.log(`Bridge ${version} is already running; nothing was restarted.`);
      report(id, { state: 'updated', results: [] });
      return;
    }
    if (!args.includes('--json')) console.log(`Installing Bridge ${version}; saved connections are retained. Active replies must finish before their Bridge can restart.`);
    failure = 'download';
    const entry = await stageBridgeRelease(version);
    failure = 'error';
    report(id, { state: 'restarting' });
    const forwarded = args.filter((arg, index) => !['--version', '--remote'].includes(arg) && !['--version', '--remote'].includes(args[index - 1]));
    const output = await run(process.execPath, [entry, 'update', '--activate', ...forwarded], undefined, true, progress => {
      report(id, { state: 'waiting', waitingFor: progress.backend });
      if (!args.includes('--json')) console.log(`${progress.backend}: waiting for its current task to finish (up to 2 minutes)…`);
    });
    const result = JSON.parse(output) as { version: string; results: UpdateResult[] };
    if (result.version !== version || !Array.isArray(result.results) || !result.results.length || result.results.some(r => !['updated', 'stopped', 'manual'].includes(r.state))) {
      if (args.includes('--json')) console.log(JSON.stringify({ ok: false, ...result }));
      else for (const row of result.results ?? []) console.log(describeUpdateResult(row));
      const busy = Array.isArray(result.results) ? result.results.find(row => row.state === 'failed' && row.reason === 'busy') : undefined;
      failure = busy ? 'busy' : 'not_confirmed';
      report(id, { state: 'failed', reason: failure, ...(busy ? { waitingFor: busy.backend } : {}), results: Array.isArray(result.results) ? result.results : [] });
      throw new Error(busy ? `No Bridge was updated: ${busy.backend} is still running a task. Run update again once it finishes.` : 'Bridge update was not fully confirmed. Inspect local runtime status.');
    }
    const manifest = join(runtimeRoot(), 'active.json');
    if (existsSync(manifest)) writeFileSync(manifest + '.previous', readFileSync(manifest), { mode: 0o600 });
    writeFileSync(manifest + '.pending', JSON.stringify({ version, entry, node: process.execPath }), { mode: 0o600 }); renameSync(manifest + '.pending', manifest);
    const complete = !result.results.some(row => row.state === 'manual');
    report(id, { state: 'updated', results: result.results });
    if (args.includes('--json')) console.log(JSON.stringify({ ok: complete, ...result }));
    else { console.log(`Bridge ${version}: managed runtime update confirmed. Pairing and history retained.`); for (const row of result.results) console.log(describeUpdateResult(row)); }
    if (!complete) process.exitCode = 1;
  } catch (error) {
    // Already-finished runs keep their specific outcome; this only covers unexpected exits.
    report(id, { state: 'failed', reason: failure });
    throw error;
  } finally { unlinkSync(lock); }
}

export function compareStableVersions(a: string, b: string): number {
  if (!stableBridgeVersion(a) || !stableBridgeVersion(b)) throw new Error('Invalid Bridge version.');
  const right = b.split('.').map(Number);
  for (const [i, value] of a.split('.').map(Number).entries()) if (value !== right[i]) return value < right[i] ? -1 : 1;
  return 0;
}
export function acquireUpdateLock(path: string): void {
  if (existsSync(path)) {
    let pid: number;
    try { const saved = JSON.parse(readFileSync(path, 'utf8')); pid = saved.pid; if (!Number.isInteger(pid) || pid <= 0) throw new Error(); }
    catch { throw new Error('Invalid update lock. Inspect local Bridge state.'); }
    try { process.kill(pid, 0); throw new Error('Another Bridge update is still running.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    unlinkSync(path);
  }
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid })); } finally { closeSync(fd); }
}

export async function readReleaseMetadata(response: Response): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Invalid Bridge release metadata.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 128 * 1024) { await reader.cancel(); throw new Error(); } chunks.push(part.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new Error('Invalid Bridge release metadata.'); } finally { reader.releaseLock(); }
}
