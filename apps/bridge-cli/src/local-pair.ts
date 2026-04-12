import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { buildGatewayQrPayload, normalizeGatewayQrUrl } from '@clawket/bridge-core';
import { resolveGatewayUrl } from '@clawket/bridge-runtime';

const BLOCKED_INTERFACE_TOKENS = [
  'utun',
  'tun',
  'tap',
  'tailscale',
  'wireguard',
  'wg',
  'vpn',
  'ipsec',
  'docker',
  'veth',
  'vmnet',
  'vbox',
  'loopback',
  ' lo',
  'lo0',
  'awdl',
  'llw',
  'bridge',
  'br-',
  'ppp',
];

export interface LocalPairingInfo {
  gatewayUrl: string;
  qrPayload: string;
  expiresAt: number;
  authMode: 'token' | 'password';
}

export function buildGatewayControlUiOrigin(gatewayUrl: string): string {
  const parsed = new URL(normalizeExplicitGatewayUrl(gatewayUrl));
  const scheme = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  const port = parsed.port || (scheme === 'https:' ? '443' : '80');
  return `${scheme}//${parsed.hostname}:${port}`;
}

export function buildLocalPairingInfo(input: {
  explicitUrl?: string | null;
  gatewayToken?: string | null;
  gatewayPassword?: string | null;
  defaultGatewayUrl?: string | null;
  expiresAt?: number;
}): LocalPairingInfo {
  const auth = resolveLocalPairAuth(input);
  const gatewayUrl = resolveLocalPairGatewayUrl({
    explicitUrl: input.explicitUrl,
    defaultGatewayUrl: input.defaultGatewayUrl,
  });
  const expiresAt = input.expiresAt ?? Date.now() + 10 * 60 * 1000;
  return {
    gatewayUrl,
    expiresAt,
    authMode: auth.mode,
    qrPayload: buildGatewayQrPayload({
      gatewayUrl,
      token: auth.token,
      password: auth.password,
      expiresAt,
    }),
  };
}

export function resolveLocalPairGatewayUrl(input?: {
  explicitUrl?: string | null;
  defaultGatewayUrl?: string | null;
}): string {
  const explicit = input?.explicitUrl?.trim();
  if (explicit) {
    return normalizeExplicitGatewayUrl(explicit);
  }
  const baseGatewayUrl = input?.defaultGatewayUrl?.trim() || resolveGatewayUrl();
  const lanIp = detectLanIp();
  if (!lanIp) {
    throw new Error('Failed to determine a LAN IP address. Pass --url to specify a custom gateway URL.');
  }
  return rewriteGatewayHost(baseGatewayUrl, lanIp);
}

export function normalizeExplicitGatewayUrl(url: string): string {
  const trimmed = url.trim();
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  return normalizeGatewayQrUrl(withScheme).url;
}

export function rewriteGatewayHost(gatewayUrl: string, nextHost: string): string {
  const trimmed = gatewayUrl.trim();
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  const parsed = new URL(withScheme);
  parsed.hostname = nextHost;
  return normalizeGatewayQrUrl(parsed.toString()).url;
}

export function detectLanIp(): string | null {
  const preferredDarwinIp = detectPreferredDarwinLanIp();
  if (preferredDarwinIp) {
    return preferredDarwinIp;
  }
  const interfaces = networkInterfaces();
  let best: { score: number; ip: string } | null = null;
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4') continue;
      const score = scoreLanCandidate(name, address.address);
      if (score === 0) continue;
      if (!best || score > best.score) {
        best = { score, ip: address.address };
      }
    }
  }
  return best?.ip ?? null;
}

function detectPreferredDarwinLanIp(): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }
  for (const interfaceName of ['en0', 'en1']) {
    const ip = readInterfaceIpv4(interfaceName);
    if (ip) {
      return ip;
    }
  }
  return null;
}

function readInterfaceIpv4(interfaceName: string): string | null {
  try {
    const output = execFileSync('ipconfig', ['getifaddr', interfaceName], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return isLanIpv4(output) ? output : null;
  } catch {
    return null;
  }
}

export function scoreLanCandidate(name: string, ip: string): number {
  if (!isLanIpv4(ip)) {
    return 0;
  }
  const lower = name.toLowerCase();
  if (BLOCKED_INTERFACE_TOKENS.some((token) => lower.includes(token))) {
    return 0;
  }

  let score = isRfc1918(ip)
    ? 120
    : isCgnat(ip)
      ? 90
      : 40;
  if (
    lower.startsWith('en')
    || lower.startsWith('eth')
    || lower.startsWith('wlan')
    || lower.startsWith('wl')
    || lower.includes('wifi')
    || lower.includes('wi-fi')
  ) {
    score += 20;
  }
  return score;
}

function resolveLocalPairAuth(input: {
  gatewayToken?: string | null;
  gatewayPassword?: string | null;
}): { mode: 'token'; token: string; password: null } | { mode: 'password'; token: null; password: string } {
  if (input.gatewayToken?.trim()) {
    return { mode: 'token', token: input.gatewayToken.trim(), password: null };
  }
  if (input.gatewayPassword?.trim()) {
    return { mode: 'password', token: null, password: input.gatewayPassword.trim() };
  }
  throw new Error('OpenClaw gateway auth is missing (token or password).');
}

function isLanIpv4(ip: string): boolean {
  if (!isValidIpv4(ip)) return false;
  if (ip === '0.0.0.0') return false;
  const [a, b, c, d] = ip.split('.').map(Number);
  if (a === 127) return false;
  if (a === 169 && b === 254) return false;
  if (a >= 224 && a <= 239) return false;
  if (a === 255 && b === 255 && c === 255 && d === 255) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return isRfc1918(ip) || isCgnat(ip);
}

function isRfc1918(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isCgnat(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}
