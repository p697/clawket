#!/usr/bin/env node
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import qrcodeTerminal from 'qrcode-terminal';
import {
  buildDoctorReport,
  ensurePairPrerequisites,
  getCliLogSourcePaths,
  readRecentCliLogs,
  summarizeDoctorReport,
} from './diagnostics.js';
import { parseLookbackToMs } from './log-parse.js';
import { buildGatewayControlUiOrigin, buildLocalPairingInfo, detectLanIp } from './local-pair.js';
import { readCliVersion } from './metadata.js';
import { buildLocalPairingJson, buildPairingJson } from './pairing-output.js';
import { writePairingQrPng, writeRawQrPng } from './qr-file.js';
import { decidePairServiceAction } from './service-decision.js';
import {
  clearServiceState,
  deletePairingConfig,
  deleteHermesRelayConfig,
  getHermesProcessLogPaths,
  getHermesRelayConfigPath,
  getPairingConfigPath,
  buildHermesLocalPairingQrPayload,
  pairHermesRelay,
  getServicePaths,
  getServiceStatus,
  installService,
  isAutostartUnsupportedError,
  listRuntimeProcesses,
  pairGateway,
  getDefaultBridgeDisplayName,
  readHermesRelayConfig,
  readPairingConfig,
  registerRuntimeProcess,
  refreshHermesRelayAccessCode,
  refreshAccessCode,
  restartService,
  startTransientRuntime,
  stopService,
  stopRuntimeProcesses,
  unregisterRuntimeProcess,
  uninstallService,
  type PairingInfo,
  type ServiceStatus,
  writeServiceState,
} from '@clawket/bridge-core';
import {
  BridgeRuntime,
  HermesLocalBridge,
  HermesRelayRuntime,
  buildHermesBridgeWsUrl,
  buildHermesRelayWsUrl,
  configureOpenClawLanAccess,
  resolveGatewayAuth,
  resolveGatewayUrl,
  restartOpenClawGateway,
} from '@clawket/bridge-runtime';

