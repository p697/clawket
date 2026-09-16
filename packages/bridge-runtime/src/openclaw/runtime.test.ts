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
  BRIDGE_CAPABILITIES_V2,
  patchConnectResponseBridgeCapabilities,
  patchConnectRequestGatewayAuth,
  patchConnectRequestGatewayProtocolRange,
  patchOpenClawConnectRequest,
  stripConnectRequestBridgeMeta,
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
} from '../protocol.js';
import {
  FRAME_TOO_LARGE_CLOSE_CODE,
  FRAME_TOO_LARGE_ERROR_CODE,
  WEBSOCKET_FRAME_LIMIT_BYTES,
} from '../frame-limit.js';

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
  closeCode?: number;
  closeReason?: string;
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

  close(code = 1000, reason = ''): void {
    this.closeCalls += 1;
    this.closeCode = code;
    this.closeReason = reason;
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

  binaryMessage(data: Buffer): void {
    this.emit('message', data, true);
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
      capabilities: null,
      noncePresent: true,
      nonceLength: 9,
      authFields: ['token'],
    });
  });

  it('parses normalized capabilities from explicit connect meta', () => {
    expect(parseConnectHandshakeMeta(JSON.stringify({
      type: 'req',
      id: 'req_v2',
      method: 'connect',
      meta: {
        traceId: 'trace-1',
        capabilities: [' app.future.v3 ', BRIDGE_CAPABILITIES_V2, 'app.future.v3'],
      },
      params: {},
    }))).toMatchObject({
      id: 'req_v2',
      method: 'connect',
      capabilities: ['app.future.v3', BRIDGE_CAPABILITIES_V2],
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

  it('keeps a canonical v1 connect request byte-identical when top-level meta is absent', () => {
    const original = '{ "type": "req", "id": "req_v1", "method": "connect", "params": { "minProtocol": 3, "maxProtocol": 4 } }';

    expect(patchOpenClawConnectRequest(original, {
      authMode: 'token',
      password: null,
    })).toEqual({
      text: original,
      authInjected: false,
      protocolPatched: false,
      bridgeMetaStripped: false,
      bridgeCapabilitiesRequested: false,
    });
    const malformedMeta = JSON.stringify({
      type: 'req',
      method: 'connect.start',
      meta: { capabilities: BRIDGE_CAPABILITIES_V2 },
    });
    expect(stripConnectRequestBridgeMeta(malformedMeta)).toEqual({
      text: JSON.stringify({
        type: 'req',
        method: 'connect.start',
      }),
      stripped: true,
      bridgeCapabilitiesRequested: false,
    });
  });

  it('negotiates Bridge capabilities through Gateway-compatible params.caps without rewriting v1 envelopes', () => {
    for (const caps of [['tool-events', BRIDGE_CAPABILITIES_V2], ['tool-events'], BRIDGE_CAPABILITIES_V2, null]) {
      const text = JSON.stringify({ type: 'req', id: 'caps-connect', method: 'connect', params: { caps } });
      expect(stripConnectRequestBridgeMeta(text)).toEqual({
        text, stripped: false,
        bridgeCapabilitiesRequested: Array.isArray(caps) && caps.includes(BRIDGE_CAPABILITIES_V2),
      });
    }
  });

  it('strips Bridge-owned request meta before Gateway while preserving envelope siblings', () => {
    const prepared = stripConnectRequestBridgeMeta(JSON.stringify({
      type: 'req',
      id: 'req_v2',
      method: 'connect.start',
      futureEnvelope: { mode: 'preserve-me' },
      meta: {
        traceId: 'trace-1',
        futureMeta: { enabled: true },
        capabilities: [' app.future.v3 ', ` ${BRIDGE_CAPABILITIES_V2} `, 'app.future.v3', '', 42],
      },
      params: { minProtocol: 3, maxProtocol: 4 },
    }));

    expect(prepared.stripped).toBe(true);
    expect(prepared.bridgeCapabilitiesRequested).toBe(true);
    expect(JSON.parse(prepared.text)).toEqual({
      type: 'req',
      id: 'req_v2',
      method: 'connect.start',
      futureEnvelope: { mode: 'preserve-me' },
      params: { minProtocol: 3, maxProtocol: 4 },
    });

    for (const capabilities of [[], ['future.bridge.v3']]) {
      const unnegotiated = JSON.stringify({
        type: 'req',
        id: 'req_unnegotiated',
        method: 'connect',
        futureEnvelope: { mode: 'preserve-me' },
        meta: { capabilities },
      });
      expect(stripConnectRequestBridgeMeta(unnegotiated)).toEqual({
        text: JSON.stringify({
          type: 'req',
          id: 'req_unnegotiated',
          method: 'connect',
          futureEnvelope: { mode: 'preserve-me' },
        }),
        stripped: true,
        bridgeCapabilitiesRequested: false,
      });
    }
  });

  it('strips malformed and unknown top-level connect meta without negotiating capabilities', () => {
    for (const meta of [null, '', 42, [], {}, { future: true }, { capabilities: BRIDGE_CAPABILITIES_V2 }]) {
      const request = JSON.stringify({
        type: 'req',
        id: 'req_unnegotiated_meta',
        method: 'connect.start',
        futureEnvelope: { mode: 'preserve-me' },
        meta,
        params: { minProtocol: 3, maxProtocol: 4 },
      });
      expect(stripConnectRequestBridgeMeta(request)).toEqual({
        text: JSON.stringify({
          type: 'req',
          id: 'req_unnegotiated_meta',
          method: 'connect.start',
          futureEnvelope: { mode: 'preserve-me' },
          params: { minProtocol: 3, maxProtocol: 4 },
        }),
        stripped: true,
        bridgeCapabilitiesRequested: false,
      });
    }

    const nonConnect = JSON.stringify({
      type: 'req',
      id: 'req_chat_meta',
      method: 'chat.send',
      meta: { future: true },
      params: { message: 'keep me' },
    });
    expect(stripConnectRequestBridgeMeta(nonConnect)).toEqual({
      text: nonConnect,
      stripped: false,
      bridgeCapabilitiesRequested: false,
    });
  });

  it('adds Bridge capabilities only to successful connect responses', () => {
    const successful = patchConnectResponseBridgeCapabilities(JSON.stringify({
      type: 'res',
      id: 'req_v2',
      ok: true,
      futureEnvelope: { mode: 'preserve-me' },
      meta: {
        traceId: 'trace-response',
        capabilities: [' gateway.future.v3 ', 'gateway.future.v3'],
      },
      payload: { protocol: 4 },
    }), ' 3.0.0-preview.1 ');
    expect(successful.patched).toBe(true);
    expect(JSON.parse(successful.text)).toEqual({
      type: 'res',
      id: 'req_v2',
      ok: true,
      futureEnvelope: { mode: 'preserve-me' },
      meta: {
        traceId: 'trace-response',
        capabilities: ['gateway.future.v3', BRIDGE_CAPABILITIES_V2],
        bridgeVersion: '3.0.0-preview.1',
      },
      payload: { protocol: 4 },
    });

    const alreadyDeclared = patchConnectResponseBridgeCapabilities(JSON.stringify({
      type: 'res',
      id: 'req_v2_existing',
      ok: true,
      meta: {
        bridgeVersion: 'not-the-bridge-version',
        capabilities: [` ${BRIDGE_CAPABILITIES_V2} `, 'gateway.future.v3', BRIDGE_CAPABILITIES_V2],
      },
    }), ' \n ');
    expect(JSON.parse(alreadyDeclared.text).meta.capabilities).toEqual([
      BRIDGE_CAPABILITIES_V2,
      'gateway.future.v3',
    ]);
    expect(JSON.parse(alreadyDeclared.text).meta).not.toHaveProperty('bridgeVersion');

    const failed = JSON.stringify({ type: 'res', id: 'req_v2', ok: false });
    expect(patchConnectResponseBridgeCapabilities(failed)).toEqual({
      text: failed,
      patched: false,
    });
  });

  it('forwards a canonical v1 connect request byte-identically through BridgeRuntime', async () => {
    vi.stubEnv('OPENCLAW_STATE_DIR', await createOpenClawStateDir());
    const sockets: FakeSocket[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      bridgeVersion: '3.0.0-test',
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    const original = '{ "type": "req", "id": "req_v1_wire", "method": "connect", "params": { "minProtocol": 3, "maxProtocol": 4 } }';

    runtime.start();
    const relay = sockets[0];
    relay.open();
    relay.message(original);
    const gateway = sockets[1];
    gateway.open();

    expect(gateway.sent).toEqual([original]);
    const response = '{ "type": "res", "id": "req_v1_wire", "ok": true, "payload": { "protocol": 4 } }';
    gateway.message(response);
    expect(relay.sent).toEqual([response]);
    await runtime.stop();
  });

  it('merges Bridge capability meta on the Runtime forwarding path', async () => {
    vi.stubEnv('OPENCLAW_STATE_DIR', await createOpenClawStateDir());
    const sockets: FakeSocket[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      bridgeVersion: '3.0.0-test',
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    const request = JSON.stringify({
      type: 'req',
      id: 'req_v2_wire',
      method: 'connect.start',
      futureEnvelope: { mode: 'preserve-me' },
      meta: {
        traceId: 'trace-wire',
        futureMeta: { enabled: true },
        capabilities: [' app.future.v3 ', BRIDGE_CAPABILITIES_V2, 'app.future.v3'],
      },
      params: { minProtocol: 3, maxProtocol: 4 },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();
    relay.message(request);
    const gateway = sockets[1];
    gateway.open();

    expect(JSON.parse(gateway.sent[0] as string)).toEqual({
      type: 'req',
      id: 'req_v2_wire',
      method: 'connect.start',
      futureEnvelope: { mode: 'preserve-me' },
      params: { minProtocol: 3, maxProtocol: 4 },
    });
    const unrelatedResponse = '{ "type": "res", "id": "unrelated", "ok": true }';
    gateway.message(unrelatedResponse);
    expect(relay.sent).toEqual([unrelatedResponse]);
    gateway.message(JSON.stringify({
      type: 'res',
      id: 'req_v2_wire',
      ok: true,
      futureResponse: { mode: 'preserve-me-too' },
      payload: {
        protocol: 4,
        server: { version: '2026.9.5-openclaw' },
      },
    }));
    expect(JSON.parse(relay.sent[1] as string)).toEqual({
      type: 'res',
      id: 'req_v2_wire',
      ok: true,
      futureResponse: { mode: 'preserve-me-too' },
      payload: {
        protocol: 4,
        server: { version: '2026.9.5-openclaw' },
      },
      meta: {
        capabilities: [BRIDGE_CAPABILITIES_V2],
        bridgeVersion: '3.0.0-test',
      },
    });
    await runtime.stop();
  });

  it('strips unnegotiated connect meta on the Runtime path without advertising Bridge capabilities', async () => {
    vi.stubEnv('OPENCLAW_STATE_DIR', await createOpenClawStateDir());
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
    const request = JSON.stringify({
      type: 'req',
      id: 'req_future_meta_wire',
      method: 'connect',
      futureEnvelope: { mode: 'preserve-me' },
      meta: {
        capabilities: ['future.bridge.v3'],
        futureMeta: { enabled: true },
      },
      params: { minProtocol: 3, maxProtocol: 4 },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();
    relay.message(request);
    const gateway = sockets[1];
    gateway.open();

    expect(JSON.parse(gateway.sent[0] as string)).toEqual({
      type: 'req',
      id: 'req_future_meta_wire',
      method: 'connect',
      futureEnvelope: { mode: 'preserve-me' },
      params: { minProtocol: 3, maxProtocol: 4 },
    });
    const response = '{ "type": "res", "id": "req_future_meta_wire", "ok": true, "payload": { "protocol": 4 } }';
    gateway.message(response);
    expect(relay.sent).toEqual([response]);
    await runtime.stop();
  });

  it('clears pending Bridge capability negotiations on Gateway close and runtime stop', async () => {
    vi.stubEnv('OPENCLAW_STATE_DIR', await createOpenClawStateDir());
    const sockets: FakeSocket[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      gatewayRetryDelayMs: 60_000,
      createWebSocket: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    const negotiatedRequest = JSON.stringify({
      type: 'req',
      id: 'req_pending_capability',
      method: 'connect',
      meta: { capabilities: [BRIDGE_CAPABILITIES_V2] },
      params: { minProtocol: 3, maxProtocol: 4 },
    });

    runtime.start();
    const relay = sockets[0];
    relay.open();
    relay.message(negotiatedRequest);
    const gateway = sockets[1];
    gateway.open();
    expect((runtime as any).inFlightConnectHandshakes.size).toBe(1);

    gateway.closeFromRemote(1006, 'network');
    expect((runtime as any).inFlightConnectHandshakes.size).toBe(0);

    relay.message(negotiatedRequest);
    const replacement = sockets[2];
    replacement.open();
    expect((runtime as any).inFlightConnectHandshakes.size).toBe(1);

    await runtime.stop();
    expect((runtime as any).inFlightConnectHandshakes.size).toBe(0);
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

  it('recycles the full relay after a challenge receives no connect, instead of repeating local timeouts', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const logs: string[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG, gatewayUrl: 'ws://127.0.0.1:18789',
      onLog: (line) => logs.push(line),
      createWebSocket: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    });
    try {
      runtime.start();
      const relay = sockets[0];
      relay.open();
      relay.message('__clawket_relay_control__:{"event":"client_connected","count":1}');
      const gateway = sockets[1];
      gateway.open();
      gateway.message(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'private-nonce' } }));
      await vi.advanceTimersByTimeAsync(7_999);
      expect(relay.readyState).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay.readyState).toBe(3);
      expect(logs).toContain('connection phase=challenge_wait code=connect_request_missing elapsedMs=8000 action=relay_recycle');
      expect(logs.join(' ')).not.toContain('private-nonce');
      expect(logs.some((line) => line.startsWith('relay reconnect scheduled'))).toBe(true);
    } finally { await runtime.stop(); vi.useRealTimers(); }
  });

  it('does not mistake slow bootstrap issuance for a lost challenge', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    let finish!: (value: { token: string; expiresAtMs: number; strategy: 'mobile-setup'; access: 'full' }) => void;
    const issued = new Promise<{ token: string; expiresAtMs: number; strategy: 'mobile-setup'; access: 'full' }>((resolve) => { finish = resolve; });
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG, gatewayUrl: 'ws://127.0.0.1:18789',
      issueOpenClawBootstrapToken: () => issued,
      createWebSocket: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    });
    try {
      runtime.start();
      const relay = sockets[0]; relay.open();
      relay.message('__clawket_relay_control__:{"event":"client_connected","count":1}');
      const gateway = sockets[1]; gateway.open();
      gateway.message('{"type":"event","event":"connect.challenge"}');
      relay.message(`__clawket_relay_control__:${JSON.stringify({
        event: 'bootstrap.request', requestId: 'bootstrap-test', sourceClientId: 'client-test',
        payload: { deviceId: 'test-device', publicKey: 'test-public-key', role: 'operator', scopes: ['operator.read'], capabilities: [OPENCLAW_MOBILE_SETUP_CAPABILITY] },
      })}`);
      await vi.advanceTimersByTimeAsync(12_000);
      expect(relay.readyState).toBe(1);
      finish({ token: 'private-token', expiresAtMs: Date.now() + 60_000, strategy: 'mobile-setup', access: 'full' });
      await vi.advanceTimersByTimeAsync(7_999);
      expect(relay.readyState).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay.readyState).toBe(3);
    } finally { await runtime.stop(); vi.useRealTimers(); }
  });

  it.each(['connect', 'disconnect', 'stop'])('cancels the challenge watchdog on %s', async (action) => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG, gatewayUrl: 'ws://127.0.0.1:18789',
      createWebSocket: (url) => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    });
    try {
      runtime.start();
      const relay = sockets[0]; relay.open();
      relay.message('__clawket_relay_control__:{"event":"client_connected","count":1}');
      const gateway = sockets[1]; gateway.open();
      gateway.message('{"type":"event","event":"connect.challenge"}');
      if (action === 'connect') relay.message('{"type":"req","id":"test-connect","method":"connect","params":{}}');
      if (action === 'disconnect') relay.message('__clawket_relay_control__:{"event":"client_disconnected"}');
      if (action === 'stop') await runtime.stop();
      await vi.advanceTimersByTimeAsync(8_001);
      expect(relay.readyState).toBe(action === 'stop' ? 2 : 1);
    } finally { await runtime.stop(); vi.useRealTimers(); }
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

  it('enforces the 8 MiB frame boundary on both OpenClaw sockets', async () => {
    const sockets: FakeSocket[] = [];
    const runtime = new BridgeRuntime({
      config: BASE_CONFIG,
      gatewayUrl: 'ws://127.0.0.1:18789',
      createWebSocket: (url, options) => {
        const socket = new FakeSocket(url, options);
        sockets.push(socket);
        return socket;
      },
    });

    runtime.start();
    const relay = sockets[0];
    expect(relay.options?.maxPayload).toBe(WEBSOCKET_FRAME_LIMIT_BYTES);
    relay.open();

    const exactBoundary = Buffer.alloc(WEBSOCKET_FRAME_LIMIT_BYTES);
    relay.binaryMessage(exactBoundary);
    const gateway = sockets[1];
    expect(gateway.options?.maxPayload).toBe(WEBSOCKET_FRAME_LIMIT_BYTES);
    expect(relay.closeCalls).toBe(0);
    gateway.open();

    gateway.binaryMessage(exactBoundary);
    expect((relay.sent.at(-1) as Buffer).byteLength).toBe(WEBSOCKET_FRAME_LIMIT_BYTES);

    const oversized = Buffer.alloc(WEBSOCKET_FRAME_LIMIT_BYTES + 1);
    gateway.binaryMessage(oversized);
    expect(gateway.closeCode).toBe(FRAME_TOO_LARGE_CLOSE_CODE);
    expect(gateway.closeReason).toBe(FRAME_TOO_LARGE_ERROR_CODE);
    expect(relay.sent).toHaveLength(1);

    relay.binaryMessage(oversized);
    expect(relay.closeCode).toBe(FRAME_TOO_LARGE_CLOSE_CODE);
    expect(relay.closeReason).toBe(FRAME_TOO_LARGE_ERROR_CODE);

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

it('negotiates independent client runtimes and retires only the disconnected channel', async () => {
  const sockets: FakeSocket[] = [];
  const runtime = new BridgeRuntime({ clientChannels: true, config: BASE_CONFIG, gatewayUrl: 'ws://localhost:18789', createWebSocket: (url, options) => {
    const socket = new FakeSocket(url, options); sockets.push(socket); return socket;
  } });
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  runtime.start();
  sockets[0].open();
  const sync = (clients: string[]) => sockets[0].emit('message', Buffer.from('__clawket_relay_control__:' + JSON.stringify({ event: 'client.sockets', payload: { clients } })), false);
  sync(ids);
  expect(sockets).toHaveLength(3);
  expect(new URL(sockets[1].url).searchParams.get('targetConnectionId')).toBe(ids[0]);
  expect(new URL(sockets[2].url).searchParams.get('targetConnectionId')).toBe(ids[1]);
  sync([ids[1]]);
  await Promise.resolve();
  await Promise.resolve();
  expect(sockets[1].closeCalls).toBe(1);
  expect(sockets[2].closeCalls).toBe(0);
  sync([ids[1]]);
  await expect(runtime.approvePairRequest('retired-request')).rejects.toThrow('no longer available');
  await expect(runtime.rejectPairRequest('retired-request')).rejects.toThrow('no longer available');
  expect(sockets).toHaveLength(3);
  await runtime.stop();
  expect(sockets[2].closeCalls).toBe(1);
});

it.each([false, true])('keeps connected pairing decisions routed to the correct gateway (channels: %s)', async (channels) => {
  const sockets: FakeSocket[] = [];
  const runtime = new BridgeRuntime({ clientChannels: channels, config: BASE_CONFIG, gatewayUrl: 'ws://localhost:18789', createWebSocket: (url, options) => {
    const socket = new FakeSocket(url, options); sockets.push(socket); return socket;
  } });
  try {
    runtime.start();
    sockets[0].open();
    if (channels) {
      sockets[0].message('__clawket_relay_control__:' + JSON.stringify({ event: 'client.sockets', payload: { clients: ['11111111-1111-4111-8111-111111111111'] } }));
      sockets[1].open();
    }
    const relay = sockets[channels ? 1 : 0];
    relay.message(JSON.stringify({ type: 'req', id: 'connect-1', method: 'connect', params: {} }));
    await delay(10);
    const gateway = sockets.find((socket) => socket.url === 'ws://localhost:18789');
    expect(gateway).toBeDefined();
    gateway!.open();
    gateway!.message(JSON.stringify({ type: 'res', id: 'connect-1', ok: false, error: { code: 'NOT_PAIRED', message: 'pairing required', details: { requestId: 'pair-live' } } }));
    await delay(10);
    expect(runtime.getSnapshot().pendingPairRequests.some((request) => request.requestId === 'pair-live')).toBe(true);
    await runtime.approvePairRequest('pair-live');
    await runtime.rejectPairRequest('pair-live');
    const methods = gateway!.sent.map((frame) => { try { return JSON.parse(String(frame)).method; } catch { return null; } });
    expect(methods).toContain('device.pair.approve');
    expect(methods).toContain('device.pair.reject');
    expect(sockets.filter((socket) => socket.url === 'ws://localhost:18789')).toHaveLength(1);
  } finally { await runtime.stop(); }
});


it('does not let a stale socket pong reset the replacement watchdog', async () => {
  vi.useFakeTimers();
  const sockets: FakeSocket[] = [];
  const logs: string[] = [];
  const runtime = new BridgeRuntime({ config: BASE_CONFIG, gatewayUrl: 'ws://127.0.0.1:18789',
    heartbeatIntervalMs: 1000, heartbeatTimeoutMs: 3000, reconnectBaseDelayMs: 100,
    onLog: line => logs.push(line), createWebSocket: url => { const socket = new FakeSocket(url); sockets.push(socket); return socket; } });
  try {
    runtime.start(); sockets[0].open();
    sockets[0].closeFromRemote(1006, '');
    await vi.advanceTimersByTimeAsync(100);
    const replacement = sockets[1]; replacement.open();
    await vi.advanceTimersByTimeAsync(3000);
    sockets[0].emit('pong');
    await vi.advanceTimersByTimeAsync(1000);
    expect(replacement.readyState).toBe(3);
    expect(logs.some(line => /heartbeat timed out idleMs=4000 timeoutMs=3000 schedulerDelayMs=0/.test(line))).toBe(true);
  } finally { await runtime.stop(); vi.useRealTimers(); }
});


it('retires an invalid client channel on HTTP 409 without retrying the expired identity', async () => {
  vi.useFakeTimers();
  const sockets: FakeSocket[] = [];
  const logs: string[] = [];
  const runtime = new BridgeRuntime({ config: BASE_CONFIG, gatewayUrl: 'ws://127.0.0.1:18789', clientChannels: true,
    onLog: line => logs.push(line), createWebSocket: url => { const socket = new FakeSocket(url); sockets.push(socket); return socket; } });
  let stopped: Promise<void> | undefined;
  try {
    runtime.start(); const owner = sockets[0]; owner.open();
    const sendClients = (clients: string[]) => owner.message('__clawket_relay_control__:' + JSON.stringify({ event: 'client.sockets', payload: { clients } }));
    sendClients(['11111111-1111-4111-8111-111111111111']);
    const rejected = sockets[1];
    const destroy = vi.fn();
    rejected.emit('unexpected-response', {}, { statusCode: 409, destroy });
    await vi.advanceTimersByTimeAsync(30000);
    owner.emit('pong');
    expect(sockets).toHaveLength(2);
    expect(destroy).toHaveBeenCalledOnce();
    expect(logs.some(line => line.includes('channel retired code=client_channel_unavailable'))).toBe(true);
    sendClients(['22222222-2222-4222-8222-222222222222']);
    expect(sockets).toHaveLength(3);
    expect(sockets[2].url).toContain('22222222-2222-4222-8222-222222222222');
  } finally { stopped = runtime.stop(); await vi.advanceTimersByTimeAsync(100); await stopped; vi.useRealTimers(); }
});

it('keeps normal owner retry behavior after an HTTP upgrade failure', async () => {
  vi.useFakeTimers();
  const sockets: FakeSocket[] = [];
  const runtime = new BridgeRuntime({ config: BASE_CONFIG, gatewayUrl: 'ws://127.0.0.1:18789', reconnectBaseDelayMs: 100,
    createWebSocket: url => { const socket = new FakeSocket(url); sockets.push(socket); return socket; } });
  try {
    runtime.start();
    sockets[0].emit('unexpected-response', {}, { statusCode: 503, destroy: vi.fn() });
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(2);
  } finally { const stopped = runtime.stop(); await vi.advanceTimersByTimeAsync(100); await stopped; vi.useRealTimers(); }
});
