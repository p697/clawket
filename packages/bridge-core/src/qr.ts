export interface PairingQrPayloadV2 {
  v: 2;
  k: 'cp';
  s: string;
  g: string;
  a: string;
  rb: 1;
  pv: 2;
  sb: true;
  n?: string;
  t?: string;
  p?: string;
}

export interface LegacyPairingQrPayloadV1 {
  version: 1;
  kind: 'clawket_pair';
  server: string;
  gatewayId: string;
  accessCode: string;
  relayUrl?: string;
  displayName?: string | null;
  token?: string | null;
  password?: string | null;
}

export interface HermesLocalPairingQrPayloadV1 {
  version: 1;
  kind: 'clawket_hermes_local';
  mode: 'hermes';
  url: string;
  expiresAt: number;
  hermes: {
    bridgeUrl: string;
    displayName?: string;
  };
}

export interface HermesRelayPairingQrPayloadV1 {
  version: 1;
  kind: 'clawket_hermes_pair';
  backend: 'hermes';
  transport: 'relay';
  server: string;
  bridgeId: string;
  accessCode: string;
  relayUrl?: string;
  displayName?: string | null;
}

export type PairingQrPayload = PairingQrPayloadV2 | LegacyPairingQrPayloadV1 | HermesLocalPairingQrPayloadV1 | HermesRelayPairingQrPayloadV1;

export interface GatewayQrPayloadV2 {
  url: string;
  host: string;
  port: number;
  token?: string;
  password?: string;
  tls: boolean;
  mode: 'gateway';
  expiresAt: number;
  qrVersion: 2;
}

export function buildPairingQrPayload(input: {
  server: string;
  gatewayId: string;
  accessCode: string;
  displayName?: string | null;
  token?: string | null;
  password?: string | null;
}): string {
  const payload: PairingQrPayloadV2 = {
    v: 2,
    k: 'cp',
    s: input.server,
    g: input.gatewayId,
    a: input.accessCode,
    rb: 1,
    pv: 2,
    sb: true,
  };
  if (input.displayName?.trim()) {
    payload.n = input.displayName.trim();
  }
  if (input.token?.trim()) {
    payload.t = input.token.trim();
  }
  if (input.password?.trim()) {
    payload.p = input.password.trim();
  }
  return JSON.stringify(payload);
}

export function buildGatewayQrPayload(input: {
  gatewayUrl: string;
  token?: string | null;
  password?: string | null;
  expiresAt?: number;
}): string {
  const parsed = normalizeGatewayQrUrl(input.gatewayUrl);
  const payload: GatewayQrPayloadV2 = {
    url: parsed.url,
    host: parsed.host,
    port: parsed.port,
    tls: parsed.tls,
    mode: 'gateway',
    expiresAt: input.expiresAt ?? Date.now() + 10 * 60 * 1000,
    qrVersion: 2,
  };
  if (input.token?.trim()) {
    payload.token = input.token.trim();
  }
  if (input.password?.trim()) {
    payload.password = input.password.trim();
  }
  return JSON.stringify(payload);
}

export function buildHermesLocalPairingQrPayload(input: {
  bridgeWsUrl: string;
  bridgeHttpUrl: string;
  displayName?: string | null;
  expiresAt?: number;
}): string {
  const payload: HermesLocalPairingQrPayloadV1 = {
    version: 1,
    kind: 'clawket_hermes_local',
    mode: 'hermes',
    url: input.bridgeWsUrl.trim(),
    expiresAt: input.expiresAt ?? Date.now() + 10 * 60 * 1000,
    hermes: {
      bridgeUrl: input.bridgeHttpUrl.trim(),
    },
  };
  if (input.displayName?.trim()) {
    payload.hermes.displayName = input.displayName.trim();
  }
  return JSON.stringify(payload);
}

export function buildHermesRelayPairingQrPayload(input: {
  server: string;
  bridgeId: string;
  accessCode: string;
  displayName?: string | null;
  relayUrl?: string | null;
}): string {
  const payload: HermesRelayPairingQrPayloadV1 = {
    version: 1,
    kind: 'clawket_hermes_pair',
    backend: 'hermes',
    transport: 'relay',
    server: input.server.trim(),
    bridgeId: input.bridgeId.trim(),
    accessCode: input.accessCode.trim(),
  };
  if (input.displayName?.trim()) {
    payload.displayName = input.displayName.trim();
  }
  if (input.relayUrl?.trim()) {
    payload.relayUrl = input.relayUrl.trim();
  }
  return JSON.stringify(payload);
}

export function normalizeGatewayQrUrl(url: string): {
  url: string;
  host: string;
  port: number;
  path: string;
  tls: boolean;
} {
  const parsed = new URL(url.trim());
  const tls = parsed.protocol === 'wss:' || parsed.protocol === 'https:';
  const scheme = tls ? 'wss:' : 'ws:';
  const host = parsed.hostname;
  const port = parsed.port
    ? Number(parsed.port)
    : tls
      ? 443
      : 80;
  const path = !parsed.pathname || parsed.pathname === '' ? '/' : parsed.pathname;
  return {
    url: `${scheme}//${host}:${port}${path}`,
    host,
    port,
    path,
    tls,
  };
}