async function main(): Promise<void> {
  const [, , command = 'help', ...args] = process.argv;
  const isServiceMode = hasFlag(args, '--service');
  const jsonOutput = hasFlag(args, '--json');

  if (command === 'hermes') {
    await handleHermesCommand(args, jsonOutput);
    return;
  }

  if (command === 'pair') {
    await handlePairCommand(args, jsonOutput);
    return;
  }

  if (command === 'refresh-code') {
    const qrFile = readFlag(args, '--qr-file');
    const gatewayAuth = resolveGatewayAuth();
    if ('error' in gatewayAuth) {
      throw new Error(gatewayAuth.error);
    }
    const paired = await refreshAccessCode({
      gatewayToken: gatewayAuth.token,
      gatewayPassword: gatewayAuth.password,
    });
    const qrImagePath = await writePairingQrPng(paired, qrFile);
    if (jsonOutput) {
      printJson(buildPairingJson(paired, qrImagePath, getServiceStatus(), 'Pairing code refreshed.'));
    } else {
      printPairingInfo(paired, qrImagePath);
    }
    return;
  }

  if (command === 'hermes-refresh-code') {
    const qrFile = readFlag(args, '--qr-file');
    const paired = await refreshHermesRelayAccessCode();
    const qrImagePath = await writeRawQrPng(paired.qrPayload, 'clawket-hermes-relay-pair', qrFile);
    if (jsonOutput) {
      printJson({
        ok: true,
        backend: 'hermes',
        transport: 'relay',
        bridgeId: paired.config.bridgeId,
        relayUrl: paired.config.relayUrl,
        accessCodeExpiresAt: paired.accessCodeExpiresAt,
        qrImagePath,
      });
    } else {
      console.log(`Hermes Bridge ID: ${paired.config.bridgeId}`);
      console.log('\nScan this Hermes Relay QR in the Clawket app:\n');
      qrcodeTerminal.generate(paired.qrPayload, { small: true });
      console.log(`Expires: ${formatLocalTime(paired.accessCodeExpiresAt)}`);
      console.log(`QR image: ${qrImagePath}`);
    }
    return;
  }

  if (command === 'install' || command === 'start') {
    await handleLifecycleCommand('install', jsonOutput);
    return;
  }

  if (command === 'restart') {
    await handleLifecycleCommand('restart', jsonOutput);
    return;
  }

  if (command === 'stop') {
    await handleLifecycleCommand('stop', jsonOutput);
    return;
  }

  if (command === 'uninstall') {
    await handleLifecycleCommand('uninstall', jsonOutput);
    return;
  }

  if (command === 'reset') {
    stopRuntimeProcesses();
    stopHermesBridgeRuntimePids([
      ...listHermesRelayRuntimePids(),
      ...listHermesBridgeRuntimePids(),
    ]);
    stopService();
    deletePairingConfig();
    deleteHermesRelayConfig();
    deleteHermesBridgeCliConfig();
    console.log(`Cleared pairing config: ${getPairingConfigPath()}`);
    console.log(`Cleared Hermes relay config: ${getHermesRelayConfigPath()}`);
    console.log(`Cleared Hermes bridge config: ${HERMES_BRIDGE_CONFIG_PATH}`);
    return;
  }

  if (command === 'status') {
    await printStatus();
    return;
  }

  if (command === 'logs') {
    const lines = Number(readFlag(args, '--lines') ?? '200');
    const lastMs = parseLookbackToMs(readFlag(args, '--last') ?? readFlag(args, '-l'));
    const follow = hasFlag(args, '--follow') || hasFlag(args, '-f');
    const recent = readRecentCliLogs({
      lines,
      lastMs,
      includeErrorLog: hasFlag(args, '--errors'),
    });
    if (jsonOutput) {
      printJson({ ok: true, lines: recent });
    } else if (recent.length === 0) {
      console.log('No matching CLI logs found.');
    } else {
      console.log(recent.join('\n'));
    }
    if (follow && !jsonOutput) {
      await followCliLogs({
        includeErrorLog: hasFlag(args, '--errors'),
      });
    }
    return;
  }

  if (command === 'doctor') {
    const report = await buildDoctorReport();
    if (jsonOutput) {
      printJson(report);
    } else {
      printDoctorReport(report);
    }
    return;
  }

  if (command === 'run') {
    const config = requirePairingConfig();
    const replaceExisting = hasFlag(args, '--replace');
    const existingRuntimePids = listRuntimeProcesses().map((entry: { pid: number }) => entry.pid);
    if (existingRuntimePids.length > 0) {
      if (!replaceExisting) {
        console.error(
          `Another Clawket bridge runtime is already running (pid${existingRuntimePids.length > 1 ? 's' : ''}: ${existingRuntimePids.join(', ')}). `
          + 'Run "clawket stop" first, or rerun with "--replace" to take over.',
        );
        process.exit(1);
      }
      stopRuntimeProcesses();
    }
    const gatewayUrl = resolveGatewayUrl(readFlag(args, '--gateway-url') ?? readFlag(args, '-g'));
    const emitRuntimeLine = (line: string) => {
      console.log(`[${Date.now()}] ${line}`);
    };
    if (!isServiceMode) {
      console.log(`Gateway ID: ${config.gatewayId}`);
      console.log(`Instance ID: ${config.instanceId}`);
      console.log(`Gateway URL: ${gatewayUrl}`);
      console.log('');
      console.log('Starting bridge runtime. Press Ctrl+C to stop.');
      console.log('');
    } else {
      emitRuntimeLine('Starting Clawket service runtime.');
    }

    if (isServiceMode) {
      writeServiceState();
    }

    const runtime = new BridgeRuntime({
      config,
      gatewayUrl,
      onLog: (line) => {
        emitRuntimeLine(`[clawket] ${line}`);
      },
      onStatus: (snapshot) => {
        if (snapshot.lastError) {
          emitRuntimeLine(
            `[status] relay=${snapshot.relayConnected ? 'up' : 'down'} gateway=${snapshot.gatewayConnected ? 'up' : 'down'} clients=${snapshot.clientCount} error=${snapshot.lastError}`,
          );
          return;
        }
        emitRuntimeLine(
          `[status] relay=${snapshot.relayConnected ? 'up' : 'down'} gateway=${snapshot.gatewayConnected ? 'up' : 'down'} clients=${snapshot.clientCount}`,
        );
      },
      onPendingPairRequest: () => {
        emitRuntimeLine('[pair-request] pending');
      },
    });

    runtime.start();
    registerRuntimeProcess({
      gatewayId: config.gatewayId,
      instanceId: config.instanceId,
      serviceMode: isServiceMode,
    });
    if (isServiceMode) {
      await restoreHermesServiceRuntime((line) => {
        emitRuntimeLine(`[hermes-service] ${line}`);
      });
    }
    const shutdown = async () => {
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      await runtime.stop();
      unregisterRuntimeProcess(process.pid);
      if (isServiceMode) {
        clearServiceState(process.pid);
      }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    await new Promise<void>(() => {});
  }

  printHelp();
}

const HERMES_BRIDGE_CONFIG_PATH = join(homedir(), '.clawket', 'hermes-bridge.json');

type HermesBridgeCliConfig = {
  token: string;
  port: number;
  host: string;
  apiBaseUrl: string;
};

type HermesBridgeRuntimeOptions = {
  host: string;
  port: number;
  apiBaseUrl: string;
  token: string;
  replaceExisting: boolean;
  restartHermes: boolean;
  startHermesIfNeeded: boolean;
};

type HermesLocalPairingResult = {
  bridgeHttpUrl: string;
  bridgeWsUrl: string;
  publicHost: string;
  qrPayload: string;
  qrImagePath: string;
};

type PairBackendKind = 'openclaw' | 'hermes';

type PairTransportKind = 'relay' | 'local';

type PairSuccessResult = {
  backend: PairBackendKind;
  transport: PairTransportKind;
  label: string;
  qrPayload: string;
  qrImagePath: string;
  summaryLines: string[];
  jsonValue: Record<string, unknown>;
};

type PairFailureResult = {
  backend: PairBackendKind;
  transport: PairTransportKind;
  error: string;
};

const DEFAULT_HERMES_REGISTRY_URL = 'https://hermes-registry.clawket.ai';

type LifecycleCommand = 'install' | 'restart' | 'stop' | 'uninstall';

type LifecycleSummary = {
  command: LifecycleCommand;
  openclawPaired: boolean;
  openclawServiceStatus: ServiceStatus;
  openclawMessage: string;
  hermesConfigured: boolean;
  hermesBridgeConfigFound: boolean;
  hermesRelayConfigFound: boolean;
  hermesMessages: string[];
};

async function handlePairCommand(args: string[], jsonOutput: boolean): Promise<void> {
  const pairSubcommand = readPairSubcommand(args);
  const localPair = pairSubcommand === 'local' || hasFlag(args, '--local');
  const requestedBackend = resolveRequestedPairBackend(args);
  const backends = requestedBackend ? [requestedBackend] : detectAvailablePairBackends();

  if (backends.length === 0) {
    throw new Error(
      'No pairable backend was detected on this machine. Set up OpenClaw or Hermes first, then retry.',
    );
  }

  if (backends.length === 1) {
    const only = backends[0];
    if (localPair) {
      if (only === 'hermes') {
        await handleHermesLocalPairCommand(args, jsonOutput);
      } else {
        await handleOpenClawLocalPairCommand(args, jsonOutput);
      }
      return;
    }
    if (only === 'hermes') {
      await handleHermesRelayPairCommand(args, jsonOutput);
      return;
    }
    await handleOpenClawRelayPairCommand(args, jsonOutput);
    return;
  }

  const successes: PairSuccessResult[] = [];
  const failures: PairFailureResult[] = [];
  for (const backend of backends) {
    try {
      const result = localPair
        ? backend === 'hermes'
          ? await performHermesLocalPairing(args)
          : await performOpenClawLocalPairing(args)
        : backend === 'hermes'
          ? await performHermesRelayPairing(args)
          : await performOpenClawRelayPairing(args);
      successes.push(result);
    } catch (error) {
      failures.push({
        backend,
        transport: localPair ? 'local' : 'relay',
        error: formatError(error),
      });
    }
  }

  if (successes.length === 0 && failures.length > 0) {
    throw new Error(failures.map((entry) => `[${entry.backend}] ${entry.error}`).join('\n'));
  }

  const partialFailure = successes.length > 0 && failures.length > 0;

  if (jsonOutput) {
    printJson({
      ok: successes.length > 0,
      partialFailure,
      mode: localPair ? 'pair-local' : 'pair',
      backends,
      results: successes.map((entry) => ({
        backend: entry.backend,
        transport: entry.transport,
        label: entry.label,
        ...entry.jsonValue,
      })),
      failures,
    });
  } else {
    printPairResultBundle({
      localPair,
      detectedBackends: backends,
      successes,
      failures,
    });
  }
}

async function handleLifecycleCommand(command: LifecycleCommand, jsonOutput: boolean): Promise<void> {
  const openclawConfig = readPairingConfig();
  const hermesBridgeConfig = readHermesBridgeCliConfig();
  const hermesRelayConfig = readHermesRelayConfig();
  const lifecycleStartedAtMs = Date.now();

  let openclawMessage = 'OpenClaw is not paired. Left the OpenClaw service unchanged.';
  let openclawServiceStatus = getServiceStatus();

  if (command === 'install') {
    stopRuntimeProcesses();
    if (openclawConfig) {
      openclawServiceStatus = installService();
      openclawServiceStatus = await waitForOpenClawServiceReady(lifecycleStartedAtMs, openclawServiceStatus);
      openclawMessage = `Installed background service for gateway ${openclawConfig.gatewayId}.`;
    }
  } else if (command === 'restart') {
    stopRuntimeProcesses();
    if (openclawConfig) {
      openclawServiceStatus = restartService();
      openclawServiceStatus = await waitForOpenClawServiceReady(lifecycleStartedAtMs, openclawServiceStatus);
      openclawMessage = `Restarted background service for gateway ${openclawConfig.gatewayId}.`;
    }
  } else if (command === 'stop') {
    openclawServiceStatus = stopService();
    stopRuntimeProcesses();
    openclawMessage = openclawConfig ? 'Stopped background service.' : 'OpenClaw is not paired. Stopped any active OpenClaw runtime only.';
  } else {
    openclawServiceStatus = uninstallService();
    stopRuntimeProcesses();
    openclawMessage = openclawConfig
      ? 'Removed background service registration.'
      : 'OpenClaw is not paired. Ensured no OpenClaw service registration remains.';
  }

  const hermesHandledByServiceLauncher = (command === 'install' || command === 'restart')
    && Boolean(openclawConfig)
    && openclawServiceStatus.installed
    && openclawServiceStatus.running;

  const hermesMessages = hermesHandledByServiceLauncher
    ? ['Hermes runtimes will be restored by the OpenClaw service launcher.']
    : await handleHermesLifecycle(command, {
      bridgeConfig: hermesBridgeConfig,
      relayConfigFound: Boolean(hermesRelayConfig),
    });

  const summary: LifecycleSummary = {
    command,
    openclawPaired: Boolean(openclawConfig),
    openclawServiceStatus,
    openclawMessage,
    hermesConfigured: Boolean(hermesBridgeConfig || hermesRelayConfig),
    hermesBridgeConfigFound: Boolean(hermesBridgeConfig),
    hermesRelayConfigFound: Boolean(hermesRelayConfig),
    hermesMessages,
  };

  if (jsonOutput) {
    printJson({
      ok: true,
      ...summary,
    });
    return;
  }

  printLifecycleSummary(summary);
}

async function waitForOpenClawServiceReady(
  startedAtMs: number,
  initialStatus: ServiceStatus,
  timeoutMs = 7_000,
  pollMs = 200,
): Promise<ServiceStatus> {
  let lastStatus = initialStatus;
  if (!lastStatus.installed) {
    return lastStatus;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    lastStatus = getServiceStatus();
    if (lastStatus.running && hasOpenClawRelayConnectedSince(startedAtMs)) {
      return lastStatus;
    }
    await delay(pollMs);
  }
  return getServiceStatus();
}

function hasOpenClawRelayConnectedSince(startedAtMs: number): boolean {
  const lookbackMs = Math.max(5_000, Date.now() - startedAtMs + 1_000);
  const recent = readRecentCliLogs({
    lastMs: lookbackMs,
    lines: 400,
  });
  return recent.some((line) => {
    const timestamp = parseCliLogTimestampMs(line);
    return timestamp != null
      && timestamp >= startedAtMs
      && line.includes('[clawket] relay connected');
  });
}

function parseCliLogTimestampMs(line: string): number | null {
  const match = /^\[(\d{10,})\]/.exec(line);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function detectAvailablePairBackends(): PairBackendKind[] {
  const backends: PairBackendKind[] = [];
  if (canPairOpenClaw()) {
    backends.push('openclaw');
  }
  if (canPairHermes()) {
    backends.push('hermes');
  }
  return backends;
}

function canPairOpenClaw(): boolean {
  const gatewayAuth = resolveGatewayAuth();
  if ('error' in gatewayAuth) {
    return false;
  }
  return Boolean(gatewayAuth.token || gatewayAuth.password);
}

function canPairHermes(): boolean {
  return Boolean(readHermesBridgeCliConfig()?.token || existsSync(resolveDefaultHermesSourcePath()));
}

function resolveDefaultHermesSourcePath(): string {
  return join(homedir(), '.hermes', 'hermes-agent');
}

async function handleHermesCommand(args: string[], jsonOutput: boolean): Promise<void> {
  const subcommand = readPairSubcommand(args) ?? 'help';
  const subArgs = args.slice(1);

  if (subcommand === 'run') {
    const saved = readHermesBridgeCliConfig();
    const host = readFlag(subArgs, '--host') ?? saved?.host ?? '0.0.0.0';
    const port = Number(readFlag(subArgs, '--port') ?? saved?.port ?? '4319');
    const apiBaseUrl = readFlag(subArgs, '--api-url') ?? saved?.apiBaseUrl ?? 'http://127.0.0.1:8642';
    const token = readFlag(subArgs, '--token') ?? process.env.CLAWKET_HERMES_BRIDGE_TOKEN ?? saved?.token ?? randomUUID();
    const bridge = await startHermesBridgeRuntime({
      host,
      port,
      apiBaseUrl,
      token,
      replaceExisting: hasFlag(subArgs, '--replace') || !hasFlag(subArgs, '--no-replace'),
      restartHermes: hasFlag(subArgs, '--restart-hermes'),
      startHermesIfNeeded: !hasFlag(subArgs, '--no-start-hermes'),
    });

    if (!jsonOutput) {
      console.log(`Hermes bridge URL: ${bridge.getHttpUrl()}`);
      console.log(`Hermes bridge WS: ${bridge.getWsUrl()}`);
      console.log(`Hermes API: ${apiBaseUrl}`);
      console.log(`Hermes bridge health: ${bridge.getHttpUrl()}/health`);
      console.log('');
      console.log(`Hermes local bridge is running. Press Ctrl+C to stop.`);
      console.log('');
    } else {
      printJson({
        ok: true,
        bridgeUrl: bridge.getHttpUrl(),
        wsUrl: bridge.getWsUrl(),
        apiBaseUrl,
      });
    }

    await keepHermesBridgeAlive(bridge);
    return;
  }

  if (subcommand === 'dev') {
    const saved = readHermesBridgeCliConfig();
    const host = readFlag(subArgs, '--host') ?? saved?.host ?? '0.0.0.0';
    const port = Number(readFlag(subArgs, '--port') ?? saved?.port ?? '4319');
    const apiBaseUrl = readFlag(subArgs, '--api-url') ?? saved?.apiBaseUrl ?? 'http://127.0.0.1:8642';
    const token = readFlag(subArgs, '--token') ?? process.env.CLAWKET_HERMES_BRIDGE_TOKEN ?? saved?.token ?? randomUUID();
    const publicHost = readFlag(subArgs, '--public-host') ?? detectLanIp();
    if (!publicHost) {
      throw new Error('Failed to determine a LAN IP address for Hermes pairing. Pass --public-host explicitly.');
    }

    const bridge = await startHermesBridgeRuntime({
      host,
      port,
      apiBaseUrl,
      token,
      replaceExisting: hasFlag(subArgs, '--replace') || !hasFlag(subArgs, '--no-replace'),
      restartHermes: hasFlag(subArgs, '--restart-hermes'),
      startHermesIfNeeded: !hasFlag(subArgs, '--no-start-hermes'),
    });
    const pairing = await buildHermesLocalPairing({
      publicHost,
      port,
      token,
      qrFile: readFlag(subArgs, '--qr-file'),
    });

    if (jsonOutput) {
      printJson({
        ok: true,
        mode: 'hermes-dev',
        bridgeUrl: pairing.bridgeHttpUrl,
        wsUrl: pairing.bridgeWsUrl,
        publicHost: pairing.publicHost,
        apiBaseUrl,
        qrImagePath: pairing.qrImagePath,
      });
    } else {
      console.log(`Hermes bridge URL: ${pairing.bridgeHttpUrl}`);
      console.log(`Hermes bridge WS: ${pairing.bridgeWsUrl}`);
      console.log(`Hermes API: ${apiBaseUrl}`);
      console.log(`Hermes bridge health: ${bridge.getHttpUrl()}/health`);
      console.log(`Hermes pairing host: ${pairing.publicHost}`);
      console.log('\nScan this Hermes local bridge QR in the Clawket app:\n');
      qrcodeTerminal.generate(pairing.qrPayload, { small: true });
      console.log(`QR image: ${pairing.qrImagePath}`);
      console.log('');
      console.log('Hermes local dev bridge is running. Press Ctrl+C to stop.');
      console.log('');
    }

    await keepHermesBridgeAlive(bridge);
    return;
  }

  if (subcommand === 'pair') {
    const pairSubcommand = readPairSubcommand(subArgs);
    if (pairSubcommand === 'relay' || hasFlag(subArgs, '--relay')) {
      await handleHermesRelayPairCommand(subArgs, jsonOutput);
      return;
    }
    if (pairSubcommand !== 'local' && !hasFlag(subArgs, '--local')) {
      await handleHermesRelayPairCommand(subArgs, jsonOutput);
      return;
    }
    await handleHermesLocalPairCommand(subArgs, jsonOutput);
    return;
  }

  if (subcommand === 'relay') {
    const relaySubcommand = readPairSubcommand(subArgs);
    if (relaySubcommand !== 'run') {
      throw new Error('Hermes relay currently supports only "clawket hermes relay run".');
    }
    await handleHermesRelayRunCommand(subArgs, jsonOutput);
    return;
  }

  printHelp();
}

function printPairingInfo(paired: PairingInfo, qrImagePath: string): void {
  if (paired.action === 'refreshed') {
    console.log('Bridge already paired. Refreshed the pairing code.');
  }
  console.log(`Gateway ID: ${paired.config.gatewayId}`);
  console.log('\nScan this QR code in the Clawket app:\n');
  qrcodeTerminal.generate(paired.qrPayload, { small: true });
  console.log(`Expires: ${formatLocalTime(paired.accessCodeExpiresAt)}`);
  console.log(`QR image: ${qrImagePath}`);
}

function printLocalPairingInfo(
  gatewayUrl: string,
  authMode: 'token' | 'password',
  expiresAt: number,
  qrPayload: string,
  qrImagePath: string,
  customUrl: string | null,
): void {
  console.log(`Gateway URL: ${gatewayUrl}`);
  console.log(`Auth mode: ${authMode}`);
  console.log(customUrl ? '\nScan this custom gateway QR in the Clawket app:\n' : '\nScan this local gateway QR in the Clawket app:\n');
  qrcodeTerminal.generate(qrPayload, { small: true });
  console.log(`Expires: ${new Date(expiresAt).toLocaleString()}`);
  console.log(`QR image: ${qrImagePath}`);
}

async function performOpenClawLocalPairing(args: string[]): Promise<PairSuccessResult> {
  const gatewayAuth = resolveGatewayAuth();
  if ('error' in gatewayAuth) {
    throw new Error(gatewayAuth.error);
  }
  const qrFile = readFlag(args, '--qr-file');
  const explicitLocalUrl = readFlag(args, '--url');
  const local = buildLocalPairingInfo({
    explicitUrl: explicitLocalUrl,
    gatewayToken: gatewayAuth.token,
    gatewayPassword: gatewayAuth.password,
  });
  let message = 'Generated a local gateway pairing QR.';
  let configUpdated = false;
  let controlUiOrigin: string | null = null;
  let gatewayRestartAction: 'restarted' | 'started' | 'unchanged' = 'unchanged';

  if (!explicitLocalUrl) {
    controlUiOrigin = buildGatewayControlUiOrigin(local.gatewayUrl);
    const lanConfig = await configureOpenClawLanAccess({ controlUiOrigin });
    configUpdated = lanConfig.bindChanged || lanConfig.allowedOriginAdded;
    if (configUpdated) {
      const restart = await restartOpenClawGateway();
      gatewayRestartAction = restart.action;
    }
    message = configUpdated
      ? 'Configured OpenClaw for LAN access, restarted the Gateway, and generated a local gateway pairing QR.'
      : 'OpenClaw already allowed LAN pairing. Generated a local gateway pairing QR.';
  }

  const qrImagePath = await writeRawQrPng(local.qrPayload, 'clawket-local-pair', qrFile);
  return {
    backend: 'openclaw',
    transport: 'local',
    label: 'OpenClaw · Local',
    qrPayload: local.qrPayload,
    qrImagePath,
    summaryLines: [
      `Gateway URL: ${local.gatewayUrl}`,
      `Auth mode: ${local.authMode}`,
      `Expires: ${new Date(local.expiresAt).toLocaleString()}`,
      `QR image: ${qrImagePath}`,
      message,
    ],
    jsonValue: buildLocalPairingJson({
      gatewayUrl: local.gatewayUrl,
      authMode: local.authMode,
      expiresAt: local.expiresAt,
      qrImagePath,
      message,
      configUpdated,
      controlUiOrigin,
      gatewayRestartAction,
      customUrl: Boolean(explicitLocalUrl),
    }) as Record<string, unknown>,
  };
}

async function performOpenClawRelayPairing(args: string[]): Promise<PairSuccessResult> {
  const forcePair = hasFlag(args, '--force');
  if (!forcePair) {
    await ensurePairPrerequisites();
  }
  const gatewayAuth = resolveGatewayAuth();
  if ('error' in gatewayAuth) {
    throw new Error(gatewayAuth.error);
  }
  const server = resolvePairServer(args, 'openclaw');
  const name = readFlag(args, '--name') ?? readFlag(args, '-n') ?? getDefaultBridgeDisplayName();
  const qrFile = readFlag(args, '--qr-file');
  const paired = await pairGateway({
    serverUrl: server,
    displayName: name,
    gatewayToken: gatewayAuth.token,
    gatewayPassword: gatewayAuth.password,
  });
  const qrImagePath = await writePairingQrPng(paired, qrFile);
  const currentService = getServiceStatus();
  const serviceAction = decidePairServiceAction(paired, currentService);
  let serviceStatus = currentService;
  let serviceMessage = 'Background service already running. Left unchanged.';

  if (serviceAction === 'noop') {
    const runtimeProcesses = listRuntimeProcesses();
    if (runtimeProcesses.length > 1) {
      stopRuntimeProcesses();
      serviceStatus = restartService();
      serviceMessage = 'Detected duplicate bridge runtimes. Restarted the background service cleanly.';
    }
  } else {
    try {
      stopRuntimeProcesses();
      serviceStatus = serviceAction === 'install' ? installService() : restartService();
      serviceMessage = serviceAction === 'install'
        ? 'Auto-installed background service.'
        : paired.action === 'registered'
          ? 'Bridge identity changed. Restarted background service to load the new pairing.'
          : 'Background service was installed but stopped. Restarted it.';
    } catch (error) {
      if (isAutostartUnsupportedError(error)) {
        serviceStatus = await startTransientRuntime();
        serviceMessage = buildUnsupportedAutostartMessage(serviceStatus);
      } else {
        console.error(`Pairing succeeded, but service activation failed: ${formatError(error)}`);
        console.error('You can still run "clawket install" or "clawket run" manually.');
        process.exitCode = 1;
        serviceMessage = 'Pairing succeeded, but service activation failed.';
      }
    }
  }

  return {
    backend: 'openclaw',
    transport: 'relay',
    label: 'OpenClaw · Relay',
    qrPayload: paired.qrPayload,
    qrImagePath,
    summaryLines: [
      `Gateway ID: ${paired.config.gatewayId}`,
      `Expires: ${formatLocalTime(paired.accessCodeExpiresAt)}`,
      `QR image: ${qrImagePath}`,
      serviceMessage,
      `Service: ${serviceStatus.installed ? (serviceStatus.running ? 'installed, running' : 'installed, stopped') : 'not installed'}`,
    ],
    jsonValue: buildPairingJson(paired, qrImagePath, serviceStatus, serviceMessage) as Record<string, unknown>,
  };
}

async function performHermesLocalPairing(args: string[]): Promise<PairSuccessResult> {
  const { port, token } = await ensureHermesPairingRuntimeReady(args);
  const publicHost = readFlag(args, '--public-host') ?? detectLanIp();
  if (!publicHost) {
    throw new Error('Failed to determine a LAN IP address for Hermes pairing. Pass --public-host explicitly.');
  }
  const pairing = await buildHermesLocalPairing({
    publicHost,
    port,
    token,
    qrFile: readFlag(args, '--qr-file'),
  });
  return {
    backend: 'hermes',
    transport: 'local',
    label: 'Hermes · Local',
    qrPayload: pairing.qrPayload,
    qrImagePath: pairing.qrImagePath,
    summaryLines: [
      `Hermes bridge URL: ${pairing.bridgeHttpUrl}`,
      `Hermes bridge WS: ${pairing.bridgeWsUrl}`,
      `QR image: ${pairing.qrImagePath}`,
    ],
    jsonValue: {
      ok: true,
      mode: 'hermes',
      backend: 'hermes',
      transport: 'local',
      bridgeUrl: pairing.bridgeHttpUrl,
      wsUrl: pairing.bridgeWsUrl,
      qrImagePath: pairing.qrImagePath,
    },
  };
}

async function performHermesRelayPairing(args: string[]): Promise<PairSuccessResult> {
  const pairingStartedAt = Date.now();
  logHermesPerf('pair_relay_begin');
  const server = resolvePairServer(args, 'hermes');
  const name = readFlag(args, '--name') ?? readFlag(args, '-n') ?? 'Hermes';
  const qrFile = readFlag(args, '--qr-file');
  const paired = await pairHermesRelay({
    serverUrl: server,
    displayName: name,
  });
  logHermesPerf('pair_relay_registered', {
    elapsedMs: Date.now() - pairingStartedAt,
    action: paired.action,
  });
  const qrImagePath = await writeRawQrPng(paired.qrPayload, 'clawket-hermes-relay-pair', qrFile);

  // When a fresh registration replaced the relay config (new bridgeId / relayUrl /
  // relaySecret), any previously running relay runtime still holds the OLD values
  // in memory.  Stop it first so ensureHermesRelayBackgroundRuntime() starts a new
  // process that reads the updated config from disk.
  // For a simple access-code refresh the bridgeId stays the same and the running
  // runtime is still valid, so we can safely skip the restart.
  if (paired.action === 'registered') {
    const stalePids = listHermesRelayRuntimePids();
    if (stalePids.length > 0) {
      stopHermesBridgeRuntimePids(stalePids);
    }
  }

  const runtimeMessage = await ensureHermesRelayBackgroundRuntime(args);
  logHermesPerf('pair_relay_ready', {
    elapsedMs: Date.now() - pairingStartedAt,
  });
  return {
    backend: 'hermes',
    transport: 'relay',
    label: 'Hermes · Relay',
    qrPayload: paired.qrPayload,
    qrImagePath,
    summaryLines: [
      `Hermes Bridge ID: ${paired.config.bridgeId}`,
      `Hermes Relay URL: ${paired.config.relayUrl}`,
      `Expires: ${formatLocalTime(paired.accessCodeExpiresAt)}`,
      `QR image: ${qrImagePath}`,
      runtimeMessage,
    ],
    jsonValue: {
      ok: true,
      backend: 'hermes',
      transport: 'relay',
      bridgeId: paired.config.bridgeId,
      relayUrl: paired.config.relayUrl,
      accessCodeExpiresAt: paired.accessCodeExpiresAt,
      qrImagePath,
      runtimeMessage,
    },
  };
}

async function handleOpenClawRelayPairCommand(args: string[], jsonOutput: boolean): Promise<void> {
  const result = await performOpenClawRelayPairing(args);
  if (jsonOutput) {
    printJson(result.jsonValue);
    return;
  }
  const gatewayIdLine = result.summaryLines.find((line) => line.startsWith('Gateway ID: '));
  const expiresLine = result.summaryLines.find((line) => line.startsWith('Expires: '));
  const qrImageLine = result.summaryLines.find((line) => line.startsWith('QR image: '));
  const serviceMessage = result.summaryLines.find((line) => !line.startsWith('Gateway ID: ') && !line.startsWith('Expires: ') && !line.startsWith('QR image: ') && !line.startsWith('Service: ')) ?? null;
  const serviceStatusLine = result.summaryLines.find((line) => line.startsWith('Service: '));
  if (gatewayIdLine) {
    console.log(gatewayIdLine);
  }
  console.log('\nScan this QR code in the Clawket app:\n');
  qrcodeTerminal.generate(result.qrPayload, { small: true });
  if (expiresLine) {
    console.log(expiresLine);
  }
  if (qrImageLine) {
    console.log(qrImageLine);
  }
  if (serviceMessage) {
    console.log(serviceMessage);
  }
  if (serviceStatusLine) {
    console.log(serviceStatusLine);
  }
}

function printPairResultBundle(input: {
  localPair: boolean;
  detectedBackends: PairBackendKind[];
  successes: PairSuccessResult[];
  failures: PairFailureResult[];
}): void {
  console.log('Detected backends:');
  for (const backend of input.detectedBackends) {
    console.log(`- ${backend === 'openclaw' ? 'OpenClaw' : 'Hermes'}`);
  }
  for (const result of input.successes) {
    console.log(`\n[${result.label}]`);
    qrcodeTerminal.generate(result.qrPayload, { small: true });
    for (const line of result.summaryLines) {
      console.log(line);
    }
  }
  if (input.failures.length > 0) {
    console.error('\nPairing errors:');
    for (const failure of input.failures) {
      console.error(`- ${failure.backend} (${failure.transport}): ${failure.error}`);
    }
  }
}

async function handleOpenClawLocalPairCommand(args: string[], jsonOutput: boolean): Promise<void> {
  const explicitLocalUrl = readFlag(args, '--url');
  const result = await performOpenClawLocalPairing(args);
  if (jsonOutput) {
    printJson(result.jsonValue);
  } else {
    const payload = result.jsonValue as {
      gatewayUrl: string;
      authMode: 'token' | 'password';
      expiresAt: number;
      message?: string;
    };
    printLocalPairingInfo(
      payload.gatewayUrl,
      payload.authMode,
      payload.expiresAt,
      result.qrPayload,
      result.qrImagePath,
      explicitLocalUrl,
    );
    const message = payload.message;
    if (message) {
      console.log(message);
    }
  }
}

async function handleHermesLocalPairCommand(args: string[], jsonOutput: boolean): Promise<void> {
  const result = await performHermesLocalPairing(args);
  if (jsonOutput) {
    printJson(result.jsonValue);
  } else {
    console.log(result.summaryLines[0]);
    console.log('\nScan this Hermes local bridge QR in the Clawket app:\n');
    qrcodeTerminal.generate(result.qrPayload, { small: true });
    console.log(result.summaryLines[2]);
  }
}

async function handleHermesRelayPairCommand(args: string[], jsonOutput: boolean): Promise<void> {
  const result = await performHermesRelayPairing(args);
  if (jsonOutput) {
    printJson(result.jsonValue);
    return;
  }
  console.log(result.summaryLines[0]);
  console.log('\nScan this Hermes Relay QR in the Clawket app:\n');
  qrcodeTerminal.generate(result.qrPayload, { small: true });
  for (const line of result.summaryLines.slice(1)) {
    console.log(line);
  }
}

async function handleHermesRelayRunCommand(args: string[], jsonOutput: boolean): Promise<void> {
  const relayConfig = readHermesRelayConfig();
  if (!relayConfig) {
    throw new Error(`Hermes relay is not paired. Run "clawket hermes pair relay" first. Config path: ${getHermesRelayConfigPath()}`);
  }
  const { host, port, token } = await ensureHermesPairingRuntimeReady(args);
  const bridgeHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  const bridgeWsUrl = buildHermesBridgeWsUrl(bridgeHost, port, token);
  const runtime = await startHermesRelayRuntime(bridgeWsUrl);

  if (jsonOutput) {
    printJson({
      ok: true,
      backend: 'hermes',
      transport: 'relay',
      bridgeId: relayConfig.bridgeId,
      relayUrl: relayConfig.relayUrl,
      runtimeRelayUrl: buildHermesRelayWsUrl(relayConfig),
      bridgeWsUrl,
    });
  } else {
    console.log(`Hermes Bridge ID: ${relayConfig.bridgeId}`);
    console.log(`Hermes Relay URL: ${relayConfig.relayUrl}`);
    console.log(`Hermes Bridge WS: ${bridgeWsUrl}`);
    console.log('');
    console.log('Hermes relay runtime is running. Press Ctrl+C to stop.');
    console.log('');
  }

  await keepHermesRelayRuntimeAlive(runtime);
}

async function handleHermesLifecycle(
  command: LifecycleCommand,
  input: {
    bridgeConfig: HermesBridgeCliConfig | null;
    relayConfigFound: boolean;
  },
): Promise<string[]> {
  const messages: string[] = [];

  if (command === 'stop' || command === 'uninstall') {
    const pids = [
      ...listHermesRelayRuntimePids(),
      ...listHermesBridgeRuntimePids(),
    ];
    if (pids.length > 0) {
      stopHermesBridgeRuntimePids(pids);
      messages.push(`Stopped Clawket-managed Hermes runtime${pids.length > 1 ? 's' : ''} (pid${pids.length > 1 ? 's' : ''}: ${pids.join(', ')}).`);
    } else if (input.bridgeConfig || input.relayConfigFound) {
      messages.push('No Clawket-managed Hermes runtime was running.');
    } else {
      messages.push('Hermes is not configured.');
    }
    return messages;
  }

  if (!input.bridgeConfig && !input.relayConfigFound) {
    messages.push('Hermes is not configured.');
    return messages;
  }

  if (!input.bridgeConfig) {
    messages.push('Hermes relay is paired, but no local Hermes bridge config was found.');
    return messages;
  }

  const bridgePids = listHermesBridgeRuntimePids();
  const relayPids = listHermesRelayRuntimePids();
  if (command === 'restart') {
    stopHermesBridgeRuntimePids([...relayPids, ...bridgePids]);
  }

  const bridgePid = await ensureHermesBridgeBackgroundRuntime({
    config: input.bridgeConfig,
    replaceExisting: command === 'restart',
  });
  messages.push(
    bridgePid == null
      ? 'Hermes bridge runtime is already running.'
      : `Started Hermes bridge runtime (pid ${bridgePid}).`,
  );

  if (input.relayConfigFound) {
    const relayPid = await ensureHermesRelayBackgroundRuntimeWithConfig({
      config: input.bridgeConfig,
      replaceExisting: command === 'restart',
    });
    messages.push(
      relayPid == null
        ? 'Hermes relay runtime is already running.'
        : `Started Hermes relay runtime (pid ${relayPid}).`,
    );
  } else {
    messages.push('Hermes relay is not paired. Left Hermes bridge in local-only mode.');
  }

  return messages;
}

async function printStatus(): Promise<void> {
  const report = await buildDoctorReport();
  console.log(`Version: ${readCliVersion()}`);
  console.log('');
  console.log('[OpenClaw]');
  console.log(`Paired: ${report.paired ? 'yes' : 'no'}`);
  console.log(`Gateway ID: ${report.gatewayId ?? '-'}`);
  console.log(`Instance: ${report.instanceId ?? '-'}`);
  console.log(`Server URL: ${report.serverUrl ?? '-'}`);
  console.log(`Relay URL: ${report.relayUrl ?? '-'}`);
  console.log(`Local Gateway: ${report.localGatewayUrl}`);
  console.log(`Local Gateway Reachable: ${report.localGatewayReachable ? 'yes' : 'no'}`);
  console.log(`Service: ${report.serviceInstalled ? 'installed' : 'not installed'} (${report.serviceMethod})`);
  console.log(`Service Running: ${report.serviceRunning ? 'yes' : 'no'}`);
  console.log(`Service Path: ${report.servicePath || '-'}`);
  console.log(`CLI Log: ${report.logPath}`);
  console.log(`CLI Error Log: ${report.errorLogPath}`);
  console.log('');
  console.log('[Hermes]');
  console.log(`Source: ${report.hermesSourceFound ? 'found' : 'missing'} (${report.hermesSourcePath})`);
  console.log(`Bridge Config: ${report.hermesBridgeConfigFound ? 'found' : 'missing'} (${report.hermesBridgeConfigPath})`);
  console.log(`Bridge Runtime Running: ${report.hermesBridgeRuntimeRunning ? 'yes' : 'no'}`);
  console.log(`Bridge URL: ${report.hermesBridgeUrl ?? '-'}`);
  console.log(`Bridge Health: ${report.hermesBridgeHealthUrl ?? '-'}`);
  console.log(`Bridge Reachable: ${report.hermesBridgeReachable ? 'yes' : 'no'}`);
  console.log(`Hermes API Reachable: ${report.hermesApiReachable == null ? '-' : report.hermesApiReachable ? 'yes' : 'no'}`);
  console.log(`Relay Paired: ${report.hermesRelayPaired ? 'yes' : 'no'} (${report.hermesRelayConfigPath})`);
  console.log(`Relay Server: ${report.hermesRelayServerUrl ?? '-'}`);
  console.log(`Relay URL: ${report.hermesRelayUrl ?? '-'}`);
  console.log(`Relay Runtime Running: ${report.hermesRelayRuntimeRunning ? 'yes' : 'no'}`);
  console.log(`Hermes Bridge Log: ${report.hermesBridgeLogPath}`);
  console.log(`Hermes Bridge Error Log: ${report.hermesBridgeErrorLogPath}`);
  console.log(`Hermes Relay Log: ${report.hermesRelayLogPath}`);
  console.log(`Hermes Relay Error Log: ${report.hermesRelayErrorLogPath}`);

  if (!report.paired && !report.hermesRelayPaired && !report.hermesBridgeConfigFound) {
    process.exitCode = 1;
  }
}

function listHermesBridgeRuntimePids(): number[] {
  if (process.platform === 'win32') {
    return [];
  }
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
        if (!isKnownClawketBridgeCliCommand(command)) return [];
        if (!/\bhermes\s+(run|dev)\b/.test(command)) return [];
        return [pid];
      });
  } catch {
    return [];
  }
}

