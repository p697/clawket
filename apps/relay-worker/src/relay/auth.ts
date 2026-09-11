import { isSecurePairingSecretConfigured, sha256Hex, verifyPairingRelayTicket } from '@clawket/shared';
import { HERMES_BACKEND_POLICY, OPENCLAW_BACKEND_POLICY } from '../backend-policy';
import type { BackendPolicy, PairBridgeRecord, PairGatewayRecord, PairRecord } from './types';

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
      const authorized = await verifyViaRegistry(registryVerifyUrl, principalId, token, policy);
      return fullAuthorization(authorized, null, authorized ? 'registry' : 'rejected');
    }
    const matched = Array.isArray(pair.clientTokens)
      ? pair.clientTokens.find((item) => item?.hash === tokenHash)
      : undefined;
    if (matched) {
      return fullAuthorization(true, matched.label?.trim() || null, mirrored ? 'mirrored' : 'kv');
    }
    if (mirrored) return fullAuthorization(true, null, 'mirrored');
    const authorized = await verifyViaRegistry(registryVerifyUrl, principalId, token, policy);
    return fullAuthorization(authorized, null, authorized ? 'registry' : 'rejected');
  }
  if (mirrored) return fullAuthorization(true, null, 'mirrored');
  const authorized = await verifyViaRegistry(registryVerifyUrl, principalId, token, policy);
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
): Promise<boolean> {
  const base = registryVerifyUrl?.trim();
  if (!base) return false;

  try {
    const endpoint = `${base.replace(/\/+$/, '')}${policy.registryVerifyPath}${encodeURIComponent(principalId)}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });
    return response.status === 200;
  } catch {
    return false;
  }
}
