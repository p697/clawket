import {
  errorResponse,
  jsonResponse,
  normalizeRegion,
  parsePositiveInt,
  readBearerToken,
  resolveRelayAuthToken,
  sha256Hex,
  type ConnectionRole,
  type RelayAuthQuery,
  type RelayAuthSource,
  type RelayAuthTokenResolution,
  type RegistryErrorShape,
} from './protocol';

export interface HermesRelayAuthQuery extends RelayAuthQuery {
  bridgeId: string;
}

export interface HermesPairRegisterRequest {
  displayName?: string | null;
  preferredRegion?: string;
  bridgeVersion?: string;
}

export interface HermesPairRegisterResponse {
  bridgeId: string;
  relaySecret: string;
  relayUrl: string;
  accessCode: string;
  accessCodeExpiresAt: string;
  displayName: string | null;
  region: string;
}

export interface HermesPairAccessCodeRequest {
  bridgeId: string;
  relaySecret: string;
  displayName?: string | null;
}

export interface HermesPairAccessCodeResponse {
  bridgeId: string;
  relayUrl: string;
  accessCode: string;
  accessCodeExpiresAt: string;
  displayName: string | null;
  region: string;
}

export interface HermesPairClaimRequest {
  bridgeId: string;
  accessCode: string;
  clientLabel?: string | null;
}

export interface HermesPairClaimResponse {
  bridgeId: string;
  relayUrl: string;
  clientToken: string;
  displayName: string | null;
  region: string;
}

export {
  errorResponse,
  jsonResponse,
  normalizeRegion,
  parsePositiveInt,
  readBearerToken,
  resolveRelayAuthToken,
  sha256Hex,
};
export type {
  ConnectionRole,
  RelayAuthQuery,
  RelayAuthSource,
  RelayAuthTokenResolution,
  RegistryErrorShape,
};

export function parseHermesRelayAuthQuery(url: URL): HermesRelayAuthQuery {
  const roleRaw = url.searchParams.get('role');
  const bridgeId = (url.searchParams.get('bridgeId') ?? '').trim();
  const clientId = (url.searchParams.get('clientId') ?? '').trim() || undefined;
  const token = (url.searchParams.get('token') ?? '').trim() || undefined;
  const role: ConnectionRole = roleRaw === 'gateway' ? 'gateway' : 'client';

  return {
    bridgeId,
    gatewayId: bridgeId,
    role,
    clientId,
    token,
  };
}