function listHermesRelayRuntimePids(): number[] {
  if (process.platform === 'win32') {
    return [];
  }
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
        if (!isKnownClawketBridgeCliCommand(command)) return [];
        if (!/\bhermes\s+relay\s+run\b/.test(command)) return [];
        return [pid];
      });
  } catch {
    return [];
  }
}

function isKnownClawketBridgeCliCommand(command: string): boolean {
  const currentScriptPath = resolveCurrentScriptPath();
  if (currentScriptPath && command.includes(currentScriptPath)) {
    return true;
  }
  return /(?:^|\s)\S*(?:@p697\/clawket|apps\/bridge-cli)\/dist\/index\.js(?:\s|$)/.test(command);
}

async function startHermesBridgeRuntime(options: HermesBridgeRuntimeOptions): Promise<HermesLocalBridge> {
  const { host, port, apiBaseUrl, token, replaceExisting, restartHermes, startHermesIfNeeded } = options;

  const existingBridgePids = listHermesBridgeRuntimePids();
  if (existingBridgePids.length > 0) {
    if (!replaceExisting) {
      throw new Error(
        `Another Hermes local bridge is already running on port ${port} `
        + `(pid${existingBridgePids.length > 1 ? 's' : ''}: ${existingBridgePids.join(', ')}). `
        + 'Rerun with "--replace" to restart it cleanly.',
      );
    }
    stopHermesBridgeRuntimePids(existingBridgePids);
  }

  if (restartHermes) {
    const existingHermesGatewayPids = listHermesGatewayRuntimePids();
    if (existingHermesGatewayPids.length > 0) {
      console.log(
        `Restarting Hermes gateway process${existingHermesGatewayPids.length > 1 ? 'es' : ''} `
        + `(pid${existingHermesGatewayPids.length > 1 ? 's' : ''}: ${existingHermesGatewayPids.join(', ')}).`,
      );
      stopHermesBridgeRuntimePids(existingHermesGatewayPids);
    } else {
      console.log('No existing Hermes gateway process found to restart.');
    }
  }

  const bridge = new HermesLocalBridge({
    host,
    port,
    apiBaseUrl,
    bridgeToken: token,
    startHermesIfNeeded,
    onLog: (line) => {
      console.log(`[${Date.now()}] [hermes] ${line}`);
    },
    onStatus: (snapshot) => {
      const base = `[${Date.now()}] [status] clients=${snapshot.clientCount} sessions=${snapshot.sessionCount} api=${snapshot.hermesApiReachable ? 'up' : 'down'}`;
      if (snapshot.lastError) {
        console.log(`${base} error=${snapshot.lastError}`);
        return;
      }
      console.log(base);
    },
  });
  await bridge.start();
  writeHermesBridgeCliConfig({ host, port, apiBaseUrl, token });
  return bridge;
}

