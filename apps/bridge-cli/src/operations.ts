import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { getHermesProcessLogPaths, getServicePaths } from '@clawket/bridge-core';
import { agentLabels, discoverAgentTargets, inspectAgents, option, selectAgentTarget, type AgentBackend } from './agent-inventory.js';
import type { CliDoctorReport } from './diagnostics.js';
import { showLogs, type LogSource } from './cli-logs.js';
import { readCliVersion } from './metadata.js';

export const BACKENDS = ['openclaw', 'hermes', 'codex', 'claude-code', 'pi', 'local-model'] as const;
export type Backend = typeof BACKENDS[number];
export function requestedBackend(args: string[]): Backend | undefined {
  const value = option(args, '--backend');
  if (!value) return undefined;
  if (!(BACKENDS as readonly string[]).includes(value)) throw new Error(`Unknown --backend. Choose ${BACKENDS.join(', ')}.`);
  return value as Backend;
}

type Connection = { backend: Backend; environment: string; scope: string; state: string; transport: string; finding: string | null;
  configPath?: string; logPath?: string; modelConfigured?: boolean | null; projectAvailable?: boolean | null };

export async function handleAgentDiagnostics(backend: AgentBackend, args: string[]): Promise<boolean> {
  const command = args[0];
  if (!['status', 'doctor', 'logs'].includes(command)) return false;
  const target = selectAgentTarget(backend, args);
  if (command === 'logs') await showLogs([{ name: backend, path: join(dirname(target.configPath), `${backend}.log`) }], args);
  else printOperations(command, await inspectAgents([target]), args);
  return true;
}

export async function productConnections(report: CliDoctorReport | undefined, previewPaired: boolean, args: string[]): Promise<Connection[]> {
  const backend = requestedBackend(args);
  const previewOnly = args.includes('--preview');
  const rows: Connection[] = [];
  if (report && (!backend || backend === 'openclaw')) {
    if (!previewOnly) rows.push({ backend: 'openclaw', environment: 'production', scope: 'service', transport: 'relay',
      state: !report.paired ? 'unpaired' : !report.serviceRunning ? 'stopped' : report.localGatewayReachable ? 'running' : 'degraded',
      finding: !report.paired ? null : !report.serviceRunning ? 'Start the paired OpenClaw service with clawket start.'
        : !report.localGatewayReachable ? 'Local Gateway is unreachable; inspect clawket doctor --verbose and OpenClaw logs.' : null });
    if (previewPaired || previewOnly) rows.push({ backend: 'openclaw', environment: 'preview', scope: 'service', transport: 'relay',
      state: !previewPaired ? 'unpaired' : !report.serviceRunning ? 'stopped' : report.localGatewayReachable ? 'running' : 'degraded',
      finding: previewPaired && (!report.serviceRunning || !report.localGatewayReachable) ? 'Check the shared OpenClaw service and local Gateway.' : null });
  }
  if (report && (!backend || backend === 'hermes') && !previewOnly) rows.push({ backend: 'hermes', environment: 'production', scope: 'service',
    transport: report.hermesRelayPaired ? 'relay' : 'local',
    state: !report.hermesBridgeConfigFound && !report.hermesRelayPaired ? 'unpaired'
      : !report.hermesBridgeReachable ? 'unverified' : report.hermesApiReachable !== true || (report.hermesRelayPaired && !report.hermesRelayRuntimeRunning) ? 'degraded' : 'ready',
    finding: !report.hermesBridgeConfigFound && !report.hermesRelayPaired ? null
      : !report.hermesBridgeReachable ? 'Hermes Bridge is unreachable; inspect its logs and start the saved runtime.'
      : report.hermesApiReachable !== true ? 'The local Hermes API is unavailable or unverified.'
      : report.hermesRelayPaired && !report.hermesRelayRuntimeRunning ? 'The Hermes Relay runtime is stopped.' : null });
  if (!backend || ['codex', 'claude-code', 'pi'].includes(backend)) {
    const kind = backend as AgentBackend | undefined;
    const scoped = kind && (option(args, '--config') || option(args, '--project') || args.includes('--device'));
    const targets = scoped ? [selectAgentTarget(kind!, args)] : discoverAgentTargets(kind, previewOnly);
    if (kind && !targets.length) targets.push(selectAgentTarget(kind, args));
    rows.push(...await inspectAgents(targets));
  }
  if (!backend || backend === 'local-model') {
    const path = resolve(backend === 'local-model' ? option(args, '--config') ?? localModelPath() : localModelPath());
    if (existsSync(path) || backend === 'local-model') rows.push(localModelStatus(path));
  }
  if (report) {
    for (const row of rows) {
      if (row.state === 'unpaired') continue;
      const issues: string[] = row.finding ? [row.finding] : [];
      if (row.backend === 'openclaw') {
        if (report.openclawConfigFound === false) issues.push('Local OpenClaw configuration is missing.');
        if (report.openclawAuthMode === 'token' && !report.openclawTokenFound) issues.push('Gateway token authentication is not configured.');
        if (report.openclawAuthMode === 'password' && !report.openclawPasswordFound) issues.push('Gateway password authentication is not configured.');
        if (report.openclawAuthMode === null && report.openclawTokenFound && report.openclawPasswordFound) issues.push('Select an explicit Gateway authentication mode.');
      } else if (row.backend === 'hermes' && report.hermesSourceFound === false) issues.push('Hermes installation is missing.');
      row.finding = issues.length ? issues.join(' ') : null;
    }
  }
  if (!rows.length) throw new Error('No matching configuration. Use the backend command with its original --config or --project options.');
  return rows;
}

