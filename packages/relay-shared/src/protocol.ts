export type ConnectionRole = 'gateway' | 'client';

export interface RelayAuthQuery {
  gatewayId: string;
  role: ConnectionRole;
  clientId?: string;
  token?: string;
}

export type RelayAuthSource = 'query' | 'bearer' | 'none';

export interface RelayAuthTokenResolution {
  token: string | null;
  authSource: RelayAuthSource;
}

export interface PairRegisterRequest {
  displayName?: string | null;
  preferredRegion?: string;
  gatewayVersion?: string;
}

export interface PairRegisterResponse {
  gatewayId: string;
  relaySecret: string;
  relayUrl: string;
  accessCode: string;
  accessCodeExpiresAt: string;
  displayName: string | null;
  region: string;
}

export interface PairAccessCodeRequest {
  gatewayId: string;
  relaySecret: string;
  displayName?: string | null;
}

export interface PairAccessCodeResponse {
  gatewayId: string;
  relayUrl: string;
  accessCode: string;
  accessCodeExpiresAt: string;
  displayName: string | null;
  region: string;
}

export interface PairClaimRequest {
  gatewayId: string;
  accessCode: string;
  clientLabel?: string | null;
}

export interface PairClaimResponse {
  gatewayId: string;
  relayUrl: string;
  clientToken: string;
  displayName: string | null;
  region: string;
}

export interface PairingSessionCiphertext {
  nonce: string;
  ciphertext: string;
}

export interface PairingSessionCreateRequest {
  gatewayId: string;
  relaySecret: string;
  codeHash: string;
  shortCodeHash?: string;
  linkPayload: PairingSessionCiphertext;
  codePayload: PairingSessionCiphertext;
}

export interface PairingSessionCreateResponse {
  sessionId: string;
  pairingUrl: string;
  expiresAt: string;
  displayName: string | null;
  capabilities?: string[];
}

export interface PairingSessionReadResponse {
  sessionId: string;
  expiresAt: string;
  displayName: string | null;
  encryptedPayload: PairingSessionCiphertext;
}

export interface PairingSessionResolveRequest {
  codeHash: string;
}

export interface SecurePairingResolveRequest {
  codeHash: string;
}

export interface SecurePairingResolveResponse {
  protocol: 2;
  sessionId: string;
  gatewayId: string;
  relayUrl: string;
  relayTicket: string;
  expiresAt: string;
  displayName: string | null;
}

export interface PairingRelayTicketClaims {
  version: 2;
  scope: 'pairing';
  gatewayId: string;
  sessionId: string;
  tokenId: string;
  expiresAt: number;
}

export const SECURE_PAIRING_V2_CAPABILITY = 'pairing.secure-short-code.v2';
export const PAIRING_TICKET_SECRET_MIN_LENGTH = 32;

export function isSecurePairingSecretConfigured(secret: string | undefined): boolean {
  return (secret?.trim().length ?? 0) >= PAIRING_TICKET_SECRET_MIN_LENGTH;
}

export interface RegistryErrorShape {
  error: {
    code: string;
    message: string;
  };
}

export function parseRelayAuthQuery(url: URL): RelayAuthQuery {
  const roleRaw = url.searchParams.get('role');
  const gatewayId = (url.searchParams.get('gatewayId') ?? '').trim();
  const clientId = (url.searchParams.get('clientId') ?? '').trim() || undefined;
  const token = (url.searchParams.get('token') ?? '').trim() || undefined;
  const role: ConnectionRole = roleRaw === 'gateway' ? 'gateway' : 'client';

  return {
    gatewayId,
    role,
    clientId,
    token,
  };
}

export function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function errorResponse(code: string, message: string, status = 400): Response {
  return jsonResponse({ error: { code, message } }, status);
}

export function readBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

export function resolveRelayAuthToken(queryToken: string | undefined, request: Request): RelayAuthTokenResolution {
  const normalizedQueryToken = queryToken?.trim() || '';
  if (normalizedQueryToken) {
    return {
      token: normalizedQueryToken,
      authSource: 'query',
    };
  }

  const bearerToken = readBearerToken(request);
  if (bearerToken) {
    return {
      token: bearerToken,
      authSource: 'bearer',
    };
  }

  return {
    token: null,
    authSource: 'none',
  };
}

export async function constantTimeSecretEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  return safeEqual(leftHash, rightHash);
}

export function normalizeRegion(region: string): string {
  const value = region.trim().toLowerCase();
  if (!value) return 'us';
  return value;
}

export async function sha256Hex(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}

export async function hmacSha256Hex(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(signature));
}

export async function issuePairingRelayTicket(
  claims: PairingRelayTicketClaims,
  secret: string,
): Promise<string> {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await hmacSha256Hex(secret, `clawket-pairing-ticket-v2.${payload}`);
  return `cpt2.${payload}.${signature}`;
}

export async function verifyPairingRelayTicket(input: {
  token: string;
  secret: string;
  gatewayId: string;
  nowMs?: number;
}): Promise<PairingRelayTicketClaims | null> {
  const parts = input.token.split('.');
  if (parts.length !== 3 || parts[0] !== 'cpt2') return null;
  const payload = parts[1] ?? '';
  const signature = parts[2] ?? '';
  if (!payload || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const expected = await hmacSha256Hex(input.secret, `clawket-pairing-ticket-v2.${payload}`);
  if (!safeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as Partial<PairingRelayTicketClaims>;
    if (parsed.version !== 2
      || parsed.scope !== 'pairing'
      || parsed.gatewayId !== input.gatewayId
      || typeof parsed.sessionId !== 'string'
      || !/^ps_[a-f0-9]{64}$/.test(parsed.sessionId)
      || typeof parsed.tokenId !== 'string'
      || !/^[a-f0-9-]{16,64}$/.test(parsed.tokenId)
      || typeof parsed.expiresAt !== 'number'
      || parsed.expiresAt <= (input.nowMs ?? Date.now())) {
      return null;
    }
    return parsed as PairingRelayTicketClaims;
  } catch {
    return null;
  }
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function safeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, '0')).join('');
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
