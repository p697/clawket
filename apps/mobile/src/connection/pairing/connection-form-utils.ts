/** Pure compatibility helpers shared by pairing and the legacy editor. */
export function buildRelayClaimKey(serverUrl: string, gatewayId: string, accessCode: string): string {
  return `${serverUrl.trim()}::${gatewayId.trim()}::${accessCode.trim()}`;
}

export function shouldSuppressDuplicatePairingAlert(
  previousMessage: string | null,
  previousAtMs: number,
  nextMessage: string,
  nowMs: number,
  windowMs = 1500,
): boolean {
  if (!previousMessage) return false;
  return previousMessage === nextMessage && nowMs - previousAtMs < windowMs;
}

export function isUnsupportedDirectLocalTlsConfig(input: {
  url: string;
  hasRelayConfig?: boolean;
}): boolean {
  if (input.hasRelayConfig) {
    return false;
  }
  try {
    const parsed = new URL(input.url.trim());
    if (parsed.protocol !== 'wss:') {
      return false;
    }
    return isPrivateOrLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'localhost' || normalized === '::1' || normalized === '[::1]') {
    return true;
  }
  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map((entry) => Number(entry));
    if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
      return false;
    }
    const [a, b] = octets;
    return a === 127
      || a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127);
  }
  return normalized.endsWith('.local');
}
