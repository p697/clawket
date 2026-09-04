import { X509Certificate } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PeerCertificate } from 'node:tls';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { PairingConfig } from '@clawket/bridge-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BridgeRuntime,
  buildRelayWsHeaders,
  buildRelayWsUrl,
  dedupePendingGatewayMessages,
  patchConnectRequestGatewayAuth,
  patchConnectRequestGatewayProtocolRange,
  patchOpenClawConnectRequest,
  OPENCLAW_MOBILE_SETUP_CAPABILITY,
  prunePendingGatewayMessagesForFreshDemand,
  sanitizeRuntimeLogLine,
  shouldRecycleGatewayForFreshClient,
  shouldDropStaleConnectAfterGatewayReopen,
  shouldKeepGatewayConnected,
  shouldScheduleGatewayIdleClose,
  summarizePendingGatewayMessages,
} from './runtime.js';
import {
  isConnectHandshakeRequest,
  parseConnectHandshakeMeta,
  parseConnectStartIdentity,
  parseControl,
  parsePairingRequestFromError,
  parsePairResolvedEvent,
  parseResponseEnvelopeMeta,
} from './protocol.js';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    await rm(dir, { recursive: true, force: true });
  }
});

class FakeSocket extends EventEmitter {
  readyState = 0;
  sent: Array<string | Buffer> = [];
  closeCalls = 0;
  pingCalls = 0;
  options?: {
    headers?: Record<string, string>;
    maxPayload?: number;
    rejectUnauthorized?: boolean;
    checkServerIdentity?: (hostname: string, cert: PeerCertificate) => Error | undefined;
  };
  tlsCert?: PeerCertificate;

  constructor(readonly url: string, options?: {
    headers?: Record<string, string>;
    maxPayload?: number;
    rejectUnauthorized?: boolean;
    checkServerIdentity?: (hostname: string, cert: PeerCertificate) => Error | undefined;
  }) {
    super();
    this.options = options;
  }

  send(data: string | Buffer): void {
    this.sent.push(typeof data === 'string' ? data : Buffer.from(data));
  }

  close(): void {
    this.closeCalls += 1;
    if (this.readyState === 2 || this.readyState === 3) return;
    this.readyState = 2;
  }

  terminate(): void {
    this.readyState = 3;
    this.emit('close', 1006, Buffer.alloc(0));
  }

  ping(): void {
    this.pingCalls += 1;
  }

  open(): void {
    this.readyState = 1;
    this.emit('open');
  }

  message(text: string): void {
    this.emit('message', Buffer.from(text), false);
  }

  closeFromRemote(code = 1000, reason = ''): void {
    this.readyState = 3;
    this.emit('close', code, Buffer.from(reason));
  }
}

const BASE_CONFIG: PairingConfig = {
  serverUrl: 'https://registry.example.com',
  gatewayId: 'gw_test',
  relaySecret: 'secret_test',
  relayUrl: 'wss://relay.example.com/ws',
  instanceId: 'inst_test',
  displayName: 'Lucy',
  createdAt: '2026-03-11T00:00:00.000Z',
  updatedAt: '2026-03-11T00:00:00.000Z',
};

