import { parseDeepLink } from './deepLinks';

describe('parseDeepLink', () => {
  describe('agent route', () => {
    it('parses agent link with message', () => {
      const result = parseDeepLink('clawket://agent?message=hello');
      expect(result).toEqual({ type: 'agent', message: 'hello', sessionKey: undefined });
    });

    it('parses agent link with message and sessionKey', () => {
      const result = parseDeepLink('clawket://agent?message=hi&sessionKey=key123');
      expect(result).toEqual({ type: 'agent', message: 'hi', sessionKey: 'key123' });
    });

    it('returns null when message is missing', () => {
      expect(parseDeepLink('clawket://agent')).toBeNull();
    });
  });

  describe('session route', () => {
    it('parses session link with key', () => {
      const result = parseDeepLink('clawket://session?key=mySession');
      expect(result).toEqual({ type: 'session', key: 'mySession' });
    });

    it('returns null when key is missing', () => {
      expect(parseDeepLink('clawket://session')).toBeNull();
    });
  });

  describe('config route', () => {
    it('parses config link', () => {
      expect(parseDeepLink('clawket://config')).toEqual({ type: 'config' });
    });
  });

  describe('connect route', () => {
    it('parses connect link with url', () => {
      const result = parseDeepLink('clawket://connect?url=https://example.com');
      expect(result).toEqual({ type: 'connect', url: 'https://example.com', token: undefined });
    });

    it('parses connect link with url and token', () => {
      const result = parseDeepLink('clawket://connect?url=https://example.com&token=abc');
      expect(result).toEqual({ type: 'connect', url: 'https://example.com', token: 'abc' });
    });

    it('parses connect link with url and password', () => {
      const result = parseDeepLink('clawket://connect?url=https://example.com&password=secret');
      expect(result).toEqual({ type: 'connect', url: 'https://example.com', token: undefined, password: 'secret' });
    });

    it('returns null when url is missing', () => {
      expect(parseDeepLink('clawket://connect')).toBeNull();
    });
  });

  describe('hermes-pair route (AirDrop / share-sheet)', () => {
    it('parses a JSON payload deep link', () => {
      const payload = encodeURIComponent(JSON.stringify({
        version: 1,
        kind: 'clawket_hermes_local',
        mode: 'hermes',
        transport: 'tailscale',
        url: 'ws://100.64.1.2:4319/v1/hermes/ws?token=abc',
        hermes: { bridgeUrl: 'http://100.64.1.2:4319', displayName: 'Studio' },
      }));
      const result = parseDeepLink(`clawket://hermes-pair?payload=${payload}`);
      expect(result).toEqual({
        type: 'hermes-pair',
        url: 'ws://100.64.1.2:4319/v1/hermes/ws?token=abc',
        bridgeUrl: 'http://100.64.1.2:4319',
        transportKind: 'tailscale',
        displayName: 'Studio',
      });
    });

    it('parses explicit query params', () => {
      const result = parseDeepLink(
        'clawket://hermes-pair?url=ws%3A%2F%2F192.168.1.5%3A4319%2Fv1%2Fhermes%2Fws&bridgeUrl=http%3A%2F%2F192.168.1.5%3A4319&transport=bonjour&displayName=LAN',
      );
      expect(result).toEqual({
        type: 'hermes-pair',
        url: 'ws://192.168.1.5:4319/v1/hermes/ws',
        bridgeUrl: 'http://192.168.1.5:4319',
        transportKind: 'bonjour',
        displayName: 'LAN',
      });
    });
  });

  describe('edge cases', () => {
    it('returns null for invalid URL', () => {
      expect(parseDeepLink('not a url')).toBeNull();
    });

    it('returns null for non-clawket protocol', () => {
      expect(parseDeepLink('https://example.com/agent?message=hi')).toBeNull();
    });

    it('returns null for unknown route', () => {
      expect(parseDeepLink('clawket://unknown')).toBeNull();
    });

    it('handles encoded parameters', () => {
      const result = parseDeepLink('clawket://agent?message=hello%20world');
      expect(result).toEqual({ type: 'agent', message: 'hello world', sessionKey: undefined });
    });
  });
});