function localModelPath(): string { return join(homedir(), '.clawket', 'local-model-preview', 'runtime.json'); }
function localModelStatus(configPath: string): Connection {
  let state = 'unpaired';
  if (existsSync(configPath)) {
    state = 'invalid';
    try {
      const info = lstatSync(configPath);
      if (info.isFile() && info.size <= 256 * 1024) {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        if (config && typeof config.token === 'string' && Array.isArray(config.endpoints) && config.endpoints.length) state = 'unverified';
      }
    } catch { /* Report invalid without leaking config contents. */ }
  }
  return { backend: 'local-model', environment: 'preview', scope: 'model server', transport: 'relay', state, configPath,
    finding: state === 'unverified' ? 'Saved pairing found. Foreground/Windows supervisor readiness is not measured by this command.'
      : state === 'invalid' ? 'Local-model configuration is invalid; inspect it locally.' : 'Pair a local model first.' };
}

export function printOperations(command: string, connections: Connection[], args: string[], extra: object = {}): void {
  const configured = connections.filter(row => row.state !== 'unpaired');
  const findings = connections.filter(row => row.finding && (row.state !== 'unpaired' || !configured.length))
    .map(row => `${label(row)}: ${row.finding}`);
  if (!configured.length && !findings.length) findings.push('No matching saved pairing. Run clawket pair choose, or select --backend and the original --config.');
  const overall = !configured.length ? 'missing' : findings.length ? 'degraded' : 'healthy';
  if (args.includes('--json')) console.log(JSON.stringify({ ...extra, version: readCliVersion(), connections, summary: { overall, findings } }, null, 2));
  else {
    console.log(command === 'doctor' ? `Doctor: ${overall}` : `Clawket ${readCliVersion()}`);
    for (const row of connections) console.log(`${label(row)}: ${row.state === 'unpaired' ? 'not paired' : row.state}${row.state !== 'unpaired' ? ` (${row.transport}${row.modelConfigured === false ? '; model setup required' : ''}${row.projectAvailable === false ? '; project unavailable' : ''})` : ''}`);
    if (command === 'doctor') {
      findings.forEach(finding => console.log(`- ${finding}`));
      console.log('Next: clawket logs --follow, or select --backend and the original --project / --config.');
    }
    if (args.includes('--verbose')) {
      for (const row of connections) {
        if (row.configPath) console.log(`${label(row)} config: ${row.configPath}`);
        if (row.logPath) console.log(`${label(row)} log: ${row.logPath}`);
      }
    }
    console.log('Local checks only; Relay/phone connectivity and successful inference are unverified.');
  }
  if (!configured.length || (command === 'doctor' && findings.length)) process.exitCode = 1;
}

function label(row: Connection): string {
  const name = row.backend in agentLabels ? agentLabels[row.backend as AgentBackend] : row.backend === 'openclaw' ? 'OpenClaw' : row.backend === 'hermes' ? 'Hermes' : 'Local model';
  return `${name} · ${row.scope} · ${row.environment}`;
}

export function productLogSources(args: string[]): LogSource[] {
  const backend = requestedBackend(args);
  const sources: LogSource[] = [];
  if (!backend || backend === 'openclaw') {
    const paths = getServicePaths();
    sources.push({ name: 'openclaw', path: paths.logPath }, { name: 'openclaw:stderr', path: paths.errorLogPath });
  }
  if ((!backend || backend === 'hermes') && !args.includes('--preview')) {
    const paths = getHermesProcessLogPaths();
    sources.push({ name: 'hermes:bridge', path: paths.bridgeLogPath }, { name: 'hermes:relay', path: paths.relayLogPath },
      { name: 'hermes:bridge:stderr', path: paths.bridgeErrorLogPath }, { name: 'hermes:relay:stderr', path: paths.relayErrorLogPath });
  }
  if (!backend || ['codex', 'claude-code', 'pi'].includes(backend)) {
    const kind = backend as AgentBackend | undefined;
    const scoped = kind && (option(args, '--config') || option(args, '--project') || args.includes('--device'));
    const targets = scoped ? [selectAgentTarget(kind!, args)] : discoverAgentTargets(kind, args.includes('--preview'));
    if (kind && !targets.length) targets.push(selectAgentTarget(kind, args));
    targets.forEach((target, index) => sources.push({ name: `${target.backend}:${target.environment}:${index + 1}`, path: join(dirname(target.configPath), `${target.backend}.log`) }));
  }
  // Local-model foreground output belongs to its terminal. Windows' supervisor has a sanitized persistent log.
  if (!backend || backend === 'local-model') {
    const config = backend === 'local-model' ? option(args, '--config') ?? localModelPath() : localModelPath();
    sources.push({ name: 'local-model:supervisor', path: join(dirname(resolve(config)), 'windows-service', 'supervisor.jsonl') });
  }
  return sources;
}
