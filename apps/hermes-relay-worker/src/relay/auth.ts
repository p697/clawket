import { sha256Hex } from '@clawket/shared';
import type { PairBridgeRecord } from './types';

function pairBridgeKey(bridgeId: string): string {
  return `hermes-pair-bridge:${bridgeId}`;
}

export type RelayAuthInput = {
  routesKv: KVNamespace;
  registryVerifyUrl?: string;
  bridgeId: string;
  role: 'gateway' | 'client';
  token: string;
  mirroredClientTokenHashes?: ReadonlySet<string>;
};

export async function isRelayTokenAuthorized(input: RelayAuthInput): Promise<boolean> {
  const { routesKv, registryVerifyUrl, bridgeId, role, token, mirroredClientTokenHashes } = input;
  const tokenHash = await sha256Hex(token);
  if (role === 'client' && mirroredClientTokenHashes?.has(tokenHash)) {
    return true;
  }
  const pairBridge = await getPairBridge(routesKv, bridgeId);
  if (pairBridge) {
    if (role === 'gateway') {
      if (tokenHash === pairBridge.relaySecretHash) return true;
      return verifyViaRegistry(registryVerifyUrl, bridgeId, token);
    }
    if (Array.isArray(pairBridge.clientTokens)
      && pairBridge.clientTokens.some((item) => item?.hash === tokenHash)) {
      return true;
    }
    return verifyViaRegistry(registryVerifyUrl, bridgeId, token);
  }
  return verifyViaRegistry(registryVerifyUrl, bridgeId, token);
}

export async function getPairBridge(routesKv: KVNamespace, bridgeId: string): Promise<PairBridgeRecord | null> {
  const raw = await routesKv.get(pairBridgeKey(bridgeId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PairBridgeRecord;
    return parsed && typeof parsed.bridgeId === 'string' && typeof parsed.relaySecretHash === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function resolveClientLabelFromToken(
  routesKv: KVNamespace,
  bridgeId: string,
  token: string,
): Promise<string | null> {
  const pairBridge = await getPairBridge(routesKv, bridgeId);
  if (!pairBridge || !Array.isArray(pairBridge.clientTokens)) return null;
  const tokenHash = await sha256Hex(token);
  const matched = pairBridge.clientTokens.find((item) => item?.hash === tokenHash);
  return matched?.label?.trim() || null;
}

export { sha256Hex } from '@clawket/shared';

async function verifyViaRegistry(
  registryVerifyUrl: string | undefined,
  bridgeId: string,
  token: string,
): Promise<boolean> {
  const base = registryVerifyUrl?.trim();
  if (!base) return false;

  try {
    const endpoint = `${base.replace(/\/+$/, '')}/v1/hermes/verify/${encodeURIComponent(bridgeId)}`;
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