async function buildHermesLocalPairing(options: {
  publicHost: string;
  port: number;
  token: string;
  qrFile: string | null;
}): Promise<HermesLocalPairingResult> {
  const bridgeHttpUrl = `http://${options.publicHost}:${options.port}`;
  const bridgeWsUrl = buildHermesBridgeWsUrl(options.publicHost, options.port, options.token);
  const qrPayload = buildHermesLocalPairingQrPayload({
    bridgeHttpUrl,
    bridgeWsUrl,
    displayName: 'Hermes',
  });
  const qrImagePath = await writeRawQrPng(qrPayload, 'clawket-hermes-local-pair', options.qrFile);
  return {
    bridgeHttpUrl,
    bridgeWsUrl,
    publicHost: options.publicHost,
    qrPayload,
    qrImagePath,
  };
}

async function keepHermesBridgeAlive(bridge: HermesLocalBridge): Promise<void> {
  const shutdown = async () => {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise<void>(() => {});
}

async function restoreHermesServiceRuntime(log: (line: string) => void): Promise<void> {
  const bridgeConfig = readHermesBridgeCliConfig();
  const relayConfig = readHermesRelayConfig();

  if (!bridgeConfig && !relayConfig) {
    return;
  }

  if (!bridgeConfig) {
    log('Hermes relay is paired, but no local Hermes bridge config was found. Skipping Hermes restore.');
    return;
  }

  try {
    const bridgePid = await ensureHermesBridgeBackgroundRuntime({
      config: bridgeConfig,
      replaceExisting: false,
    });
    log(
      bridgePid == null
        ? 'Hermes bridge runtime already running.'
        : `Started Hermes bridge runtime (pid ${bridgePid}).`,
    );
  } catch (error) {
    log(`Hermes bridge restore failed: ${formatError(error)}`);
    return;
  }

  if (!relayConfig) {
    log('Hermes relay is not paired. Left Hermes bridge in local-only mode.');
    return;
  }

  try {
    const relayPid = await ensureHermesRelayBackgroundRuntimeWithConfig({
      config: bridgeConfig,
      replaceExisting: false,
    });
    log(
      relayPid == null
        ? 'Hermes relay runtime already running.'
        : `Started Hermes relay runtime (pid ${relayPid}).`,
    );
  } catch (error) {
    log(`Hermes relay restore failed: ${formatError(error)}`);
  }
}

async function startHermesRelayRuntime(bridgeWsUrl: string): Promise<HermesRelayRuntime> {
  const config = readHermesRelayConfig();
  if (!config) {
    throw new Error('Hermes relay is not paired.');
  }
  const runtime = new HermesRelayRuntime({
    config,
    bridgeUrl: bridgeWsUrl,
    onLog: (line) => {
      console.log(`[${Date.now()}] [hermes-relay] ${line}`);
    },
    onStatus: (snapshot) => {
      const base = `[${Date.now()}] [status] relay=${snapshot.relayConnected ? 'up' : 'down'} bridge=${snapshot.bridgeConnected ? 'up' : 'down'}`;
      if (snapshot.lastError) {
        console.log(`${base} error=${snapshot.lastError}`);
        return;
      }
      console.log(base);
    },
  });
  runtime.start();
  return runtime;
}

async function keepHermesRelayRuntimeAlive(runtime: HermesRelayRuntime): Promise<void> {
  const shutdown = async () => {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await runtime.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise<void>(() => {});
}

async function ensureHermesRelayBackgroundRuntime(args: string[]): Promise<string> {
  const startedAt = Date.now();
  logHermesPerf('relay_runtime_ensure_begin');
  const relayConfig = readHermesRelayConfig();
  if (!relayConfig) {
    throw new Error('Hermes relay is not paired.');
  }
  const relayPids = listHermesRelayRuntimePids();
  if (relayPids.length === 1) {
    await waitForHermesRelayCloudBridgeReady(relayConfig, 20_000);
    logHermesPerf('relay_runtime_ensure_reused', {
      elapsedMs: Date.now() - startedAt,
      pid: relayPids[0],
    });
    return `Hermes relay runtime already running (pid ${relayPids[0]}) and confirmed by relay.`;
  }
  if (relayPids.length > 1) {
    stopHermesBridgeRuntimePids(relayPids);
  }

  const { host, port, apiBaseUrl, token } = await ensureHermesPairingRuntimeReady(args);
  const relayStartedAt = Date.now();
  startDetachedHermesRelayRuntime({
    host,
    port,
    apiBaseUrl,
    token,
    restartHermes: hasFlag(args, '--restart-hermes'),
  });
  await waitForHermesRelayRuntimeReady(relayStartedAt, 20_000);
  await waitForHermesRelayCloudBridgeReady(relayConfig, 20_000);
  const startedPids = listHermesRelayRuntimePids();
  if (startedPids.length === 0) {
    logHermesPerf('relay_runtime_ensure_requested_no_pid', {
      elapsedMs: Date.now() - startedAt,
    });
    return 'Hermes relay runtime launch was requested. Run `clawket hermes relay run` manually if it did not stay up.';
  }
  logHermesPerf('relay_runtime_ensure_started', {
    elapsedMs: Date.now() - startedAt,
    pid: startedPids[0],
  });
  return `Auto-started Hermes relay runtime (pid ${startedPids[0]}) and confirmed cloud bridge attachment.`;
}

async function ensureHermesBridgeBackgroundRuntime(input: {
  config: HermesBridgeCliConfig;
  replaceExisting: boolean;
}): Promise<number | null> {
  const bridgePids = listHermesBridgeRuntimePids();
  if (bridgePids.length > 0 && !input.replaceExisting) {
    return null;
  }

  startDetachedHermesBridgeRuntime({
    host: input.config.host,
    port: input.config.port,
    apiBaseUrl: input.config.apiBaseUrl,
    token: input.config.token,
    restartHermes: false,
  });
  await waitForHermesBridgeHealth(input.config.port);
  const startedPids = listHermesBridgeRuntimePids();
  return startedPids[0] ?? null;
}

async function ensureHermesRelayBackgroundRuntimeWithConfig(input: {
  config: HermesBridgeCliConfig;
  replaceExisting: boolean;
}): Promise<number | null> {
  const relayPids = listHermesRelayRuntimePids();
  if (relayPids.length > 0 && !input.replaceExisting) {
    return null;
  }

  const relayStartedAt = Date.now();
  startDetachedHermesRelayRuntime({
    host: input.config.host,
    port: input.config.port,
    apiBaseUrl: input.config.apiBaseUrl,
    token: input.config.token,
    restartHermes: false,
  });
  await waitForHermesRelayRuntimeReady(relayStartedAt, 20_000);
  const relayConfig = readHermesRelayConfig();
  if (relayConfig) {
    await waitForHermesRelayCloudBridgeReady(relayConfig, 20_000);
  }
  const startedPids = listHermesRelayRuntimePids();
  return startedPids[0] ?? null;
}

function stopHermesBridgeRuntimePids(pids: number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Ignore stale PIDs.
    }
  }
  for (const pid of pids) {
    if (waitForPidExit(pid, 3_000)) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Ignore stale PIDs.
    }
  }
}

