import { describe, expect, it } from 'vitest';
import { listPairPrerequisiteFailures, summarizeDoctorReport, type CliDoctorReport } from './diagnostics.js';
import { parseLookbackToMs } from './log-parse.js';

describe('diagnostics helpers', () => {
  it('parses lookback durations', () => {
    expect(parseLookbackToMs('30s')).toBe(30_000);
    expect(parseLookbackToMs('2m')).toBe(120_000);
    expect(parseLookbackToMs('1h')).toBe(3_600_000);
    expect(parseLookbackToMs('1d')).toBe(86_400_000);
    expect(parseLookbackToMs()).toBeNull();
  });

  it('rejects invalid lookback durations', () => {
    expect(() => parseLookbackToMs('2 minutes')).toThrow(/Invalid --last value/);
    expect(() => parseLookbackToMs('abc')).toThrow(/Invalid --last value/);
  });

  it('reports missing OpenClaw prerequisites before pairing', () => {
    expect(listPairPrerequisiteFailures({
      openclawConfigFound: false,
      openclawAuthMode: null,
      openclawTokenFound: false,
      openclawPasswordFound: false,
      localGatewayUrl: 'ws://127.0.0.1:18789',
      localGatewayReachable: false,
    })).toEqual([
      `OpenClaw config was not found under ${process.env.HOME}/.openclaw or /root/.openclaw.`,
      'OpenClaw gateway auth is missing (token or password).',
      'Local OpenClaw Gateway is not reachable at ws://127.0.0.1:18789.',
    ]);
  });

  it('accepts pairing when OpenClaw prerequisites are ready', () => {
    expect(listPairPrerequisiteFailures({
      openclawConfigFound: true,
      openclawAuthMode: 'token',
      openclawTokenFound: true,
      openclawPasswordFound: false,
      localGatewayUrl: 'ws://127.0.0.1:18789',
      localGatewayReachable: true,
    })).toEqual([]);
  });

  it('accepts password-based pairing when password auth is configured', () => {
    expect(listPairPrerequisiteFailures({
      openclawConfigFound: true,
      openclawAuthMode: 'password',
      openclawTokenFound: false,
      openclawPasswordFound: true,
      localGatewayUrl: 'ws://127.0.0.1:18789',
      localGatewayReachable: true,
    })).toEqual([]);
  });

  it('fails fast when both token and password exist without explicit auth mode', () => {
    expect(listPairPrerequisiteFailures({
      openclawConfigFound: true,
      openclawAuthMode: null,
      openclawTokenFound: true,
      openclawPasswordFound: true,
      localGatewayUrl: 'ws://127.0.0.1:18789',
      localGatewayReachable: true,
    })).toEqual([
      'OpenClaw has both gateway token and password configured, but gateway.auth.mode is unset.',
    ]);
  });

  it('reports missing overall status when neither backend is configured', () => {
    expect(summarizeDoctorReport(buildReport({
      paired: false,
      openclawConfigFound: false,
      hermesBridgeConfigFound: false,
      hermesRelayPaired: false,
    }))).toEqual({
      overall: 'missing',
      findings: ['No OpenClaw or Hermes bridge configuration was detected on this machine.'],
    });
  });

  it('reports degraded Hermes status when relay is paired but runtime is down', () => {
    const summary = summarizeDoctorReport(buildReport({
      hermesBridgeConfigFound: true,
      hermesBridgeReachable: true,
      hermesApiReachable: true,
      hermesRelayPaired: true,
      hermesRelayRuntimeRunning: false,
    }));

    expect(summary.overall).toBe('degraded');
    expect(summary.findings).toContain('Hermes relay is paired, but the Hermes relay runtime is not running.');
  });

  it('reports healthy status when configured backends are reachable', () => {
    expect(summarizeDoctorReport(buildReport())).toEqual({
      overall: 'healthy',
      findings: [],
    });
  });
});

function buildReport(overrides: Partial<CliDoctorReport> = {}): CliDoctorReport {
  return {
    paired: true,
    gatewayId: 'gw_123',
    serverUrl: 'https://registry.clawket.ai',
    relayUrl: 'wss://relay.clawket.ai/ws',
    instanceId: 'inst_123',
    serviceInstalled: true,
    serviceRunning: true,
    serviceMethod: 'launchagent',
    servicePath: '/tmp/service.plist',
    logPath: '/tmp/bridge-cli.log',
    errorLogPath: '/tmp/bridge-cli-error.log',
    openclawConfigDir: '/tmp/.openclaw',
    openclawMediaDir: '/tmp/.openclaw/media',
    openclawConfigFound: true,
    openclawAuthMode: 'token',
    openclawTokenFound: true,
    openclawPasswordFound: false,
    localGatewayUrl: 'ws://127.0.0.1:18789',
    localGatewayReachable: true,
    hermesSourcePath: '/tmp/.hermes/hermes-agent',
    hermesSourceFound: true,
    hermesBridgeConfigPath: '/tmp/.clawket/hermes-bridge.json',
    hermesBridgeConfigFound: true,
    hermesBridgeUrl: 'http://127.0.0.1:4321',
    hermesBridgeHealthUrl: 'http://127.0.0.1:4321/health',
    hermesBridgeReachable: true,
    hermesApiReachable: true,
    hermesBridgeRuntimeRunning: true,
    hermesRelayConfigPath: '/tmp/.clawket/hermes-relay.json',
    hermesRelayPaired: true,
    hermesRelayServerUrl: 'https://hermes-registry.clawket.ai',
    hermesRelayUrl: 'wss://hermes-relay.clawket.ai/ws',
    hermesRelayRuntimeRunning: true,
    hermesBridgeLogPath: '/tmp/hermes-bridge.log',
    hermesBridgeErrorLogPath: '/tmp/hermes-bridge-error.log',
    hermesRelayLogPath: '/tmp/hermes-relay.log',
    hermesRelayErrorLogPath: '/tmp/hermes-relay-error.log',
    ...overrides,
  };
}
