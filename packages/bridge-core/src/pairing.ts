import { canonicalizeOfficialRelayUrl, sameRelayRegistry } from './official-relay.js';
import {
  readPairingConfig,
  writePairingConfig,
  type PairingConfig,
  type PairingEnvironment,
} from './config.js';
import { buildPairingQrPayload } from './qr.js';
import { buildPairingSessionDraft } from './pairing-session.js';
import { securePairingCodeKeyHex, writeSecurePairingResponderState } from './secure-pairing.js';


export interface PairGatewayResult {
  gatewayId: string;
  relaySecret: string;
  relayUrl: string;
  accessCode: string;
  accessCodeExpiresAt: string;
  displayName: string | null;
  region: string;
}

export interface PairingInfo {
  config: PairingConfig;
  accessCode: string;
  accessCodeExpiresAt: string;
  qrPayload: string;
  pairingSession?: PairingSessionInfo | null;
  action: 'registered' | 'refreshed';
}

export interface PairingSessionInfo {
  sessionId: string;
  pairingUrl: string;
  pairingCode: string;
  expiresAt: string;
  protocol: 1 | 2;
}

export async function pairGateway(input: {
  serverUrl: string;
  displayName?: string | null;
  gatewayToken?: string | null;
  gatewayPassword?: string | null;
  environment?: PairingEnvironment;
}): Promise<PairingInfo> {
  const baseUrl = canonicalizeOfficialRelayUrl(normalizeHttpBase(input.serverUrl), 'openclaw');
  const environment = input.environment ?? 'production';
  const existing = readPairingConfig(environment);
  const compatibility = assessPairingCompatibility(existing, baseUrl);
  if (compatibility === 'refresh-existing' && existing) {
    return refreshAccessCode({
      serverUrl: existing.serverUrl,
      gatewayId: existing.gatewayId,
      relaySecret: existing.relaySecret,
      displayName: input.displayName,
      gatewayToken: input.gatewayToken,
      gatewayPassword: input.gatewayPassword,
      environment,
    });
  }
  if (compatibility === 'server-mismatch') {
    throw new Error(
      `This bridge is already paired with ${existing?.serverUrl}. Run "clawket reset" before pairing with a different server.`,
    );
  }

  const registerRequest = await postJsonWithCloudflareFallback(`${baseUrl}/v1/pair/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      displayName: input.displayName?.trim() || null,
    }),
  });
  if (!registerRequest.response.ok) {
    throw await buildPairingRequestError('Pair register', registerRequest);
  }

  const payload = await registerRequest.response.json() as PairGatewayResult;
  const now = new Date().toISOString();
  const config: PairingConfig = {
    serverUrl: baseUrl,
    gatewayId: payload.gatewayId,
    relaySecret: payload.relaySecret,
    relayUrl: payload.relayUrl,
    instanceId: existing?.instanceId ?? `inst-${payload.gatewayId.slice(-10)}`,
    displayName: payload.displayName,
    createdAt: now,
    updatedAt: now,
  };
  writePairingConfig(config, environment);
  const qrPayload = buildPairingQrPayload({
    server: baseUrl,
    gatewayId: payload.gatewayId,
    accessCode: payload.accessCode,
    displayName: payload.displayName,
    token: input.gatewayToken?.trim() || null,
    password: input.gatewayPassword?.trim() || null,
  });
  return {
    config,
    accessCode: payload.accessCode,
    accessCodeExpiresAt: payload.accessCodeExpiresAt,
    action: 'registered',
    qrPayload,
    pairingSession: await createPairingSession({
      serverUrl: baseUrl,
      gatewayId: payload.gatewayId,
      relaySecret: payload.relaySecret,
      qrPayload,
      environment,
    }),
  };
}

export async function refreshAccessCode(input?: {
  serverUrl?: string;
  gatewayId?: string;
  relaySecret?: string;
  displayName?: string | null;
  gatewayToken?: string | null;
  gatewayPassword?: string | null;
  environment?: PairingEnvironment;
}): Promise<PairingInfo> {
  const environment = input?.environment ?? 'production';
  const existing = readPairingConfig(environment);
  const serverUrl = normalizeHttpBase(input?.serverUrl ?? existing?.serverUrl ?? '');
  const gatewayId = input?.gatewayId ?? existing?.gatewayId ?? '';
  const relaySecret = input?.relaySecret ?? existing?.relaySecret ?? '';
  if (!serverUrl || !gatewayId || !relaySecret) {
    throw new Error('Pairing config not found. Run pair first.');
  }

  const refreshRequest = await postJsonWithCloudflareFallback(`${serverUrl}/v1/pair/access-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      gatewayId,
      relaySecret,
      displayName: input?.displayName?.trim() || undefined,
    }),
  });
  if (!refreshRequest.response.ok) {
    throw await buildPairingRequestError('Access code refresh', refreshRequest);
  }

  const payload = await refreshRequest.response.json() as {
    gatewayId: string;
    relayUrl: string;
    accessCode: string;
    accessCodeExpiresAt: string;
    displayName: string | null;
  };
  const nextConfig: PairingConfig = {
    serverUrl,
    gatewayId: payload.gatewayId,
    relaySecret,
    relayUrl: payload.relayUrl,
    instanceId: existing?.instanceId ?? `inst-${payload.gatewayId.slice(-10)}`,
    displayName: payload.displayName,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writePairingConfig(nextConfig, environment);
  const qrPayload = buildPairingQrPayload({
    server: serverUrl,
    gatewayId: payload.gatewayId,
    accessCode: payload.accessCode,
    displayName: payload.displayName,
    token: input?.gatewayToken?.trim() || null,
    password: input?.gatewayPassword?.trim() || null,
  });
  return {
    config: nextConfig,
    accessCode: payload.accessCode,
    accessCodeExpiresAt: payload.accessCodeExpiresAt,
    action: 'refreshed',
    qrPayload,
    pairingSession: await createPairingSession({
      serverUrl,
      gatewayId: payload.gatewayId,
      relaySecret,
      qrPayload,
      environment,
    }),
  };
}

