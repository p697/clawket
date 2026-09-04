import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import nacl from 'tweetnacl';
import { buildPairingSessionDraft, normalizePairingCode } from './pairing-session.js';

describe('pairing session encryption', () => {
  it('encrypts independent link and short-code payloads that decrypt to the legacy QR', () => {
    const qrPayload = JSON.stringify({ v: 2, k: 'cp', a: 'secret-access-code' });
    const draft = buildPairingSessionDraft({
      gatewayId: 'gw_test',
      relaySecret: 'grs_test',
      qrPayload,
    });

    expect(draft.pairingCode).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}(?:-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}){2}$/);
    expect(draft.shortPairingCode).toMatch(/^\d{6}$/);
    expect(draft.request.shortCodeHash).toBe(
      createHash('sha256').update(draft.shortPairingCode, 'utf8').digest('hex'),
    );
    expect(draft.request.codeHash).toBe(
      createHash('sha256').update(normalizePairingCode(draft.pairingCode), 'utf8').digest('hex'),
    );
    expect(decrypt(draft.request.linkPayload, Buffer.from(draft.linkSecret, 'base64url'))).toBe(qrPayload);
    const codeKey = createHash('sha256')
      .update(normalizePairingCode(draft.pairingCode), 'utf8')
      .digest();
    expect(decrypt(draft.request.codePayload, codeKey)).toBe(qrPayload);
    expect(draft.request.linkPayload.ciphertext).not.toBe(draft.request.codePayload.ciphertext);
  });
});

function decrypt(
  encrypted: { nonce: string; ciphertext: string },
  key: Uint8Array,
): string {
  const plaintext = nacl.secretbox.open(
    Buffer.from(encrypted.ciphertext, 'base64url'),
    Buffer.from(encrypted.nonce, 'base64url'),
    key,
  );
  if (!plaintext) throw new Error('Failed to decrypt test payload');
  return Buffer.from(plaintext).toString('utf8');
}
