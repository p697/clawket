/**
 * auth.ts — Relay token authentication.
 * Ported from apps/relay-worker/src/relay/auth.ts.
 * Adapted: uses MemoryKV instead of KVNamespace.
 */

import { sha256Hex } from '@clawket/shared';
import type { PairGatewayRecord } from './types.js';
import type { MemoryKV } from '../kv-store.js';

function pairGatewayKey(gatewayId: string): string {
  return `pair-gateway:${gatewayId}`;
}

export type RelayAuthInput = {
  routesKv: MemoryKV;
  registryVerifyUrl?: string;
  gatewayId: string;
  role: 'gateway' | 'client';
  token: string;
  mirroredClientTokenHashes?: ReadonlySet<string>;
};

export async function isRelayTokenAuthorized(input: RelayAuthInput): Promise<boolean> {
  const { routesKv, registryVerifyUrl, gatewayId, role, token, mirroredClientTokenHashes } = input;
  const tokenHash = await sha256Hex(token);
  if (role === 'client' && mirroredClientTokenHashes?.has(tokenHash)) {
    return true;
  }
  const pairGateway = await getPairGateway(routesKv, gatewayId);
  if (pairGateway) {
    if (role === 'gateway') {
      if (tokenHash === pairGateway.relaySecretHash) return true;
      return verifyViaRegistry(registryVerifyUrl, gatewayId, token);
    }
    if (Array.isArray(pairGateway.clientTokens)
      && pairGateway.clientTokens.some((item) => item?.hash === tokenHash)) {
      return true;
    }
    return verifyViaRegistry(registryVerifyUrl, gatewayId, token);
  }
  return verifyViaRegistry(registryVerifyUrl, gatewayId, token);
}

export async function getPairGateway(routesKv: MemoryKV, gatewayId: string): Promise<PairGatewayRecord | null> {
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
  routesKv: MemoryKV,
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
