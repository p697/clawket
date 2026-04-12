import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  bridgeRuntimeCtorMock,
  pairGatewayMock,
  qrcodeGenerateMock,
  refreshAccessCodeMock,
  pairHermesRelayMock,
  readPairingConfigMock,
  readHermesRelayConfigMock,
  writePairingQrPngMock,
  writeRawQrPngMock,
  resolveGatewayAuthMock,
  getServiceStatusMock,
  installServiceMock,
  restartServiceMock,
  stopRuntimeProcessesMock,
  stopServiceMock,
  uninstallServiceMock,
  hermesLocalBridgeCtorMock,
  hermesRelayRuntimeCtorMock,
  execFileSyncMock,
  spawnMock,
  buildHermesLocalPairingQrPayloadMock,
  buildLocalPairingInfoMock,
  buildHermesRelayWsUrlMock,
  getHermesProcessLogPathsMock,
  readRecentCliLogsMock,
} = vi.hoisted(() => ({
  bridgeRuntimeCtorMock: vi.fn(),
  pairGatewayMock: vi.fn(),
  qrcodeGenerateMock: vi.fn(),
  refreshAccessCodeMock: vi.fn(),
  pairHermesRelayMock: vi.fn(),
  readPairingConfigMock: vi.fn(() => null),
  readHermesRelayConfigMock: vi.fn(),
  writePairingQrPngMock: vi.fn(),
  writeRawQrPngMock: vi.fn(),
  resolveGatewayAuthMock: vi.fn(),
  hermesLocalBridgeCtorMock: vi.fn(),
  hermesRelayRuntimeCtorMock: vi.fn(),
  execFileSyncMock: vi.fn(),
  spawnMock: vi.fn(() => ({ unref: vi.fn() })),
  buildHermesLocalPairingQrPayloadMock: vi.fn(() => '{"v":1,"kind":"hermes-local"}'),
  buildLocalPairingInfoMock: vi.fn(),
  buildHermesRelayWsUrlMock: vi.fn(() => 'wss://hermes-relay.example.com/ws?bridgeId=hbg_123&role=gateway'),
  getHermesProcessLogPathsMock: vi.fn(() => ({
    bridgeLogPath: '/tmp/hermes-bridge.log',
    bridgeErrorLogPath: '/tmp/hermes-bridge-error.log',
    relayLogPath: '/tmp/hermes-relay.log',
    relayErrorLogPath: '/tmp/hermes-relay-error.log',
  })),
  readRecentCliLogsMock: vi.fn<() => string[]>(() => []),
  installServiceMock: vi.fn(),
  restartServiceMock: vi.fn(),
  stopRuntimeProcessesMock: vi.fn(),
  stopServiceMock: vi.fn(),
  uninstallServiceMock: vi.fn(),
  getServiceStatusMock: vi.fn(() => ({
    installed: true,
    running: true,
    method: 'launchagent',
    servicePath: '/tmp/clawket.plist',
    logPath: '/tmp/clawket.log',
    errorLogPath: '/tmp/clawket-error.log',
    pid: 123,
  })),
}));

vi.mock('qrcode-terminal', () => ({
  default: {
    generate: qrcodeGenerateMock,
  },
}));

vi.mock('./diagnostics.js', () => ({
  buildDoctorReport: vi.fn(),
  ensurePairPrerequisites: vi.fn(),
  readRecentCliLogs: readRecentCliLogsMock,
}));

vi.mock('./log-parse.js', () => ({
  parseLookbackToMs: vi.fn(() => null),
}));

vi.mock('./local-pair.js', () => ({
  buildGatewayControlUiOrigin: vi.fn(),
  buildLocalPairingInfo: buildLocalPairingInfoMock,
  detectLanIp: vi.fn(() => '192.168.31.41'),
}));

vi.mock('./metadata.js', () => ({
  readCliVersion: vi.fn(() => '0.0.0-test'),
}));

vi.mock('./pairing-output.js', () => ({
  buildLocalPairingJson: vi.fn(() => ({})),
  buildPairingJson: vi.fn(() => ({})),
}));

vi.mock('./qr-file.js', () => ({
  writePairingQrPng: writePairingQrPngMock,
  writeRawQrPng: writeRawQrPngMock,
}));

vi.mock('./service-decision.js', () => ({
  decidePairServiceAction: vi.fn(() => 'noop'),
}));

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
  spawn: spawnMock,
}));

