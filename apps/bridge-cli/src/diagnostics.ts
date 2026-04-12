import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { homedir } from 'node:os';
import {
  getHermesProcessLogPaths,
  getServicePaths,
  getServiceStatus,
  getHermesRelayConfigPath,
  readHermesRelayConfig,
  readPairingConfig,
} from '@clawket/bridge-core';
import {
  getOpenClawConfigDir,
  getOpenClawMediaDir,
  readOpenClawInfo,
  resolveGatewayUrl,
} from '@clawket/bridge-runtime';
import { parseLookbackToMs } from './log-parse.js';

export type CliDoctorReport = {
  paired: boolean;
  gatewayId: string | null;
  serverUrl: string | null;
  relayUrl: string | null;
  instanceId: string | null;
  serviceInstalled: boolean;
  serviceRunning: boolean;
  serviceMethod: string;
  servicePath: string;
  logPath: string;
  errorLogPath: string;
  openclawConfigDir: string;
  openclawMediaDir: string;
  openclawConfigFound: boolean;
  openclawAuthMode: 'token' | 'password' | null;
  openclawTokenFound: boolean;
  openclawPasswordFound: boolean;
  localGatewayUrl: string;
  localGatewayReachable: boolean;
  hermesSourcePath: string;
  hermesSourceFound: boolean;
  hermesBridgeConfigPath: string;
  hermesBridgeConfigFound: boolean;
  hermesBridgeUrl: string | null;
  hermesBridgeHealthUrl: string | null;
  hermesBridgeReachable: boolean;
  hermesApiReachable: boolean | null;
  hermesBridgeRuntimeRunning: boolean;
  hermesRelayConfigPath: string;
  hermesRelayPaired: boolean;
  hermesRelayServerUrl: string | null;
  hermesRelayUrl: string | null;
  hermesRelayRuntimeRunning: boolean;
  hermesBridgeLogPath: string;
  hermesBridgeErrorLogPath: string;
  hermesRelayLogPath: string;
  hermesRelayErrorLogPath: string;
};

export type PairPrerequisiteReport = Pick<
  CliDoctorReport,
  'openclawConfigFound'
  | 'openclawAuthMode'
  | 'openclawTokenFound'
  | 'openclawPasswordFound'
  | 'localGatewayUrl'
  | 'localGatewayReachable'
>;

export type CliDoctorSummary = {
  overall: 'healthy' | 'degraded' | 'missing';
  findings: string[];
};

export function getCliLogSourcePaths(includeErrorLog = false): string[] {
  const { logPath, errorLogPath } = getServicePaths();
  const {
    bridgeLogPath,
    bridgeErrorLogPath,
    relayLogPath,
    relayErrorLogPath,
  } = getHermesProcessLogPaths();
  const sources = [logPath, bridgeLogPath, relayLogPath];
  if (includeErrorLog) {
    sources.push(errorLogPath, bridgeErrorLogPath, relayErrorLogPath);
  }
  return sources;
}

export function readRecentCliLogs(input?: {
  lastMs?: number | null;
  lines?: number;
  includeErrorLog?: boolean;
}): string[] {
  const lines = clampLines(input?.lines ?? 200);
  const lookbackMs = input?.lastMs ?? null;
  const cutoff = lookbackMs != null ? Date.now() - lookbackMs : null;
  const sources = getCliLogSourcePaths(Boolean(input?.includeErrorLog));

  const entries = sources.flatMap((path, sourceIndex) => readLogFile(path, sourceIndex));
  const filtered = cutoff == null
    ? entries
    : entries.filter((entry) => entry.ts != null && entry.ts >= cutoff);
  return filtered
    .sort(compareLogEntries)
    .slice(-lines)
    .map((entry) => entry.raw);
}

export function summarizeDoctorReport(report: CliDoctorReport): CliDoctorSummary {
  const findings: string[] = [];
  const openclawConfigured = report.paired || report.openclawConfigFound;
  const hermesConfigured = report.hermesBridgeConfigFound || report.hermesRelayPaired;

  if (openclawConfigured) {
    if (!report.openclawConfigFound) {
      findings.push('OpenClaw pairing exists, but the local OpenClaw config directory is missing.');
    }
    if (report.openclawAuthMode === 'token' && !report.openclawTokenFound) {
      findings.push('OpenClaw is configured for token auth, but the gateway token is missing.');
    }
    if (report.openclawAuthMode === 'password' && !report.openclawPasswordFound) {
      findings.push('OpenClaw is configured for password auth, but the gateway password is missing.');
    }
    if (report.paired && !report.serviceRunning) {
      findings.push('OpenClaw is paired, but the background service is not running.');
    }
    if (!report.localGatewayReachable) {
      findings.push(`OpenClaw gateway is not reachable at ${report.localGatewayUrl}.`);
    }
  }

  if (hermesConfigured) {
    if (!report.hermesSourceFound) {
      findings.push('Hermes source was not found on this machine.');
    }
    if (report.hermesRelayPaired && !report.hermesBridgeConfigFound) {
      findings.push('Hermes relay is paired, but the local Hermes bridge config is missing.');
    }
    if (report.hermesBridgeConfigFound && !report.hermesBridgeReachable) {
      findings.push(`Hermes bridge is configured but not reachable at ${report.hermesBridgeHealthUrl ?? report.hermesBridgeUrl ?? 'its configured address'}.`);
    }
    if (report.hermesApiReachable === false) {
      findings.push('Hermes bridge is running, but the upstream Hermes API is not reachable.');
    }
    if (report.hermesRelayPaired && !report.hermesRelayRuntimeRunning) {
      findings.push('Hermes relay is paired, but the Hermes relay runtime is not running.');
    }
  }

  if (!openclawConfigured && !hermesConfigured) {
    return {
      overall: 'missing',
      findings: ['No OpenClaw or Hermes bridge configuration was detected on this machine.'],
    };
  }

  return {
    overall: findings.length > 0 ? 'degraded' : 'healthy',
    findings,
  };
}

