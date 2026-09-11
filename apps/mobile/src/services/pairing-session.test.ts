import { sha256 } from 'js-sha256';
import nacl from 'tweetnacl';
import {
  normalizePairingCode,
  parsePairingLink,
  resolvePairingCode,
  resolvePairingLink,
} from './pairing-session';
import { OFFICIAL_PRODUCTION_REGISTRY_URL } from './relay-environment';
import {
  FRAME_TOO_LARGE_CLOSE_CODE,
  FRAME_TOO_LARGE_ERROR_CODE,
  WEBSOCKET_FRAME_LIMIT_BYTES,
} from './websocket-frame-limit';

function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function encryptedResponse(payload: string, key: Uint8Array) {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  return {
    sessionId: 'ps_abc123',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    displayName: "Lucy's Mac",
    encryptedPayload: {
      nonce: toBase64Url(nonce),
      ciphertext: toBase64Url(nacl.secretbox(new TextEncoder().encode(payload), nonce, key)),
    },
  };
}

describe('pairing sessions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('parses official HTTPS and custom-scheme pairing links', () => {
    const key = toBase64Url(nacl.randomBytes(nacl.secretbox.keyLength));
    const https = `${OFFICIAL_PRODUCTION_REGISTRY_URL}/pair/ps_abc123#k=${key}`;
    expect(parsePairingLink(https)).toEqual({
      serverUrl: OFFICIAL_PRODUCTION_REGISTRY_URL,
      sessionId: 'ps_abc123',
      linkSecret: key,
    });
    expect(parsePairingLink(`clawket://pair?server=${encodeURIComponent(OFFICIAL_PRODUCTION_REGISTRY_URL)}&session=ps_abc123&key=${key}`))
      .toEqual(parsePairingLink(https));
  });

  it('rejects untrusted hosts and incomplete links', () => {
    const key = toBase64Url(nacl.randomBytes(nacl.secretbox.keyLength));
    expect(parsePairingLink(`https://evil.example/pair/ps_abc123#k=${key}`)).toBeNull();
    expect(parsePairingLink(`${OFFICIAL_PRODUCTION_REGISTRY_URL}/pair/ps_abc123`)).toBeNull();
  });

  it('decrypts a link payload locally', async () => {
    const key = nacl.randomBytes(nacl.secretbox.keyLength);
    const payload = JSON.stringify({ k: 'cp', v: 2, s: OFFICIAL_PRODUCTION_REGISTRY_URL, n: '书房电脑' });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(encryptedResponse(payload, key)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const result = await resolvePairingLink(
      `${OFFICIAL_PRODUCTION_REGISTRY_URL}/pair/ps_abc123#k=${toBase64Url(key)}`,
    );
    expect(result.rawQrPayload).toBe(payload);
    expect(fetch).toHaveBeenCalledWith(
      `${OFFICIAL_PRODUCTION_REGISTRY_URL}/v1/pair/session/ps_abc123`,
      undefined,
    );
  });

  it('hashes and decrypts a human pairing code without sending the code', async () => {
    const code = 'ABCD-EFGH-JK23';
    const normalized = normalizePairingCode(code);
    const key = Uint8Array.from(sha256.array(normalized));
    const payload = JSON.stringify({ k: 'cp', v: 2 });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(encryptedResponse(payload, key)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(resolvePairingCode({
      serverUrl: OFFICIAL_PRODUCTION_REGISTRY_URL,
      pairingCode: code.toLowerCase(),
    })).resolves.toMatchObject({ rawQrPayload: payload });
    const body = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual({ codeHash: sha256(normalized) });
    expect(JSON.stringify(body)).not.toContain(normalized);
  });

  it('uses a 6-digit code for an authenticated ephemeral Bridge handshake', async () => {
    const code = '123456';
    const sessionId = `ps_${'a'.repeat(64)}`;
    const gatewayId = 'gw_secure_pairing';
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const payload = JSON.stringify({ k: 'cp', v: 2, g: gatewayId, a: 'one-time-access' });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      protocol: 2,
      sessionId,
      gatewayId,
      relayUrl: 'wss://relay.clawket.ai/ws',
      relayTicket: 'cpt2.test.signature',
      expiresAt,
      displayName: 'Studio Mac',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const originalWebSocket = global.WebSocket;
    class PairingWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public readonly url: string) {
        queueMicrotask(() => this.onopen?.());
      }
      send(raw: string) {
        const request = JSON.parse(raw.slice('__clawket_relay_control__:'.length));
        const clientPublicKey = request.payload.clientPublicKey as string;
        const requestId = request.requestId as string;
        const bridgeKeys = nacl.box.keyPair();
        const nonce = nacl.randomBytes(nacl.box.nonceLength);
        const ciphertext = nacl.box(
          new TextEncoder().encode(payload),
          nonce,
          Buffer.from(clientPublicKey, 'base64url'),
          bridgeKeys.secretKey,
        );
        const bridgePublicKey = toBase64Url(bridgeKeys.publicKey);
        const nonceValue = toBase64Url(nonce);
        const ciphertextValue = toBase64Url(ciphertext);
        const codeKey = Uint8Array.from(sha256.array(code));
        const bridgeProof = sha256.hmac(
          codeKey,
          `clawket-pair-v2:result:${sessionId}:${requestId}:${clientPublicKey}:${bridgePublicKey}:${nonceValue}:${ciphertextValue}`,
        );
        queueMicrotask(() => this.onmessage?.({
          data: `__clawket_relay_control__:${JSON.stringify({
            event: 'pairing.secure.result',
            requestId,
            payload: {
              protocol: 2,
              sessionId,
              bridgePublicKey,
              nonce: nonceValue,
              ciphertext: ciphertextValue,
              bridgeProof,
            },
          })}`,
        }));
      }
      close() {}
    }
    global.WebSocket = PairingWebSocket as unknown as typeof WebSocket;
    try {
      await expect(resolvePairingCode({
        serverUrl: OFFICIAL_PRODUCTION_REGISTRY_URL,
        pairingCode: code,
      })).resolves.toMatchObject({ rawQrPayload: payload, displayName: 'Studio Mac' });
      const requestBody = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body);
      expect(requestBody).toEqual({ codeHash: sha256(code) });
    } finally {
      global.WebSocket = originalWebSocket;
    }
  });

  it('rejects an oversized secure-pairing frame before decoding it', async () => {
    const code = '123456';
    const sessionId = `ps_${'a'.repeat(64)}`;
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      protocol: 2,
      sessionId,
      gatewayId: 'gw_secure_pairing',
      relayUrl: 'wss://relay.clawket.ai/ws',
      relayTicket: 'cpt2.test.signature',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      displayName: 'Studio Mac',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const originalWebSocket = global.WebSocket;
    const closeSpy = jest.fn();
    class OversizedPairingWebSocket {
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      close = closeSpy;

      constructor(_url: string) {
        queueMicrotask(() => this.onopen?.());
      }

      send(_raw: string): void {
        queueMicrotask(() => this.onmessage?.({
          data: 'a'.repeat(WEBSOCKET_FRAME_LIMIT_BYTES + 1),
        }));
      }
    }
    global.WebSocket = OversizedPairingWebSocket as unknown as typeof WebSocket;
    try {
      await expect(resolvePairingCode({
        serverUrl: OFFICIAL_PRODUCTION_REGISTRY_URL,
        pairingCode: code,
      })).rejects.toMatchObject({
        code: FRAME_TOO_LARGE_ERROR_CODE,
        message: FRAME_TOO_LARGE_ERROR_CODE,
      });
      expect(closeSpy).toHaveBeenCalledWith(
        FRAME_TOO_LARGE_CLOSE_CODE,
        FRAME_TOO_LARGE_ERROR_CODE,
      );
    } finally {
      global.WebSocket = originalWebSocket;
    }
  });

  it('returns a stable expiration error for a missing session', async () => {
    const key = nacl.randomBytes(nacl.secretbox.keyLength);
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'PAIRING_SESSION_NOT_FOUND', message: 'missing' },
    }), { status: 404, headers: { 'content-type': 'application/json' } }));

    await expect(resolvePairingLink(
      `${OFFICIAL_PRODUCTION_REGISTRY_URL}/pair/ps_abc123#k=${toBase64Url(key)}`,
    )).rejects.toMatchObject({
      code: 'PAIRING_SESSION_NOT_FOUND',
      message: expect.stringContaining('expired'),
    });
  });
});
