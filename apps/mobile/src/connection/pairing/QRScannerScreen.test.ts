import { parseQRPayload } from './qrPayload';

describe('parseQRPayload', () => {
  it('parses JSON payload with relay metadata', () => {
    const raw = JSON.stringify({
      host: '192.168.31.39',
      port: 18789,
      token: 'abc',
      mode: 'local',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway-device-id',
      },
    });

    expect(parseQRPayload(raw)).toEqual({
      url: 'ws://192.168.31.39:18789',
      token: 'abc',
      transportKind: 'local',
      mode: 'local',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway-device-id',
      },
    });
  });

  it('parses openclaw URL payload with relay query params', () => {
    const raw = 'openclaw://connect?host=10.0.0.8&port=18789&token=xyz&tls=1&mode=relay&serverUrl=https%3A%2F%2Fregistry.example.com&gatewayId=device-123';

    expect(parseQRPayload(raw)).toEqual({
      url: 'wss://10.0.0.8:18789',
      backendKind: 'openclaw',
      transportKind: 'relay',
      token: 'xyz',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'device-123',
      },
    });
  });

  it('parses JSON payload with direct url field', () => {
    const raw = JSON.stringify({
      url: 'wss://relay-fallback.example.com/ws',
      token: 'token_pro',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry-fallback.example.com',
        gatewayId: 'home-mac-1',
      },
    });

    expect(parseQRPayload(raw)).toEqual({
      url: 'wss://relay-fallback.example.com/ws',
      token: 'token_pro',
      transportKind: 'relay',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry-fallback.example.com',
        gatewayId: 'home-mac-1',
      },
    });
  });

  it('parses openclaw URL payload with url query param', () => {
    const raw = 'openclaw://connect?url=wss%3A%2F%2Frelay-fallback.example.com%2Fws&token=token_pro&mode=relay&serverUrl=https%3A%2F%2Fregistry-fallback.example.com&gatewayId=home-mac-1';

    expect(parseQRPayload(raw)).toEqual({
      url: 'wss://relay-fallback.example.com/ws',
      backendKind: 'openclaw',
      transportKind: 'relay',
      token: 'token_pro',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry-fallback.example.com',
        gatewayId: 'home-mac-1',
      },
    });
  });

  it('parses clawket pair QR payload', () => {
    const raw = JSON.stringify({
      v: 2,
      k: 'cp',
      s: 'https://registry.example.com',
      g: 'gateway_123',
      a: 'AB7K9Q',
      n: 'Lucy Mac',
    });

    expect(parseQRPayload(raw)).toEqual({
      url: '',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway_123',
        accessCode: 'AB7K9Q',
        displayName: 'Lucy Mac',
      },
    });
  });

  it('parses a new-format clawket pair QR without legacy credentials and keeps relay bootstrap metadata', () => {
    const raw = JSON.stringify({
      v: 2,
      k: 'cp',
      s: 'https://registry.example.com',
      g: 'gateway_123',
      a: '123456',
      n: 'Lucy Mac',
      pv: 2,
      sb: true,
    });

    expect(parseQRPayload(raw)).toEqual({
      url: '',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway_123',
        accessCode: '123456',
        displayName: 'Lucy Mac',
        protocolVersion: 2,
        supportsBootstrap: true,
      },
    });
  });

  it('parses clawket pair QR payload with gateway auth token', () => {
    const raw = JSON.stringify({
      v: 2,
      k: 'cp',
      s: 'https://registry.example.com',
      g: 'gateway_123',
      a: '123456',
      n: 'Lucy Mac',
      t: 'gateway-token',
    });

    expect(parseQRPayload(raw)).toEqual({
      url: '',
      token: 'gateway-token',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway_123',
        accessCode: '123456',
        displayName: 'Lucy Mac',
      },
    });
  });

  it('parses clawket pair QR payload with gateway password', () => {
    const raw = JSON.stringify({
      v: 2,
      k: 'cp',
      s: 'https://registry.example.com',
      g: 'gateway_123',
      a: '123456',
      n: 'Lucy Mac',
      p: 'gateway-password',
    });

    expect(parseQRPayload(raw)).toEqual({
      url: '',
      password: 'gateway-password',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway_123',
        accessCode: '123456',
        displayName: 'Lucy Mac',
      },
    });
  });

  it('parses relay bootstrap capability flags from QR payload', () => {
    const raw = JSON.stringify({
      url: 'wss://relay.example.com/ws',
      token: 'gateway-token',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway_123',
        protocolVersion: 2,
        supportsBootstrap: true,
      },
    });

    expect(parseQRPayload(raw)).toEqual({
      url: 'wss://relay.example.com/ws',
      token: 'gateway-token',
      transportKind: 'relay',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway_123',
        protocolVersion: 2,
        supportsBootstrap: true,
      },
    });
  });

  it('parses direct JSON payload with password auth', () => {
    const raw = JSON.stringify({
      url: 'wss://gateway.example.com/ws',
      password: 'pw-secret',
      mode: 'custom',
    });

    expect(parseQRPayload(raw)).toEqual({
      url: 'wss://gateway.example.com/ws',
      password: 'pw-secret',
      transportKind: 'custom',
      mode: 'custom',
    });
  });

  it('parses hermes local bridge QR payload', () => {
    const raw = JSON.stringify({
      version: 1,
      kind: 'clawket_hermes_local',
      mode: 'hermes',
      url: 'ws://192.168.1.8:4319/v1/hermes/ws?token=secret',
      expiresAt: Date.now() + 60_000,
      hermes: {
        bridgeUrl: 'http://192.168.1.8:4319',
        displayName: 'Hermes',
      },
    });

    expect(parseQRPayload(raw)).toEqual({
      url: 'ws://192.168.1.8:4319/v1/hermes/ws?token=secret',
      backendKind: 'hermes',
      transportKind: 'local',
      mode: 'hermes',
      hermes: {
        bridgeUrl: 'http://192.168.1.8:4319',
        displayName: 'Hermes',
      },
    });
  });

  it('parses hermes relay pairing QR payload', () => {
    const raw = JSON.stringify({
      version: 1,
      kind: 'clawket_hermes_pair',
      backend: 'hermes',
      transport: 'relay',
      server: 'https://hermes-registry.example.com',
      bridgeId: 'hbg_123',
      accessCode: 'ABCD23',
      relayUrl: 'wss://hermes-relay.example.com/ws',
      displayName: 'Hermes Mac',
    });

    expect(parseQRPayload(raw)).toEqual({
      url: 'wss://hermes-relay.example.com/ws',
      backendKind: 'hermes',
      transportKind: 'relay',
      mode: 'hermes',
      relay: {
        serverUrl: 'https://hermes-registry.example.com',
        gatewayId: 'hbg_123',
        accessCode: 'ABCD23',
        relayUrl: 'wss://hermes-relay.example.com/ws',
        displayName: 'Hermes Mac',
      },
    });
  });

  it('still parses legacy clawket pair QR payload', () => {
    const raw = JSON.stringify({
      version: 1,
      kind: 'clawket_pair',
      server: 'https://registry.example.com',
      gatewayId: 'gateway_123',
      accessCode: 'AB7K9Q',
      relayUrl: 'wss://relay-us.example.com/ws',
      displayName: 'Lucy Mac',
    });

    expect(parseQRPayload(raw)).toEqual({
      url: 'wss://relay-us.example.com/ws',
      token: undefined,
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway_123',
        accessCode: 'AB7K9Q',
        relayUrl: 'wss://relay-us.example.com/ws',
        displayName: 'Lucy Mac',
      },
    });
  });

  it('still parses legacy clawket pair QR payloads with gateway auth credentials', () => {
    const raw = JSON.stringify({
      version: 1,
      kind: 'clawket_pair',
      server: 'https://registry.example.com',
      gatewayId: 'gateway_123',
      accessCode: '123456',
      relayUrl: 'wss://relay-us.example.com/ws',
      displayName: 'Lucy Mac',
      token: 'legacy-token',
      password: 'legacy-password',
    });

    expect(parseQRPayload(raw)).toEqual({
      url: 'wss://relay-us.example.com/ws',
      token: 'legacy-token',
      password: 'legacy-password',
      mode: 'relay',
      relay: {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway_123',
        accessCode: '123456',
        relayUrl: 'wss://relay-us.example.com/ws',
        displayName: 'Lucy Mac',
      },
    });
  });
});