export async function buildDoctorReport(): Promise<CliDoctorReport> {
  const config = readPairingConfig();
  const service = getServiceStatus();
  const openclaw = readOpenClawInfo();
  const localGatewayUrl = resolveGatewayUrl();
  const localGatewayReachable = await checkGatewayReachable(localGatewayUrl);
  const hermesSourcePath = `${homedir()}/.hermes/hermes-agent`;
  const hermesSourceFound = existsSync(hermesSourcePath);
  const hermesBridgeConfigPath = `${homedir()}/.clawket/hermes-bridge.json`;
  const hermesBridgeConfig = readHermesBridgeConfig(hermesBridgeConfigPath);
  const hermesBridgeUrl = hermesBridgeConfig
    ? `http://${normalizeHermesDisplayHost(hermesBridgeConfig.host)}:${hermesBridgeConfig.port}`
    : null;
  const hermesBridgeHealthUrl = hermesBridgeUrl ? `${hermesBridgeUrl}/health` : null;
  const hermesBridgeReachable = hermesBridgeHealthUrl
    ? await checkHttpReachable(hermesBridgeHealthUrl)
    : false;
  const hermesHealth = hermesBridgeHealthUrl
    ? await readHermesBridgeHealth(hermesBridgeHealthUrl)
    : null;
  const hermesRelayConfig = readHermesRelayConfig();
  const hermesLogs = getHermesProcessLogPaths();

  return {
    paired: Boolean(config),
    gatewayId: config?.gatewayId ?? null,
    serverUrl: config?.serverUrl ?? null,
    relayUrl: config?.relayUrl ?? null,
    instanceId: config?.instanceId ?? null,
    serviceInstalled: service.installed,
    serviceRunning: service.running,
    serviceMethod: service.method,
    servicePath: service.servicePath,
    logPath: service.logPath,
    errorLogPath: service.errorLogPath,
    openclawConfigDir: getOpenClawConfigDir(),
    openclawMediaDir: getOpenClawMediaDir(),
    openclawConfigFound: openclaw.configFound,
    openclawAuthMode: openclaw.authMode,
    openclawTokenFound: Boolean(openclaw.token),
    openclawPasswordFound: Boolean(openclaw.password),
    localGatewayUrl,
    localGatewayReachable,
    hermesSourcePath,
    hermesSourceFound,
    hermesBridgeConfigPath,
    hermesBridgeConfigFound: Boolean(hermesBridgeConfig),
    hermesBridgeUrl,
    hermesBridgeHealthUrl,
    hermesBridgeReachable,
    hermesApiReachable: hermesHealth?.hermesApiReachable ?? null,
    hermesBridgeRuntimeRunning: listHermesBridgeRuntimePids().length > 0,
    hermesRelayConfigPath: getHermesRelayConfigPath(),
    hermesRelayPaired: Boolean(hermesRelayConfig),
    hermesRelayServerUrl: hermesRelayConfig?.serverUrl ?? null,
    hermesRelayUrl: hermesRelayConfig?.relayUrl ?? null,
    hermesRelayRuntimeRunning: listHermesRelayRuntimePids().length > 0,
    hermesBridgeLogPath: hermesLogs.bridgeLogPath,
    hermesBridgeErrorLogPath: hermesLogs.bridgeErrorLogPath,
    hermesRelayLogPath: hermesLogs.relayLogPath,
    hermesRelayErrorLogPath: hermesLogs.relayErrorLogPath,
  };
}

export async function ensurePairPrerequisites(): Promise<CliDoctorReport> {
  const report = await buildDoctorReport();
  const failures = listPairPrerequisiteFailures(report);
  if (failures.length > 0) {
    throw new Error([
      'Cannot complete `clawket pair` because local OpenClaw prerequisites are not ready.',
      ...failures.map((item) => `- ${item}`),
      'Run `clawket doctor` for more details, or use `clawket pair --force` only if you intentionally want to bypass this safety check.',
    ].join('\n'));
  }
  return report;
}

