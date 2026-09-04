import { describe, expect, it } from 'vitest';
import type { PairingInfo, ServiceStatus } from '@clawket/bridge-core';
import { buildLocalPairingJson, buildPairingJson } from './pairing-output.js';

const PAIRING: PairingInfo = {
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
  qrPayload: '{"v":2}',
  action: 'registered',
};

const SERVICE: ServiceStatus = {
  installed: true,
  running: true,
  method: 'launchagent',
  servicePath: '/Users/tester/Library/LaunchAgents/ai.clawket.bridge.cli.plist',
  logPath: '/Users/tester/.clawket/logs/bridge-cli.log',
  errorLogPath: '/Users/tester/.clawket/logs/bridge-cli-error.log',
  pid: 12345,
};

describe('pairing json output', () => {
  it('builds a machine-readable payload for pair and refresh-code', () => {
    const output = buildPairingJson(PAIRING, '/Users/tester/.openclaw/media/gw_test_123.png', SERVICE, 'Auto-installed background service.');
    expect(output).toMatchObject({
      ok: true,
      action: 'registered',
      gatewayId: 'gw_test_123',
      accessCode: 'AB7K9Q',
      qrImagePath: '/Users/tester/.openclaw/media/gw_test_123.png',
      service: {
        installed: true,
        running: true,
        method: 'launchagent',
      },
    });
  });

  it('builds a machine-readable payload for local pair qr generation', () => {
    const output = buildLocalPairingJson({
      gatewayUrl: 'ws://192.168.1.12:18789/',
      authMode: 'password',
      expiresAt: 123,
      qrImagePath: '/Users/tester/.openclaw/media/clawket-local-pair.png',
      message: 'Configured OpenClaw for LAN access and generated a local gateway pairing QR.',
      configUpdated: true,
      controlUiOrigin: 'http://192.168.1.12:18789',
      gatewayRestartAction: 'restarted',
    });

    expect(output).toMatchObject({
      ok: true,
      action: 'local',
      gatewayUrl: 'ws://192.168.1.12:18789/',
      authMode: 'password',
      expiresAt: 123,
      qrImagePath: '/Users/tester/.openclaw/media/clawket-local-pair.png',
      configUpdated: true,
      controlUiOrigin: 'http://192.168.1.12:18789',
      gatewayRestartAction: 'restarted',
      customUrl: false,
    });
  });

  it('keeps managed setup credential details out of user-facing JSON', () => {
    const output = buildLocalPairingJson({
      gatewayUrl: 'ws://192.168.1.12:18789/',
      expiresAt: 123,
      qrImagePath: '/Users/tester/.openclaw/media/clawket-local-pair.png',
      message: 'Generated a local gateway pairing QR.',
    });

    expect(output).not.toHaveProperty('authMode');
  });
});
