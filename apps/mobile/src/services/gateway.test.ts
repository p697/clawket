import { extractText, GatewayClient } from './gateway';
import type { ConnectChallengePayload } from '../types';
import { RELAY_CONTROL_PREFIX } from './gateway-relay';

// Mock tweetnacl
jest.mock('tweetnacl', () => ({
  sign: {
    keyPair: jest.fn(() => ({
      publicKey: new Uint8Array(32).fill(1),
      secretKey: new Uint8Array(64).fill(2),
    })),
    detached: jest.fn(() => new Uint8Array(64).fill(3)),
  },
}));

// Mock js-sha256
jest.mock('js-sha256', () => ({
  sha256: jest.fn(() => 'a'.repeat(64)),
}));

// Mock StorageService
jest.mock('./storage', () => ({
  StorageService: {
    getIdentity: jest.fn(() => Promise.resolve(null)),
    setIdentity: jest.fn(() => Promise.resolve()),
    clearIdentity: jest.fn(() => Promise.resolve()),
    setDeviceToken: jest.fn(() => Promise.resolve()),
    getDeviceToken: jest.fn(() => Promise.resolve(null)),
    deleteDeviceToken: jest.fn(() => Promise.resolve()),
    getGatewayConfig: jest.fn(() => Promise.resolve(null)),
    setGatewayConfig: jest.fn(() => Promise.resolve()),
  },
}));

// MockWebSocket
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;
  OPEN = 1;
  CONNECTING = 0;
  CLOSING = 2;
  CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = jest.fn();
  close = jest.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  });
}

// Assign MockWebSocket to globalThis
(globalThis as any).WebSocket = MockWebSocket;

// ---- extractText tests ----

describe('extractText', () => {
  it('returns empty string for undefined message', () => {
    expect(extractText(undefined)).toBe('');
  });

  it('returns empty string for message with no content', () => {
    expect(extractText({ role: 'assistant' })).toBe('');
  });

  it('returns empty string for message with empty string content', () => {
    expect(extractText({ role: 'assistant', content: '' })).toBe('');
  });

  it('returns string content directly', () => {
    expect(extractText({ role: 'assistant', content: 'hello world' })).toBe('hello world');
  });

  it('extracts text blocks from array content', () => {
    expect(
      extractText({
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello ' },
          { type: 'text', text: 'world' },
        ],
      }),
    ).toBe('hello world');
  });

  it('filters out non-text blocks (e.g. thinking)', () => {
    expect(
      extractText({
        role: 'assistant',
        content: [
          { type: 'thinking', text: 'hmm' },
          { type: 'text', text: 'answer' },
          { type: 'tool_use' },
        ],
      }),
    ).toBe('answer');
  });

  it('handles text blocks with missing text field', () => {
    expect(
      extractText({
        role: 'assistant',
        content: [{ type: 'text' }, { type: 'text', text: 'ok' }],
      }),
    ).toBe('ok');
  });

  it('returns empty string for array content with no text blocks', () => {
    expect(
      extractText({
        role: 'assistant',
        content: [{ type: 'tool_use' }],
      }),
    ).toBe('');
  });

  it('works with message without role', () => {
    expect(extractText({ content: 'no role' })).toBe('no role');
  });
});

// ---- GatewayClient tests ----

