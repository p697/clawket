import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockInterfaces: Record<string, Array<{ family: string; address: string; internal: boolean }>> = {};

vi.mock('node:os', () => ({
  networkInterfaces: () => mockInterfaces,
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(() => ''),
}));

const {
  isTailscaleIp,
  isLanIpv4,
  isValidIpv4,
  isRfc1918,
  isCgnat,
  detectInterfaceIp,
  isPairingTransport,
} = await import('./transport-pairing.js');

describe('transport-pairing', () => {
  beforeEach(() => {
    mockInterfaces = {};
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('isValidIpv4', () => {
    it.each([
      ['192.168.1.1', true],
      ['10.0.0.1', true],
      ['100.64.0.1', true],
      ['256.0.0.1', false],
      ['1.2.3', false],
      ['localhost', false],
      ['::1', false],
      ['', false],
    ])('%s -> %s', (input, expected) => {
      expect(isValidIpv4(input)).toBe(expected);
    });
  });

  describe('isRfc1918', () => {
    it.each([
      ['10.0.0.1', true],
      ['172.16.0.1', true],
      ['172.31.255.255', true],
      ['192.168.1.1', true],
      ['100.64.0.1', false],
      ['8.8.8.8', false],
      ['127.0.0.1', false],
    ])('%s -> %s', (input, expected) => {
      expect(isRfc1918(input)).toBe(expected);
    });
  });

  describe('isCgnat', () => {
    it.each([
      ['100.64.0.1', true],
      ['100.127.255.255', true],
      ['100.63.0.1', false],
      ['100.128.0.1', false],
      ['10.0.0.1', false],
    ])('%s -> %s', (input, expected) => {
      expect(isCgnat(input)).toBe(expected);
    });
  });

  describe('isTailscaleIp', () => {
    it.each([
      ['100.89.167.39', true],
      ['100.100.100.100', true],
      ['10.0.0.1', false],
      ['127.0.0.1', false],
      ['169.254.0.1', false],
    ])('%s -> %s', (input, expected) => {
      expect(isTailscaleIp(input)).toBe(expected);
    });
  });

  describe('isLanIpv4', () => {
    it.each([
      ['192.168.1.1', true],
      ['10.0.0.1', true],
      ['100.64.0.1', true],
      ['127.0.0.1', false],
      ['0.0.0.0', false],
      ['169.254.0.1', false],
      ['255.255.255.255', false],
      ['198.18.0.1', false],
    ])('%s -> %s', (input, expected) => {
      expect(isLanIpv4(input)).toBe(expected);
    });
  });

  describe('detectInterfaceIp', () => {
    it('returns a LAN address when a matching interface is present', () => {
      mockInterfaces = {
        en0: [{ family: 'IPv4', address: '192.168.1.42', internal: false }],
        lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      };
      const ip = detectInterfaceIp({
        preferredInterfaceNames: ['en0'],
      });
      expect(ip).toBe('192.168.1.42');
    });

    it('respects blocked interface tokens', () => {
      mockInterfaces = {
        utun4: [{ family: 'IPv4', address: '100.89.167.39', internal: false }],
        en0: [{ family: 'IPv4', address: '192.168.1.42', internal: false }],
      };
      const ip = detectInterfaceIp({
        blockedInterfaceTokens: ['utun'],
        preferredInterfaceNames: ['en0'],
        ipFilter: (addr) => isLanIpv4(addr) && !isTailscaleIp(addr),
      });
      expect(ip).toBe('192.168.1.42');
    });

    it('selects a Tailscale address when the filter allows it', () => {
      mockInterfaces = {
        utun4: [{ family: 'IPv4', address: '100.89.167.39', internal: false }],
        en0: [{ family: 'IPv4', address: '192.168.1.42', internal: false }],
      };
      const ip = detectInterfaceIp({
        preferredInterfaceNames: ['utun4', 'en0'],
        ipFilter: (addr) => isTailscaleIp(addr),
      });
      expect(ip).toBe('100.89.167.39');
    });

    it('returns null when no interface matches', () => {
      mockInterfaces = {};
      expect(detectInterfaceIp()).toBeNull();
    });
  });

  describe('isPairingTransport', () => {
    it.each([
      ['local', true],
      ['tailscale', true],
      ['bonjour', true],
      ['multipeer', true],
      ['relay', true],
      ['cloudflare', true],
      ['bluetooth', false],
      ['', false],
      [null, false],
    ])('%s -> %s', (input, expected) => {
      expect(isPairingTransport(input as unknown as string)).toBe(expected);
    });
  });
});