function listHermesGatewayRuntimePids(): number[] {
  if (process.platform === 'win32') {
    return [];
  }
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
        if (!command.includes('hermes')) return [];
        if (!/\bgateway\s+run\b/.test(command)) return [];
        return [pid];
      });
  } catch {
    return [];
  }
}

function waitForPidExit(pid: number, timeoutMs: number): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isPidRunning(pid)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return !isPidRunning(pid);
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolveCurrentScriptPath(): string {
  return process.argv[1] ?? '';
}

function printServiceResult(message: string | null, status: ServiceStatus): void {
  if (message) {
    console.log(message);
  }
  console.log(`Service: ${status.installed ? (status.running ? 'installed, running' : 'installed, stopped') : 'not installed'}`);
  console.log(`Service path: ${status.servicePath || '-'}`);
}

function printLifecycleSummary(summary: LifecycleSummary): void {
  console.log('[OpenClaw]');
  console.log(summary.openclawMessage);
  printServiceResult(null, summary.openclawServiceStatus);
  console.log('');
  console.log('[Hermes]');
  console.log(`Configured: ${summary.hermesConfigured ? 'yes' : 'no'}`);
  console.log(`Bridge config: ${summary.hermesBridgeConfigFound ? 'found' : 'missing'}`);
  console.log(`Relay pairing: ${summary.hermesRelayConfigFound ? 'found' : 'missing'}`);
  for (const message of summary.hermesMessages) {
    console.log(message);
  }
}

