import { isSecurePairingSecretConfigured, sha256Hex, verifyPairingRelayTicket } from '@clawket/shared';
import type { PairGatewayRecord } from './types';

function pairGatewayKey(gatewayId: string): string {
  return `pair-gateway:${gatewayId}`;
}

export type RelayAuthInput = {
  routesKv: KVNamespace;
  registryVerifyUrl?: string;
  gatewayId: string;
  role: 'gateway' | 'client';
  token: string;
  mirroredClientTokenHashes?: ReadonlySet<string>;
  pairingTicketSecret?: string;
};

export type RelayAuthorizationResult = {
  authorized: boolean;
  clientLabel: string | null;
  path: 'mirrored' | 'kv' | 'registry' | 'ticket' | 'rejected';
  authScope: 'full' | 'pairing';
  pairingSessionId: string | null;
  ticketExpiresAt: number | null;
};

export async function isRelayTokenAuthorized(input: RelayAuthInput): Promise<boolean> {
  return (await authorizeRelayToken(input)).authorized;
}

export async function authorizeRelayToken(input: RelayAuthInput): Promise<RelayAuthorizationResult> {
  const { routesKv, registryVerifyUrl, gatewayId, role, token, mirroredClientTokenHashes } = input;
  const pairingTicketSecret = input.pairingTicketSecret?.trim() ?? '';
  if (role === 'client' && isSecurePairingSecretConfigured(pairingTicketSecret)) {
    const ticket = await verifyPairingRelayTicket({
      token,
      secret: pairingTicketSecret,
      gatewayId,
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
  const pairGateway = await getPairGateway(routesKv, gatewayId);
  if (pairGateway) {
    if (role === 'gateway') {
      if (tokenHash === pairGateway.relaySecretHash) {
        return fullAuthorization(true, null, 'kv');
      }
      const authorized = await verifyViaRegistry(registryVerifyUrl, gatewayId, token);
      return fullAuthorization(authorized, null, authorized ? 'registry' : 'rejected');
    }
    const matched = Array.isArray(pairGateway.clientTokens)
      ? pairGateway.clientTokens.find((item) => item?.hash === tokenHash)
      : undefined;
    if (matched) {
      return fullAuthorization(true, matched.label?.trim() || null, mirrored ? 'mirrored' : 'kv');
    }
    if (mirrored) return fullAuthorization(true, null, 'mirrored');
    const authorized = await verifyViaRegistry(registryVerifyUrl, gatewayId, token);
    return fullAuthorization(authorized, null, authorized ? 'registry' : 'rejected');
  }
  if (mirrored) return fullAuthorization(true, null, 'mirrored');
  const authorized = await verifyViaRegistry(registryVerifyUrl, gatewayId, token);
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

export async function getPairGateway(routesKv: KVNamespace, gatewayId: string): Promise<PairGatewayRecord | null> {
  const raw = await routesKv.get(pairGatewayKey(gatewayId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PairGatewayRecord;
    return parsed && typeof parsed.gatewayId === 'string' && typeof parsed.relaySecretHash === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function resolveClientLabelFromToken(
  routesKv: KVNamespace,
  gatewayId: string,
  token: string,
): Promise<string | null> {
  const pairGateway = await getPairGateway(routesKv, gatewayId);
  if (!pairGateway || !Array.isArray(pairGateway.clientTokens)) return null;
  const tokenHash = await sha256Hex(token);
  const matched = pairGateway.clientTokens.find((item) => item?.hash === tokenHash);
  return matched?.label?.trim() || null;
}

export { sha256Hex } from '@clawket/shared';

async function verifyViaRegistry(
  registryVerifyUrl: string | undefined,
  gatewayId: string,
  token: string,
): Promise<boolean> {
  const base = registryVerifyUrl?.trim();
  if (!base) return false;

  try {
    const endpoint = `${base.replace(/\/+$/, '')}/v1/verify/${encodeURIComponent(gatewayId)}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    return response.status === 200;
  } catch {
    return false;
  }
}