describe('GatewayClient', () => {
  let client: GatewayClient;
  let createdWs: MockWebSocket;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    client = new GatewayClient();
    (globalThis as { fetch?: unknown }).fetch = jest.fn();

    // Capture the WebSocket instance created during connect()
    (globalThis as any).WebSocket = jest.fn(() => {
      createdWs = new MockWebSocket();
      return createdWs;
    }) as any;
    // Keep static constants available
    (globalThis as any).WebSocket.OPEN = MockWebSocket.OPEN;
    (globalThis as any).WebSocket.CONNECTING = MockWebSocket.CONNECTING;
    (globalThis as any).WebSocket.CLOSING = MockWebSocket.CLOSING;
    (globalThis as any).WebSocket.CLOSED = MockWebSocket.CLOSED;
  });

  function decodeLatestSignedPayload(): string {
    const nacl = jest.requireMock('tweetnacl') as {
      sign: { detached: jest.Mock };
    };
    const latestCall = nacl.sign.detached.mock.calls.at(-1);
    if (!latestCall) {
      throw new Error('Expected a signature call');
    }
    return Buffer.from(latestCall[0] as Uint8Array).toString('utf8');
  }

  async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  function mockDeviceIdentity(): void {
    jest.spyOn(client as unknown as { ensureIdentity: () => Promise<{
      deviceId: string;
      publicKeyHex: string;
      secretKeyHex: string;
    }> }, 'ensureIdentity').mockResolvedValue({
      deviceId: 'a'.repeat(64),
      publicKeyHex: '01'.repeat(32),
      secretKeyHex: '02'.repeat(64),
    });
  }

  afterEach(() => {
    client.disconnect();
    jest.clearAllTimers();
    jest.useRealTimers();
    logSpy.mockRestore();
    jest.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts in idle state', () => {
      expect(client.getConnectionState()).toBe('idle');
    });
  });

  describe('configure', () => {
    it('accepts a config object', () => {
      client.configure({ url: 'wss://example.com', token: 'abc' });
      // No error thrown; state remains idle
      expect(client.getConnectionState()).toBe('idle');
    });

    it('accepts null config', () => {
      client.configure(null);
      expect(client.getConnectionState()).toBe('idle');
    });
  });

  describe('session mutations', () => {
    it('patches a session label', async () => {
      const sendRequestSpy = jest.spyOn(client as any, 'sendRequest').mockResolvedValue({ ok: true, key: 'session:1' });

      await expect(client.patchSession('session:1', { label: 'Renamed' })).resolves.toEqual({ ok: true, key: 'session:1' });
      expect(sendRequestSpy).toHaveBeenCalledWith('sessions.patch', { key: 'session:1', label: 'Renamed' });
    });

    it('resets a session', async () => {
      const sendRequestSpy = jest.spyOn(client as any, 'sendRequest').mockResolvedValue({ ok: true, key: 'session:1' });

      await expect(client.resetSession('session:1')).resolves.toEqual({ ok: true, key: 'session:1' });
      expect(sendRequestSpy).toHaveBeenCalledWith('sessions.reset', { key: 'session:1', reason: 'reset' });
    });

    it('deletes a session', async () => {
      const sendRequestSpy = jest.spyOn(client as any, 'sendRequest').mockResolvedValue({ ok: true, key: 'session:1' });

      await expect(client.deleteSession('session:1', { deleteTranscript: false })).resolves.toEqual({ ok: true, key: 'session:1' });
      expect(sendRequestSpy).toHaveBeenCalledWith('sessions.delete', { key: 'session:1', deleteTranscript: false });
    });
  });

  describe('event system (on/off)', () => {
    it('registers and calls a listener', () => {
      const listener = jest.fn();
      client.on('error', listener);

      // Trigger an error by connecting without config
      client.connect();

      expect(listener).toHaveBeenCalledWith({
        code: 'config_missing',
        message: 'Gateway URL is not configured',
      });
    });

    it('unsubscribes via returned function', () => {
      const listener = jest.fn();
      const unsub = client.on('error', listener);
      unsub();

      client.connect();
      expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple listeners on the same event', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      client.on('error', listener1);
      client.on('error', listener2);

      client.connect();
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  describe('connect', () => {
    it('emits error when no config URL set', () => {
      const errorListener = jest.fn();
      client.on('error', errorListener);
      client.connect();
      expect(errorListener).toHaveBeenCalledWith({
        code: 'config_missing',
        message: 'Gateway URL is not configured',
      });
    });

    it('transitions to connecting state on connect', () => {
      const states: string[] = [];
      client.on('connection', (e) => states.push(e.state));
      client.configure({ url: 'wss://example.com' });
      client.connect();

      expect(states).toContain('connecting');
    });

    it('transitions to challenging state on ws open', () => {
      const states: string[] = [];
      client.on('connection', (e) => states.push(e.state));
      client.configure({ url: 'wss://example.com' });
      client.connect();

      // Simulate ws open
      createdWs.onopen!();
      expect(states).toContain('challenging');
    });

    it('transitions Hermes connections directly to ready on ws open', () => {
      const states: string[] = [];
      client.on('connection', (e) => states.push(e.state));
      client.configure({
        url: 'ws://127.0.0.1:4319/v1/hermes/ws',
        backendKind: 'hermes',
        mode: 'hermes',
      });
      client.connect();

      createdWs.onopen!();
      expect(states).toContain('ready');
      expect(states).not.toContain('challenging');
    });

    it('keeps current connect attempt valid when connect is called repeatedly during connecting', () => {
      const states: string[] = [];
      client.on('connection', (e) => states.push(e.state));
      client.configure({ url: 'wss://example.com' });
      client.connect();
      client.connect();

      // The original socket open callback must still be accepted.
      createdWs.onopen!();
      expect(states).toContain('challenging');
    });

    it('normalizes http URL to ws', () => {
      client.configure({ url: 'http://localhost:3000' });
      client.connect();
      expect((globalThis as any).WebSocket).toHaveBeenCalledWith('ws://localhost:3000');
    });

    it('normalizes https URL to wss', () => {
      client.configure({ url: 'https://example.com' });
      client.connect();
      expect((globalThis as any).WebSocket).toHaveBeenCalledWith('wss://example.com');
    });

    it('adds wss:// to bare hostname', () => {
      client.configure({ url: 'example.com' });
      client.connect();
      expect((globalThis as any).WebSocket).toHaveBeenCalledWith('wss://example.com');
    });

    it('keeps wss:// URL unchanged', () => {
      client.configure({ url: 'wss://example.com' });
      client.connect();
      expect((globalThis as any).WebSocket).toHaveBeenCalledWith('wss://example.com');
    });

    it('blocks direct local wss connections before opening a socket', () => {
      const errorListener = jest.fn();
      const states: string[] = [];
      client.on('error', errorListener);
      client.on('connection', (event) => states.push(event.state));

      client.configure({ url: 'wss://192.168.1.8:18789' });
      client.connect();

      expect((globalThis as any).WebSocket).not.toHaveBeenCalled();
      expect(errorListener).toHaveBeenCalledWith({
        code: 'local_tls_unsupported',
        message: 'Clawket mobile does not currently support direct local TLS gateway connections. Disable OpenClaw gateway TLS for LAN pairing, or use Relay/Tailscale instead.',
        retryable: false,
        hint: 'If you are connecting over your local network, set gateway.tls.enabled to false before pairing.',
      });
      expect(states).toContain('closed');
    });

    it('still allows public wss connections', () => {
      client.configure({ url: 'wss://gateway.example.com' });
      client.connect();
      expect((globalThis as any).WebSocket).toHaveBeenCalledWith('wss://gateway.example.com');
    });

    it('does not use relay pairing state while mode is local', async () => {
      jest.useRealTimers();
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getIdentity: jest.Mock; getDeviceToken: jest.Mock };
      };
      StorageService.getIdentity.mockResolvedValue({
        deviceId: 'a'.repeat(64),
        publicKeyHex: 'ab',
        secretKeyHex: 'cd',
        createdAt: new Date().toISOString(),
      });
      StorageService.getDeviceToken.mockResolvedValue('device-token-123');
      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ relayUrl: 'wss://relay-us.clawket.ai' }),
      });

      client.configure({
        url: 'ws://192.168.1.10:18789',
        mode: 'local',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-1',
        },
      });
      client.connect();

      createdWs.close();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('uses relay fast path in relay mode with configured relay credentials', async () => {
      jest.useRealTimers();
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getIdentity: jest.Mock };
      };
      StorageService.getIdentity.mockResolvedValue(null);

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        token: 'gateway-auth-token',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
        },
      });
      client.connect();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(1);
      const relayUrl = ((globalThis as any).WebSocket as jest.Mock).mock.calls[0][0] as string;
      const parsed = new URL(relayUrl);
      expect(parsed.origin).toBe('wss://relay-us.example.com');
      expect(parsed.pathname).toBe('/ws');
      expect(parsed.searchParams.get('gatewayId')).toBe('gateway-device-relay');
      expect(parsed.searchParams.get('role')).toBe('client');
      expect(parsed.searchParams.get('clientId')).toBe('a'.repeat(64));
      expect(parsed.searchParams.get('token')).toBe('relay-access-token');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('uses bridgeId instead of gatewayId for Hermes relay fast-path connections', async () => {
      mockDeviceIdentity();
      client.configure({
        url: 'wss://relay-hermes.example.com/ws',
        mode: 'hermes',
        backendKind: 'hermes',
        transportKind: 'relay',
        relay: {
          serverUrl: 'https://hermes-registry.example.com',
          gatewayId: 'hbg_123',
          clientToken: 'hct_secret',
        },
      });
      client.connect();
      await flushPromises();

      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(1);
      const relayUrl = ((globalThis as any).WebSocket as jest.Mock).mock.calls[0][0] as string;
      const parsed = new URL(relayUrl);
      expect(parsed.searchParams.get('bridgeId')).toBe('hbg_123');
      expect(parsed.searchParams.get('gatewayId')).toBeNull();
      expect(parsed.searchParams.get('token')).toBe('hct_secret');
    });

    it('does not start duplicate relay fast-path connections while bootstrap is in flight', async () => {
      (globalThis.fetch as jest.Mock).mockReturnValue(new Promise(() => {}));
      const fastPathSpy = jest.spyOn(client as any, 'tryConnectRelayFastPath');

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        token: 'gateway-auth-token',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
        },
      });

      client.connect();
      client.connect();
      await Promise.resolve();
      await Promise.resolve();

      expect(fastPathSpy).toHaveBeenCalledTimes(1);
      expect((globalThis.fetch as jest.Mock).mock.calls.length).toBeLessThanOrEqual(1);
      expect(((globalThis as any).WebSocket as jest.Mock).mock.calls.length).toBeLessThanOrEqual(1);
    });

    it('forces reconnect when relay bootstrap hangs before fast path opens socket', async () => {
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getIdentity: jest.Mock };
      };
      StorageService.getIdentity.mockReturnValue(new Promise(() => {}));
      const errorListener = jest.fn();
      client.on('error', errorListener);

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        token: 'gateway-auth-token',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
        },
      });

      client.connect();
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(12_100);
      await Promise.resolve();
      await Promise.resolve();

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'relay_bootstrap_timeout' }),
      );
    });

    it('still times out bootstrap after a skipped duplicate connect before socket open', async () => {
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getIdentity: jest.Mock };
      };
      StorageService.getIdentity.mockReturnValue(new Promise(() => {}));
      const errorListener = jest.fn();
      client.on('error', errorListener);

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        token: 'gateway-auth-token',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
        },
      });

      client.connect();
      client.connect();
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(12_100);
      await Promise.resolve();
      await Promise.resolve();

      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'relay_bootstrap_timeout' }),
      );
    });

  it('blocks relay mode when client token is missing', async () => {
      jest.useRealTimers();
      const errorListener = jest.fn();
      client.on('error', errorListener);

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        token: 'gateway-auth-token',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-relay',
        },
      });
      client.connect();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect((globalThis as any).WebSocket).not.toHaveBeenCalled();
      expect(errorListener).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'relay_config_invalid',
          message: 'Relay connection is incomplete.',
        }),
      );
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('transitions to closed state', () => {
      const states: string[] = [];
      client.on('connection', (e) => states.push(e.state));
      client.configure({ url: 'wss://example.com' });
      client.connect();
      client.disconnect();

      expect(states).toContain('closed');
      expect(client.getConnectionState()).toBe('closed');
    });
  });

  describe('reconnect', () => {
    it('restarts an existing socket connection', () => {
      client.configure({ url: 'wss://example.com' });
      client.connect();
      const firstWs = createdWs;
      firstWs.readyState = MockWebSocket.OPEN;
      (client as unknown as { state: string }).state = 'ready';

      client.reconnect();

      expect(firstWs.close).toHaveBeenCalled();
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(2);
      expect(client.getConnectionState()).toBe('connecting');
    });

    it('does not restart while a handshake is already in progress', () => {
      client.configure({ url: 'wss://example.com' });
      client.connect();
      const firstWs = createdWs;
      firstWs.readyState = MockWebSocket.OPEN;
      firstWs.onopen!();

      client.reconnect();

      expect(firstWs.close).not.toHaveBeenCalled();
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(1);
      expect(client.getConnectionState()).toBe('challenging');
    });

    it('emits config error when reconnect is called without URL', () => {
      const errorListener = jest.fn();
      client.on('error', errorListener);

      client.reconnect();

      expect(errorListener).toHaveBeenCalledWith({
        code: 'config_missing',
        message: 'Gateway URL is not configured',
      });
    });
  });

  describe('getBaseUrl', () => {
    it('returns null when no config', () => {
      expect(client.getBaseUrl()).toBeNull();
    });

    it('converts wss to https', () => {
      client.configure({ url: 'wss://example.com/' });
      expect(client.getBaseUrl()).toBe('https://example.com');
    });

    it('converts ws to http', () => {
      client.configure({ url: 'ws://localhost:3000/' });
      expect(client.getBaseUrl()).toBe('http://localhost:3000');
    });

    it('strips the websocket path suffix used by relay endpoints', () => {
      client.configure({ url: 'wss://relay.example.com/ws' });
      expect(client.getBaseUrl()).toBe('https://relay.example.com');
    });

    it('strips the Hermes websocket mount path', () => {
      client.configure({
        url: 'ws://127.0.0.1:4319/v1/hermes/ws',
        backendKind: 'hermes',
        mode: 'hermes',
      });
      expect(client.getBaseUrl()).toBe('http://127.0.0.1:4319');
    });
  });

  describe('handleChatEvent via WebSocket message', () => {
    beforeEach(() => {
      client.configure({ url: 'wss://example.com' });
      client.connect();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();
    });

    function simulateEvent(event: string, payload: unknown) {
      const frame = JSON.stringify({ type: 'event', event, payload });
      createdWs.onmessage!({ data: frame });
    }

    it('emits chatDelta on chat delta event with text', () => {
      const listener = jest.fn();
      client.on('chatDelta', listener);

      simulateEvent('chat', {
        runId: 'r1',
        sessionKey: 's1',
        seq: 1,
        state: 'delta',
        message: { role: 'assistant', content: 'hello' },
      });

      expect(listener).toHaveBeenCalledWith({
        runId: 'r1',
        sessionKey: 's1',
        text: 'hello',
      });
    });

    it('does not emit chatDelta when delta has no text', () => {
      const listener = jest.fn();
      client.on('chatDelta', listener);

      simulateEvent('chat', {
        runId: 'r1',
        sessionKey: 's1',
        seq: 1,
        state: 'delta',
        message: { role: 'assistant', content: [{ type: 'tool_use' }] },
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('does not emit chatDelta for silent NO_REPLY lead fragments', () => {
      const listener = jest.fn();
      client.on('chatDelta', listener);

      simulateEvent('chat', {
        runId: 'r1',
        sessionKey: 's1',
        seq: 1,
        state: 'delta',
        message: { role: 'assistant', content: 'NO ' },
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('emits chatFinal on chat final event', () => {
      const listener = jest.fn();
      client.on('chatFinal', listener);

      simulateEvent('chat', {
        runId: 'r1',
        sessionKey: 's1',
        seq: 2,
        state: 'final',
        message: { role: 'assistant', content: 'done' },
        usage: { input: 10, output: 20 },
      });

      expect(listener).toHaveBeenCalledWith({
        runId: 'r1',
        sessionKey: 's1',
        message: { role: 'assistant', content: 'done' },
        usage: { input: 10, output: 20 },
      });
    });

    it('invalidates cached session metadata after a final chat event', async () => {
      const sendRequestSpy = jest
        .spyOn(client as unknown as { sendRequest: (method: string, params?: object) => Promise<unknown> }, 'sendRequest')
        .mockResolvedValueOnce({
          sessions: [{ key: 's1', contextTokens: 1000 }],
        })
        .mockResolvedValueOnce({
          sessions: [{ key: 's1', contextTokens: 2000 }],
        });

      await expect(client.listSessions()).resolves.toEqual([{ key: 's1', contextTokens: 1000 }]);

      simulateEvent('chat', {
        runId: 'r1',
        sessionKey: 's1',
        seq: 2,
        state: 'final',
        message: { role: 'assistant', content: 'done' },
      });

      await expect(client.listSessions()).resolves.toEqual([{ key: 's1', contextTokens: 2000 }]);
      expect(sendRequestSpy).toHaveBeenCalledTimes(2);
    });

    it('emits chatAborted on chat aborted event', () => {
      const listener = jest.fn();
      client.on('chatAborted', listener);

      simulateEvent('chat', {
        runId: 'r1',
        sessionKey: 's1',
        seq: 3,
        state: 'aborted',
      });

      expect(listener).toHaveBeenCalledWith({
        runId: 'r1',
        sessionKey: 's1',
      });
    });

    it('emits chatError on chat error event', () => {
      const listener = jest.fn();
      client.on('chatError', listener);

      simulateEvent('chat', {
        runId: 'r1',
        sessionKey: 's1',
        seq: 4,
        state: 'error',
        errorMessage: 'something broke',
      });

      expect(listener).toHaveBeenCalledWith({
        runId: 'r1',
        sessionKey: 's1',
        message: 'something broke',
      });
    });

    it('uses default error message when errorMessage is missing', () => {
      const listener = jest.fn();
      client.on('chatError', listener);

      simulateEvent('chat', {
        runId: 'r1',
        sessionKey: 's1',
        seq: 4,
        state: 'error',
      });

      expect(listener).toHaveBeenCalledWith({
        runId: 'r1',
        sessionKey: 's1',
        message: 'Stream error',
      });
    });
  });

  describe('handleAgentEvent via WebSocket message', () => {
    beforeEach(() => {
      client.configure({ url: 'wss://example.com' });
      client.connect();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();
    });

    function simulateEvent(event: string, payload: unknown) {
      const frame = JSON.stringify({ type: 'event', event, payload });
      createdWs.onmessage!({ data: frame });
    }

    it('emits chatCompaction on compaction start event', () => {
      const listener = jest.fn();
      client.on('chatCompaction', listener);

      simulateEvent('agent', {
        runId: 'r1',
        sessionKey: 's1',
        stream: 'compaction',
        data: { phase: 'start' },
      });

      expect(listener).toHaveBeenCalledWith({
        runId: 'r1',
        sessionKey: 's1',
        phase: 'start',
      });
    });

    it('emits chatCompaction on compaction end event', () => {
      const listener = jest.fn();
      client.on('chatCompaction', listener);

      simulateEvent('agent', {
        runId: 'r1',
        sessionKey: 's1',
        stream: 'compaction',
        data: { phase: 'end' },
      });

      expect(listener).toHaveBeenCalledWith({
        runId: 'r1',
        sessionKey: 's1',
        phase: 'end',
      });
    });

    it('emits chatRunStart on lifecycle start event', () => {
      const listener = jest.fn();
      client.on('chatRunStart', listener);

      simulateEvent('agent', {
        runId: 'r1',
        sessionKey: 's1',
        stream: 'lifecycle',
        data: { phase: 'start' },
      });

      expect(listener).toHaveBeenCalledWith({
        runId: 'r1',
        sessionKey: 's1',
      });
    });

    it('emits chatTool on tool start event', () => {
      const listener = jest.fn();
      client.on('chatTool', listener);

      simulateEvent('agent', {
        runId: 'r1',
        sessionKey: 's1',
        stream: 'tool',
        data: {
          phase: 'start',
          toolCallId: 'tc1',
          name: 'bash',
          args: { command: 'ls' },
        },
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'r1',
          sessionKey: 's1',
          toolCallId: 'tc1',
          name: 'bash',
          phase: 'start',
          args: { command: 'ls' },
          status: 'running',
        }),
      );
    });

    it('emits chatTool on tool result event with success', () => {
      const listener = jest.fn();
      client.on('chatTool', listener);

      simulateEvent('agent', {
        runId: 'r1',
        stream: 'tool',
        data: {
          phase: 'result',
          toolCallId: 'tc2',
          name: 'read',
          result: 'file content',
        },
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: 'tc2',
          name: 'read',
          phase: 'result',
          output: 'file content',
          status: 'success',
        }),
      );
    });

    it('emits chatTool on tool result event with error', () => {
      const listener = jest.fn();
      client.on('chatTool', listener);

      simulateEvent('agent', {
        runId: 'r1',
        stream: 'tool',
        data: {
          phase: 'result',
          toolCallId: 'tc3',
          name: 'bash',
          result: 'error output',
          isError: true,
        },
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: 'tc3',
          name: 'bash',
          phase: 'result',
          status: 'error',
        }),
      );
    });

    it('emits chatTool on tool update event with partialResult', () => {
      const listener = jest.fn();
      client.on('chatTool', listener);

      simulateEvent('agent', {
        runId: 'r1',
        stream: 'tool',
        data: {
          phase: 'update',
          toolCallId: 'tc4',
          name: 'bash',
          partialResult: 'partial output',
        },
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: 'tc4',
          name: 'bash',
          phase: 'update',
          output: 'partial output',
          status: 'running',
        }),
      );
    });

    it('ignores non-tool streams other than compaction/lifecycle', () => {
      const toolListener = jest.fn();
      const compactionListener = jest.fn();
      client.on('chatTool', toolListener);
      client.on('chatCompaction', compactionListener);

      simulateEvent('agent', {
        runId: 'r1',
        stream: 'assistant',
        data: { phase: 'start' },
      });

      expect(toolListener).not.toHaveBeenCalled();
      expect(compactionListener).not.toHaveBeenCalled();
    });

    it('ignores tool events without runId', () => {
      const listener = jest.fn();
      client.on('chatTool', listener);

      simulateEvent('agent', {
        runId: '',
        stream: 'tool',
        data: { phase: 'start', name: 'bash' },
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('response frame handling', () => {
    beforeEach(() => {
      client.configure({ url: 'wss://example.com' });
      client.connect();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();
    });

    it('ignores invalid JSON messages', () => {
      const errorListener = jest.fn();
      client.on('error', errorListener);

      createdWs.onmessage!({ data: 'not json{' });
      expect(errorListener).toHaveBeenCalledWith({
        code: 'invalid_json',
        message: 'Failed to parse server message',
      });
    });

    it('silently ignores non-gateway frames', () => {
      const errorListener = jest.fn();
      client.on('error', errorListener);

      createdWs.onmessage!({ data: JSON.stringify({ foo: 'bar' }) });
      // Should not emit an error for unrecognized frames
      expect(errorListener).not.toHaveBeenCalled();
    });

    it('silently ignores tick events', () => {
      const errorListener = jest.fn();
      client.on('error', errorListener);

      createdWs.onmessage!({ data: JSON.stringify({ type: 'event', event: 'tick' }) });
      expect(errorListener).not.toHaveBeenCalled();
    });

    it('accepts relay tick frames as keepalive heartbeats', () => {
      const tickListener = jest.fn();
      client.on('tick', tickListener);

      createdWs.onmessage!({ data: JSON.stringify({ type: 'tick', ts: Date.now() }) });

      expect(tickListener).toHaveBeenCalledWith({});
    });

  });

  describe('request timeout recovery', () => {
    beforeEach(() => {
      client.configure({ url: 'wss://example.com' });
      client.connect();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();
    });

    it('blocks non-connect requests until handshake reaches ready state', async () => {
      const pending = client.request('sessions.list', { limit: 1 });
      await expect(pending).rejects.toThrow('Gateway handshake in progress: sessions.list');
      expect(createdWs.send).not.toHaveBeenCalled();
    });

    it('rejects timed-out requests and restarts transport', async () => {
      const firstWs = createdWs;
      (client as unknown as { state: string }).state = 'ready';
      const pending = client.request('sessions.list', { limit: 1 });

      jest.advanceTimersByTime(15_000);
      await expect(pending).rejects.toThrow('Request timed out: sessions.list');

      expect(firstWs.close).toHaveBeenCalled();
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(2);
      expect(client.getConnectionState()).toBe('connecting');
    });
  });

  describe('relay bootstrap v2', () => {
    it('uses stored deviceToken in relay mode even when no legacy token or password is configured', async () => {
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getDeviceToken: jest.Mock };
      };
      StorageService.getDeviceToken.mockResolvedValue('stored-device-token');
      mockDeviceIdentity();

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
          supportsBootstrap: true,
        },
      });

      client.connect();
      await flushPromises();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();
      createdWs.onmessage!({
        data: JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'b'.repeat(64), ts: Date.now() },
        }),
      });
      await flushPromises();

      expect(createdWs.send).toHaveBeenCalledTimes(1);
      const connectFrame = JSON.parse(createdWs.send.mock.calls[0][0] as string);
      expect(connectFrame.params.auth).toEqual({ deviceToken: 'stored-device-token' });
      expect(StorageService.getDeviceToken).toHaveBeenCalledWith('a'.repeat(64), {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway-device-relay',
      });
    });

    it('uses stored deviceToken in relay mode without requesting bootstrap', async () => {
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getDeviceToken: jest.Mock };
      };
      StorageService.getDeviceToken.mockResolvedValue('stored-device-token');
      mockDeviceIdentity();

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        token: 'legacy-token',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
          supportsBootstrap: true,
        },
      });

      client.connect();
      await flushPromises();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();
      createdWs.onmessage!({
        data: JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'b'.repeat(64), ts: Date.now() },
        }),
      });
      await flushPromises();

      expect(createdWs.send).toHaveBeenCalledTimes(1);
      const connectFrame = JSON.parse(createdWs.send.mock.calls[0][0] as string);
      expect(connectFrame.method).toBe('connect');
      expect(connectFrame.params.auth).toEqual({ deviceToken: 'stored-device-token' });
      expect(createdWs.send.mock.calls[0][0]).not.toContain(RELAY_CONTROL_PREFIX);
      expect(decodeLatestSignedPayload()).toContain(`|stored-device-token|${'b'.repeat(64)}|`);
      expect(StorageService.getDeviceToken).toHaveBeenCalledWith('a'.repeat(64), {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway-device-relay',
      });
    });

    it('requests bootstrap and connects with bootstrapToken when relay supports V2 and no deviceToken exists', async () => {
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getDeviceToken: jest.Mock };
      };
      StorageService.getDeviceToken.mockResolvedValue(null);
      mockDeviceIdentity();

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        token: 'legacy-token',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
          protocolVersion: 2,
        },
      });

      client.connect();
      await flushPromises();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();
      createdWs.onmessage!({
        data: JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'b'.repeat(64), ts: Date.now() },
        }),
      });
      await flushPromises();

      expect(createdWs.send).toHaveBeenCalledTimes(1);
      const bootstrapRequestRaw = createdWs.send.mock.calls[0][0] as string;
      expect(bootstrapRequestRaw.startsWith(RELAY_CONTROL_PREFIX)).toBe(true);
      const bootstrapRequest = JSON.parse(bootstrapRequestRaw.slice(RELAY_CONTROL_PREFIX.length));
      expect(bootstrapRequest).toMatchObject({
        type: 'control',
        event: 'bootstrap.request',
        payload: {
          deviceId: 'a'.repeat(64),
          publicKey: expect.any(String),
          role: 'operator',
          scopes: ['operator.admin', 'operator.read', 'operator.write', 'operator.pairing'],
        },
      });
      expect(bootstrapRequest.deviceId).toBeUndefined();
      expect(bootstrapRequest.publicKey).toBeUndefined();
      expect(bootstrapRequest.role).toBeUndefined();
      expect(bootstrapRequest.scopes).toBeUndefined();

      createdWs.onmessage!({
        data: `${RELAY_CONTROL_PREFIX}${JSON.stringify({
          event: 'bootstrap.issued',
          requestId: bootstrapRequest.requestId,
          bootstrapToken: 'bootstrap-token',
        })}`,
      });
      await flushPromises();

      expect(createdWs.send).toHaveBeenCalledTimes(2);
      const connectFrame = JSON.parse(createdWs.send.mock.calls[1][0] as string);
      expect(connectFrame.method).toBe('connect');
      expect(connectFrame.params.auth).toEqual({ bootstrapToken: 'bootstrap-token' });
      expect(decodeLatestSignedPayload()).toContain(`|bootstrap-token|${'b'.repeat(64)}|`);
    });

    it('requests bootstrap without legacy fallback credentials when relay supports V2 and no deviceToken exists', async () => {
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getDeviceToken: jest.Mock };
      };
      StorageService.getDeviceToken.mockResolvedValue(null);
      mockDeviceIdentity();

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
          protocolVersion: 2,
        },
      });

      client.connect();
      await flushPromises();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();
      createdWs.onmessage!({
        data: JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'b'.repeat(64), ts: Date.now() },
        }),
      });
      await flushPromises();

      const bootstrapRequestRaw = createdWs.send.mock.calls[0][0] as string;
      const bootstrapRequest = JSON.parse(bootstrapRequestRaw.slice(RELAY_CONTROL_PREFIX.length));
      createdWs.onmessage!({
        data: `${RELAY_CONTROL_PREFIX}${JSON.stringify({
          event: 'bootstrap.issued',
          requestId: bootstrapRequest.requestId,
          bootstrapToken: 'bootstrap-token',
        })}`,
      });
      await flushPromises();

      expect(createdWs.send).toHaveBeenCalledTimes(2);
      const connectFrame = JSON.parse(createdWs.send.mock.calls[1][0] as string);
      expect(connectFrame.params.auth).toEqual({ bootstrapToken: 'bootstrap-token' });
    });

    it('stores issued deviceToken using the active relay gateway scope', async () => {
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getDeviceToken: jest.Mock; setDeviceToken: jest.Mock };
      };
      StorageService.getDeviceToken.mockResolvedValue('stored-device-token');
      mockDeviceIdentity();

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com/',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
          supportsBootstrap: true,
        },
      });

      client.connect();
      await flushPromises();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();

      const sendRequestSpy = jest
        .spyOn(client as unknown as { sendRequest: (method: string, params?: object, options?: object) => Promise<unknown> }, 'sendRequest')
        .mockResolvedValue({
          auth: { deviceToken: 'issued-device-token' },
        });

      await (client as unknown as { handleConnectChallenge: (payload: ConnectChallengePayload) => Promise<void> })
        .handleConnectChallenge({ nonce: 'b'.repeat(64), ts: Date.now() });

      expect(sendRequestSpy).toHaveBeenCalledWith(
        'connect',
        expect.any(Object),
        expect.objectContaining({
          timeoutMs: 8_000,
          skipAutoReconnectOnTimeout: true,
        }),
      );
      expect(StorageService.setDeviceToken).toHaveBeenCalledWith('a'.repeat(64), 'issued-device-token', {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway-device-relay',
      });
    });

    it('clears stale relay deviceToken and restarts when gateway reports device token mismatch', async () => {
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getDeviceToken: jest.Mock; deleteDeviceToken: jest.Mock };
      };
      StorageService.getDeviceToken.mockResolvedValue('stored-device-token');
      mockDeviceIdentity();

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com/',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
          supportsBootstrap: true,
        },
      });

      client.connect();
      await flushPromises();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();

      jest
        .spyOn(client as unknown as { sendRequest: (method: string, params?: object, options?: object) => Promise<unknown> }, 'sendRequest')
        .mockRejectedValue(new Error('[INVALID_REQUEST] unauthorized: device token mismatch (rotate/reissue device token)'));
      const restartSpy = jest
        .spyOn(client as unknown as { restartConnection: (reason: string) => void }, 'restartConnection')
        .mockImplementation(() => {});

      await (client as unknown as { handleConnectChallenge: (payload: ConnectChallengePayload) => Promise<void> })
        .handleConnectChallenge({ nonce: 'b'.repeat(64), ts: Date.now() });

      expect(StorageService.deleteDeviceToken).toHaveBeenCalledWith('a'.repeat(64), {
        serverUrl: 'https://registry.example.com',
        gatewayId: 'gateway-device-relay',
      });
      expect(restartSpy).toHaveBeenCalledWith('Connection restarted');
    });

    it('falls back to legacy token when bootstrap times out', async () => {
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getDeviceToken: jest.Mock };
      };
      StorageService.getDeviceToken.mockResolvedValue(null);
      mockDeviceIdentity();
      const errorListener = jest.fn();
      client.on('error', errorListener);

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        token: 'legacy-token',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
          supportsBootstrap: true,
        },
      });

      client.connect();
      await flushPromises();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();
      createdWs.onmessage!({
        data: JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'b'.repeat(64), ts: Date.now() },
        }),
      });
      await flushPromises();

      expect(createdWs.send).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(12_100);
      await flushPromises();

      expect(createdWs.send).toHaveBeenCalledTimes(2);
      const connectFrame = JSON.parse(createdWs.send.mock.calls[1][0] as string);
      expect(connectFrame.params.auth).toEqual({ token: 'legacy-token' });
      expect(decodeLatestSignedPayload()).toContain(`|legacy-token|${'b'.repeat(64)}|`);
      expect(errorListener).not.toHaveBeenCalled();
    });

    it('falls back to legacy password when relay bootstrap returns bootstrap.error', async () => {
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getDeviceToken: jest.Mock };
      };
      StorageService.getDeviceToken.mockResolvedValue(null);
      mockDeviceIdentity();

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        password: 'legacy-password',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
          supportsBootstrap: true,
        },
      });

      client.connect();
      await flushPromises();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();
      createdWs.onmessage!({
        data: JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'b'.repeat(64), ts: Date.now() },
        }),
      });
      await flushPromises();

      const bootstrapRequestRaw = createdWs.send.mock.calls[0][0] as string;
      const bootstrapRequest = JSON.parse(bootstrapRequestRaw.slice(RELAY_CONTROL_PREFIX.length));
      createdWs.onmessage!({
        data: `${RELAY_CONTROL_PREFIX}${JSON.stringify({
          event: 'bootstrap.error',
          requestId: bootstrapRequest.requestId,
          error: {
            code: 'BOOTSTRAP_DENIED',
            message: 'Relay rejected bootstrap',
          },
        })}`,
      });
      await flushPromises();

      expect(createdWs.send).toHaveBeenCalledTimes(2);
      const connectFrame = JSON.parse(createdWs.send.mock.calls[1][0] as string);
      expect(connectFrame.params.auth).toEqual({ password: 'legacy-password' });
      expect(decodeLatestSignedPayload()).toContain(`||${'b'.repeat(64)}|`);
    });

    it('falls back to legacy token when gateway rejects bootstrapToken auth schema', async () => {
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getDeviceToken: jest.Mock };
      };
      StorageService.getDeviceToken.mockResolvedValue(null);
      mockDeviceIdentity();
      const errorListener = jest.fn();
      client.on('error', errorListener);

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        token: 'legacy-token',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
          supportsBootstrap: true,
        },
      });

      client.connect();
      await flushPromises();
      const firstWs = createdWs;
      firstWs.readyState = MockWebSocket.OPEN;
      firstWs.onopen!();
      firstWs.onmessage!({
        data: JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'b'.repeat(64), ts: Date.now() },
        }),
      });
      await flushPromises();

      const bootstrapRequestRaw = firstWs.send.mock.calls[0][0] as string;
      const bootstrapRequest = JSON.parse(bootstrapRequestRaw.slice(RELAY_CONTROL_PREFIX.length));
      firstWs.onmessage!({
        data: `${RELAY_CONTROL_PREFIX}${JSON.stringify({
          event: 'bootstrap.issued',
          requestId: bootstrapRequest.requestId,
          bootstrapToken: 'bootstrap-token',
        })}`,
      });
      await flushPromises();

      const bootstrapConnectFrame = JSON.parse(firstWs.send.mock.calls[1][0] as string);
      firstWs.onmessage!({
        data: JSON.stringify({
          type: 'res',
          id: bootstrapConnectFrame.id,
          ok: false,
          error: {
            code: 'INVALID_REQUEST',
            message: "invalid connect params: at /auth: unexpected property 'bootstrapToken'",
          },
        }),
      });
      await flushPromises();

      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(2);
      expect(errorListener).not.toHaveBeenCalled();

      const fallbackWs = createdWs;
      fallbackWs.readyState = MockWebSocket.OPEN;
      fallbackWs.onopen!();
      fallbackWs.onmessage!({
        data: JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'c'.repeat(64), ts: Date.now() },
        }),
      });
      await flushPromises();

      expect(fallbackWs.send).toHaveBeenCalledTimes(1);
      const fallbackConnectFrame = JSON.parse(fallbackWs.send.mock.calls[0][0] as string);
      expect(fallbackConnectFrame.params.auth).toEqual({ token: 'legacy-token' });
      expect(decodeLatestSignedPayload()).toContain(`|legacy-token|${'c'.repeat(64)}|`);
    });

    it('falls back to legacy password when gateway rejects bootstrapToken auth schema', async () => {
      const { StorageService } = jest.requireMock('./storage') as {
        StorageService: { getDeviceToken: jest.Mock };
      };
      StorageService.getDeviceToken.mockResolvedValue(null);
      mockDeviceIdentity();
      const errorListener = jest.fn();
      client.on('error', errorListener);

      client.configure({
        url: 'wss://relay-us.example.com/ws',
        password: 'legacy-password',
        mode: 'relay',
        relay: {
          serverUrl: 'https://registry.example.com',
          gatewayId: 'gateway-device-relay',
          clientToken: 'relay-access-token',
          supportsBootstrap: true,
        },
      });

      client.connect();
      await flushPromises();
      const firstWs = createdWs;
      firstWs.readyState = MockWebSocket.OPEN;
      firstWs.onopen!();
      firstWs.onmessage!({
        data: JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'b'.repeat(64), ts: Date.now() },
        }),
      });
      await flushPromises();

      const bootstrapRequestRaw = firstWs.send.mock.calls[0][0] as string;
      const bootstrapRequest = JSON.parse(bootstrapRequestRaw.slice(RELAY_CONTROL_PREFIX.length));
      firstWs.onmessage!({
        data: `${RELAY_CONTROL_PREFIX}${JSON.stringify({
          event: 'bootstrap.issued',
          requestId: bootstrapRequest.requestId,
          bootstrapToken: 'bootstrap-token',
        })}`,
      });
      await flushPromises();

      const bootstrapConnectFrame = JSON.parse(firstWs.send.mock.calls[1][0] as string);
      firstWs.onmessage!({
        data: JSON.stringify({
          type: 'res',
          id: bootstrapConnectFrame.id,
          ok: false,
          error: {
            code: 'INVALID_REQUEST',
            message: "invalid connect params: at /auth: unexpected property 'bootstrapToken'",
          },
        }),
      });
      await flushPromises();

      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(2);
      expect(errorListener).not.toHaveBeenCalled();

      const fallbackWs = createdWs;
      fallbackWs.readyState = MockWebSocket.OPEN;
      fallbackWs.onopen!();
      fallbackWs.onmessage!({
        data: JSON.stringify({
          type: 'event',
          event: 'connect.challenge',
          payload: { nonce: 'd'.repeat(64), ts: Date.now() },
        }),
      });
      await flushPromises();

      expect(fallbackWs.send).toHaveBeenCalledTimes(1);
      const fallbackConnectFrame = JSON.parse(fallbackWs.send.mock.calls[0][0] as string);
      expect(fallbackConnectFrame.params.auth).toEqual({ password: 'legacy-password' });
      expect(decodeLatestSignedPayload()).toContain(`||${'d'.repeat(64)}|`);
    });
  });

  describe('connect challenge handling', () => {
    beforeEach(() => {
      client.configure({ url: 'wss://example.com', token: 'token_pro' });
      client.connect();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();
    });

    it('ignores duplicate connect.challenge while connect request is in flight', async () => {
      const connectSpy = jest
        .spyOn(client as unknown as { handleConnectChallenge: (payload: unknown) => Promise<void> }, 'handleConnectChallenge')
        .mockImplementation(() => new Promise<void>(() => {}));

      const challengeFrame = {
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'b'.repeat(64) },
      };
      createdWs.onmessage!({ data: JSON.stringify(challengeFrame) });
      createdWs.onmessage!({ data: JSON.stringify(challengeFrame) });
      await Promise.resolve();
      await Promise.resolve();

      expect(connectSpy).toHaveBeenCalledTimes(1);
    });

    it('ignores stale nonce mismatch from a superseded connect attempt', async () => {
      const errorListener = jest.fn();
      client.on('error', errorListener);
      jest.spyOn(client as unknown as { ensureIdentity: () => Promise<{
        deviceId: string;
        publicKeyHex: string;
        secretKeyHex: string;
      }> }, 'ensureIdentity').mockResolvedValue({
        deviceId: 'device-1',
        publicKeyHex: '01'.repeat(32),
        secretKeyHex: '02'.repeat(64),
      });

      let rejectConnect!: (error: Error) => void;
      const sendRequestSpy = jest
        .spyOn(client as unknown as { sendRequest: (method: string, params?: object, options?: object) => Promise<unknown> }, 'sendRequest')
        .mockImplementation((method: string) => {
          if (method !== 'connect') {
            return Promise.resolve(null);
          }
          return new Promise<unknown>((_resolve, reject) => {
            rejectConnect = reject;
          });
        });

      const staleChallenge = (client as unknown as { handleConnectChallenge: (payload: ConnectChallengePayload) => Promise<void> })
        .handleConnectChallenge({ nonce: 'b'.repeat(64), ts: Date.now() });

      await flushPromises();
      (client as unknown as { connectAttemptId: number }).connectAttemptId += 1;
      rejectConnect(new Error('[UNAUTHORIZED] device nonce mismatch'));
      await staleChallenge;

      expect(sendRequestSpy).toHaveBeenCalledWith(
        'connect',
        expect.objectContaining({
          device: expect.objectContaining({
            nonce: 'b'.repeat(64),
          }),
        }),
        expect.objectContaining({
          timeoutMs: 8_000,
          skipAutoReconnectOnTimeout: true,
        }),
      );
      expect(errorListener).not.toHaveBeenCalled();
      expect((client as unknown as { reconnectBlockedReason: unknown }).reconnectBlockedReason).toBeNull();
    });

  });

  describe('metadata caching', () => {
    it('fills session contextTokens from gateway defaults when missing on the session row', async () => {
      const sendRequestSpy = jest
        .spyOn(client as unknown as { sendRequest: (method: string, params?: object) => Promise<unknown> }, 'sendRequest')
        .mockResolvedValue({
          defaults: { contextTokens: 200_000 },
          sessions: [{ key: 'agent:main:main', model: 'gpt-5', modelProvider: 'openai' }],
        });

      await expect(client.listSessions()).resolves.toEqual([
        {
          key: 'agent:main:main',
          model: 'gpt-5',
          modelProvider: 'openai',
          contextTokens: 200_000,
        },
      ]);
      expect(sendRequestSpy).toHaveBeenCalledWith('sessions.list', {
        limit: 100,
        includeLastMessage: true,
        includeDerivedTitles: true,
      });
    });

    it('filters silent lastMessagePreview values from session rows', async () => {
      const sendRequestSpy = jest
        .spyOn(client as unknown as { sendRequest: (method: string, params?: object) => Promise<unknown> }, 'sendRequest')
        .mockResolvedValue({
          sessions: [{ key: 'agent:main:main', lastMessagePreview: 'NO' }],
        });

      await expect(client.listSessions()).resolves.toEqual([
        {
          key: 'agent:main:main',
          lastMessagePreview: undefined,
        },
      ]);
      expect(sendRequestSpy).toHaveBeenCalledWith('sessions.list', {
        limit: 100,
        includeLastMessage: true,
        includeDerivedTitles: true,
      });
    });

    it('fetches chat history without includeTools probing', async () => {
      const sendRequestSpy = jest
        .spyOn(client as unknown as { sendRequest: (method: string, params?: object) => Promise<unknown> }, 'sendRequest')
        .mockResolvedValue({ messages: [{ role: 'assistant', content: 'cached' }], thinkingLevel: 'off' });

      await expect(client.fetchHistory('session-1', 12)).resolves.toEqual({
        messages: [{ role: 'assistant', content: 'cached' }],
        thinkingLevel: 'off',
      });

      expect(sendRequestSpy).toHaveBeenCalledTimes(1);
      expect(sendRequestSpy).toHaveBeenCalledWith('chat.history', { sessionKey: 'session-1', limit: 12 });
    });

    it('deduplicates concurrent chat history requests for the same session and limit', async () => {
      let resolveRequest!: (value: unknown) => void;
      const sendRequestSpy = jest
        .spyOn(client as unknown as { sendRequest: (method: string, params?: object) => Promise<unknown> }, 'sendRequest')
        .mockImplementation(() => new Promise((resolve) => {
          resolveRequest = resolve;
        }));

      const firstPromise = client.fetchHistory('session-1', 12);
      const secondPromise = client.fetchHistory('session-1', 12);

      expect(sendRequestSpy).toHaveBeenCalledTimes(1);

      resolveRequest({ messages: [{ role: 'assistant', content: 'merged' }], sessionId: 'sess-1' });

      await expect(Promise.all([firstPromise, secondPromise])).resolves.toEqual([
        { messages: [{ role: 'assistant', content: 'merged' }], sessionId: 'sess-1', thinkingLevel: undefined },
        { messages: [{ role: 'assistant', content: 'merged' }], sessionId: 'sess-1', thinkingLevel: undefined },
      ]);
    });

    it('reuses a short-lived chat history cache and refreshes after the TTL expires', async () => {
      const sendRequestSpy = jest
        .spyOn(client as unknown as { sendRequest: (method: string, params?: object) => Promise<unknown> }, 'sendRequest')
        .mockResolvedValue({ messages: [{ role: 'assistant', content: 'cached' }], thinkingLevel: 'off' });

      const first = await client.fetchHistory('session-1', 12);
      const second = await client.fetchHistory('session-1', 12);

      expect(first).toEqual({ messages: [{ role: 'assistant', content: 'cached' }], thinkingLevel: 'off' });
      expect(second).toEqual(first);
      expect(sendRequestSpy).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1_001);

      await client.fetchHistory('session-1', 12);
      expect(sendRequestSpy).toHaveBeenCalledTimes(2);
    });

    it('deduplicates concurrent identity lookups and reuses a short-lived cache', async () => {
      const sendRequestSpy = jest
        .spyOn(client as unknown as { sendRequest: (method: string, params?: object) => Promise<unknown> }, 'sendRequest')
        .mockResolvedValue({ name: 'Main Agent', emoji: '🤖', avatarUrl: 'https://example.com/a.png' });

      const [first, second] = await Promise.all([
        client.fetchIdentity('main'),
        client.fetchIdentity('main'),
      ]);

      expect(first).toEqual({ name: 'Main Agent', emoji: '🤖', avatar: 'https://example.com/a.png' });
      expect(second).toEqual(first);
      expect(sendRequestSpy).toHaveBeenCalledTimes(1);

      const third = await client.fetchIdentity('main');
      expect(third).toEqual(first);
      expect(sendRequestSpy).toHaveBeenCalledTimes(1);
    });

    it('reuses cached agent list results within the short TTL window', async () => {
      const sendRequestSpy = jest
        .spyOn(client as unknown as { sendRequest: (method: string, params?: object) => Promise<unknown> }, 'sendRequest')
        .mockResolvedValue({
          defaultId: 'main',
          mainKey: 'agent:main:main',
          agents: [{ id: 'main', name: 'Main' }],
        });

      const [first, second] = await Promise.all([
        client.listAgents(),
        client.listAgents(),
      ]);

      expect(first.agents).toHaveLength(1);
      expect(second).toEqual(first);
      expect(sendRequestSpy).toHaveBeenCalledTimes(1);

      const third = await client.listAgents();
      expect(third).toEqual(first);
      expect(sendRequestSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('exec approval events', () => {
    beforeEach(() => {
      client.configure({ url: 'wss://example.com' });
      client.connect();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();
    });

    it('emits execApprovalRequested event', () => {
      const listener = jest.fn();
      client.on('execApprovalRequested', listener);

      const payload = {
        id: 'ea1',
        request: { command: 'rm -rf /', cwd: '/tmp' },
        createdAtMs: 1000,
        expiresAtMs: 2000,
      };

      createdWs.onmessage!({
        data: JSON.stringify({ type: 'event', event: 'exec.approval.requested', payload }),
      });

      expect(listener).toHaveBeenCalledWith(payload);
    });

    it('emits execApprovalResolved event', () => {
      const listener = jest.fn();
      client.on('execApprovalResolved', listener);

      const payload = { id: 'ea1', decision: 'allow-once' };

      createdWs.onmessage!({
        data: JSON.stringify({ type: 'event', event: 'exec.approval.resolved', payload }),
      });

      expect(listener).toHaveBeenCalledWith(payload);
    });
  });

  describe('chat delta with tool blocks', () => {
    beforeEach(() => {
      client.configure({ url: 'wss://example.com' });
      client.connect();
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();
    });

    it('emits chatTool for tool blocks in delta content', () => {
      const toolListener = jest.fn();
      client.on('chatTool', toolListener);

      const frame = {
        type: 'event',
        event: 'chat',
        payload: {
          runId: 'r1',
          sessionKey: 's1',
          seq: 1,
          state: 'delta',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tc_block', name: 'bash', input: { command: 'ls' } },
            ],
          },
        },
      };

      createdWs.onmessage!({ data: JSON.stringify(frame) });

      expect(toolListener).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'r1',
          name: 'bash',
          phase: 'result',
        }),
      );
    });
  });

  describe('ws error and close', () => {
    it('emits ws_error on WebSocket error', () => {
      const errorListener = jest.fn();
      client.on('error', errorListener);
      client.configure({ url: 'wss://example.com' });
      client.connect();

      createdWs.onerror!();
      expect(errorListener).toHaveBeenCalledWith({
        code: 'ws_error',
        message: 'WebSocket error',
      });
    });

    it('schedules reconnect on unexpected close', () => {
      const states: string[] = [];
      client.on('connection', (e) => states.push(e.state));
      client.configure({ url: 'wss://example.com' });
      client.connect();

      // Simulate close without manual disconnect
      createdWs.onclose!();

      expect(states).toContain('reconnecting');
    });

    it('does not reconnect on manual disconnect', () => {
      const states: string[] = [];
      client.on('connection', (e) => states.push(e.state));
      client.configure({ url: 'wss://example.com' });
      client.connect();
      client.disconnect();

      // The last state should be 'closed', not 'reconnecting'
      expect(states[states.length - 1]).toBe('closed');
    });

    it('fails stalled connecting socket with ws_connect_timeout', () => {
      const errorListener = jest.fn();
      client.on('error', errorListener);
      client.configure({ url: 'wss://example.com' });
      client.connect();
      const firstWs = createdWs;
      createdWs.readyState = MockWebSocket.CONNECTING;

      jest.advanceTimersByTime(10_000);

      expect(errorListener).toHaveBeenCalledWith({
        code: 'ws_connect_timeout',
        message: 'WebSocket open timed out',
      });
      expect(firstWs.close).toHaveBeenCalled();
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(2);
    });

    it('fails stalled challenging socket with challenge_timeout', () => {
      const errorListener = jest.fn();
      client.on('error', errorListener);
      client.configure({ url: 'wss://example.com' });
      client.connect();
      const firstWs = createdWs;
      createdWs.readyState = MockWebSocket.OPEN;
      createdWs.onopen!();

      jest.advanceTimersByTime(20_000);

      expect(errorListener).toHaveBeenCalledWith({
        code: 'challenge_timeout',
        message: 'Gateway challenge timed out',
      });
      expect(firstWs.close).toHaveBeenCalled();
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(2);
    });

    it('stays in pairing_pending and schedules reconnect when gateway requires pairing', () => {
      const states: string[] = [];
      client.on('connection', (e) => states.push(e.state));
      client.configure({ url: 'wss://example.com', token: 'token_pro' });
      client.connect();
      createdWs.readyState = MockWebSocket.OPEN;
      // Simulate pairing_pending state (as set by handleConnectChallenge on NOT_PAIRED)
      (client as unknown as { pairingPending: boolean }).pairingPending = true;
      createdWs.onclose!();

      expect(states).toContain('pairing_pending');
      // Should have scheduled a reconnect attempt (not blocked)
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(1);

      // After backoff, a reconnect attempt should be made
      jest.advanceTimersByTime(30_000);
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(2);
    });

    it('blocks auto-retry on nonce mismatch but allows manual reconnect', () => {
      const errorListener = jest.fn();
      client.on('error', errorListener);
      client.configure({ url: 'wss://example.com', token: 'token_pro' });
      client.connect();
      createdWs.readyState = MockWebSocket.OPEN;
      (client as unknown as {
        blockReconnect: (reason: { code: string; message: string; hint?: string }) => void;
      }).blockReconnect({
        code: 'device_nonce_mismatch',
        message: 'Device authentication nonce mismatch. Please regenerate a new Relay QR code in Clawket Bridge.',
        hint: 'Open Clawket Bridge and scan a newly generated Relay QR code.',
      });
      createdWs.onclose!();

      expect(errorListener).toHaveBeenCalledWith(expect.objectContaining({
        code: 'device_nonce_mismatch',
        retryable: false,
      }));
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(30_000);
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(1);

      client.reconnect();
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(2);
    });

    it('blocks auto-retry on device signature invalid but allows manual reconnect', () => {
      const errorListener = jest.fn();
      client.on('error', errorListener);
      client.configure({ url: 'wss://example.com', token: 'token_pro' });
      client.connect();
      createdWs.readyState = MockWebSocket.OPEN;
      (client as unknown as {
        blockReconnect: (reason: { code: string; message: string; hint?: string }) => void;
      }).blockReconnect({
        code: 'device_signature_invalid',
        message: 'Device authentication failed. Reset the Clawket app device identity and reconnect.',
        hint: 'If this keeps happening, clear the app identity or app data, then reconnect to the Gateway.',
      });
      createdWs.onclose!();

      expect(errorListener).toHaveBeenCalledWith(expect.objectContaining({
        code: 'device_signature_invalid',
        retryable: false,
      }));
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(30_000);
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(1);

      client.reconnect();
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(2);
    });
  });

  describe('stale transport recovery', () => {
    it('probes a healthy ready connection without forcing reconnect', async () => {
      client.configure({ url: 'wss://example.com' });
      client.connect();
      (client as unknown as { state: string }).state = 'ready';
      const sendRequestSpy = jest.spyOn(client as any, 'sendRequest').mockResolvedValue({});

      await expect(client.probeConnection(1234)).resolves.toBe(true);
      expect(sendRequestSpy).toHaveBeenCalledWith(
        'health',
        {},
        { timeoutMs: 1234, skipAutoReconnectOnTimeout: true },
      );
    });

    it('leaves ready state and reconnects when a request starts without an open socket', async () => {
      const states: string[] = [];
      client.on('connection', ({ state }) => states.push(state));
      client.configure({ url: 'wss://example.com' });
      (client as unknown as { state: string }).state = 'ready';
      (client as unknown as { ws: MockWebSocket }).ws = new MockWebSocket();
      (client as unknown as { ws: MockWebSocket }).ws.readyState = MockWebSocket.CLOSED;
      const reconnectSpy = jest.spyOn(client, 'reconnect').mockImplementation(() => {});

      await expect(client.request('sessions.list', {})).rejects.toThrow('WebSocket is not open');
      expect(states).toContain('reconnecting');
      expect(reconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('bypasses force-reconnect debounce for a stale ready transport', () => {
      client.configure({ url: 'wss://example.com' });
      (client as unknown as { state: string }).state = 'ready';
      (client as unknown as { ws: MockWebSocket | null }).ws = null;
      (client as unknown as { lastForceReconnectAt: number }).lastForceReconnectAt = Date.now();

      client.reconnect();
      expect((globalThis as any).WebSocket).toHaveBeenCalledTimes(1);
    });
  });
});
