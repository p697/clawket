import {
  buildRelayClaimKey,
  isUnsupportedDirectLocalTlsConfig,
  shouldSuppressDuplicatePairingAlert,
} from './connection-form-utils';

describe('gatewayConfigForm utils', () => {
  it('builds a stable relay claim key', () => {
    expect(buildRelayClaimKey(' https://registry.example.com ', ' gw_123 ', ' 123456 ')).toBe(
      'https://registry.example.com::gw_123::123456',
    );
  });

  it('suppresses only duplicate pairing alerts inside the cooldown window', () => {
    expect(shouldSuppressDuplicatePairingAlert(null, 0, 'Pairing failed', 1000)).toBe(false);
    expect(shouldSuppressDuplicatePairingAlert('Pairing failed', 1000, 'Pairing failed', 2000)).toBe(true);
    expect(shouldSuppressDuplicatePairingAlert('Pairing failed', 1000, 'Pairing failed', 2600)).toBe(false);
    expect(shouldSuppressDuplicatePairingAlert('Old error', 1000, 'New error', 1500)).toBe(false);
  });

  it('detects unsupported direct local TLS URLs', () => {
    expect(isUnsupportedDirectLocalTlsConfig({ url: 'wss://192.168.1.8:18789' })).toBe(true);
    expect(isUnsupportedDirectLocalTlsConfig({ url: 'wss://gateway.local:18789' })).toBe(true);
    expect(isUnsupportedDirectLocalTlsConfig({ url: 'wss://gateway.example.com' })).toBe(false);
    expect(isUnsupportedDirectLocalTlsConfig({ url: 'ws://192.168.1.8:18789' })).toBe(false);
    expect(isUnsupportedDirectLocalTlsConfig({ url: 'wss://192.168.1.8:18789', hasRelayConfig: true })).toBe(false);
  });
});