export function listPairPrerequisiteFailures(report: PairPrerequisiteReport): string[] {
  const failures: string[] = [];
  if (!report.openclawConfigFound) {
    failures.push(`OpenClaw config was not found under ${formatOpenClawConfigLocations()}.`);
  }
  if (report.openclawTokenFound && report.openclawPasswordFound && report.openclawAuthMode == null) {
    failures.push('OpenClaw has both gateway token and password configured, but gateway.auth.mode is unset.');
  }
  if (!report.openclawTokenFound && !report.openclawPasswordFound) {
    failures.push('OpenClaw gateway auth is missing (token or password).');
  }
  if (report.openclawAuthMode === 'token' && !report.openclawTokenFound) {
    failures.push('OpenClaw gateway token is missing.');
  }
  if (report.openclawAuthMode === 'password' && !report.openclawPasswordFound) {
    failures.push('OpenClaw gateway password is missing.');
  }
  if (!report.localGatewayReachable) {
    failures.push(`Local OpenClaw Gateway is not reachable at ${report.localGatewayUrl}.`);
  }
  return failures;
}

function formatOpenClawConfigLocations(): string {
  const seen = new Set<string>();
  return [homedir(), '/root']
    .map((home) => `${home.trim()}/.openclaw`)
    .filter((path) => path !== '/.openclaw')
    .filter((path) => {
      if (seen.has(path)) return false;
      seen.add(path);
      return true;
    })
    .join(' or ');
}

type ParsedLogEntry = {
  ts: number | null;
  raw: string;
  sourceIndex: number;
  lineIndex: number;
};

function readLogFile(path: string, sourceIndex: number): ParsedLogEntry[] {
  try {
    const raw = readFileSync(path, 'utf8');
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, lineIndex) => ({
        raw: line,
        ts: parseTimestamp(line),
        sourceIndex,
        lineIndex,
      }));
  } catch {
    return [];
  }
}

function parseTimestamp(line: string): number | null {
  const matched = line.match(/^\[(\d{13})\]\s/);
  if (!matched) return null;
  const value = Number(matched[1]);
  return Number.isFinite(value) ? value : null;
}

function clampLines(value: number): number {
  if (!Number.isFinite(value)) return 200;
  return Math.max(1, Math.min(2_000, Math.floor(value)));
}

async function checkGatewayReachable(gatewayUrl: string): Promise<boolean> {
  try {
    const parsed = new URL(gatewayUrl);
    const host = parsed.hostname || '127.0.0.1';
    const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'wss:' ? 443 : 80);
    await new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      socket.setTimeout(900);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error('timeout'));
      });
      socket.once('error', (error) => {
        socket.destroy();
        reject(error);
      });
      socket.connect(port, host);
    });
    return true;
  } catch {
    return false;
  }
}

type HermesBridgeCliConfig = {
  token: string;
  port: number;
  host: string;
  apiBaseUrl: string;
};

function readHermesBridgeConfig(path: string): HermesBridgeCliConfig | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<HermesBridgeCliConfig>;
    if (!parsed.token || !parsed.port || !parsed.host || !parsed.apiBaseUrl) {
      return null;
    }
    return {
      token: parsed.token,
      port: parsed.port,
      host: parsed.host,
      apiBaseUrl: parsed.apiBaseUrl,
    };
  } catch {
    return null;
  }
}

async function checkHttpReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function readHermesBridgeHealth(url: string): Promise<{ hermesApiReachable: boolean } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const parsed = await response.json() as { hermesApiReachable?: boolean };
    return {
      hermesApiReachable: Boolean(parsed.hermesApiReachable),
    };
  } catch {
    return null;
  }
}

function listHermesBridgeRuntimePids(): number[] {
  return listPosixPidsMatching(/\bhermes\s+(run|dev)\b/);
}

function listHermesRelayRuntimePids(): number[] {
  return listPosixPidsMatching(/\bhermes\s+relay\s+run\b/);
}

function listPosixPidsMatching(pattern: RegExp): number[] {
  try {
    const scriptPath = process.argv[1] ?? '';
    if (!scriptPath) return [];
    const output = readPsOutput();
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
        if (!pattern.test(command)) return [];
        return [pid];
      });
  } catch {
    return [];
  }
}

function readPsOutput(): string {
  return execFileSync('ps', ['-ax', '-o', 'pid=,args='], { encoding: 'utf8' });
}

function compareLogEntries(a: ParsedLogEntry, b: ParsedLogEntry): number {
  if (a.ts != null && b.ts != null && a.ts !== b.ts) {
    return a.ts - b.ts;
  }
  if (a.ts != null && b.ts == null) return -1;
  if (a.ts == null && b.ts != null) return 1;
  if (a.sourceIndex !== b.sourceIndex) {
    return a.sourceIndex - b.sourceIndex;
  }
  return a.lineIndex - b.lineIndex;
}

function normalizeHermesDisplayHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed || trimmed === '0.0.0.0' || trimmed === '::' || trimmed === '::1') {
    return '127.0.0.1';
  }
  return trimmed;
}