function printDoctorReport(report: Awaited<ReturnType<typeof buildDoctorReport>>): void {
  const summary = summarizeDoctorReport(report);
  console.log(`[Doctor: ${summary.overall}]`);
  if (summary.findings.length === 0) {
    console.log('No issues detected.');
  } else {
    for (const finding of summary.findings) {
      console.log(`- ${finding}`);
    }
  }
  console.log('');
  console.log('[OpenClaw]');
  console.log(`Paired: ${report.paired ? 'yes' : 'no'}`);
  console.log(`Gateway ID: ${report.gatewayId ?? '-'}`);
  console.log(`Server URL: ${report.serverUrl ?? '-'}`);
  console.log(`Relay URL: ${report.relayUrl ?? '-'}`);
  console.log(`Instance ID: ${report.instanceId ?? '-'}`);
  console.log(`Service: ${report.serviceInstalled ? 'installed' : 'not installed'} (${report.serviceMethod})`);
  console.log(`Service running: ${report.serviceRunning ? 'yes' : 'no'}`);
  console.log(`Service path: ${report.servicePath || '-'}`);
  console.log(`Log path: ${report.logPath}`);
  console.log(`Error log path: ${report.errorLogPath}`);
  console.log(`OpenClaw dir: ${report.openclawConfigDir}`);
  console.log(`OpenClaw media: ${report.openclawMediaDir}`);
  console.log(`OpenClaw config: ${report.openclawConfigFound ? 'found' : 'missing'}`);
  console.log(`OpenClaw token: ${report.openclawTokenFound ? 'found' : 'missing'}`);
  console.log(`Gateway URL: ${report.localGatewayUrl}`);
  console.log(`Gateway reachable: ${report.localGatewayReachable ? 'yes' : 'no'}`);
  console.log('');
  console.log('[Hermes]');
  console.log(`Source: ${report.hermesSourceFound ? 'found' : 'missing'} (${report.hermesSourcePath})`);
  console.log(`Bridge config: ${report.hermesBridgeConfigFound ? 'found' : 'missing'} (${report.hermesBridgeConfigPath})`);
  console.log(`Bridge runtime running: ${report.hermesBridgeRuntimeRunning ? 'yes' : 'no'}`);
  console.log(`Bridge URL: ${report.hermesBridgeUrl ?? '-'}`);
  console.log(`Bridge health: ${report.hermesBridgeHealthUrl ?? '-'}`);
  console.log(`Bridge reachable: ${report.hermesBridgeReachable ? 'yes' : 'no'}`);
  console.log(`Hermes API reachable: ${report.hermesApiReachable == null ? '-' : report.hermesApiReachable ? 'yes' : 'no'}`);
  console.log(`Relay paired: ${report.hermesRelayPaired ? 'yes' : 'no'} (${report.hermesRelayConfigPath})`);
  console.log(`Relay server: ${report.hermesRelayServerUrl ?? '-'}`);
  console.log(`Relay URL: ${report.hermesRelayUrl ?? '-'}`);
  console.log(`Relay runtime running: ${report.hermesRelayRuntimeRunning ? 'yes' : 'no'}`);
  console.log(`Hermes bridge log: ${report.hermesBridgeLogPath}`);
  console.log(`Hermes bridge error log: ${report.hermesBridgeErrorLogPath}`);
  console.log(`Hermes relay log: ${report.hermesRelayLogPath}`);
  console.log(`Hermes relay error log: ${report.hermesRelayErrorLogPath}`);
}

