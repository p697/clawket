import { HermesRelayPairingService } from './hermes-relay-pairing';

describe('HermesRelayPairingService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('claims a Hermes relay pairing from websocket-style server urls', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      bridgeId: 'hbg_123',
      relayUrl: 'wss://hermes-relay.example.com/ws',
      clientToken: 'hct_123',
      displayName: 'Hermes Mac',
      region: 'us',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as jest.Mock;

    const result = await HermesRelayPairingService.claim({
      serverUrl: 'wss://hermes-registry.example.com/',
      bridgeId: 'hbg_123',
      accessCode: 'ABCD23',
      clientLabel: 'Lucy iPhone',
    });

    expect(global.fetch).toHaveBeenCalledWith('https://hermes-registry.example.com/v1/hermes/pair/claim', expect.objectContaining({
      method: 'POST',
    }));
    expect(result).toEqual({
      bridgeId: 'hbg_123',
      relayUrl: 'wss://hermes-relay.example.com/ws',
      clientToken: 'hct_123',
      displayName: 'Hermes Mac',
      region: 'us',
    });
  });

  it('maps expired access codes to a user-friendly error', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'ACCESS_CODE_EXPIRED',
        message: 'expired',
      },
    }), {
      status: 410,
      headers: { 'content-type': 'application/json' },
    })) as jest.Mock;

    await expect(HermesRelayPairingService.claim({
      serverUrl: 'https://hermes-registry.example.com',
      bridgeId: 'hbg_123',
      accessCode: 'ABCD23',
    })).rejects.toThrow('This Hermes Relay QR code has expired. Generate a new QR code in Clawket Bridge and try again.');
  });
});
