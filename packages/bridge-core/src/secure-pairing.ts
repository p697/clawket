import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PairingEnvironment } from './config.js';

const CONFIG_DIR = join(homedir(), '.clawket');
const MAX_SECURE_PAIRING_ATTEMPTS = 5;
export const SECURE_PAIRING_V2_CAPABILITY = 'pairing.secure-short-code.v2';

export type SecurePairingResponderState = {
  protocol: 2;
  environment: PairingEnvironment;
  sessionId: string;
  gatewayId: string;
  codeKeyHex: string;
  qrPayload: string;
  expiresAt: string;
  attempts: number;
};

export function securePairingStatePath(environment: PairingEnvironment): string {
  return join(CONFIG_DIR, `pairing-session.${environment}.json`);
}

export function writeSecurePairingResponderState(
  state: Omit<SecurePairingResponderState, 'protocol' | 'attempts'>,
): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const value: SecurePairingResponderState = { ...state, protocol: 2, attempts: 0 };
  writeFileSync(securePairingStatePath(state.environment), `${JSON.stringify(value)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    chmodSync(securePairingStatePath(state.environment), 0o600);
  } catch {
    // Best effort on platforms without POSIX permissions.
  }
}

export function readSecurePairingResponderState(sessionId: string): SecurePairingResponderState | null {
  for (const environment of ['production', 'preview'] as const) {
    const path = securePairingStatePath(environment);
    if (!existsSync(path)) continue;
    try {
      const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<SecurePairingResponderState>;
      if (value.protocol !== 2
        || value.environment !== environment
        || value.sessionId !== sessionId
        || typeof value.gatewayId !== 'string'
        || typeof value.codeKeyHex !== 'string'
        || !/^[a-f0-9]{64}$/.test(value.codeKeyHex)
        || typeof value.qrPayload !== 'string'
        || !value.qrPayload
        || typeof value.expiresAt !== 'string'
        || Date.parse(value.expiresAt) <= Date.now()
        || typeof value.attempts !== 'number') {
        if (value.expiresAt && Date.parse(value.expiresAt) <= Date.now()) rmSync(path, { force: true });
        continue;
      }
      return value as SecurePairingResponderState;
    } catch {
      continue;
    }
  }
  return null;
}

export function consumeSecurePairingAttempt(sessionId: string): SecurePairingResponderState | null {
  const state = readSecurePairingResponderState(sessionId);
  if (!state || state.attempts >= MAX_SECURE_PAIRING_ATTEMPTS) return null;
  const next = { ...state, attempts: state.attempts + 1 };
  writeFileSync(securePairingStatePath(state.environment), `${JSON.stringify(next)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return next;
}

export function securePairingCodeKeyHex(code: string): string {
  return createHash('sha256').update(code.replace(/\D/g, ''), 'utf8').digest('hex');
}

export function createSecurePairingClientProof(input: {
  codeKeyHex: string;
  sessionId: string;
  requestId: string;
  clientPublicKey: string;
}): string {
  return createHmac('sha256', Buffer.from(input.codeKeyHex, 'hex'))
    .update(`clawket-pair-v2:start:${input.sessionId}:${input.requestId}:${input.clientPublicKey}`, 'utf8')
    .digest('hex');
}

export function createSecurePairingBridgeProof(input: {
  codeKeyHex: string;
  sessionId: string;
  requestId: string;
  clientPublicKey: string;
  bridgePublicKey: string;
  nonce: string;
  ciphertext: string;
}): string {
  return createHmac('sha256', Buffer.from(input.codeKeyHex, 'hex'))
    .update(
      `clawket-pair-v2:result:${input.sessionId}:${input.requestId}:${input.clientPublicKey}:${input.bridgePublicKey}:${input.nonce}:${input.ciphertext}`,
      'utf8',
    )
    .digest('hex');
}

export function securePairingProofEquals(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
