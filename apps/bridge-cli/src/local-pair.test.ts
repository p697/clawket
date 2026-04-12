import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildGatewayControlUiOrigin,
  buildLocalPairingInfo,
  detectLanIp,
  normalizeExplicitGatewayUrl,
  rewriteGatewayHost,
  scoreLanCandidate,
} from './local-pair.js';

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

describe('local pair helpers', () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.stubGlobal('process', process);
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('builds a local QR payload with password auth', () => {
    const info = buildLocalPairingInfo({
      explicitUrl: 'http://100.88.1.7:18789',
      gatewayPassword: 'secret-password',
      expiresAt: 123,
    });

    expect(info.gatewayUrl).toBe('ws://100.88.1.7:18789/');
    expect(info.authMode).toBe('password');
    expect(JSON.parse(info.qrPayload)).toMatchObject({
      url: 'ws://100.88.1.7:18789/',
      host: '100.88.1.7',
      port: 18789,
      password: 'secret-password',
      mode: 'gateway',
      expiresAt: 123,
      qrVersion: 2,
    });
  });

  it('normalizes explicit URLs without a scheme', () => {
    expect(normalizeExplicitGatewayUrl('tailnet-device:18789/ws')).toBe('ws://tailnet-device:18789/ws');
  });

  it('rewrites localhost gateway URLs to a LAN host', () => {
    expect(rewriteGatewayHost('ws://127.0.0.1:18789', '192.168.1.12')).toBe('ws://192.168.1.12:18789/');
  });

  it('builds a matching control-ui origin from the gateway URL', () => {
    expect(buildGatewayControlUiOrigin('wss://studio.example/ws')).toBe('https://studio.example:443');
    expect(buildGatewayControlUiOrigin('ws://192.168.1.12:18789/')).toBe('http://192.168.1.12:18789');
  });

  it('prefers real LAN interfaces over tunnel adapters', () => {
    expect(scoreLanCandidate('tailscale0', '100.90.0.3')).toBe(0);
    expect(scoreLanCandidate('en0', '192.168.1.12')).toBeGreaterThan(0);
  });

  it('prefers realtime ipconfig lookup on macOS en0/en1', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    execFileSyncMock
      .mockImplementationOnce(() => '192.168.31.41\n');

    expect(detectLanIp()).toBe('192.168.31.41');
    expect(execFileSyncMock).toHaveBeenCalledWith('ipconfig', ['getifaddr', 'en0'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  });

  it('falls back from en0 to en1 on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    execFileSyncMock
      .mockImplementationOnce(() => {
        throw new Error('no en0 address');
      })
      .mockImplementationOnce(() => '192.168.31.42\n');

    expect(detectLanIp()).toBe('192.168.31.42');
    expect(execFileSyncMock).toHaveBeenNthCalledWith(1, 'ipconfig', ['getifaddr', 'en0'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    expect(execFileSyncMock).toHaveBeenNthCalledWith(2, 'ipconfig', ['getifaddr', 'en1'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  });
});