function requirePairingConfig() {
  const config = readPairingConfig();
  if (!config) {
    console.error(`Not paired. Run "clawket pair" first. Config path: ${getPairingConfigPath()}`);
    process.exit(1);
  }
  return config;
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  return value?.trim() ? value.trim() : null;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function resolvePairServer(args: string[], backend: PairBackendKind): string {
  const explicit = readFlag(args, '--server') ?? readFlag(args, '-s');
  if (explicit?.trim()) return explicit;

  if (backend === 'hermes') {
    const hermesServer = process.env.CLAWKET_HERMES_REGISTRY_URL?.trim()
      || process.env.CLAWKET_PACKAGE_DEFAULT_HERMES_REGISTRY_URL?.trim()
      || DEFAULT_HERMES_REGISTRY_URL;
    if (hermesServer) return hermesServer;
    throw new Error(
      'No Hermes registry server configured. Pass --server https://hermes-registry.example.com or set CLAWKET_HERMES_REGISTRY_URL.',
    );
  }

  const envServer = process.env.CLAWKET_REGISTRY_URL?.trim() || process.env.CLAWKET_PACKAGE_DEFAULT_REGISTRY_URL?.trim();
  if (envServer) return envServer;

  throw new Error(
    'No registry server configured. Pass --server https://registry.example.com or set CLAWKET_REGISTRY_URL.',
  );
}

function readPairSubcommand(args: string[]): string | null {
  for (const arg of args) {
    if (!arg.startsWith('-')) {
      return arg.trim() || null;
    }
  }
  return null;
}

function resolveRequestedPairBackend(args: string[]): 'openclaw' | 'hermes' | null {
  const backend = readFlag(args, '--backend')?.toLowerCase();
  if (!backend) {
    return null;
  }
  if (backend === 'openclaw') {
    return 'openclaw';
  }
  if (backend === 'hermes') {
    return 'hermes';
  }
  throw new Error(`Unsupported local pairing backend "${backend}". Use --backend openclaw or --backend hermes.`);
}

async function ensureHermesPairingRuntimeReady(args: string[]): Promise<{
  host: string;
  port: number;
  apiBaseUrl: string;
  token: string;
}> {
  const startedAt = Date.now();
  logHermesPerf('pairing_runtime_ready_begin');
  const saved = readHermesBridgeCliConfig();
  const host = readFlag(args, '--host') ?? saved?.host ?? '0.0.0.0';
  const port = Number(readFlag(args, '--port') ?? saved?.port ?? '4319');
  const apiBaseUrl = readFlag(args, '--api-url') ?? saved?.apiBaseUrl ?? 'http://127.0.0.1:8642';
  const token = readFlag(args, '--token') ?? process.env.CLAWKET_HERMES_BRIDGE_TOKEN ?? saved?.token ?? randomUUID();
  const existingBridgePids = listHermesBridgeRuntimePids();

  if (existingBridgePids.length > 0) {
    const resolved = await resolveExistingHermesPairingRuntime(saved);
    logHermesPerf('pairing_runtime_ready_reused', {
      elapsedMs: Date.now() - startedAt,
      port: resolved.port,
    });
    return resolved;
  }

  if (!existsSync(resolveDefaultHermesSourcePath())) {
    throw new Error(
      `Hermes source is not available at ${resolveDefaultHermesSourcePath()}. Install Hermes first or start the bridge manually.`,
    );
  }
  startDetachedHermesBridgeRuntime({
    host,
    port,
    apiBaseUrl,
    token,
    restartHermes: hasFlag(args, '--restart-hermes'),
  });
  await waitForHermesBridgeHealth(port);
  logHermesPerf('pairing_runtime_ready_started', {
    elapsedMs: Date.now() - startedAt,
    port,
  });

  return { host, port, apiBaseUrl, token };
}

async function resolveExistingHermesPairingRuntime(saved: HermesBridgeCliConfig | null): Promise<{
  host: string;
  port: number;
  apiBaseUrl: string;
  token: string;
}> {
  if (!saved?.token) {
    throw new Error(
      `A Clawket-managed Hermes bridge is already running, but no saved bridge config was found at ${HERMES_BRIDGE_CONFIG_PATH}. `
      + 'To avoid emitting a mismatched QR code or relay target, stop the running bridge or rerun with "--replace" so Clawket can take ownership cleanly.',
    );
  }

  const health = await readHermesBridgeHealth(saved.port);
  const runningBridge = parseHermesBridgeUrl(health.bridgeUrl);
  return {
    host: runningBridge?.host ?? saved.host,
    port: runningBridge?.port ?? saved.port,
    apiBaseUrl: health.hermesApiBaseUrl ?? saved.apiBaseUrl,
    token: saved.token,
  };
}

function startDetachedHermesBridgeRuntime(input: {
  host: string;
  port: number;
  apiBaseUrl: string;
  token: string;
  restartHermes: boolean;
}): void {
  const logFiles = getHermesProcessLogPaths();
  const stdoutFd = openSync(logFiles.bridgeLogPath, 'a');
  const stderrFd = openSync(logFiles.bridgeErrorLogPath, 'a');
  // Pass the bridge token via the environment instead of argv so it does
  // not appear in `ps`, /proc/<pid>/cmdline, or shell history. The child
  // `clawket hermes run` handler reads `CLAWKET_HERMES_BRIDGE_TOKEN` as a
  // fallback when `--token` is not passed explicitly.
  const childArgs = [
    resolveCurrentScriptPath(),
    'hermes',
    'run',
    '--host',
    input.host,
    '--port',
    String(input.port),
    '--api-url',
    input.apiBaseUrl,
    '--no-replace',
  ];
  if (input.restartHermes) {
    childArgs.push('--restart-hermes');
  }
  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
    env: { ...process.env, CLAWKET_HERMES_BRIDGE_TOKEN: input.token },
  });
  closeSync(stdoutFd);
  closeSync(stderrFd);
  child.unref();
}

function startDetachedHermesRelayRuntime(input: {
  host: string;
  port: number;
  apiBaseUrl: string;
  token: string;
  restartHermes: boolean;
}): void {
  const logFiles = getHermesProcessLogPaths();
  const stdoutFd = openSync(logFiles.relayLogPath, 'a');
  const stderrFd = openSync(logFiles.relayErrorLogPath, 'a');
  // Pass the bridge token via the environment instead of argv so it does
  // not appear in `ps`, /proc/<pid>/cmdline, or shell history. The child
  // `clawket hermes relay run` handler (via ensureHermesPairingRuntimeReady)
  // reads `CLAWKET_HERMES_BRIDGE_TOKEN` as a fallback when `--token` is not
  // passed explicitly.
  const childArgs = [
    resolveCurrentScriptPath(),
    'hermes',
    'relay',
    'run',
    '--host',
    input.host,
    '--port',
    String(input.port),
    '--api-url',
    input.apiBaseUrl,
  ];
  if (input.restartHermes) {
    childArgs.push('--restart-hermes');
  }
  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
    env: { ...process.env, CLAWKET_HERMES_BRIDGE_TOKEN: input.token },
  });
  closeSync(stdoutFd);
  closeSync(stderrFd);
  child.unref();
}

