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

  describe('secure pairing route', () => {
    const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    it('parses the custom scheme used by the browser fallback button', () => {
      const url = `clawket://pair?server=${encodeURIComponent('https://registry.clawket.ai')}&session=ps_abc123&key=${key}`;
      expect(parseDeepLink(url)).toEqual({ type: 'pair', url });
    });

    it('parses official Universal Links', () => {
      const url = `https://registry.clawket.ai/pair/ps_abc123#k=${key}`;
      expect(parseDeepLink(url)).toEqual({ type: 'pair', url });
    });

    it('does not claim lookalike pairing links', () => {
      expect(parseDeepLink(`https://example.com/pair/ps_abc123#k=${key}`)).toBeNull();
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
