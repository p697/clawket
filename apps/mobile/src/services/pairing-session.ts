import { sha256 } from 'js-sha256';
import nacl from 'tweetnacl';
import { resolveOfficialRelayEnvironment } from './relay-environment';

type PairingSessionCiphertext = {
  nonce: string;
  ciphertext: string;
};

type PairingSessionReadResponse = {
  sessionId: string;
  expiresAt: string;
  displayName: string | null;
  encryptedPayload: PairingSessionCiphertext;
};

type SecurePairingResolveResponse = {
  protocol: 2;
  sessionId: string;
  gatewayId: string;
  relayUrl: string;
  relayTicket: string;
  expiresAt: string;
  displayName: string | null;
};

const RELAY_CONTROL_PREFIX = '__clawket_relay_control__:';

export type PairingLinkDescriptor = {
  serverUrl: string;
  sessionId: string;
  linkSecret: string;
};

export type ResolvedPairingSession = {
  rawQrPayload: string;
  displayName: string | null;
  serverUrl: string;
  expiresAt: string;
};

export class PairingSessionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PairingSessionError';
  }
}

export function parsePairingLink(url: string): PairingLinkDescriptor | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol === 'clawket:' && parsed.hostname === 'pair') {
    return validatePairingLinkDescriptor({
      serverUrl: parsed.searchParams.get('server') ?? '',
      sessionId: parsed.searchParams.get('session') ?? '',
      linkSecret: parsed.searchParams.get('key') ?? '',
    });
  }

  if (parsed.protocol !== 'https:' || !resolveOfficialRelayEnvironment(parsed.origin)) return null;
  const match = parsed.pathname.match(/^\/pair\/([^/]+)\/?$/);
  if (!match) return null;
  const fragment = new URLSearchParams(parsed.hash.slice(1));
  return validatePairingLinkDescriptor({
    serverUrl: parsed.origin,
    sessionId: decodeURIComponent(match[1]),
    linkSecret: fragment.get('k') ?? '',
  });
}

export async function resolvePairingLink(url: string): Promise<ResolvedPairingSession> {
  const descriptor = parsePairingLink(url);
  if (!descriptor) {
    throw new PairingSessionError('INVALID_PAIRING_LINK', 'This pairing link is incomplete or invalid.');
  }
  return resolveEncryptedPairingSession({
    serverUrl: descriptor.serverUrl,
    endpoint: `/v1/pair/session/${encodeURIComponent(descriptor.sessionId)}`,
    key: decodeBase64Url(descriptor.linkSecret, nacl.secretbox.keyLength),
  });
}

export async function resolvePairingCode(input: {
  serverUrl: string;
  pairingCode: string;
}): Promise<ResolvedPairingSession> {
  const normalizedCode = normalizePairingCode(input.pairingCode);
  const serverUrl = normalizeServerUrl(input.serverUrl);
  if (/^\d{6}$/.test(normalizedCode)) {
    return resolveSecureShortPairingCode({ serverUrl, pairingCode: normalizedCode });
  }
  if (normalizedCode.length !== 12) {
    throw new PairingSessionError('INVALID_PAIRING_CODE', 'Enter the 6-digit pairing code shown on your computer.');
  }
  const codeHash = sha256(normalizedCode);
  return resolveEncryptedPairingSession({
    serverUrl,
    endpoint: '/v1/pair/session/resolve',
    key: Uint8Array.from(sha256.array(normalizedCode)),
    requestBody: { codeHash },
  });
}