async function waitForHermesBridgeHealth(port: number, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const health = await readHermesBridgeHealth(port);
      if (health.ok && health.running) {
        logHermesPerf('bridge_health_ready', {
          elapsedMs: Date.now() - startedAt,
          port,
        });
        return;
      }
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  logHermesPerf('bridge_health_timeout', {
    elapsedMs: Date.now() - startedAt,
    port,
    timeoutMs,
  });
  throw new Error(`Hermes bridge did not become ready at http://127.0.0.1:${port}/health within ${timeoutMs}ms.`);
}

async function readHermesBridgeHealth(port: number): Promise<{
  ok: boolean;
  running: boolean;
  bridgeUrl: string | null;
  hermesApiBaseUrl: string | null;
}> {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  if (!response.ok) {
    throw new Error(`Hermes bridge health request failed with status ${response.status}.`);
  }
  const payload = await response.json() as {
    ok?: unknown;
    running?: unknown;
    bridgeUrl?: unknown;
    hermesApiBaseUrl?: unknown;
  };
  return {
    ok: payload.ok === true,
    running: payload.running === true,
    bridgeUrl: typeof payload.bridgeUrl === 'string' && payload.bridgeUrl.trim() ? payload.bridgeUrl : null,
    hermesApiBaseUrl: typeof payload.hermesApiBaseUrl === 'string' && payload.hermesApiBaseUrl.trim()
      ? payload.hermesApiBaseUrl
      : null,
  };
}

function parseHermesBridgeUrl(value: string | null): { host: string; port: number } | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const port = Number(parsed.port);
    if (!parsed.hostname || !Number.isFinite(port) || port <= 0) {
      return null;
    }
    return {
      host: parsed.hostname,
      port,
    };
  } catch {
    return null;
  }
}

async function waitForHermesRelayRuntimeStart(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listHermesRelayRuntimePids().length > 0) {
      return;
    }
    await sleep(200);
  }
}

async function waitForHermesRelayRuntimeReady(startedAtMs: number, timeoutMs: number): Promise<void> {
  await waitForHermesRelayRuntimeStart(Math.min(timeoutMs, 5_000));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasHermesRelayReadyLogLine(startedAtMs)) {
      return;
    }
    await sleep(250);
  }
}

async function waitForHermesRelayCloudBridgeReady(
  relayConfig: {
    bridgeId: string;
    relaySecret: string;
    relayUrl: string;
  },
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  const statusUrl = buildHermesRelayBridgeStatusUrl(relayConfig.relayUrl, relayConfig.bridgeId);
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(statusUrl, {
        headers: {
          authorization: `Bearer ${relayConfig.relaySecret}`,
          accept: 'application/json',
        },
      });
      if (response.ok) {
        const payload = await response.json() as { hasBridge?: boolean };
        if (payload?.hasBridge) {
          logHermesPerf('relay_cloud_bridge_ready', {
            elapsedMs: Date.now() - startedAt,
          });
          return;
        }
      } else {
        lastError = `status ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  logHermesPerf('relay_cloud_bridge_timeout', {
    elapsedMs: Date.now() - startedAt,
    timeoutMs,
  });
  throw new Error(
    `Hermes relay did not observe the local bridge for ${relayConfig.bridgeId} within ${timeoutMs}ms`
    + (lastError ? ` (${lastError}).` : '.'),
  );
}

function buildHermesRelayBridgeStatusUrl(relayUrl: string, bridgeId: string): string {
  const parsed = new URL(relayUrl);
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  parsed.pathname = '/v1/internal/hermes/bridge-status';
  parsed.search = '';
  parsed.hash = '';
  parsed.searchParams.set('bridgeId', bridgeId);
  return parsed.toString();
}

function hasHermesRelayReadyLogLine(startedAtMs: number): boolean {
  const { relayLogPath } = getHermesProcessLogPaths();
  if (!existsSync(relayLogPath)) {
    return false;
  }
  try {
    const content = readFileSync(relayLogPath, 'utf8');
    const lines = content.split('\n');
    for (let index = lines.length - 1; index >= 0 && index >= lines.length - 200; index -= 1) {
      const line = lines[index];
      if (!line) continue;
      const match = line.match(/^\[(\d+)\]/);
      if (!match) continue;
      const loggedAt = Number(match[1]);
      if (!Number.isFinite(loggedAt)) continue;
      if (loggedAt < startedAtMs) {
        break;
      }
      if (line.includes('[status] relay=up bridge=up') || line.includes('bridge connected attempt=')) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp(): void {
  console.log([
    'clawket pair [--backend <openclaw|hermes>] [--server <url>] [--name <displayName>] [--public-host <192.168.x.x>] [--port <4319>] [--qr-file <path>] [--json] [--force]',
    'clawket pair local [--backend <openclaw|hermes>] [--url <ws://host:port>] [--public-host <192.168.x.x>] [--port <4319>] [--qr-file <path>] [--json]',
    'clawket pair --local [--backend <openclaw|hermes>] [--url <ws://host:port>] [--public-host <192.168.x.x>] [--port <4319>] [--qr-file <path>] [--json]',
    'clawket refresh-code [--qr-file <path>] [--json]',
    'clawket start',
    'clawket install',
    'clawket restart',
    'clawket stop',
    'clawket uninstall',
    'clawket reset',
    'clawket status',
    'clawket logs [--last <2m>] [--lines <200>] [--errors] [--follow] [--json]',
    'clawket doctor [--json]',
    'clawket run [--gateway-url <ws://127.0.0.1:18789>] [--replace]',
    'clawket hermes dev [--public-host <192.168.x.x>] [--host <0.0.0.0>] [--port <4319>] [--api-url <http://127.0.0.1:8642>] [--qr-file <path>] [--restart-hermes] [--json]',
    'clawket hermes run [--host <0.0.0.0>] [--port <4319>] [--api-url <http://127.0.0.1:8642>] [--restart-hermes]',
    'clawket hermes pair local [--public-host <192.168.x.x>] [--port <4319>] [--qr-file <path>] [--json]',
    'clawket hermes pair relay [--server <url>] [--name <displayName>] [--qr-file <path>] [--json]',
    'clawket hermes relay run [--host <127.0.0.1>] [--port <4319>] [--api-url <http://127.0.0.1:8642>] [--restart-hermes] [--json]',
  ].join('\n'));
}

function buildUnsupportedAutostartMessage(status: ServiceStatus): string {
  if (status.running) {
    return 'Started the bridge runtime, but this host does not support automatic startup registration. Use your container or process manager to restart Clawket on reboot.';
  }
  return 'This host does not support automatic startup registration, and the bridge runtime could not be started automatically. Use your container or process manager to run Clawket.';
}

function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logHermesPerf(event: string, fields?: Record<string, unknown>): void {
  const payload = fields
    ? Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(' ')
    : '';
  // console.log(`[${Date.now()}] [perf] ${event}${payload ? ` ${payload}` : ''}`);
  void event;
  void payload;
}

async function followCliLogs(input: {
  includeErrorLog: boolean;
}): Promise<void> {
  const sources = getCliLogSourcePaths(input.includeErrorLog);
  const state = new Map<string, number>();
  for (const path of sources) {
    state.set(path, countLogLines(path));
  }

  console.log('');
  console.log('Following logs. Press Ctrl+C to stop.');

  let running = true;
  const stop = () => {
    running = false;
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (running) {
    for (const path of sources) {
      const previous = state.get(path) ?? 0;
      const lines = readAllLogLines(path);
      if (lines.length < previous) {
        state.set(path, lines.length);
        if (lines.length > 0) {
          console.log(lines.join('\n'));
        }
        continue;
      }
      if (lines.length > previous) {
        console.log(lines.slice(previous).join('\n'));
        state.set(path, lines.length);
      }
    }
    await sleep(500);
  }
}

function readAllLogLines(path: string): string[] {
  try {
    const raw = readFileSync(path, 'utf8');
    return raw.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

function countLogLines(path: string): number {
  if (!existsSync(path)) {
    return 0;
  }
  try {
    if (statSync(path).size === 0) {
      return 0;
    }
  } catch {
    return 0;
  }
  return readAllLogLines(path).length;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function readHermesBridgeCliConfig(): HermesBridgeCliConfig | null {
  if (!existsSync(HERMES_BRIDGE_CONFIG_PATH)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(HERMES_BRIDGE_CONFIG_PATH, 'utf8')) as Partial<HermesBridgeCliConfig>;
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

function writeHermesBridgeCliConfig(config: HermesBridgeCliConfig): void {
  mkdirSync(join(homedir(), '.clawket'), { recursive: true });
  writeFileSync(HERMES_BRIDGE_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function deleteHermesBridgeCliConfig(): void {
  if (!existsSync(HERMES_BRIDGE_CONFIG_PATH)) {
    return;
  }
  rmSync(HERMES_BRIDGE_CONFIG_PATH, { force: true });
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