async function createPairingSession(input: {
  serverUrl: string;
  gatewayId: string;
  relaySecret: string;
  qrPayload: string;
  environment: PairingEnvironment;
}): Promise<PairingSessionInfo | null> {
  const draft = buildPairingSessionDraft(input);
  try {
    const request = await postJsonWithCloudflareFallback(`${input.serverUrl}/v1/pair/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(draft.request),
    });
    if (!request.response.ok) return null;
    const payload = await request.response.json() as {
      sessionId?: string;
      pairingUrl?: string;
      expiresAt?: string;
      capabilities?: string[];
    };
    const sessionId = payload.sessionId?.trim() ?? '';
    const pairingUrl = payload.pairingUrl?.trim() ?? '';
    const expiresAt = payload.expiresAt?.trim() ?? '';
    if (!/^ps_[a-f0-9]{64}$/.test(sessionId) || !pairingUrl || !Number.isFinite(Date.parse(expiresAt))) {
      return null;
    }
    const url = new URL(pairingUrl);
    const secureShortCode = payload.capabilities?.includes('pairing.secure-short-code.v2') === true;
    const displayedPairingCode = secureShortCode ? draft.shortPairingCode : draft.pairingCode;
    url.hash = new URLSearchParams({
      k: draft.linkSecret,
      c: displayedPairingCode,
    }).toString();
    if (secureShortCode) {
      writeSecurePairingResponderState({
        environment: input.environment,
        sessionId,
        gatewayId: input.gatewayId,
        codeKeyHex: securePairingCodeKeyHex(draft.shortPairingCode),
        qrPayload: input.qrPayload,
        expiresAt,
      });
    }
    return {
      sessionId,
      pairingUrl: url.toString(),
      pairingCode: displayedPairingCode,
      expiresAt,
      protocol: secureShortCode ? 2 : 1,
    };
  } catch {
    // A new Bridge must remain usable with a Registry that predates pairing sessions.
    return null;
  }
}


export function normalizeHttpBase(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/+$/, '');
  }
  if (trimmed.startsWith('ws://')) return `http://${trimmed.slice('ws://'.length)}`.replace(/\/+$/, '');
  if (trimmed.startsWith('wss://')) return `https://${trimmed.slice('wss://'.length)}`.replace(/\/+$/, '');
  return `https://${trimmed}`.replace(/\/+$/, '');
}

export function assessPairingCompatibility(
  existing: PairingConfig | null,
  nextServerUrl: string,
): 'register-new' | 'refresh-existing' | 'server-mismatch' {
  if (!existing) return 'register-new';
  if (sameRelayRegistry(existing.serverUrl, nextServerUrl)) return 'refresh-existing';
  return 'server-mismatch';
}

async function postJsonWithCloudflareFallback(
  url: string,
  init: RequestInit,
): Promise<{ response: Response; attemptedUrl: string; fallbackUrl: string | null }> {
  const response = await fetch(url, init);
  return { response, attemptedUrl: url, fallbackUrl: null };
}

async function buildPairingRequestError(
  action: string,
  request: { response: Response; attemptedUrl: string; fallbackUrl: string | null },
): Promise<Error> {
  if (isCloudflareChallengeResponse(request.response)) {
    const targetOrigin = new URL(request.fallbackUrl ?? request.attemptedUrl).origin;
    const fallbackText = request.fallbackUrl
      ? ` Automatic fallback to ${request.fallbackUrl} also hit a Cloudflare challenge.`
      : '';
    return new Error(
      `${action} failed (${request.response.status}): Cloudflare challenge blocked the registry API at ${targetOrigin}.${fallbackText} Retry from a different network or use a registry endpoint that does not require browser verification.`,
    );
  }

  return new Error(`${action} failed (${request.response.status}): ${summarizeFailedResponse(await request.response.text())}`);
}

export function isCloudflareChallengeResponse(response: Pick<Response, 'status' | 'headers'>): boolean {
  return response.status === 403 && response.headers.get('cf-mitigated')?.trim().toLowerCase() === 'challenge';
}

/** Kept for existing Bridge Core callers. Official APIs use custom domains. */
export function resolveCloudflareChallengeFallbackUrl(
  _url: string,
  _response: Pick<Response, 'status' | 'headers'>,
): string | null {
  return null;
}

function summarizeFailedResponse(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return 'Empty response body';
  if (collapsed.length <= 240) return collapsed;
  return `${collapsed.slice(0, 237)}...`;
}
