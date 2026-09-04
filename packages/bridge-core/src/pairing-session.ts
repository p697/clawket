import { createHash, randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';

type PairingSessionCiphertext = {
  nonce: string;
  ciphertext: string;
};

type PairingSessionCreateRequest = {
  gatewayId: string;
  relaySecret: string;
  codeHash: string;
  shortCodeHash: string;
  linkPayload: PairingSessionCiphertext;
  codePayload: PairingSessionCiphertext;
};

const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const PAIRING_CODE_LENGTH = 12;
const SHORT_PAIRING_CODE_LENGTH = 6;

export type PairingSessionDraft = {
  request: PairingSessionCreateRequest;
  linkSecret: string;
  pairingCode: string;
  shortPairingCode: string;
};

export function buildPairingSessionDraft(input: {
  gatewayId: string;
  relaySecret: string;
  qrPayload: string;
}): PairingSessionDraft {
  const linkKey = randomBytes(nacl.secretbox.keyLength);
  const linkSecret = linkKey.toString('base64url');
  const pairingCode = generatePairingCode();
  const shortPairingCode = generateShortPairingCode();
  const normalizedCode = normalizePairingCode(pairingCode);
  const codeKey = createHash('sha256').update(normalizedCode, 'utf8').digest();
  return {
    linkSecret,
    pairingCode,
    shortPairingCode,
    request: {
      gatewayId: input.gatewayId,
      relaySecret: input.relaySecret,
      codeHash: createHash('sha256').update(normalizedCode, 'utf8').digest('hex'),
      shortCodeHash: createHash('sha256').update(shortPairingCode, 'utf8').digest('hex'),
      linkPayload: encryptPairingPayload(input.qrPayload, linkKey),
      codePayload: encryptPairingPayload(input.qrPayload, codeKey),
    },
  };
}

function generateShortPairingCode(): string {
  let value = '';
  while (value.length < SHORT_PAIRING_CODE_LENGTH) {
    const bytes = randomBytes(SHORT_PAIRING_CODE_LENGTH);
    for (const byte of bytes) {
      const limit = Math.floor(256 / 10) * 10;
      if (byte >= limit) continue;
      value += String(byte % 10);
      if (value.length === SHORT_PAIRING_CODE_LENGTH) break;
    }
  }
  return value;
}

export function normalizePairingCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function encryptPairingPayload(payload: string, key: Uint8Array): PairingSessionCiphertext {
  const nonce = randomBytes(nacl.secretbox.nonceLength);
  const plaintext = Buffer.from(payload, 'utf8');
  const ciphertext = nacl.secretbox(plaintext, nonce, key);
  return {
    nonce: Buffer.from(nonce).toString('base64url'),
    ciphertext: Buffer.from(ciphertext).toString('base64url'),
  };
}

function generatePairingCode(): string {
  let value = '';
  while (value.length < PAIRING_CODE_LENGTH) {
    const bytes = randomBytes(PAIRING_CODE_LENGTH);
    for (const byte of bytes) {
      const limit = Math.floor(256 / PAIRING_CODE_ALPHABET.length) * PAIRING_CODE_ALPHABET.length;
      if (byte >= limit) continue;
      value += PAIRING_CODE_ALPHABET[byte % PAIRING_CODE_ALPHABET.length];
      if (value.length === PAIRING_CODE_LENGTH) break;
    }
  }
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}