async function resolveSecureShortPairingCode(input: {
  serverUrl: string;
  pairingCode: string;
}): Promise<ResolvedPairingSession> {
  const codeKey = Uint8Array.from(sha256.array(input.pairingCode));
  const response = await fetch(`${input.serverUrl}/v2/pair/session/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ codeHash: sha256(input.pairingCode) }),
  }).catch(() => {
    throw new PairingSessionError('PAIRING_NETWORK_ERROR', 'Could not reach the pairing service. Check your connection and try again.');
  });
  const body = await readJson(response);
  if (!response.ok) throwPairingHttpError(response, body);
  if (!isSecurePairingResolveResponse(body) || Date.parse(body.expiresAt) <= Date.now()) {
    throw new PairingSessionError('INVALID_PAIRING_RESPONSE', 'The pairing service returned an invalid response.');
  }
  const keyPair = nacl.box.keyPair();
  const clientPublicKey = encodeBase64Url(keyPair.publicKey);
  const requestId = createRequestId();
  const clientProof = sha256.hmac(
    codeKey,
    `clawket-pair-v2:start:${body.sessionId}:${requestId}:${clientPublicKey}`,
  );
  const payload = await exchangeSecurePairingPayload({
    response: body,
    requestId,
    clientPublicKey,
    clientSecretKey: keyPair.secretKey,
    clientProof,
    codeKey,
  });
  return {
    rawQrPayload: payload,
    displayName: body.displayName,
    serverUrl: input.serverUrl,
    expiresAt: body.expiresAt,
  };
}

function exchangeSecurePairingPayload(input: {
  response: SecurePairingResolveResponse;
  requestId: string;
  clientPublicKey: string;
  clientSecretKey: Uint8Array;
  clientProof: string;
  codeKey: Uint8Array;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(buildSecurePairingRelayUrl(input.response));
    let settled = false;
    const timeout = setTimeout(() => {
      fail('PAIRING_HANDSHAKE_TIMEOUT', 'The computer did not respond to the pairing request.');
    }, 15_000);
    const fail = (code: string, message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { socket.close(); } catch { /* already closed */ }
      reject(new PairingSessionError(code, message));
    };
    socket.onopen = () => {
      socket.send(`${RELAY_CONTROL_PREFIX}${JSON.stringify({
        type: 'control',
        event: 'pairing.secure.start',
        requestId: input.requestId,
        payload: {
          protocol: 2,
          sessionId: input.response.sessionId,
          clientPublicKey: input.clientPublicKey,
          clientProof: input.clientProof,
        },
      })}`);
    };
    socket.onerror = () => fail('PAIRING_HANDSHAKE_FAILED', 'Could not establish the secure pairing channel.');
    socket.onclose = () => fail('PAIRING_HANDSHAKE_FAILED', 'The secure pairing channel closed before pairing completed.');
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string' || !event.data.startsWith(RELAY_CONTROL_PREFIX)) return;
      let envelope: { event?: unknown; requestId?: unknown; payload?: Record<string, unknown> };
      try {
        envelope = JSON.parse(event.data.slice(RELAY_CONTROL_PREFIX.length));
      } catch {
        return;
      }
      if (envelope.requestId !== input.requestId) return;
      if (envelope.event === 'pairing.secure.error') {
        fail('PAIRING_HANDSHAKE_REJECTED', 'The secure pairing request was rejected or expired.');
        return;
      }
      if (envelope.event !== 'pairing.secure.result' || !isSecurePairingResult(envelope.payload)) return;
      const result = envelope.payload;
      if (result.sessionId !== input.response.sessionId) return;
      const expectedProof = sha256.hmac(
        input.codeKey,
        `clawket-pair-v2:result:${input.response.sessionId}:${input.requestId}:${input.clientPublicKey}:${result.bridgePublicKey}:${result.nonce}:${result.ciphertext}`,
      );
      if (!constantTimeHexEqual(result.bridgeProof, expectedProof)) {
        fail('PAIRING_HANDSHAKE_FAILED', 'The secure pairing response could not be authenticated.');
        return;
      }
      try {
        const plaintext = nacl.box.open(
          decodeBase64Url(result.ciphertext),
          decodeBase64Url(result.nonce, nacl.box.nonceLength),
          decodeBase64Url(result.bridgePublicKey, nacl.box.publicKeyLength),
          input.clientSecretKey,
        );
        if (!plaintext) throw new Error('decryption failed');
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.close();
        resolve(decodeUtf8(plaintext));
      } catch {
        fail('PAIRING_DECRYPT_FAILED', 'The secure pairing response could not be decrypted.');
      }
    };
  });
}

function buildSecurePairingRelayUrl(value: SecurePairingResolveResponse): string {
  const url = new URL(value.relayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : url.protocol === 'http:' ? 'ws:' : url.protocol;
  url.searchParams.set('gatewayId', value.gatewayId);
  url.searchParams.set('role', 'client');
  url.searchParams.set('clientId', `pair-${createRequestId()}`);
  url.searchParams.set('token', value.relayTicket);
  return url.toString();
}

function createRequestId(): string {
  return Array.from(nacl.randomBytes(16)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

function encodeBase64Url(value: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let output = '';
  for (let index = 0; index < value.length; index += 3) {
    const a = value[index] ?? 0;
    const b = value[index + 1] ?? 0;
    const c = value[index + 2] ?? 0;
    const packed = (a << 16) | (b << 8) | c;
    output += alphabet[(packed >>> 18) & 63];
    output += alphabet[(packed >>> 12) & 63];
    if (index + 1 < value.length) output += alphabet[(packed >>> 6) & 63];
    if (index + 2 < value.length) output += alphabet[packed & 63];
  }
  return output;
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function normalizePairingCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function resolveEncryptedPairingSession(input: {
  serverUrl: string;
  endpoint: string;
  key: Uint8Array;
  requestBody?: Record<string, string>;
}): Promise<ResolvedPairingSession> {
  const response = await fetch(`${input.serverUrl}${input.endpoint}`, input.requestBody ? {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input.requestBody),
  } : undefined).catch(() => {
    throw new PairingSessionError('PAIRING_NETWORK_ERROR', 'Could not reach the pairing service. Check your connection and try again.');
  });
  const body = await readJson(response);
  if (!response.ok) {
    const code = readErrorCode(body) ?? 'PAIRING_SESSION_FAILED';
    if (response.status === 404 || response.status === 410) {
      throw new PairingSessionError(code, 'This pairing invitation is invalid or has expired. Create a new one on your computer.');
    }
    if (response.status === 429) {
      throw new PairingSessionError(code, 'Too many pairing attempts. Wait a few minutes and try again.');
    }
    throw new PairingSessionError(code, 'Could not load this pairing invitation. Try again.');
  }
  if (!isPairingSessionReadResponse(body)) {
    throw new PairingSessionError('INVALID_PAIRING_RESPONSE', 'The pairing service returned an invalid response.');
  }
  const expiresAtMs = Date.parse(body.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new PairingSessionError('PAIRING_SESSION_EXPIRED', 'This pairing invitation has expired. Create a new one on your computer.');
  }
  const nonce = decodeBase64Url(body.encryptedPayload.nonce, nacl.secretbox.nonceLength);
  const ciphertext = decodeBase64Url(body.encryptedPayload.ciphertext);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, input.key);
  if (!plaintext) {
    throw new PairingSessionError('PAIRING_DECRYPT_FAILED', 'This pairing invitation is invalid or was copied incompletely.');
  }
  return {
    rawQrPayload: decodeUtf8(plaintext),
    displayName: body.displayName,
    serverUrl: input.serverUrl,
    expiresAt: body.expiresAt,
  };
}

function validatePairingLinkDescriptor(input: PairingLinkDescriptor): PairingLinkDescriptor | null {
  let serverUrl: string;
  try {
    serverUrl = normalizeServerUrl(input.serverUrl);
  } catch {
    return null;
  }
  if (!input.sessionId.trim() || !/^ps_[A-Za-z0-9_-]+$/.test(input.sessionId)) return null;
  try {
    decodeBase64Url(input.linkSecret, nacl.secretbox.keyLength);
  } catch {
    return null;
  }
  return { serverUrl, sessionId: input.sessionId, linkSecret: input.linkSecret };
}

function normalizeServerUrl(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== 'https:' || !resolveOfficialRelayEnvironment(parsed.origin)) {
    throw new PairingSessionError('UNTRUSTED_PAIRING_SERVER', 'This pairing invitation does not use an official Clawket service.');
  }
  return parsed.origin;
}

function decodeBase64Url(value: string, expectedLength?: number): Uint8Array {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PairingSessionError('INVALID_PAIRING_SECRET', 'The pairing invitation is incomplete.');
  }
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes: number[] = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const character of base64) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) {
      throw new PairingSessionError('INVALID_PAIRING_SECRET', 'The pairing invitation is incomplete.');
    }
    accumulator = (accumulator << 6) | digit;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((accumulator >> bitCount) & 0xff);
      accumulator &= (1 << bitCount) - 1;
    }
  }
  if (bitCount > 0 && accumulator !== 0) {
    throw new PairingSessionError('INVALID_PAIRING_SECRET', 'The pairing invitation is incomplete.');
  }
  const decoded = Uint8Array.from(bytes);
  if (expectedLength !== undefined && decoded.length !== expectedLength) {
    throw new PairingSessionError('INVALID_PAIRING_SECRET', 'The pairing invitation is incomplete.');
  }
  return decoded;
}

function decodeUtf8(value: Uint8Array): string {
  let escaped = '';
  for (const byte of value) escaped += `%${byte.toString(16).padStart(2, '0')}`;
  try {
    return decodeURIComponent(escaped);
  } catch {
    throw new PairingSessionError('INVALID_PAIRING_RESPONSE', 'The pairing service returned an invalid response.');
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readErrorCode(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function throwPairingHttpError(response: Response, body: unknown): never {
  const code = readErrorCode(body) ?? 'PAIRING_SESSION_FAILED';
  if (response.status === 404 || response.status === 410) {
    throw new PairingSessionError(code, 'This pairing invitation is invalid or has expired. Create a new one on your computer.');
  }
  if (response.status === 429) {
    throw new PairingSessionError(code, 'Too many pairing attempts. Wait a few minutes and try again.');
  }
  throw new PairingSessionError(code, 'Could not load this pairing invitation. Try again.');
}

function isSecurePairingResolveResponse(value: unknown): value is SecurePairingResolveResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.protocol === 2
    && typeof record.sessionId === 'string'
    && /^ps_[a-f0-9]{64}$/.test(record.sessionId)
    && typeof record.gatewayId === 'string'
    && typeof record.relayUrl === 'string'
    && typeof record.relayTicket === 'string'
    && typeof record.expiresAt === 'string'
    && (typeof record.displayName === 'string' || record.displayName === null);
}

function isSecurePairingResult(value: unknown): value is {
  protocol: 2;
  sessionId: string;
  bridgePublicKey: string;
  nonce: string;
  ciphertext: string;
  bridgeProof: string;
} {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.protocol === 2
    && typeof record.sessionId === 'string'
    && typeof record.bridgePublicKey === 'string'
    && typeof record.nonce === 'string'
    && typeof record.ciphertext === 'string'
    && typeof record.bridgeProof === 'string'
    && /^[a-f0-9]{64}$/.test(record.bridgeProof);
}

function isPairingSessionReadResponse(value: unknown): value is PairingSessionReadResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const encryptedPayload = record.encryptedPayload;
  return typeof record.sessionId === 'string'
    && typeof record.expiresAt === 'string'
    && (typeof record.displayName === 'string' || record.displayName === null)
    && Boolean(encryptedPayload)
    && typeof encryptedPayload === 'object'
    && typeof (encryptedPayload as Record<string, unknown>).nonce === 'string'
    && typeof (encryptedPayload as Record<string, unknown>).ciphertext === 'string';
}