vi.mock('@clawket/bridge-core', () => ({
  buildHermesLocalPairingQrPayload: buildHermesLocalPairingQrPayloadMock,
  clearServiceState: vi.fn(),
  deleteHermesRelayConfig: vi.fn(),
  deletePairingConfig: vi.fn(),
  getDefaultBridgeDisplayName: vi.fn(() => 'Lucy'),
  getHermesProcessLogPaths: getHermesProcessLogPathsMock,
  getHermesRelayConfigPath: vi.fn(() => '/tmp/hermes-relay.json'),
  getPairingConfigPath: vi.fn(() => '/tmp/bridge-cli.json'),
  getServicePaths: vi.fn(() => ({
    logPath: '/tmp/clawket.log',
    errorLogPath: '/tmp/clawket-error.log',
  })),
  getServiceStatus: getServiceStatusMock,
  installService: installServiceMock,
  isAutostartUnsupportedError: vi.fn(() => false),
  listRuntimeProcesses: vi.fn(() => []),
  pairGateway: pairGatewayMock,
  pairHermesRelay: pairHermesRelayMock,
  readHermesRelayConfig: readHermesRelayConfigMock,
  readPairingConfig: readPairingConfigMock,
  refreshAccessCode: refreshAccessCodeMock,
  refreshHermesRelayAccessCode: vi.fn(),
  registerRuntimeProcess: vi.fn(),
  restartService: restartServiceMock,
  startTransientRuntime: vi.fn(),
  stopRuntimeProcesses: stopRuntimeProcessesMock,
  stopService: stopServiceMock,
  uninstallService: uninstallServiceMock,
  unregisterRuntimeProcess: vi.fn(),
  writeServiceState: vi.fn(),
}));

vi.mock('@clawket/bridge-runtime', () => ({
  BridgeRuntime: bridgeRuntimeCtorMock,
  HermesLocalBridge: hermesLocalBridgeCtorMock,
  HermesRelayRuntime: hermesRelayRuntimeCtorMock,
  buildHermesBridgeWsUrl: vi.fn((host: string, port: number, token: string) => `ws://${host}:${port}/v1/hermes/ws?token=${token}`),
  buildHermesRelayWsUrl: buildHermesRelayWsUrlMock,
  configureOpenClawLanAccess: vi.fn(),
  resolveGatewayAuth: resolveGatewayAuthMock,
  resolveGatewayUrl: vi.fn(() => 'ws://127.0.0.1:18789'),
  restartOpenClawGateway: vi.fn(),
}));