const TLS_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUel0Lv05cjrViyI/H3tABBJxM7NgwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDEyMDEyMjEzMloXDTI2MDEy
MTEyMjEzMlowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA67q+QlqeKbDDGw0z2NWjeOhzw8UXIRoIfF3nTZK5XOM9
ShYsi1LF6VSIbsqF6tX35aUw8+/vqRhAyUOaRHQoZ937loIu4Avqb3eVUNXgF/+6
lRO9n4cdeDcYWomVN4Qs14xtkn5UxBBMZFJEE5tK3R0o4C1TIUzNz6puis33YLZv
Wcl8JQLKKxP6b4G1MRt0OMSjQRs24q2ftRMzw8LI3934rTbWpGSZMpruioOZbFIo
UFVzj9FO3/fPRZnr6EzLyZpLyc7KE0Xe7FzUjo8zsCa/HWvAuB5F4ttZndchHHMl
tIkoe7Vrw66VgwIFukTLjBwtLVuG5KQxqxaW0DoM1QIDAQABo1MwUTAdBgNVHQ4E
FgQUwNdNkEQtd0n/aofzN7/EeYPPPbIwHwYDVR0jBBgwFoAUwNdNkEQtd0n/aofz
N7/EeYPPPbIwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAnOnw
o8Az/bL0A6bGHTYra3L9ArIIljMajT6KDHxylR4LhliuVNAznnhP3UkcZbUdjqjp
MNOM0lej2pNioondtQdXUskZtqWy6+dLbTm1RYQh1lbCCZQ26o7o/oENzjPksLAb
jRM47DYxRweTyRWQ5t9wvg/xL0Yi1tWq4u4FCNZlBMgdwAEnXNwVWTzRR9RHwy20
lmUzM8uQ/p42bk4EvPEV4PI1h5G0khQ6x9CtkadCTDs/ZqoUaJMwZBIDSrdJJSLw
4Vh8Lqzia1CFB4um9J4S1Gm/VZMBjjeGGBJk7VSYn4ZmhPlbPM+6z39lpQGEG0x4
r1USnb+wUdA7Zoj/mQ==
-----END CERTIFICATE-----`;

async function createOpenClawStateDir(config: unknown = {
  gateway: {
    port: 18789,
    auth: {
      mode: 'token',
      token: 'gateway-token',
    },
  },
}): Promise<string> {
  const stateDir = await mkdtemp(join(tmpdir(), 'clawket-bridge-runtime-'));
  tempDirs.push(stateDir);
  await writeFile(join(stateDir, 'openclaw.json'), JSON.stringify(config), 'utf8');
  return stateDir;
}

describe('bridge runtime protocol helpers', () => {
  it('builds relay websocket URL with gateway pairing fields but without query secrets', () => {
    const url = new URL(buildRelayWsUrl({
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_123',
      relaySecret: 'secret_123',
      relayUrl: 'wss://relay.example.com',
      instanceId: 'inst_host_1',
      displayName: 'Mac',
      createdAt: '2026-03-07T00:00:00.000Z',
      updatedAt: '2026-03-07T00:00:00.000Z',
    }));

    expect(url.pathname).toBe('/ws');
    expect(url.searchParams.get('gatewayId')).toBe('gw_123');
    expect(url.searchParams.get('role')).toBe('gateway');
    expect(url.searchParams.get('clientId')).toBe('inst_host_1');
    expect(url.searchParams.get('token')).toBeNull();
  });

  it('builds relay websocket bearer auth headers', () => {
    expect(buildRelayWsHeaders({
      relaySecret: 'secret_123',
    })).toEqual({
      Authorization: 'Bearer secret_123',
    });
  });

  it('drops any legacy token query already present on the relay URL', () => {
    const url = new URL(buildRelayWsUrl({
      serverUrl: 'https://registry.example.com',
      gatewayId: 'gw_123',
      relaySecret: 'secret_123',
      relayUrl: 'wss://relay.example.com/ws?region=us&token=legacy-secret',
      instanceId: 'inst_host_1',
      displayName: 'Mac',
      createdAt: '2026-03-07T00:00:00.000Z',
      updatedAt: '2026-03-07T00:00:00.000Z',
    }));

    expect(url.searchParams.get('region')).toBe('us');
    expect(url.searchParams.get('token')).toBeNull();
  });

  it('parses relay control frames', () => {
    expect(parseControl('__clawket_relay_control__:{"event":"client_count","count":2}')).toMatchObject({
      event: 'client_count',
      count: 2,
    });
  });

  it('parses relay control envelopes with request metadata and payload', () => {
    expect(parseControl('__clawket_relay_control__:{"type":"control","event":"bootstrap.request","requestId":"req_bootstrap_1","sourceClientId":"client-a","targetClientId":"gateway-a","payload":{"deviceId":"device-1","count":3}}')).toMatchObject({
      event: 'bootstrap.request',
      requestId: 'req_bootstrap_1',
      sourceClientId: 'client-a',
      targetClientId: 'gateway-a',
      payload: {
        deviceId: 'device-1',
        count: 3,
      },
      count: 3,
    });
  });

  it('parses connect.start identity', () => {
    expect(parseConnectStartIdentity(JSON.stringify({
      type: 'req',
      id: 'req_1',
      method: 'connect.start',
      params: {
        deviceName: 'Lucy iPhone',
      },
    }))).toEqual({
      id: 'req_1',
      label: 'Lucy iPhone',
    });
  });

  it('detects connect handshake requests', () => {
    expect(isConnectHandshakeRequest(JSON.stringify({
      type: 'req',
      method: 'connect',
    }))).toBe(true);
    expect(isConnectHandshakeRequest(JSON.stringify({
      type: 'req',
      method: 'chat.send',
    }))).toBe(false);
  });

  it('parses connect handshake metadata', () => {
    expect(parseConnectHandshakeMeta(JSON.stringify({
      type: 'req',
      id: 'req_1',
      method: 'connect.start',
      params: {
        auth: {
          token: 'secret',
        },
        device: {
          nonce: 'nonce-123',
        },
      },
    }))).toEqual({
      id: 'req_1',
      method: 'connect.start',
      minProtocol: null,
      maxProtocol: null,
      noncePresent: true,
      nonceLength: 9,
      authFields: ['token'],
    });
  });

  it('parses pending pair requests from gateway errors', () => {
    const parsed = parsePairingRequestFromError(JSON.stringify({
      type: 'res',
      ok: false,
      error: {
        code: 'NOT_PAIRED',
        message: 'pairing required',
        details: {
          requestId: 'req_pair_1',
          deviceId: 'device_1',
          displayName: 'Lucy Phone',
          platform: 'ios',
        },
      },
    }), 1234);

    expect(parsed).toEqual({
      requestId: 'req_pair_1',
      deviceId: 'device_1',
      displayName: 'Lucy Phone',
      platform: 'ios',
      deviceFamily: null,
      role: null,
      remoteIp: null,
      receivedAtMs: 1234,
      status: 'pending',
    });
  });

  it('parses pair resolved events', () => {
    expect(parsePairResolvedEvent(JSON.stringify({
      type: 'event',
      event: 'device.pair.resolved',
      payload: {
        requestId: 'req_pair_1',
        decision: 'approved',
      },
    }))).toEqual({
      requestId: 'req_pair_1',
      decision: 'approved',
    });
  });

  it('parses response envelopes', () => {
    expect(parseResponseEnvelopeMeta(JSON.stringify({
      type: 'res',
      id: 'req_1',
      ok: false,
      error: {
        code: 'TIMEOUT',
        message: 'upstream timeout',
        details: { reason: 'slow' },
        retryAfterMs: 250,
      },
    }))).toEqual({
      id: 'req_1',
      ok: false,
      errorCode: 'TIMEOUT',
      errorMessage: 'upstream timeout',
      errorDetails: { reason: 'slow' },
      retryAfterMs: 250,
    });
  });

  it('keeps gateway connected only while demand or queued connect work exists', () => {
    expect(shouldKeepGatewayConnected(1, 0)).toBe(true);
    expect(shouldKeepGatewayConnected(0, 1)).toBe(true);
    expect(shouldKeepGatewayConnected(0, 0)).toBe(false);
  });

  it('schedules idle close once demand and queued connect work are both gone', () => {
    expect(shouldScheduleGatewayIdleClose(0, 0, true)).toBe(true);
    expect(shouldScheduleGatewayIdleClose(1, 0, true)).toBe(false);
    expect(shouldScheduleGatewayIdleClose(0, 1, true)).toBe(false);
    expect(shouldScheduleGatewayIdleClose(0, 0, false)).toBe(false);
  });

  it('recycles an open gateway socket at a fresh client-demand boundary', () => {
    expect(shouldRecycleGatewayForFreshClient(0, 1, true, false)).toBe(true);
    expect(shouldRecycleGatewayForFreshClient(1, 1, true, true)).toBe(true);
    expect(shouldRecycleGatewayForFreshClient(1, 1, true, false)).toBe(false);
    expect(shouldRecycleGatewayForFreshClient(0, 1, false, true)).toBe(false);
    expect(shouldRecycleGatewayForFreshClient(0, 0, true, true)).toBe(false);
  });

  it('keeps connect frames queued while gateway reopens', () => {
    expect(shouldDropStaleConnectAfterGatewayReopen(false, true)).toBe(false);
    expect(shouldDropStaleConnectAfterGatewayReopen(false, false)).toBe(false);
    expect(shouldDropStaleConnectAfterGatewayReopen(true, true)).toBe(false);
  });

  it('summarizes queued gateway messages by type', () => {
    expect(summarizePendingGatewayMessages([
      {
        kind: 'text',
        text: JSON.stringify({ type: 'req', method: 'connect.start' }),
      },
      {
        kind: 'text',
        text: JSON.stringify({ type: 'req', method: 'chat.send' }),
      },
      {
        kind: 'binary',
        data: Buffer.from('01', 'hex'),
      },
    ])).toEqual({
      total: 3,
      connectRequests: 1,
      otherText: 1,
      binary: 1,
    });
  });

  it('keeps only the latest connect handshake when multiple are queued', () => {
    const firstConnect = {
      kind: 'text' as const,
      text: JSON.stringify({ type: 'req', id: 'connect-a', method: 'connect.start' }),
    };
    const secondConnect = {
      kind: 'text' as const,
      text: JSON.stringify({ type: 'req', id: 'connect-b', method: 'connect.start' }),
    };
    const followup = {
      kind: 'text' as const,
      text: JSON.stringify({ type: 'req', id: 'chat-1', method: 'chat.send' }),
    };

    expect(dedupePendingGatewayMessages([
      firstConnect,
      { kind: 'binary' as const, data: Buffer.from('aa', 'hex') },
      secondConnect,
      followup,
    ])).toEqual({
      messages: [
        { kind: 'binary', data: Buffer.from('aa', 'hex') },
        secondConnect,
        followup,
      ],
      dropped: 1,
    });
  });

  it('drops stale queued messages before fresh client demand recycle', () => {
    const oldChat = {
      kind: 'text' as const,
      text: JSON.stringify({ type: 'req', id: 'chat-old', method: 'chat.send' }),
    };
    const newConnect = {
      kind: 'text' as const,
      text: JSON.stringify({ type: 'req', id: 'connect-new', method: 'connect.start' }),
    };
    const newChat = {
      kind: 'text' as const,
      text: JSON.stringify({ type: 'req', id: 'chat-new', method: 'chat.send' }),
    };

    expect(prunePendingGatewayMessagesForFreshDemand([
      oldChat,
      { kind: 'binary' as const, data: Buffer.from('bb', 'hex') },
      newConnect,
      newChat,
    ])).toEqual({
      messages: [newConnect, newChat],
      dropped: 2,
    });
  });

  it('drops a stale queue entirely when no connect handshake remains', () => {
    expect(prunePendingGatewayMessagesForFreshDemand([
      {
        kind: 'text',
        text: JSON.stringify({ type: 'req', method: 'chat.send' }),
      },
    ])).toEqual({
      messages: [],
      dropped: 1,
    });
  });

  it('injects gateway password into proxied connect requests when password auth is active', () => {
    const patched = patchConnectRequestGatewayAuth(JSON.stringify({
      type: 'req',
      id: 'req_1',
      method: 'connect',
      params: {
        auth: {},
        device: {
          nonce: 'nonce-1',
        },
      },
    }), {
      authMode: 'password',
      password: 'p697',
    });

    expect(patched.injected).toBe(true);
    expect(JSON.parse(patched.text)).toMatchObject({
      params: {
        auth: {
          password: 'p697',
        },
      },
    });
  });

  it('widens legacy OpenClaw connect protocol range for newer gateways', () => {
    const patched = patchConnectRequestGatewayProtocolRange(JSON.stringify({
      type: 'req',
      id: 'req_1',
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        auth: { bootstrapToken: 'bootstrap' },
        device: { nonce: 'nonce-1' },
      },
    }));

    expect(patched.patched).toBe(true);
    expect(JSON.parse(patched.text)).toMatchObject({
      params: {
        minProtocol: 3,
        maxProtocol: 4,
      },
    });
  });

  it('does not rewrite unknown future OpenClaw connect protocol ranges', () => {
    const original = JSON.stringify({
      type: 'req',
      id: 'req_1',
      method: 'connect',
      params: {
        minProtocol: 5,
        maxProtocol: 5,
      },
    });

    expect(patchConnectRequestGatewayProtocolRange(original)).toEqual({
      text: original,
      patched: false,
    });
  });

  it('patches OpenClaw connect auth and protocol range together', () => {
    const patched = patchOpenClawConnectRequest(JSON.stringify({
      type: 'req',
      id: 'req_1',
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        auth: {},
      },
    }), {
      authMode: 'password',
      password: 'p697',
    });

    expect(patched.authInjected).toBe(true);
    expect(patched.protocolPatched).toBe(true);
    expect(JSON.parse(patched.text)).toMatchObject({
      params: {
        minProtocol: 3,
        maxProtocol: 4,
        auth: {
          password: 'p697',
        },
      },
    });
  });

  it('preserves existing gateway password on proxied connect requests', () => {
    const original = JSON.stringify({
      type: 'req',
      id: 'req_1',
      method: 'connect.start',
      params: {
        auth: {
          password: 'existing-password',
        },
      },
    });

    expect(patchConnectRequestGatewayAuth(original, {
      authMode: 'password',
      password: 'p697',
    })).toEqual({
      text: original,
      injected: false,
    });
  });

  it('does not inject auth while token mode is active', () => {
    const original = JSON.stringify({
      type: 'req',
      id: 'req_1',
      method: 'connect',
      params: {},
    });

    expect(patchConnectRequestGatewayAuth(original, {
      authMode: 'token',
      password: 'p697',
    })).toEqual({
      text: original,
      injected: false,
    });
  });

  it('waits for the old gateway socket to close before reconnecting fresh client demand', async () => {
    const sockets: FakeSocket[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();

    relay.message(JSON.stringify({
      type: 'req',
      id: 'connect-a',
      method: 'connect',
      params: {
        auth: { token: 'secret' },
        device: { nonce: 'nonce-a' },
      },
    }));

    const gatewayA = sockets[1];
    gatewayA.open();
    expect(gatewayA.sent).toHaveLength(1);

    relay.message('__clawket_relay_control__:{"event":"client_count","count":1}');

    expect(gatewayA.closeCalls).toBe(1);
    expect(sockets).toHaveLength(2);

    relay.message(JSON.stringify({
      type: 'req',
      id: 'connect-b',
      method: 'connect',
      params: {
        auth: { token: 'secret' },
        device: { nonce: 'nonce-b' },
      },
    }));

    expect(gatewayA.sent).toHaveLength(1);
    expect(sockets).toHaveLength(2);

    gatewayA.closeFromRemote(1005);

    expect(sockets).toHaveLength(3);
    const gatewayB = sockets[2];
    gatewayB.open();

    expect(gatewayB.sent).toHaveLength(1);
    expect(JSON.parse(gatewayB.sent[0] as string)).toMatchObject({
      id: 'connect-b',
      params: {
        device: {
          nonce: 'nonce-b',
        },
      },
    });

    await runtime.stop();
  });

  it('retries proxied connect responses while OpenClaw startup sidecars are loading', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();

    relay.message(JSON.stringify({
      type: 'req',
      id: 'connect-a',
      method: 'connect',
      params: {
        auth: { token: 'secret' },
        device: { nonce: 'nonce-a' },
      },
    }));

    const gateway = sockets[1];
    gateway.open();
    expect(gateway.sent).toHaveLength(1);
    const relaySentBefore = relay.sent.length;

    gateway.message(JSON.stringify({
      type: 'res',
      id: 'connect-a',
      ok: false,
      error: {
        code: 'UNAVAILABLE',
        message: 'gateway startup sidecars are still loading',
        details: { reason: 'startup-sidecars' },
        retryAfterMs: 250,
      },
    }));

    expect(relay.sent).toHaveLength(relaySentBefore);

    await vi.advanceTimersByTimeAsync(250);
    expect(gateway.sent).toHaveLength(2);
    expect(JSON.parse(gateway.sent[1] as string)).toMatchObject({
      id: 'connect-a',
      method: 'connect',
    });

    gateway.message(JSON.stringify({
      type: 'res',
      id: 'connect-a',
      ok: true,
      payload: { type: 'hello-ok' },
    }));

    expect(relay.sent).toHaveLength(relaySentBefore + 1);
    expect(JSON.parse(relay.sent.at(-1) as string)).toMatchObject({
      id: 'connect-a',
      ok: true,
    });

    await runtime.stop();
    vi.useRealTimers();
  });

  it('does not connect the local gateway when relay demand drops to zero and no connect work is queued', async () => {
    const sockets: FakeSocket[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();

    relay.message('__clawket_relay_control__:{"event":"client_count","count":0}');

    expect(sockets).toHaveLength(1);

    await runtime.stop();
  });

  it('backs off gateway reconnect attempts after repeated failures', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const logs: string[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      gatewayRetryDelayMs: 10,
      onLog: (line) => logs.push(line),
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();
    relay.message('__clawket_relay_control__:{"event":"client_count","count":1}');

    const gatewayA = sockets[1];
    gatewayA.closeFromRemote(1006, 'socket hang up');

    expect(logs).toContain('gateway reconnect scheduled delayMs=10 attempt=1');
    expect(relay.sent.some((frame) => (
      typeof frame === 'string' && frame.includes('client.reconnect-required')
    ))).toBe(true);

    await vi.advanceTimersByTimeAsync(10);
    const gatewayB = sockets[2];
    gatewayB.closeFromRemote(1006, 'socket hang up');

    expect(logs).toContain('gateway reconnect scheduled delayMs=17 attempt=2');

    await runtime.stop();
    vi.useRealTimers();
  });

  it('resets relay reconnect backoff after a pong proves the connection healthy', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const logs: string[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      reconnectBaseDelayMs: 10,
      reconnectMaxDelayMs: 100,
      onLog: (line) => logs.push(line),
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();
    const relayA = sockets[0];
    relayA.open();
    relayA.closeFromRemote(1006, 'network');
    await vi.advanceTimersByTimeAsync(10);

    const relayB = sockets[1];
    relayB.open();
    relayB.emit('pong');
    relayB.closeFromRemote(1006, 'network');

    expect(logs.filter((line) => line === 'relay reconnect scheduled delayMs=10')).toHaveLength(2);
    expect(logs).toContain('relay health confirmed; reconnect backoff reset');

    await runtime.stop();
    vi.useRealTimers();
  });

  it('resets gateway reconnect backoff only after a successful connect response', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const logs: string[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      gatewayRetryDelayMs: 10,
      onLog: (line) => logs.push(line),
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();
    relay.message('__clawket_relay_control__:{"event":"client_count","count":1}');
    const gatewayA = sockets[1];
    gatewayA.closeFromRemote(1006, 'socket hang up');
    await vi.advanceTimersByTimeAsync(10);

    const gatewayB = sockets[2];
    gatewayB.open();
    relay.message(JSON.stringify({ type: 'req', id: 'connect-ok', method: 'connect', params: {} }));
    gatewayB.message(JSON.stringify({ type: 'res', id: 'connect-ok', ok: true }));
    gatewayB.closeFromRemote(1006, 'socket hang up');

    expect(logs.filter((line) => line === 'gateway reconnect scheduled delayMs=10 attempt=1')).toHaveLength(2);

    await runtime.stop();
    vi.useRealTimers();
  });

  it('connects to relay with a bearer header and redacts it in logs', async () => {
    const sockets: FakeSocket[] = [];
    const logs: string[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      onLog: (line) => logs.push(line),
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].options?.headers).toEqual({
      Authorization: `Bearer ${BASE_CONFIG.relaySecret}`,
    });
    expect(new URL(sockets[0].url).searchParams.get('token')).toBeNull();
    expect(logs.some((line) => line.includes('authorization=Bearer <redacted>'))).toBe(true);
    expect(logs.join('\n')).not.toContain(BASE_CONFIG.relaySecret);
    expect(logs.some((line) => line.includes(`gatewayId=${BASE_CONFIG.gatewayId}`))).toBe(true);
    expect(logs.join('\n')).not.toContain(BASE_CONFIG.instanceId);

    await runtime.stop();
  });

  it('uses fingerprint-based trust for local wss gateway connections', async () => {
    const fingerprint = new X509Certificate(TLS_CERT_PEM).fingerprint256?.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
    const stateDir = await createOpenClawStateDir({
      gateway: {
        port: 18789,
        tls: {
          enabled: true,
        },
        auth: {
          mode: 'token',
          token: 'gateway-token',
        },
      },
    });
    await mkdir(join(stateDir, 'gateway', 'tls'), { recursive: true });
    await writeFile(join(stateDir, 'gateway', 'tls', 'gateway-cert.pem'), TLS_CERT_PEM, 'utf8');
    vi.stubEnv('OPENCLAW_STATE_DIR', stateDir);

    const sockets: FakeSocket[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'wss://127.0.0.1:18789',
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();

    relay.message(JSON.stringify({
      type: 'req',
      id: 'connect-a',
      method: 'connect',
      params: {
        auth: { token: 'secret' },
        device: { nonce: 'nonce-a' },
      },
    }));

    const gateway = sockets[1];
    expect(gateway.options?.rejectUnauthorized).toBe(false);
    expect(typeof gateway.options?.checkServerIdentity).toBe('function');
    expect(
      gateway.options?.checkServerIdentity?.('127.0.0.1', {
        fingerprint256: fingerprint,
      } as PeerCertificate),
    ).toBeUndefined();
    expect(
      gateway.options?.checkServerIdentity?.('127.0.0.1', {
        fingerprint256: 'AA:BB:CC',
      } as PeerCertificate)?.message,
    ).toBe('gateway tls fingerprint mismatch');

    await runtime.stop();
  });

  it('logs connect response timing once the gateway answers', async () => {
    const sockets: FakeSocket[] = [];
    const logs: string[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      onLog: (line) => logs.push(line),
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();

    relay.message(JSON.stringify({
      type: 'req',
      id: 'connect-a',
      method: 'connect',
      params: {
        auth: { password: 'secret' },
        device: { nonce: 'nonce-a' },
      },
    }));

    const gateway = sockets[1];
    gateway.open();
    gateway.message(JSON.stringify({
      type: 'res',
      id: 'connect-a',
      ok: true,
      result: {
        accepted: true,
      },
    }));

    expect(logs.some((line) => line.includes('gateway connect response reqId=<redacted> method=connect'))).toBe(true);
    expect(logs.some((line) => line.includes('ok=true'))).toBe(true);
    expect(logs.join('\n')).not.toContain('connect-a');

    await runtime.stop();
  });

  it('logs a single warning when a connect handshake stays pending', async () => {
    const sockets: FakeSocket[] = [];
    const logs: string[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      heartbeatIntervalMs: 5,
      connectHandshakeWarnDelayMs: 5,
      onLog: (line) => logs.push(line),
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();

    relay.message(JSON.stringify({
      type: 'req',
      id: 'connect-stuck',
      method: 'connect',
      params: {
        auth: { password: 'secret' },
        device: { nonce: 'nonce-stuck' },
      },
    }));

    const gateway = sockets[1];
    gateway.open();

    await delay(20);

    expect(logs.filter((line) => line.includes('gateway connect still pending reqId=<redacted>'))).toHaveLength(1);
    expect(logs.join('\n')).not.toContain('connect-stuck');

    await runtime.stop();
  });

  it('keeps gateway ids while redacting other runtime identifiers and token-like values', () => {
    expect(sanitizeRuntimeLogLine(
      'runtime starting gatewayId=gw_sensitive instanceId=inst_sensitive requestId=req_sensitive deviceId=device_sensitive relay=grs_secret client=gct_secret',
    )).toBe(
      'runtime starting gatewayId=gw_sensitive instanceId=<redacted> requestId=<redacted> deviceId=<redacted> relay=<redacted> client=<redacted>',
    );
  });

  it('issues bootstrap tokens for a specific device and replies to the requesting relay client', async () => {
    const sockets: FakeSocket[] = [];
    const issueOpenClawBootstrapToken = vi.fn().mockResolvedValue({
      token: 'setup-bootstrap-token',
      expiresAtMs: 1_800_000_000_000,
      strategy: 'mobile-setup',
      access: 'full',
    });
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      issueOpenClawBootstrapToken,
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();

    relay.message(`__clawket_relay_control__:${JSON.stringify({
      type: 'control',
      event: 'bootstrap.request',
      requestId: 'req_bootstrap_1',
      sourceClientId: 'client-1',
      targetClientId: 'inst_test',
      payload: {
        deviceId: 'device-1',
        publicKey: 'public-key-1',
        role: 'operator',
        scopes: ['operator.write', 'operator.read'],
        capabilities: [OPENCLAW_MOBILE_SETUP_CAPABILITY],
      },
    })}`);
    await delay(10);

    expect(relay.sent).toHaveLength(1);
    const response = parseControl(relay.sent[0] as string);
    expect(response).toMatchObject({
      event: 'bootstrap.issued',
      requestId: 'req_bootstrap_1',
      targetClientId: 'client-1',
    });
    expect(response?.payload).toMatchObject({
      bootstrapToken: 'setup-bootstrap-token',
      expiresAtMs: 1_800_000_000_000,
      strategy: 'mobile-setup',
      access: 'full',
    });
    expect(issueOpenClawBootstrapToken).toHaveBeenCalledWith({
      deviceId: 'device-1',
      publicKey: 'public-key-1',
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      gatewayUrl: 'ws://127.0.0.1:18789',
    });

    await runtime.stop();
  });

  it.each([
    { label: 'missing capability metadata', capabilities: undefined },
    { label: 'unknown capability metadata', capabilities: ['future.unknown.v1'] },
  ])('keeps legacy bootstrap issuance for $label', async ({ capabilities }) => {
    const sockets: FakeSocket[] = [];
    const issueOpenClawBootstrapToken = vi.fn();
    const issueLegacyOpenClawBootstrapToken = vi.fn().mockResolvedValue({
      token: 'legacy-bootstrap-token',
      expiresAtMs: 1_800_000_000_000,
      strategy: 'legacy-bound',
    });
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      issueOpenClawBootstrapToken,
      issueLegacyOpenClawBootstrapToken,
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();

    relay.message(`__clawket_relay_control__:${JSON.stringify({
      type: 'control',
      event: 'bootstrap.request',
      requestId: 'req_bootstrap_legacy',
      sourceClientId: 'client-legacy',
      payload: {
        deviceId: 'device-legacy',
        publicKey: 'public-key-legacy',
        role: 'operator',
        scopes: ['operator.read'],
        ...(capabilities ? { capabilities } : {}),
      },
    })}`);
    await delay(10);

    expect(issueOpenClawBootstrapToken).not.toHaveBeenCalled();
    expect(issueLegacyOpenClawBootstrapToken).toHaveBeenCalledWith({
      deviceId: 'device-legacy',
      publicKey: 'public-key-legacy',
      role: 'operator',
      scopes: ['operator.read'],
      gatewayUrl: 'ws://127.0.0.1:18789',
    });
    expect(parseControl(relay.sent[0] as string)?.payload).toMatchObject({
      bootstrapToken: 'legacy-bootstrap-token',
      strategy: 'legacy-bound',
    });

    await runtime.stop();
  });

  it('returns bootstrap.error when bootstrap.request payload is invalid', async () => {
    const stateDir = await createOpenClawStateDir();
    vi.stubEnv('OPENCLAW_STATE_DIR', stateDir);

    const sockets: FakeSocket[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();

    relay.message('__clawket_relay_control__:{"type":"control","event":"bootstrap.request","requestId":"req_bootstrap_invalid","sourceClientId":"client-1","payload":{"deviceId":"device-1","publicKey":"","role":"operator","scopes":[]}}');
    await delay(10);

    expect(relay.sent).toHaveLength(1);
    const response = parseControl(relay.sent[0] as string);
    expect(response).toEqual({
      event: 'bootstrap.error',
      requestId: 'req_bootstrap_invalid',
      targetClientId: 'client-1',
      payload: {
        code: 'invalid_request',
        message: 'payload.publicKey is required',
      },
      count: undefined,
      sourceClientId: undefined,
    });

    await runtime.stop();
  });
});
