import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';

/**
 * Pairing transports supported by the Clawket bridge.
 *
 * - `local`      : direct LAN IP (RFC1918/CGNAT) without a relay.
 * - `tailscale`  : direct Tailscale IP (100.64/10) without a relay.
 * - `bonjour`    : local service discovery via mDNS; often layered on top of LAN/Tailscale.
 * - `multipeer`  : Apple Multipeer Connectivity (native, proximity/LAN).
 * - `relay`      : cloud relay through a Clawket registry/relay worker.
 * - `cloudflare` : cloud relay through Cloudflare Tunnel.
 */
export type PairingTransport = 'local' | 'tailscale' | 'bonjour' | 'multipeer' | 'relay' | 'cloudflare';

export const PAIRING_TRANSPORTS: readonly PairingTransport[] = [
  'local',
  'tailscale',
  'bonjour',
  'multipeer',
  'relay',
  'cloudflare',
];

export function isPairingTransport(value: unknown): value is PairingTransport {
  return typeof value === 'string' && PAIRING_TRANSPORTS.includes(value as PairingTransport);
}

export interface DetectIpOptions {
  /** Only consider addresses from these interface names (exact match). */
  allowedInterfaceNames?: readonly string[];
  /** Reject addresses from interfaces whose names include any of these tokens. */
  blockedInterfaceTokens?: readonly string[];
  /** Only consider IPv4 addresses. */
  family?: 'IPv4' | 'IPv6';
  /** Prefer these interface names in order. */
  preferredInterfaceNames?: readonly string[];
  /** Custom predicate to filter an IP address. */
  ipFilter?: (ip: string) => boolean;
}

/**
 * Generic interface/IP detector. Mirrors the scoring logic from local-pair.ts
 * but allows callers to supply their own allow/block lists and IP filter.
 */
export function detectInterfaceIp(options: DetectIpOptions = {}): string | null {
  const {
    allowedInterfaceNames,
    blockedInterfaceTokens = [],
    family = 'IPv4',
    preferredInterfaceNames = [],
    ipFilter = isRoutableIpv4,
  } = options;

  const preferredEntries = preferredInterfaceNames
    .map((name) => ({ name, ip: readInterfaceIpv4(name) }))
    .filter((entry): entry is { name: string; ip: string } => entry.ip !== null && ipFilter(entry.ip));
  const preferred = preferredEntries[0]?.ip ?? null;

  if (preferred) return preferred;

  const interfaces = networkInterfaces();
  let best: { score: number; ip: string } | null = null;

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (allowedInterfaceNames && !allowedInterfaceNames.includes(name)) continue;
    if (blockedInterfaceTokens.some((token) => name.toLowerCase().includes(token.toLowerCase()))) continue;

    for (const address of addresses ?? []) {
      if (address.family !== family) continue;
      const ip = address.address;
      if (!ipFilter(ip)) continue;
      const score = scoreInterfaceCandidate(name, ip);
      if (score === 0) continue;
      if (!best || score > best.score) {
        best = { score, ip };
      }
    }
  }

  return best?.ip ?? null;
}

function readInterfaceIpv4(name: string): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const output = execFileSync('ipconfig', ['getifaddr', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return isRoutableIpv4(output) ? output : null;
  } catch {
    return null;
  }
}

/** Tailscale CGNAT range: 100.64.0.0/10 */
export function isTailscaleIp(ip: string): boolean {
  if (!isValidIpv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

/** RFC1918 private ranges. */
export function isRfc1918(ip: string): boolean {
  if (!isValidIpv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Carrier Grade NAT range: 100.64.0.0/10 (shared with Tailscale). */
export function isCgnat(ip: string): boolean {
  if (!isValidIpv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

export function isLanIpv4(ip: string): boolean {
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

export function isRoutableIpv4(ip: string): boolean {
  return isLanIpv4(ip);
}

export function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

export function scoreInterfaceCandidate(name: string, ip: string): number {
  let score = isRfc1918(ip)
    ? 120
    : isCgnat(ip)
      ? 90
      : 40;

  const lower = name.toLowerCase();
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

export interface TailscaleIpOptions {
  /** Interface name to prefer (e.g. 'utun4'). */
  preferredInterfaceName?: string;
}

/**
 * Detect the best Tailscale IP address.
 *
 * Tailscale interfaces are typically named `utunN` on macOS. We do NOT block
 * them here; we actively look for them and pick the highest-scoring address.
 */
export function detectTailscaleIp(options: TailscaleIpOptions = {}): string | null {
  return detectInterfaceIp({
    preferredInterfaceNames: options.preferredInterfaceName
      ? [options.preferredInterfaceName]
      : ['utun4', 'utun3', 'utun2', 'utun1', 'utun0'],
    ipFilter: (ip) => isTailscaleIp(ip),
  });
}

/**
 * Detect the best LAN IP address, explicitly excluding VPN/Tailscale interfaces.
 */
export function detectLanIp(): string | null {
  return detectInterfaceIp({
    preferredInterfaceNames: ['en0', 'en1'],
    blockedInterfaceTokens: [
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
    ],
    ipFilter: (ip) => isLanIpv4(ip) && !isTailscaleIp(ip),
  });
}

/**
 * Build a WebSocket gateway URL for the given transport host.
 */
export function buildTransportWsUrl(host: string, port: number, token: string): string {
  return `ws://${host}:${port}/v1/hermes/ws?token=${encodeURIComponent(token)}`;
}

export function buildTransportHttpUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}