describe('cli pairing output', () => {
  const originalArgv = process.argv.slice();
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'clawket-cli-home-')));
    process.argv = ['node', 'clawket', 'refresh-code'];
    resolveGatewayAuthMock.mockReturnValue({ token: 'gateway-token', password: null });
    refreshAccessCodeMock.mockResolvedValue({
      config: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gw_test_123',
        relaySecret: 'secret',
        relayUrl: 'wss://relay.example.com/ws',
        instanceId: 'inst_test',
        displayName: 'Lucy',
        createdAt: '2026-03-08T00:00:00.000Z',
        updatedAt: '2026-03-08T00:00:00.000Z',
      },
      accessCode: 'AB7K9Q',
      accessCodeExpiresAt: '2026-03-08T01:00:00.000Z',
      qrPayload: '{"v":2,"k":"cp","g":"gw_test_123","a":"AB7K9Q"}',
      action: 'refreshed',
    });
    pairHermesRelayMock.mockResolvedValue({
      config: {
        serverUrl: 'https://hermes-registry.example.com',
        bridgeId: 'hbg_123',
        relaySecret: 'hrs_secret',
        relayUrl: 'wss://hermes-relay.example.com/ws',
        instanceId: 'hermes-host',
        displayName: 'Hermes',
        createdAt: '2026-04-11T00:00:00.000Z',
        updatedAt: '2026-04-11T00:00:00.000Z',
      },
      accessCode: 'ABCD23',
      accessCodeExpiresAt: '2026-04-11T01:00:00.000Z',
      qrPayload: '{"version":1,"kind":"clawket_hermes_pair"}',
      action: 'registered',
    });
    readHermesRelayConfigMock.mockReturnValue({
      serverUrl: 'https://hermes-registry.example.com',
      bridgeId: 'hbg_123',
      relaySecret: 'hrs_secret',
      relayUrl: 'wss://hermes-relay.example.com/ws',
      instanceId: 'hermes-host',
      displayName: 'Hermes',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
    });
    writePairingQrPngMock.mockResolvedValue('/tmp/clawket-pair.png');
    writeRawQrPngMock.mockResolvedValue('/tmp/clawket-hermes-local-pair.png');
    buildLocalPairingInfoMock.mockReturnValue({
      gatewayUrl: 'ws://192.168.1.9:18789',
      qrPayload: '{"v":2,"kind":"openclaw-local"}',
      expiresAt: Date.now() + 60_000,
      authMode: 'token',
    });
    hermesLocalBridgeCtorMock.mockImplementation(() => ({
      start: vi.fn().mockRejectedValue(new Error('stop after startup checks')),
      stop: vi.fn().mockResolvedValue(undefined),
      getHttpUrl: vi.fn(() => 'http://0.0.0.0:4321'),
      getWsUrl: vi.fn(() => 'ws://0.0.0.0:4321/v1/hermes/ws?token=test'),
    }));
    hermesRelayRuntimeCtorMock.mockImplementation(() => ({
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    }));
    bridgeRuntimeCtorMock.mockImplementation(() => ({
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    }));
    readPairingConfigMock.mockReturnValue(null);
    execFileSyncMock.mockReturnValue('');
    spawnMock.mockReturnValue({ unref: vi.fn() });
    installServiceMock.mockReturnValue(getServiceStatusMock());
    restartServiceMock.mockReturnValue(getServiceStatusMock());
    stopServiceMock.mockReturnValue(getServiceStatusMock());
    uninstallServiceMock.mockReturnValue(getServiceStatusMock());
    readRecentCliLogsMock.mockReturnValue([]);
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        running: true,
        hasBridge: true,
        bridgeUrl: 'http://0.0.0.0:4321',
        hermesApiBaseUrl: 'http://127.0.0.1:8642',
      }),
    } as Response)) as unknown as typeof fetch;
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv.slice();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('prints the standard refresh flow for alphanumeric access codes', async () => {
    await import('./index.js');

    await vi.waitFor(() => {
      expect(refreshAccessCodeMock).toHaveBeenCalledTimes(1);
    });

    expect(qrcodeGenerateMock).toHaveBeenCalledWith('{"v":2,"k":"cp","g":"gw_test_123","a":"AB7K9Q"}', { small: true });
    expect(consoleLogSpy).toHaveBeenCalledWith('Bridge already paired. Refreshed the pairing code.');
    expect(consoleLogSpy).toHaveBeenCalledWith('Gateway ID: gw_test_123');
    expect(consoleLogSpy).toHaveBeenCalledWith('QR image: /tmp/clawket-pair.png');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('requires an explicit registry server when pairing in a source checkout', async () => {
    process.argv = ['node', 'clawket', 'pair'];
    vi.stubEnv('CLAWKET_REGISTRY_URL', '');
    vi.stubEnv('CLAWKET_PACKAGE_DEFAULT_REGISTRY_URL', '');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never));

    await import('./index.js');

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'No registry server configured. Pass --server https://registry.example.com or set CLAWKET_REGISTRY_URL.',
      );
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(pairGatewayMock).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('replaces an existing Hermes local bridge process before starting a new one', async () => {
    process.argv = ['node', 'clawket', 'hermes', 'run'];
    execFileSyncMock.mockReturnValue(`40160 ${process.argv[1]} hermes run --host 0.0.0.0 --port 4321\n`);
    const killSpy = vi.spyOn(process, 'kill')
      .mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0) {
          throw new Error('process exited');
        }
        return true;
      }) as typeof process.kill);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never));

    await import('./index.js');

    await vi.waitFor(() => {
      expect(killSpy).toHaveBeenCalledWith(40160, 'SIGTERM');
      expect(hermesLocalBridgeCtorMock).toHaveBeenCalledTimes(1);
    });

    killSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('detects globally installed Hermes relay runtimes when refreshing a registered Hermes pairing', async () => {
    process.argv = ['node', 'clawket', 'pair', '--backend', 'hermes'];
    execFileSyncMock.mockReturnValue(
      '40161 /opt/homebrew/lib/node_modules/@p697/clawket/dist/index.js hermes relay run --host 0.0.0.0 --port 4321\n',
    );
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never));
    const killSpy = vi.spyOn(process, 'kill')
      .mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0) {
          throw new Error('process exited');
        }
        return true;
      }) as typeof process.kill);

    await import('./index.js');

    await vi.waitFor(() => {
      expect(killSpy).toHaveBeenCalledWith(expect.any(Number), 'SIGTERM');
    });

    killSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('preserves the saved Hermes bridge config when --no-replace refuses to start over a running bridge', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'clawket-cli-home-'));
    mkdirSync(join(homeDir, '.clawket'), { recursive: true });
    const configPath = join(homeDir, '.clawket', 'hermes-bridge.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        host: '0.0.0.0',
        port: 4321,
        apiBaseUrl: 'http://127.0.0.1:8642',
        token: 'saved-token',
      }),
      'utf8',
    );
    vi.stubEnv('HOME', homeDir);
    process.argv = ['node', 'clawket', 'hermes', 'run', '--no-replace', '--token', 'new-token', '--port', '9999'];
    execFileSyncMock.mockReturnValue(`40160 ${process.argv[1]} hermes run --host 0.0.0.0 --port 4321\n`);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never));

    await import('./index.js');

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Another Hermes local bridge is already running on port 9999'));
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(hermesLocalBridgeCtorMock).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({
      host: '0.0.0.0',
      port: 4321,
      apiBaseUrl: 'http://127.0.0.1:8642',
      token: 'saved-token',
    });

    exitSpy.mockRestore();
  });

  it('can explicitly restart an existing Hermes gateway process for local development', async () => {
    process.argv = ['node', 'clawket', 'hermes', 'run', '--restart-hermes'];
    execFileSyncMock.mockReturnValue(
      [
        `40160 ${process.argv[1]} hermes run --host 0.0.0.0 --port 4321`,
        '35917 /Users/lucy/.hermes/hermes-agent/venv/bin/python3 /Users/lucy/.local/bin/hermes gateway run --replace',
      ].join('\n'),
    );
    const killSpy = vi.spyOn(process, 'kill')
      .mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0) {
          throw new Error('process exited');
        }
        return true;
      }) as typeof process.kill);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never));

    await import('./index.js');

    await vi.waitFor(() => {
      expect(killSpy).toHaveBeenCalledWith(40160, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledWith(35917, 'SIGTERM');
    });

    expect(consoleLogSpy).toHaveBeenCalledWith('Restarting Hermes gateway process (pid: 35917).');

    killSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('runs Hermes local dev as a single command with QR output', async () => {
    process.argv = ['node', 'clawket', 'hermes', 'dev', '--public-host', '192.168.31.41', '--port', '4321'];
    execFileSyncMock.mockReturnValue(`40160 ${process.argv[1]} hermes dev --public-host 192.168.31.41 --port 4321\n`);
    hermesLocalBridgeCtorMock.mockImplementation(() => ({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getHttpUrl: vi.fn(() => 'http://0.0.0.0:4321'),
      getWsUrl: vi.fn(() => 'ws://0.0.0.0:4321/v1/hermes/ws?token=test'),
    }));
    const killSpy = vi.spyOn(process, 'kill')
      .mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0) {
          throw new Error('process exited');
        }
        return true;
      }) as typeof process.kill);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never));
    const processOnSpy = vi.spyOn(process, 'on')
      .mockImplementation(((event: NodeJS.Signals, listener: () => void) => {
        if (event === 'SIGINT') {
          queueMicrotask(listener);
        }
        return process;
      }) as typeof process.on);

    await import('./index.js');

    await vi.waitFor(() => {
      expect(killSpy).toHaveBeenCalledWith(40160, 'SIGTERM');
      expect(writeRawQrPngMock).toHaveBeenCalledWith(
        '{"v":1,"kind":"hermes-local"}',
        'clawket-hermes-local-pair',
        null,
      );
      expect(qrcodeGenerateMock).toHaveBeenCalledWith('{"v":1,"kind":"hermes-local"}', { small: true });
    });

    expect(consoleLogSpy).toHaveBeenCalledWith('Hermes bridge URL: http://192.168.31.41:4321');
    expect(consoleLogSpy).toHaveBeenCalledWith('Hermes pairing host: 192.168.31.41');

    processOnSpy.mockRestore();
    killSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('keeps pair local on the OpenClaw path by default', async () => {
    process.argv = ['node', 'clawket', 'pair', 'local', '--url', 'ws://192.168.1.9:18789'];

    await import('./index.js');

    await vi.waitFor(() => {
      expect(buildLocalPairingInfoMock).toHaveBeenCalledWith({
        explicitUrl: 'ws://192.168.1.9:18789',
        gatewayToken: 'gateway-token',
        gatewayPassword: null,
      });
      expect(writeRawQrPngMock).toHaveBeenCalledWith(
        '{"v":2,"kind":"openclaw-local"}',
        'clawket-local-pair',
        null,
      );
    });
    expect(buildHermesLocalPairingQrPayloadMock).not.toHaveBeenCalled();
  });

  it('supports Hermes local pairing through pair local --backend hermes', async () => {
    mkdirSync(join(process.env.HOME as string, '.hermes', 'hermes-agent'), { recursive: true });
    process.argv = [
      'node',
      'clawket',
      'pair',
      'local',
      '--backend',
      'hermes',
      '--public-host',
      '192.168.31.41',
      '--port',
      '4321',
      '--token',
      'hermes-token',
    ];

    await import('./index.js');

    await vi.waitFor(() => {
      expect(buildHermesLocalPairingQrPayloadMock).toHaveBeenCalledWith({
        bridgeHttpUrl: 'http://192.168.31.41:4321',
        bridgeWsUrl: 'ws://192.168.31.41:4321/v1/hermes/ws?token=hermes-token',
        displayName: 'Hermes',
      });
      expect(writeRawQrPngMock).toHaveBeenCalledWith(
        '{"v":1,"kind":"hermes-local"}',
        'clawket-hermes-local-pair',
        null,
      );
    });
    expect(buildLocalPairingInfoMock).not.toHaveBeenCalled();
  });

  it('reuses the running Hermes bridge config for local pairing instead of transient CLI flags', async () => {
    mkdirSync(join(process.env.HOME as string, '.clawket'), { recursive: true });
    writeFileSync(
      join(process.env.HOME as string, '.clawket', 'hermes-bridge.json'),
      JSON.stringify({
        host: '0.0.0.0',
        port: 4321,
        apiBaseUrl: 'http://127.0.0.1:8642',
        token: 'saved-hermes-token',
      }),
      'utf8',
    );
    process.argv = [
      'node',
      'clawket',
      'pair',
      'local',
      '--backend',
      'hermes',
      '--public-host',
      '192.168.31.41',
      '--port',
      '9999',
      '--token',
      'override-token',
    ];
    execFileSyncMock.mockReturnValue(`40160 ${process.argv[1]} hermes run --host 0.0.0.0 --port 4321\n`);
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        running: true,
        bridgeUrl: 'http://0.0.0.0:4321',
        hermesApiBaseUrl: 'http://127.0.0.1:8642',
      }),
    } as Response)) as unknown as typeof fetch;

    await import('./index.js');

    await vi.waitFor(() => {
      expect(buildHermesLocalPairingQrPayloadMock).toHaveBeenCalledWith({
        bridgeHttpUrl: 'http://192.168.31.41:4321',
        bridgeWsUrl: 'ws://192.168.31.41:4321/v1/hermes/ws?token=saved-hermes-token',
        displayName: 'Hermes',
      });
    });
  });

  it('auto-detects both OpenClaw and Hermes for pair local without replacing legacy OpenClaw flow', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'clawket-cli-test-'));
    mkdirSync(join(homeDir, '.hermes', 'hermes-agent'), { recursive: true });
    mkdirSync(join(homeDir, '.clawket'), { recursive: true });
    writeFileSync(
      join(homeDir, '.clawket', 'hermes-bridge.json'),
      JSON.stringify({
        host: '0.0.0.0',
        port: 4321,
        apiBaseUrl: 'http://127.0.0.1:8642',
        token: 'saved-hermes-token',
      }),
      'utf8',
    );
    vi.stubEnv('HOME', homeDir);
    process.argv = [
      'node',
      'clawket',
      'pair',
      'local',
      '--url',
      'ws://192.168.1.9:18789',
      '--public-host',
      '192.168.31.41',
    ];
    execFileSyncMock.mockReturnValue(`40160 ${process.argv[1]} hermes run --host 0.0.0.0 --port 4321\n`);

    await import('./index.js');

    await vi.waitFor(() => {
      expect(buildLocalPairingInfoMock).toHaveBeenCalledTimes(1);
      expect(buildHermesLocalPairingQrPayloadMock).toHaveBeenCalledWith({
        bridgeHttpUrl: 'http://192.168.31.41:4321',
        bridgeWsUrl: 'ws://192.168.31.41:4321/v1/hermes/ws?token=saved-hermes-token',
        displayName: 'Hermes',
      });
      expect(qrcodeGenerateMock).toHaveBeenCalledTimes(2);
    });
  });

  it('does not fail the overall pair command when OpenClaw succeeds but Hermes sidecar pairing fails', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'clawket-cli-test-'));
    mkdirSync(join(homeDir, '.hermes', 'hermes-agent'), { recursive: true });
    vi.stubEnv('HOME', homeDir);
    process.argv = [
      'node',
      'clawket',
      'pair',
      '--server',
      'https://registry.example.com',
    ];
    pairGatewayMock.mockResolvedValue({
      config: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gw_openclaw_123',
        relaySecret: 'relay-secret',
        relayUrl: 'wss://relay.example.com/ws',
        instanceId: 'inst-openclaw',
        displayName: 'Lucy',
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
      },
      accessCode: 'ABCD23',
      accessCodeExpiresAt: '2026-04-12T01:00:00.000Z',
      qrPayload: '{"v":2,"k":"cp","g":"gw_openclaw_123","a":"ABCD23"}',
      action: 'registered',
    });
    pairHermesRelayMock.mockRejectedValue(new Error('Hermes registry unavailable'));
    process.exitCode = undefined;

    await import('./index.js');

    await vi.waitFor(() => {
      expect(pairGatewayMock).toHaveBeenCalledTimes(1);
      expect(pairHermesRelayMock).toHaveBeenCalledTimes(1);
      expect(writePairingQrPngMock).toHaveBeenCalledTimes(1);
    });

    expect(process.exitCode).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith('\nPairing errors:');
    expect(consoleErrorSpy).toHaveBeenCalledWith('- hermes (relay): Hermes registry unavailable');
  });

  it('pairs Hermes relay through the isolated Hermes registry endpoints', async () => {
    mkdirSync(join(process.env.HOME as string, '.hermes', 'hermes-agent'), { recursive: true });
    mkdirSync(join(process.env.HOME as string, '.clawket'), { recursive: true });
    writeFileSync(
      join(process.env.HOME as string, '.clawket', 'hermes-bridge.json'),
      JSON.stringify({
        host: '0.0.0.0',
        port: 4321,
        apiBaseUrl: 'http://127.0.0.1:8642',
        token: 'test',
      }),
      'utf8',
    );
    execFileSyncMock.mockReturnValue(`40161 ${process.argv[1]} hermes relay run --host 0.0.0.0 --port 4321\n`);
    process.argv = ['node', 'clawket', 'hermes', 'pair', 'relay', '--server', 'https://hermes-registry.example.com'];

    await import('./index.js');

    await vi.waitFor(() => {
      expect(pairHermesRelayMock).toHaveBeenCalledWith({
        serverUrl: 'https://hermes-registry.example.com',
        displayName: 'Hermes',
      });
    });

    await vi.waitFor(() => {
      expect(qrcodeGenerateMock).toHaveBeenCalledWith('{"version":1,"kind":"clawket_hermes_pair"}', { small: true });
    });
    expect(consoleLogSpy).toHaveBeenCalledWith('Hermes Bridge ID: hbg_123');
  });

  it('defaults clawket pair --backend hermes to Hermes relay on the production registry', async () => {
    mkdirSync(join(process.env.HOME as string, '.hermes', 'hermes-agent'), { recursive: true });
    mkdirSync(join(process.env.HOME as string, '.clawket'), { recursive: true });
    writeFileSync(
      join(process.env.HOME as string, '.clawket', 'hermes-bridge.json'),
      JSON.stringify({
        host: '0.0.0.0',
        port: 4321,
        apiBaseUrl: 'http://127.0.0.1:8642',
        token: 'test',
      }),
      'utf8',
    );
    process.argv = ['node', 'clawket', 'pair', '--backend', 'hermes'];

    await import('./index.js');

    await vi.waitFor(() => {
      expect(pairHermesRelayMock).toHaveBeenCalledWith({
        serverUrl: 'https://hermes-registry.clawket.ai',
        displayName: 'Hermes',
      });
    });
  });

  it('starts the Hermes relay runtime against the local Hermes bridge', async () => {
    mkdirSync(join(process.env.HOME as string, '.hermes', 'hermes-agent'), { recursive: true });
    mkdirSync(join(process.env.HOME as string, '.clawket'), { recursive: true });
    writeFileSync(
      join(process.env.HOME as string, '.clawket', 'hermes-bridge.json'),
      JSON.stringify({
        host: '0.0.0.0',
        port: 4321,
        apiBaseUrl: 'http://127.0.0.1:8642',
        token: 'test',
      }),
      'utf8',
    );
    process.argv = ['node', 'clawket', 'hermes', 'relay', 'run', '--json'];
    hermesLocalBridgeCtorMock.mockImplementation(() => ({
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getHttpUrl: vi.fn(() => 'http://0.0.0.0:4321'),
      getWsUrl: vi.fn(() => 'ws://0.0.0.0:4321/v1/hermes/ws?token=test'),
    }));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never));
    const processOnSpy = vi.spyOn(process, 'on')
      .mockImplementation(((event: NodeJS.Signals, listener: () => void) => {
        if (event === 'SIGINT') {
          queueMicrotask(listener);
        }
        return process;
      }) as typeof process.on);

    await import('./index.js');

    await vi.waitFor(() => {
      expect(hermesRelayRuntimeCtorMock).toHaveBeenCalledTimes(1);
    });

    expect(hermesRelayRuntimeCtorMock).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        bridgeId: 'hbg_123',
      }),
      bridgeUrl: 'ws://127.0.0.1:4321/v1/hermes/ws?token=test',
    }));

    processOnSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('fails safely when a running Hermes bridge has no saved config to recover its token', async () => {
    process.argv = ['node', 'clawket', 'pair', 'local', '--backend', 'hermes', '--public-host', '192.168.31.41'];
    execFileSyncMock.mockReturnValue(`40160 ${process.argv[1]} hermes run --host 0.0.0.0 --port 4321\n`);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never));

    await import('./index.js');

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('no saved bridge config was found'));
    });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(buildHermesLocalPairingQrPayloadMock).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('can start managed Hermes runtimes even when OpenClaw is not paired', async () => {
    mkdirSync(join(process.env.HOME as string, '.clawket'), { recursive: true });
    writeFileSync(
      join(process.env.HOME as string, '.clawket', 'hermes-bridge.json'),
      JSON.stringify({
        host: '0.0.0.0',
        port: 4321,
        apiBaseUrl: 'http://127.0.0.1:8642',
        token: 'test',
      }),
      'utf8',
    );
    process.argv = ['node', 'clawket', 'start'];
    execFileSyncMock
      .mockReturnValueOnce('')
      .mockReturnValueOnce(`40160 ${process.argv[1]} hermes run --host 0.0.0.0 --port 4321\n`)
      .mockReturnValueOnce('')
      .mockReturnValueOnce(`40161 ${process.argv[1]} hermes relay run --host 0.0.0.0 --port 4321\n`);

    await import('./index.js');

    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(2);
    });

    expect(installServiceMock).not.toHaveBeenCalled();
    expect(stopRuntimeProcessesMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      expect.arrayContaining(['hermes', 'run', '--host', '0.0.0.0', '--port', '4321']),
      expect.any(Object),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      expect.arrayContaining(['hermes', 'relay', 'run', '--host', '0.0.0.0', '--port', '4321']),
      expect.any(Object),
    );
  });

  it('waits for OpenClaw relay reconnection before finishing restart', async () => {
    process.argv = ['node', 'clawket', 'restart'];
    readPairingConfigMock.mockReturnValue({
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_test_123',
      relaySecret: 'secret',
      relayUrl: 'wss://relay.example.com/ws',
      instanceId: 'inst_test',
      displayName: 'Lucy',
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:00:00.000Z',
    } as never);
    getServiceStatusMock
      .mockReturnValueOnce({
        installed: true,
        running: true,
        method: 'launchagent',
        servicePath: '/tmp/clawket.plist',
        logPath: '/tmp/clawket.log',
        errorLogPath: '/tmp/clawket-error.log',
        pid: 123,
      })
      .mockReturnValue({
        installed: true,
        running: true,
        method: 'launchagent',
        servicePath: '/tmp/clawket.plist',
        logPath: '/tmp/clawket.log',
        errorLogPath: '/tmp/clawket-error.log',
        pid: 456,
      });
    readRecentCliLogsMock
      .mockReturnValueOnce([])
      .mockReturnValueOnce(['[9999999999999] [clawket] relay connected attempt=1']);

    await import('./index.js');

    await vi.waitFor(() => {
      expect(restartServiceMock).toHaveBeenCalledTimes(1);
      expect(readRecentCliLogsMock).toHaveBeenCalled();
    });

    expect(stopRuntimeProcessesMock).toHaveBeenCalledTimes(1);
  });

  it('does not start duplicate Hermes runtimes during restart when the OpenClaw service launcher will restore them', async () => {
    mkdirSync(join(process.env.HOME as string, '.clawket'), { recursive: true });
    writeFileSync(
      join(process.env.HOME as string, '.clawket', 'hermes-bridge.json'),
      JSON.stringify({
        host: '0.0.0.0',
        port: 4321,
        apiBaseUrl: 'http://127.0.0.1:8642',
        token: 'test',
      }),
      'utf8',
    );
    writeFileSync(join(process.env.HOME as string, '.clawket', 'hermes-relay.json'), JSON.stringify({
      serverUrl: 'https://hermes-registry.example.com',
      bridgeId: 'hbg_123',
      relaySecret: 'hrs_secret',
      relayUrl: 'wss://hermes-relay.example.com/ws',
      instanceId: 'hermes-host',
      displayName: 'Hermes',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
    }), 'utf8');
    process.argv = ['node', 'clawket', 'restart'];
    readPairingConfigMock.mockReturnValue({
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_test_123',
      relaySecret: 'secret',
      relayUrl: 'wss://relay.example.com/ws',
      instanceId: 'inst_test',
      displayName: 'Lucy',
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:00:00.000Z',
    } as never);
    getServiceStatusMock
      .mockReturnValueOnce({
        installed: true,
        running: true,
        method: 'launchagent',
        servicePath: '/tmp/clawket.plist',
        logPath: '/tmp/clawket.log',
        errorLogPath: '/tmp/clawket-error.log',
        pid: 123,
      })
      .mockReturnValue({
        installed: true,
        running: true,
        method: 'launchagent',
        servicePath: '/tmp/clawket.plist',
        logPath: '/tmp/clawket.log',
        errorLogPath: '/tmp/clawket-error.log',
        pid: 456,
      });
    readRecentCliLogsMock
      .mockReturnValueOnce([])
      .mockReturnValueOnce(['[9999999999999] [clawket] relay connected attempt=1']);

    await import('./index.js');

    await vi.waitFor(() => {
      expect(restartServiceMock).toHaveBeenCalledTimes(1);
    });

    expect(spawnMock).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('Hermes runtimes will be restored by the OpenClaw service launcher.');
  });

  it('restores managed Hermes runtimes when the OpenClaw service launcher starts run --service', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'clawket-cli-service-home-'));
    mkdirSync(join(homeDir, '.clawket'), { recursive: true });
    writeFileSync(
      join(homeDir, '.clawket', 'hermes-bridge.json'),
      JSON.stringify({
        host: '0.0.0.0',
        port: 4321,
        apiBaseUrl: 'http://127.0.0.1:8642',
        token: 'test',
      }),
      'utf8',
    );
    writeFileSync(join(homeDir, '.clawket', 'hermes-relay.json'), JSON.stringify({
      serverUrl: 'https://hermes-registry.example.com',
      bridgeId: 'hbg_123',
      relaySecret: 'hrs_secret',
      relayUrl: 'wss://hermes-relay.example.com/ws',
      instanceId: 'hermes-host',
      displayName: 'Hermes',
      createdAt: '2026-04-11T00:00:00.000Z',
      updatedAt: '2026-04-11T00:00:00.000Z',
    }), 'utf8');
    writeFileSync(
      '/tmp/hermes-relay.log',
      '[9999999999999] [status] relay=up bridge=up\n',
      'utf8',
    );
    vi.stubEnv('HOME', homeDir);
    process.argv = ['node', 'clawket', 'run', '--service'];
    readPairingConfigMock.mockReturnValue({
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_test_123',
      relaySecret: 'secret',
      relayUrl: 'wss://relay.example.com/ws',
      instanceId: 'inst_test',
      displayName: 'Lucy',
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:00:00.000Z',
    } as never);
    execFileSyncMock
      .mockReturnValueOnce('')
      .mockReturnValueOnce(`40160 ${process.argv[1]} hermes run --host 0.0.0.0 --port 4321\n`)
      .mockReturnValueOnce('')
      .mockReturnValueOnce(`40161 ${process.argv[1]} hermes relay run --host 0.0.0.0 --port 4321\n`)
      .mockReturnValueOnce(`40161 ${process.argv[1]} hermes relay run --host 0.0.0.0 --port 4321\n`);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never));
    const processOnSpy = vi.spyOn(process, 'on')
      .mockImplementation(((event: NodeJS.Signals, listener: () => void) => {
        if (event === 'SIGTERM') {
          queueMicrotask(listener);
        }
        return process;
      }) as typeof process.on);

    await import('./index.js');

    await vi.waitFor(() => {
      expect(spawnMock).toHaveBeenCalledTimes(2);
      expect(bridgeRuntimeCtorMock).toHaveBeenCalledTimes(1);
    });

    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      expect.arrayContaining(['hermes', 'run', '--host', '0.0.0.0', '--port', '4321']),
      expect.any(Object),
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      expect.arrayContaining(['hermes', 'relay', 'run', '--host', '0.0.0.0', '--port', '4321']),
      expect.any(Object),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[hermes-service] Started Hermes bridge runtime (pid 40160).'));

    processOnSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('stops managed Hermes runtimes through the shared stop command', async () => {
    mkdirSync(join(process.env.HOME as string, '.clawket'), { recursive: true });
    writeFileSync(
      join(process.env.HOME as string, '.clawket', 'hermes-bridge.json'),
      JSON.stringify({
        host: '0.0.0.0',
        port: 4321,
        apiBaseUrl: 'http://127.0.0.1:8642',
        token: 'test',
      }),
      'utf8',
    );
    process.argv = ['node', 'clawket', 'stop'];
    execFileSyncMock
      .mockReturnValueOnce(`40161 ${process.argv[1]} hermes relay run --host 0.0.0.0 --port 4321\n`)
      .mockReturnValueOnce(`40160 ${process.argv[1]} hermes run --host 0.0.0.0 --port 4321\n`);
    const killSpy = vi.spyOn(process, 'kill')
      .mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0) {
          throw new Error('process exited');
        }
        return true;
      }) as typeof process.kill);

    await import('./index.js');

    await vi.waitFor(() => {
      expect(killSpy).toHaveBeenCalledWith(40161, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledWith(40160, 'SIGTERM');
    });

    expect(consoleLogSpy).toHaveBeenCalledWith('Stopped Clawket-managed Hermes runtimes (pids: 40161, 40160).');
    expect(stopServiceMock).toHaveBeenCalledTimes(1);
    expect(stopRuntimeProcessesMock).toHaveBeenCalledTimes(1);
    killSpy.mockRestore();
  });

  it('does not kill unrelated Hermes gateway processes during reset', async () => {
    mkdirSync(join(process.env.HOME as string, '.clawket'), { recursive: true });
    writeFileSync(
      join(process.env.HOME as string, '.clawket', 'hermes-bridge.json'),
      JSON.stringify({
        host: '0.0.0.0',
        port: 4321,
        apiBaseUrl: 'http://127.0.0.1:8642',
        token: 'test',
      }),
      'utf8',
    );
    process.argv = ['node', 'clawket', 'reset'];
    execFileSyncMock
      .mockReturnValueOnce(`40161 ${process.argv[1]} hermes relay run --host 0.0.0.0 --port 4321\n`)
      .mockReturnValueOnce(`40160 ${process.argv[1]} hermes run --host 0.0.0.0 --port 4321\n`);
    const killSpy = vi.spyOn(process, 'kill')
      .mockImplementation(((pid: number, signal?: number | NodeJS.Signals) => {
        if (signal === 0) {
          throw new Error('process exited');
        }
        return true;
      }) as typeof process.kill);

    await import('./index.js');

    await vi.waitFor(() => {
      expect(killSpy).toHaveBeenCalledWith(40161, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledWith(40160, 'SIGTERM');
    });

    expect(killSpy).not.toHaveBeenCalledWith(35917, 'SIGTERM');
    expect(stopServiceMock).toHaveBeenCalledTimes(1);
    expect(stopRuntimeProcessesMock).toHaveBeenCalledTimes(1);
    killSpy.mockRestore();
  });
});
