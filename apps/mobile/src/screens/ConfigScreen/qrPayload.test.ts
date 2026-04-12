import { parseQRPayload } from './qrPayload';

/**
 * Critical backward-compatibility surface: parseQRPayload is what the
 * mobile app calls for every scanned QR. A regression here would break
 * OpenClaw pairing for every existing user upgrading to the Hermes
 * branch. These tests pin the compatibility matrix:
 *
 * - Compact OpenClaw v2 pairing payload (current default)
 * - Legacy OpenClaw v1 pairing payload (`kind: 'clawket_pair'`)
 * - Hermes local v1 payload (`kind: 'clawket_hermes_local'`)
 * - Hermes relay v1 payload (`kind: 'clawket_hermes_pair'`)
 * - Legacy `{host, port, token}` gateway payload
 * - Legacy `openclaw://connect?...` URL scheme
 * - Expired QR codes (defensive)
 * - Malformed / partial payloads (return null, never throw)
 */
describe('parseQRPayload', () => {
  describe('OpenClaw v2 compact pairing payload', () => {
    it('parses a minimal compact payload', () => {
      const payload = JSON.stringify({
        v: 2,
        k: 'cp',
        s: 'https://relay.example.com',
        g: 'ocg_test123',
        a: 'access_code_abc',
        rb: 1,
        pv: 2,
        sb: true,
      });
      const result = parseQRPayload(payload);
      expect(result).not.toBeNull();
      expect(result?.mode).toBe('relay');
      expect(result?.relay).toMatchObject({
        serverUrl: 'https://relay.example.com',
        gatewayId: 'ocg_test123',
        accessCode: 'access_code_abc',
        protocolVersion: 2,
        supportsBootstrap: true,
      });
    });

    it('preserves token, password, and display name when present', () => {
      const payload = JSON.stringify({
        v: 2,
        k: 'cp',
        s: 'https://relay.example.com',
        g: 'ocg_test123',
        a: 'access_code_abc',
        rb: 1,
        pv: 2,
        sb: true,
        t: 'token-xyz',
        p: 'password-abc',
        n: 'My Gateway',
      });
      const result = parseQRPayload(payload);
      expect(result?.token).toBe('token-xyz');
      expect(result?.password).toBe('password-abc');
      expect(result?.relay?.displayName).toBe('My Gateway');
    });
  });

  describe('OpenClaw v1 legacy pairing payload', () => {
    // This is the exact shape that older clients produce. A new mobile
    // build must still parse it correctly for users on older CLI versions.
    it('parses the legacy clawket_pair payload', () => {
      const payload = JSON.stringify({
        version: 1,
        kind: 'clawket_pair',
        server: 'https://relay.example.com',
        gatewayId: 'ocg_legacy_abc',
        accessCode: 'legacy_access_code',
      });
      const result = parseQRPayload(payload);
      expect(result).not.toBeNull();
      expect(result?.mode).toBe('relay');
      expect(result?.relay?.serverUrl).toBe('https://relay.example.com');
      expect(result?.relay?.gatewayId).toBe('ocg_legacy_abc');
      expect(result?.relay?.accessCode).toBe('legacy_access_code');
    });

    it('preserves legacy token/password/displayName fields', () => {
      const payload = JSON.stringify({
        version: 1,
        kind: 'clawket_pair',
        server: 'https://relay.example.com',
        gatewayId: 'ocg_legacy_abc',
        accessCode: 'legacy_access_code',
        displayName: 'My Legacy Gateway',
        token: 'legacy_token',
        password: 'legacy_password',
      });
      const result = parseQRPayload(payload);
      expect(result?.token).toBe('legacy_token');
      expect(result?.password).toBe('legacy_password');
      expect(result?.relay?.displayName).toBe('My Legacy Gateway');
    });
  });

  describe('Hermes local v1 payload', () => {
    it('parses a Hermes local bridge QR code', () => {
      const payload = JSON.stringify({
        version: 1,
        kind: 'clawket_hermes_local',
        mode: 'hermes',
        url: 'ws://192.168.1.100:4319/v1/hermes/ws?token=abc',
        expiresAt: Date.now() + 600_000,
        hermes: {
          bridgeUrl: 'http://192.168.1.100:4319',
          displayName: 'Local Hermes',
        },
      });
      const result = parseQRPayload(payload);
      expect(result?.backendKind).toBe('hermes');
      expect(result?.transportKind).toBe('local');
      expect(result?.mode).toBe('hermes');
      expect(result?.hermes?.bridgeUrl).toBe('http://192.168.1.100:4319');
      expect(result?.hermes?.displayName).toBe('Local Hermes');
    });

    it('rejects a Hermes local payload missing bridgeUrl', () => {
      const payload = JSON.stringify({
        version: 1,
        kind: 'clawket_hermes_local',
        mode: 'hermes',
        url: 'ws://192.168.1.100:4319/v1/hermes/ws',
        expiresAt: Date.now() + 600_000,
        hermes: {},
      });
      expect(parseQRPayload(payload)).toBeNull();
    });
  });

  describe('Hermes relay v1 payload', () => {
    it('parses a Hermes relay pairing QR code', () => {
      const payload = JSON.stringify({
        version: 1,
        kind: 'clawket_hermes_pair',
        backend: 'hermes',
        transport: 'relay',
        server: 'https://hermes-relay.example.com',
        bridgeId: 'hbg_test_abc',
        accessCode: 'hermes_access_code',
        relayUrl: 'wss://hermes-relay.example.com/ws',
        displayName: 'My Hermes',
      });
      const result = parseQRPayload(payload);
      expect(result?.backendKind).toBe('hermes');
      expect(result?.transportKind).toBe('relay');
      expect(result?.mode).toBe('hermes');
      expect(result?.relay?.serverUrl).toBe('https://hermes-relay.example.com');
      expect(result?.relay?.gatewayId).toBe('hbg_test_abc');
      expect(result?.relay?.accessCode).toBe('hermes_access_code');
      expect(result?.relay?.displayName).toBe('My Hermes');
    });

    it('rejects a Hermes relay payload missing bridgeId or accessCode', () => {
      const missingBridgeId = JSON.stringify({
        version: 1,
        kind: 'clawket_hermes_pair',
        backend: 'hermes',
        transport: 'relay',
        server: 'https://hermes-relay.example.com',
        accessCode: 'x',
      });
      expect(parseQRPayload(missingBridgeId)).toBeNull();

      const missingAccessCode = JSON.stringify({
        version: 1,
        kind: 'clawket_hermes_pair',
        backend: 'hermes',
        transport: 'relay',
        server: 'https://hermes-relay.example.com',
        bridgeId: 'hbg_x',
      });
      expect(parseQRPayload(missingAccessCode)).toBeNull();
    });
  });

  describe('legacy {host, port, token} gateway payload', () => {
    // This is the very-old direct-gateway format that some users still
    // have printed / saved. Mobile upgrades must still accept it.
    it('parses a legacy host+port+token payload as a custom transport', () => {
      const payload = JSON.stringify({
        host: '192.168.1.50',
        port: 18789,
        token: 'legacy_direct_token',
      });
      const result = parseQRPayload(payload);
      expect(result).not.toBeNull();
      expect(result?.url).toBe('ws://192.168.1.50:18789');
      expect(result?.token).toBe('legacy_direct_token');
    });

    it('parses TLS flag correctly', () => {
      const payload = JSON.stringify({
        host: 'gateway.example.com',
        port: 443,
        token: 'tls_token',
        tls: true,
      });
      const result = parseQRPayload(payload);
      expect(result?.url).toBe('wss://gateway.example.com:443');
    });

    it('defaults port to 18789 when missing', () => {
      const payload = JSON.stringify({
        host: '10.0.0.5',
        password: 'pw',
      });
      const result = parseQRPayload(payload);
      expect(result?.url).toBe('ws://10.0.0.5:18789');
      expect(result?.password).toBe('pw');
    });
  });

  describe('legacy openclaw:// URL scheme', () => {
    it('parses openclaw://connect?host=...&token=... URL form', () => {
      const raw = 'openclaw://connect?host=192.168.1.10&port=18789&token=url_token';
      const result = parseQRPayload(raw);
      expect(result).not.toBeNull();
      expect(result?.url).toBe('ws://192.168.1.10:18789');
      expect(result?.token).toBe('url_token');
    });

    it('supports the url=<direct> form for relay configs', () => {
      const raw = 'openclaw://connect?url=wss://relay.example.com/ws&token=t&mode=relay&serverUrl=https://relay.example.com&gatewayId=ocg_xx';
      const result = parseQRPayload(raw);
      expect(result).not.toBeNull();
      expect(result?.url).toBe('wss://relay.example.com/ws');
      expect(result?.backendKind).toBe('openclaw');
      expect(result?.transportKind).toBe('relay');
      expect(result?.relay?.gatewayId).toBe('ocg_xx');
    });
  });

  describe('expiry and error handling', () => {
    it('rejects a payload whose expiresAt is in the past', () => {
      const payload = JSON.stringify({
        host: '192.168.1.1',
        token: 'x',
        expiresAt: Date.now() - 1,
      });
      expect(parseQRPayload(payload)).toBeNull();
    });

    it('returns null for random garbage instead of throwing', () => {
      expect(parseQRPayload('not-a-qr-code')).toBeNull();
      expect(parseQRPayload('')).toBeNull();
      expect(parseQRPayload('{ invalid json')).toBeNull();
    });

    it('returns null for JSON missing required fields', () => {
      expect(parseQRPayload(JSON.stringify({ v: 2, k: 'cp' }))).toBeNull();
      expect(parseQRPayload(JSON.stringify({ version: 1, kind: 'clawket_pair' }))).toBeNull();
      expect(parseQRPayload(JSON.stringify({ random: 'payload' }))).toBeNull();
    });

    it('returns null for pairing payloads with empty accessCode', () => {
      const payload = JSON.stringify({
        v: 2,
        k: 'cp',
        s: 'https://relay.example.com',
        g: 'ocg_x',
        a: '',
        rb: 1,
        pv: 2,
        sb: true,
      });
      expect(parseQRPayload(payload)).toBeNull();
    });
  });

  describe('cross-version compatibility guarantees', () => {
    // These are the most important tests for the P0 review:
    // a new mobile build parsing OLD CLI outputs, and an OLD mobile build
    // parsing new pairing payloads gracefully (returns null, no crash).

    it('new parser accepts legacy v1 OpenClaw QR from old CLI versions', () => {
      // Minimal v1 payload as produced by historical bridge-cli releases.
      const legacyV1 = JSON.stringify({
        version: 1,
        kind: 'clawket_pair',
        server: 'https://relay.example.com',
        gatewayId: 'ocg_legacy',
        accessCode: 'ac',
      });
      const result = parseQRPayload(legacyV1);
      expect(result?.relay?.gatewayId).toBe('ocg_legacy');
    });

    it('new parser accepts compact v2 OpenClaw QR produced by the current CLI', () => {
      const compactV2 = JSON.stringify({
        v: 2,
        k: 'cp',
        s: 'https://relay.example.com',
        g: 'ocg_new',
        a: 'ac',
        rb: 1,
        pv: 2,
        sb: true,
      });
      const result = parseQRPayload(compactV2);
      expect(result?.relay?.gatewayId).toBe('ocg_new');
    });

    it('Hermes payloads do not trigger OpenClaw parsing paths by accident', () => {
      // A Hermes relay payload has `server`, `bridgeId`, `accessCode`,
      // which overlap with the legacy OpenClaw fields. Make sure the
      // parser dispatches by `kind` first so we never mis-identify a
      // Hermes QR as an OpenClaw relay config.
      const hermesRelay = JSON.stringify({
        version: 1,
        kind: 'clawket_hermes_pair',
        backend: 'hermes',
        transport: 'relay',
        server: 'https://hermes-relay.example.com',
        bridgeId: 'hbg_abc',
        accessCode: 'code',
      });
      const result = parseQRPayload(hermesRelay);
      expect(result?.backendKind).toBe('hermes');
      expect(result?.transportKind).toBe('relay');
    });
  });
});
