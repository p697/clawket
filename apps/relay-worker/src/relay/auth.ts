import { isSecurePairingSecretConfigured, sha256Hex, verifyPairingRelayTicket } from '@clawket/shared';
import { HERMES_BACKEND_POLICY, OPENCLAW_BACKEND_POLICY } from '../backend-policy';
import type { BackendPolicy, PairBridgeRecord, PairGatewayRecord, PairRecord } from './types';

const REGISTRY_VERIFY_TIMEOUT_MS = 10_000;

type RelayAuthCommon = {
  routesKv: KVNamespace;
  registryVerifyUrl?: string;
  role: 'gateway' | 'client';
  token: string;
  mirroredClientTokenHashes?: ReadonlySet<string>;
  pairingTicketSecret?: string;
  policy?: BackendPolicy;
};

export type RelayAuthInput = RelayAuthCommon & (
  | { gatewayId: string; bridgeId?: never }
  | { bridgeId: string; gatewayId?: never }
  | { principalId: string; gatewayId?: never; bridgeId?: never }
);

export type RelayAuthorizationResult = {
  authorized: boolean;
  clientLabel: string | null;
  path: 'mirrored' | 'kv' | 'registry' | 'ticket' | 'rejected';
  authScope: 'full' | 'pairing';
  pairingSessionId: string | null;
  ticketExpiresAt: number | null;
};

function resolveAuthIdentity(input: RelayAuthInput): { policy: BackendPolicy; principalId: string } {
  if ('bridgeId' in input && typeof input.bridgeId === 'string') {
    return { policy: input.policy ?? HERMES_BACKEND_POLICY, principalId: input.bridgeId };
  }
  if ('gatewayId' in input && typeof input.gatewayId === 'string') {
    return { policy: input.policy ?? OPENCLAW_BACKEND_POLICY, principalId: input.gatewayId };
  }
  return { policy: input.policy ?? OPENCLAW_BACKEND_POLICY, principalId: input.principalId };
}

export async function isRelayTokenAuthorized(input: RelayAuthInput): Promise<boolean> {
  return (await authorizeRelayToken(input)).authorized;
}

export async function authorizeRelayToken(input: RelayAuthInput): Promise<RelayAuthorizationResult> {
  const { routesKv, registryVerifyUrl, role, token, mirroredClientTokenHashes } = input;
  const { policy, principalId } = resolveAuthIdentity(input);
  const pairingTicketSecret = input.pairingTicketSecret?.trim() ?? '';
  if (policy.securePairing && role === 'client' && isSecurePairingSecretConfigured(pairingTicketSecret)) {
    const ticket = await verifyPairingRelayTicket({
      token,
      secret: pairingTicketSecret,
      gatewayId: principalId,
    });
    if (ticket) {
      return {
        authorized: true,
        clientLabel: null,
        path: 'ticket',
        authScope: 'pairing',
        pairingSessionId: ticket.sessionId,
        ticketExpiresAt: ticket.expiresAt,
      };
    }
  }

  const tokenHash = await sha256Hex(token);
  const mirrored = role === 'client' && mirroredClientTokenHashes?.has(tokenHash) === true;
  const pair = await getPairRecord(routesKv, principalId, policy);
  if (pair) {
    if (role === 'gateway') {
      if (tokenHash === pair.relaySecretHash) return fullAuthorization(true, null, 'kv');
      const authorized = await verifyViaRegistry(registryVerifyUrl, principalId, token, policy, role);
      return fullAuthorization(authorized, null, authorized ? 'registry' : 'rejected');
    }
    const matched = Array.isArray(pair.clientTokens)
      ? pair.clientTokens.find((item) => item?.hash === tokenHash)
      : undefined;
    if (matched) {
      return fullAuthorization(true, matched.label?.trim() || null, mirrored ? 'mirrored' : 'kv');
    }
    if (mirrored) return fullAuthorization(true, null, 'mirrored');
    const authorized = await verifyViaRegistry(registryVerifyUrl, principalId, token, policy, role);
    return fullAuthorization(authorized, null, authorized ? 'registry' : 'rejected');
  }
  if (mirrored) return fullAuthorization(true, null, 'mirrored');
  const authorized = await verifyViaRegistry(registryVerifyUrl, principalId, token, policy, role);
  return fullAuthorization(authorized, null, authorized ? 'registry' : 'rejected');
}

function fullAuthorization(
  authorized: boolean,
  clientLabel: string | null,
  path: RelayAuthorizationResult['path'],
): RelayAuthorizationResult {
  return {
    authorized,
    clientLabel,
    path,
    authScope: 'full',
    pairingSessionId: null,
    ticketExpiresAt: null,
  };
}

async function getPairRecord(
  routesKv: KVNamespace,
  principalId: string,
  policy: BackendPolicy,
): Promise<PairRecord | null> {
  const raw = await routesKv.get(`${policy.kvKeys.pair}${principalId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PairRecord;
    return parsed
      && typeof parsed[policy.principalRecordField] === 'string'
      && typeof parsed.relaySecretHash === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function getPairGateway(routesKv: KVNamespace, gatewayId: string): Promise<PairGatewayRecord | null> {
  return await getPairRecord(routesKv, gatewayId, OPENCLAW_BACKEND_POLICY) as PairGatewayRecord | null;
}

export async function getPairBridge(routesKv: KVNamespace, bridgeId: string): Promise<PairBridgeRecord | null> {
  return await getPairRecord(routesKv, bridgeId, HERMES_BACKEND_POLICY) as PairBridgeRecord | null;
}

export async function resolveClientLabelFromToken(
  routesKv: KVNamespace,
  principalId: string,
  token: string,
  policy: BackendPolicy = OPENCLAW_BACKEND_POLICY,
): Promise<string | null> {
  const pair = await getPairRecord(routesKv, principalId, policy);
  if (!pair || !Array.isArray(pair.clientTokens)) return null;
  const tokenHash = await sha256Hex(token);
  const matched = pair.clientTokens.find((item) => item?.hash === tokenHash);
  return matched?.label?.trim() || null;
}

export async function resolveHermesClientLabelFromToken(
  routesKv: KVNamespace,
  bridgeId: string,
  token: string,
): Promise<string | null> {
  return resolveClientLabelFromToken(routesKv, bridgeId, token, HERMES_BACKEND_POLICY);
}

export { sha256Hex } from '@clawket/shared';

async function verifyViaRegistry(
  registryVerifyUrl: string | undefined,
  principalId: string,
  token: string,
  policy: BackendPolicy,
  role: 'gateway' | 'client',
): Promise<boolean> {
  const base = registryVerifyUrl?.trim();
  if (!base) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTRY_VERIFY_TIMEOUT_MS);
  try {
    const endpoint = `${base.replace(/\/+$/, '')}${policy.registryVerifyPath}${encodeURIComponent(principalId)}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      return false;
    }
    return await readRegistryRole(response, controller.signal, role);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// Registry's legacy public contract includes the wire role. A valid client
// token must never gain owner authority merely because verification returned 200.
async function readRegistryRole(response: Response, signal: AbortSignal, role: 'gateway' | 'client'): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) return false;
  const abortRead = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abortRead, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (signal.aborted) return false;
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) return false;
      if (done) break;
      size += value.byteLength;
      if (size > 1024) return false;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return payload !== null && !Array.isArray(payload) && payload.ok === true && payload.role === role;
  } finally {
    signal.removeEventListener('abort', abortRead);
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
}
