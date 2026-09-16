import { describe, expect, it } from 'vitest';
import { relayNetworkOptions } from './relay-network.js';

describe('Relay network configuration', () => {
  it('keeps direct transport unless the dedicated proxy is configured', () => {
    expect(relayNetworkOptions({ HTTPS_PROXY: 'http://example.com:8888' })).toEqual({ handshakeTimeout: 15000 });
  });
  it('uses an explicit CONNECT agent with bounded socket establishment', () => {
    const options = relayNetworkOptions({ CLAWKET_RELAY_PROXY_URL: 'http://127.0.0.1:7897' });
    expect(options.agent).toBeDefined();
    expect(options.handshakeTimeout).toBe(15000);
  });
  it('rejects invalid configuration without exposing credentials', () => {
    for (const value of ['bad secret', 'socks://user:secret@localhost:1234']) {
      expect(() => relayNetworkOptions({ CLAWKET_RELAY_PROXY_URL: value })).toThrow('CLAWKET_RELAY_PROXY_URL must be an HTTP or HTTPS proxy URL');
    }
  });
});
