import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket, { type RawData, type WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BridgeRuntime } from '../../packages/bridge-runtime/src/runtime';
import { HermesRelayRuntime } from '../../packages/bridge-runtime/src/hermes-relay';
import { getFreePort } from '../integration/harness';
import { loadCompatFixture } from './loader';
import {
  closeWebSocket,
  closeWebSocketServer,
  CompatWranglerDevProcess,
  delay,
  isRecord,
  openWebSocket,
  parseJson,
  startCompatWranglerDevProcesses,
  startWebSocketServer,
  waitFor,
  WebSocketInbox,
  wsUrl,
} from './live-harness';
import {
  compareCompatValues,
  createCompatComparisonContext,
  findFrame,
  materializeFixtureValue,
  type CompatFixture,
  type CompatComparisonContext,
  type JsonValue,
} from './schema';

const CONTROL_PREFIX = '__clawket_relay_control__:';

let openClawRegistry: CompatWranglerDevProcess;
let openClawRelay: CompatWranglerDevProcess;
let hermesRegistry: CompatWranglerDevProcess;
let hermesRelay: CompatWranglerDevProcess;
let openClawFixture: CompatFixture;
let registryFixture: CompatFixture;
let hermesFixture: CompatFixture;
let bridgeFixture: CompatFixture;
let isolatedOpenClawState = '';

const savedOpenClawEnv = new Map<string, string | undefined>();
const liveFixtureCoverage = new Map<string, Set<string>>();
const isolatedEnvNames = [
  'OPENCLAW_STATE_DIR',
  'CLAWDBOT_STATE_DIR',
  'OPENCLAW_CONFIG_PATH',
  'CLAWDBOT_CONFIG_PATH',
  'OPENCLAW_GATEWAY_TOKEN',
  'CLAWDBOT_GATEWAY_TOKEN',
  'OPENCLAW_GATEWAY_PASSWORD',
  'CLAWDBOT_GATEWAY_PASSWORD',
] as const;

beforeAll(async () => {
  [registryFixture, openClawFixture, hermesFixture, bridgeFixture] = await Promise.all([
    loadCompatFixture('registry/openclaw-v1.json'),
    loadCompatFixture('relay-openclaw/openclaw-v1.json'),
    loadCompatFixture('relay-hermes/hermes-v1.json'),
    loadCompatFixture('bridge/openclaw-forwarding-v1.json'),
  ]);

  isolatedOpenClawState = await mkdtemp(join(tmpdir(), 'clawket-compat-openclaw-'));
  for (const name of isolatedEnvNames) {
    savedOpenClawEnv.set(name, process.env[name]);
    delete process.env[name];
  }
  process.env.OPENCLAW_STATE_DIR = isolatedOpenClawState;

  const [
    openClawRegistryPort,
    openClawRelayPort,
    hermesRegistryPort,
    hermesRelayPort,
    openClawRegistryInspectorPort,
    openClawRelayInspectorPort,
    hermesRegistryInspectorPort,
    hermesRelayInspectorPort,
  ] = await Promise.all([
    getFreePort(),
    getFreePort(),
    getFreePort(),
    getFreePort(),
    getFreePort(),
    getFreePort(),
    getFreePort(),
    getFreePort(),
  ]);
  const openClawRelayUrl = `ws://127.0.0.1:${openClawRelayPort}/ws`;
  const hermesRelayUrl = `ws://127.0.0.1:${hermesRelayPort}/ws`;

  [openClawRegistry, hermesRegistry] = await startCompatWranglerDevProcesses([
    {
      cwd: process.cwd(),
      configPath: 'apps/relay-registry/wrangler.toml',
      port: openClawRegistryPort,
      inspectorPort: openClawRegistryInspectorPort,
      envVars: {
        RELAY_REGION_MAP: relayMap(openClawRelayUrl),
        PAIR_ACCESS_CODE_TTL_SEC: '600',
        PAIR_CLIENT_TOKEN_MAX: '8',
      },
    },
    {
      cwd: process.cwd(),
      configPath: 'apps/hermes-relay-registry/wrangler.toml',
      port: hermesRegistryPort,
      inspectorPort: hermesRegistryInspectorPort,
      envVars: {
        RELAY_REGION_MAP: relayMap(hermesRelayUrl),
        PAIR_ACCESS_CODE_TTL_SEC: '600',
        PAIR_CLIENT_TOKEN_MAX: '8',
      },
    },
  ]);

  [openClawRelay, hermesRelay] = await startCompatWranglerDevProcesses([
    {
      cwd: process.cwd(),
      configPath: 'apps/relay-worker/wrangler.toml',
      port: openClawRelayPort,
      inspectorPort: openClawRelayInspectorPort,
      envVars: {
        REGISTRY_VERIFY_URL: openClawRegistry.baseUrl,
        MAX_MESSAGES_PER_10S: '20',
        MAX_CLIENT_MESSAGES_PER_10S: '20',
        HEARTBEAT_INTERVAL_MS: '300',
        CLIENT_PONG_TIMEOUT_MS: '1200',
        AWAITING_CHALLENGE_TTL_MS: '5000',
        GATEWAY_OWNER_LEASE_MS: '30000',
      },
    },
    {
      cwd: process.cwd(),
      configPath: 'apps/hermes-relay-worker/wrangler.toml',
      port: hermesRelayPort,
      inspectorPort: hermesRelayInspectorPort,
      envVars: {
        REGISTRY_VERIFY_URL: hermesRegistry.baseUrl,
        HEARTBEAT_INTERVAL_MS: '30000',
        CLIENT_PONG_TIMEOUT_MS: '30000',
        GATEWAY_PING_TIMEOUT_MS: '12000',
        GATEWAY_OWNER_LEASE_MS: '30000',
      },
    },
  ]);
}, 90_000);

afterAll(async () => {
  await Promise.allSettled([
    openClawRelay?.stop(),
    openClawRegistry?.stop(),
    hermesRelay?.stop(),
    hermesRegistry?.stop(),
  ]);
  if (isolatedOpenClawState) await rm(isolatedOpenClawState, { recursive: true, force: true });
  for (const name of isolatedEnvNames) {
    const previous = savedOpenClawEnv.get(name);
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }

  assertLiveFixtureCoverage([
    registryFixture,
    openClawFixture,
    hermesFixture,
    bridgeFixture,
  ], new Map([
    [openClawFixture?.id, new Set(['close.dead-socket'])],
  ]));
});

describe('v1 compatibility live replay', () => {
  it('replays Registry register, access-code, session resolve, and claim through Wrangler dev', async () => {
    const comparison = createCompatComparisonContext();
    const registerRequest = { displayName: 'Compatibility Mac', preferredRegion: 'us' };
    assertFixtureFrame(registryFixture, 'register.request', httpRequest('/v1/pair/register', registerRequest), comparison);
    const register = await postJson(openClawRegistry.baseUrl, '/v1/pair/register', registerRequest);
    assertFixtureFrame(registryFixture, 'register.response', register, comparison);
    const registered = requireRecord(register.body, 'register response');

    const accessRequest = {
      gatewayId: requireString(registered, 'gatewayId'),
      relaySecret: requireString(registered, 'relaySecret'),
      displayName: 'Compatibility Mac 2',
    };
    assertFixtureFrame(registryFixture, 'access-code.request', httpRequest('/v1/pair/access-code', accessRequest), comparison);
    const access = await postJson(openClawRegistry.baseUrl, '/v1/pair/access-code', accessRequest);
    assertFixtureFrame(registryFixture, 'access-code.response', access, comparison);
    const accessBody = requireRecord(access.body, 'access-code response');

    const sessionRequest = {
      gatewayId: accessRequest.gatewayId,
      relaySecret: accessRequest.relaySecret,
      codeHash: '3f63d25fcb898ecfd6c2e2322bfdb11f44fe17dd0dc359e70b7246224bb223e9',
      shortCodeHash: '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92',
      linkPayload: {
        nonce: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYX',
        ciphertext: 'CVnmZpjgNOwAinuGGvP3Pz2TWTisr9YqlBPsUQX_K-N_03fy6kxHm2LQAg',
      },
      codePayload: {
        nonce: 'GBkaGxwdHh8gISIjJCUmJygpKissLS4v',
        ciphertext: 'jsbEIuq1G0BEyGQJ6C-uclVav65fyvIyGJZQzQgLdZByg8z5dutvt0GL-Q',
      },
    };
    assertFixtureFrame(registryFixture, 'session-create.request', httpRequest('/v1/pair/session', sessionRequest), comparison);
    const session = await postJson(openClawRegistry.baseUrl, '/v1/pair/session', sessionRequest);
    assertFixtureFrame(registryFixture, 'session-create.response', session, comparison);
    const sessionBody = requireRecord(session.body, 'session response');

    const resolveRequest = { codeHash: sessionRequest.codeHash };
    assertFixtureFrame(registryFixture, 'session-resolve.request', httpRequest('/v1/pair/session/resolve', resolveRequest), comparison);
    const resolved = await postJson(openClawRegistry.baseUrl, '/v1/pair/session/resolve', resolveRequest);
    assertFixtureFrame(registryFixture, 'session-resolve.response', resolved, comparison);

    const claimRequest = {
      gatewayId: accessRequest.gatewayId,
      accessCode: requireString(accessBody, 'accessCode'),
      clientLabel: 'Compatibility iPhone',
    };
    assertFixtureFrame(registryFixture, 'claim.request', httpRequest('/v1/pair/claim', claimRequest), comparison);
    const claim = await postJson(openClawRegistry.baseUrl, '/v1/pair/claim', claimRequest);
    assertFixtureFrame(registryFixture, 'claim.response', claim, comparison);

    const consumed = await fetch(
      `${openClawRegistry.baseUrl}/v1/pair/session/${encodeURIComponent(requireString(sessionBody, 'sessionId'))}`,
    );
    expect(consumed.status).toBe(404);
  });

  it('replays OpenClaw frames through Wrangler Relay and an in-process BridgeRuntime', async () => {
    const assertOpenClaw = createFixtureAsserter(openClawFixture);
    const assertBridge = createFixtureAsserter(bridgeFixture);
    const paired = await pairOpenClaw('Bridge Replay');
    const gatewayPort = await getFreePort();
    const gatewayFrames: Record<string, unknown>[] = [];
    const bridgeRelayConnections: JsonValue[] = [];
    let localGatewaySocket: WebSocket | null = null;
    const gatewayServer = await startWebSocketServer(gatewayPort, (socket) => {
      localGatewaySocket = socket;
      socket.on('message', (data: RawData, isBinary: boolean) => {
        if (isBinary) return;
        const parsed = parseJson(toText(data));
        if (!parsed) return;
        gatewayFrames.push(parsed);
        const id = typeof parsed.id === 'string' ? parsed.id : '';
        if (id === 'connect-c2-v1') socket.send(frameWire(openClawFixture, 'connect.c2.response'));
        if (id === 'connect-31a-v1') socket.send(frameWire(openClawFixture, 'connect.31a.response'));
        if (id === 'connect-d9c-v1') socket.send(frameWire(openClawFixture, 'connect.d9c.response'));
        if (id === 'connect-start-v1') socket.send(frameWire(openClawFixture, 'connect-start.response'));
        if (id === 'chat-v1') socket.send(frameWire(openClawFixture, 'chat-send.response'));
        if (id === 'sessions-v1') socket.send(frameWire(openClawFixture, 'sessions-list.response'));
        if (id === 'chat-image-v1') socket.send(frameWire(openClawFixture, 'chat-send-1.5m.response'));
      });
      socket.send(frameWire(openClawFixture, 'connect.31a.challenge'));
    });

    const runtime = new BridgeRuntime({
      config: {
        serverUrl: openClawRegistry.baseUrl,
        gatewayId: paired.gatewayId,
        relaySecret: paired.relaySecret,
        relayUrl: paired.relayUrl,
        instanceId: 'compat-bridge',
        displayName: 'Bridge Replay',
        createdAt: '2026-09-05T00:00:00.000Z',
        updatedAt: '2026-09-05T00:00:00.000Z',
      },
      gatewayUrl: `ws://127.0.0.1:${gatewayPort}`,
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 500,
      heartbeatIntervalMs: 250,
      heartbeatTimeoutMs: 5_000,
      createWebSocket: (url, options) => {
        if (url.startsWith(paired.relayUrl)) bridgeRelayConnections.push(connectionPayload(url, options?.headers));
        return new WebSocket(url, options);
      },
    });
    let legacyClient: WebSocketInbox | null = null;
    let capableClient: WebSocketInbox | null = null;

    try {
      runtime.start();
      await waitFor(() => runtime.getSnapshot().relayConnected, 'BridgeRuntime did not connect to Relay');
      expect(bridgeRelayConnections).toHaveLength(1);
      assertOpenClaw('gateway.connection', bridgeRelayConnections[0]);
      assertBridge('relay.connection', bridgeRelayConnections[0]);
      assertOpenClaw('legacy-client.connection', openClawClientConnectionPayload(paired, 'compat-ios-legacy'));
      legacyClient = await openOpenClawClient(paired, 'compat-ios-legacy');

      const challenge = await legacyClient.nextJson((frame) => frame.event === 'connect.challenge');
      assertOpenClaw('connect.31a.challenge', challenge);
      assertBridge('challenge.local-to-bridge', challenge);
      assertBridge('challenge.bridge-to-relay', challenge);

      const connect = frameObject(openClawFixture, 'connect.31a.request');
      assertBridge('connect-31a.relay-to-bridge', connect);
      legacyClient.socket.send(JSON.stringify(connect));
      await waitFor(() => gatewayFrames.some((frame) => frame.id === 'connect-31a-v1'), 'Bridge did not forward connect');
      const connectAtGateway = takeFrame(gatewayFrames, 'connect-31a-v1');
      assertOpenClaw('connect.31a.request', connectAtGateway);
      assertBridge('connect-31a.bridge-to-local', connectAtGateway);
      const connectResponse = await legacyClient.nextJson((frame) => frame.type === 'res' && frame.id === 'connect-31a-v1');
      assertOpenClaw('connect.31a.response', connectResponse);
      assertBridge('connect-31a.local-to-bridge', connectResponse);
      assertBridge('connect-31a.bridge-to-relay', connectResponse);

      localGatewaySocket?.send(frameWire(openClawFixture, 'connect.c2.challenge'));
      assertOpenClaw(
        'connect.c2.challenge',
        await legacyClient.nextJson((frame) => frame.event === 'connect.challenge'),
      );
      const c2Connect = frameObject(openClawFixture, 'connect.c2.request');
      assertOpenClaw('connect.c2.request', c2Connect);
      assertBridge('connect-c2.relay-to-bridge', c2Connect);
      legacyClient.socket.send(JSON.stringify(c2Connect));
      await waitFor(() => gatewayFrames.some((frame) => frame.id === 'connect-c2-v1'), 'Bridge did not forward c2 connect');
      const c2AtGateway = takeFrame(gatewayFrames, 'connect-c2-v1');
      const c2Patched = structuredClone(c2Connect);
      requireRecord(c2Patched.params, 'c2 patched params').maxProtocol = 4;
      expect(compareCompatValues(c2AtGateway, c2Patched as JsonValue)).toEqual([]);
      assertBridge('connect-c2.bridge-to-local', c2AtGateway);
      const c2Response = await legacyClient.nextJson((frame) => frame.type === 'res' && frame.id === 'connect-c2-v1');
      assertOpenClaw('connect.c2.response', c2Response);
      assertBridge('connect-c2.local-to-bridge', c2Response);
      assertBridge('connect-c2.bridge-to-relay', c2Response);

      localGatewaySocket?.send(frameWire(openClawFixture, 'connect.d9c.challenge'));
      assertOpenClaw(
        'connect.d9c.challenge',
        await legacyClient.nextJson((frame) => frame.event === 'connect.challenge'),
      );
      const d9cConnect = frameObject(openClawFixture, 'connect.d9c.request');
      assertBridge('connect-d9c.relay-to-bridge', d9cConnect);
      legacyClient.socket.send(JSON.stringify(d9cConnect));
      await waitFor(() => gatewayFrames.some((frame) => frame.id === 'connect-d9c-v1'), 'Bridge did not forward d9c connect');
      const d9cAtGateway = takeFrame(gatewayFrames, 'connect-d9c-v1');
      assertOpenClaw('connect.d9c.request', d9cAtGateway);
      assertBridge('connect-d9c.bridge-to-local', d9cAtGateway);
      const d9cResponse = await legacyClient.nextJson((frame) => frame.type === 'res' && frame.id === 'connect-d9c-v1');
      assertOpenClaw('connect.d9c.response', d9cResponse);
      assertBridge('connect-d9c.local-to-bridge', d9cResponse);
      assertBridge('connect-d9c.bridge-to-relay', d9cResponse);

      localGatewaySocket?.send(frameWire(openClawFixture, 'connect-start.challenge'));
      assertOpenClaw(
        'connect-start.challenge',
        await legacyClient.nextJson((frame) => frame.event === 'connect.challenge'),
      );
      const connectStart = frameObject(openClawFixture, 'connect-start.request');
      assertBridge('connect-start.relay-to-bridge', connectStart);
      legacyClient.socket.send(JSON.stringify(connectStart));
      await waitFor(() => gatewayFrames.some((frame) => frame.id === 'connect-start-v1'), 'Bridge did not forward connect.start');
      const connectStartAtGateway = takeFrame(gatewayFrames, 'connect-start-v1');
      assertOpenClaw('connect-start.request', connectStartAtGateway);
      assertBridge('connect-start.bridge-to-local', connectStartAtGateway);
      const connectStartResponse = await legacyClient.nextJson((frame) => frame.type === 'res' && frame.id === 'connect-start-v1');
      assertOpenClaw('connect-start.response', connectStartResponse);
      assertBridge('connect-start.local-to-bridge', connectStartResponse);
      assertBridge('connect-start.bridge-to-relay', connectStartResponse);

      legacyClient.socket.send(frameWire(openClawFixture, 'chat-send.request'));
      await waitFor(() => gatewayFrames.some((frame) => frame.id === 'chat-v1'), 'Bridge did not forward chat.send');
      const chatAtGateway = takeFrame(gatewayFrames, 'chat-v1');
      assertOpenClaw('chat-send.request', chatAtGateway);
      assertBridge('chat.relay-to-bridge', chatAtGateway);
      assertBridge('chat.bridge-to-local', chatAtGateway);
      const chatResponse = await legacyClient.nextJson((frame) => frame.type === 'res' && frame.id === 'chat-v1');
      assertOpenClaw('chat-send.response', chatResponse);
      assertBridge('response.local-to-bridge', chatResponse);
      assertBridge('response.bridge-to-relay', chatResponse);

      const sessionsRequest = frameObject(openClawFixture, 'sessions-list.request');
      assertBridge('sessions.relay-to-bridge', sessionsRequest);
      legacyClient.socket.send(JSON.stringify(sessionsRequest));
      await waitFor(() => gatewayFrames.some((frame) => frame.id === 'sessions-v1'), 'Bridge did not forward sessions.list');
      const sessionsAtGateway = takeFrame(gatewayFrames, 'sessions-v1');
      assertOpenClaw('sessions-list.request', sessionsAtGateway);
      assertBridge('sessions.bridge-to-local', sessionsAtGateway);
      const sessionsResponse = await legacyClient.nextJson((frame) => frame.type === 'res' && frame.id === 'sessions-v1');
      assertOpenClaw('sessions-list.response', sessionsResponse);
      assertBridge('sessions.local-to-bridge', sessionsResponse);
      assertBridge('sessions.bridge-to-relay', sessionsResponse);

      const largeFrame = frameObject(openClawFixture, 'chat-send-1.5m.request');
      assertBridge('image.relay-to-bridge', largeFrame);
      legacyClient.socket.send(JSON.stringify(largeFrame));
      await waitFor(() => gatewayFrames.some((frame) => frame.id === 'chat-image-v1'), 'Bridge did not forward 1.5 MiB chat.send', 20_000);
      const largeAtGateway = takeFrame(gatewayFrames, 'chat-image-v1');
      assertOpenClaw('chat-send-1.5m.request', largeAtGateway);
      assertBridge('image.bridge-to-local', largeAtGateway);
      expect(decodedAttachmentBytes(largeAtGateway)).toBe(1_572_864);
      expect(attachmentSha256(largeAtGateway))
        .toBe('be152331d7e2a258a0aed29704c0d34f889fa2f3bdaf17036a830bbe77a5c27c');
      const largeResponse = await legacyClient.nextJson(
        (frame) => frame.type === 'res' && frame.id === 'chat-image-v1',
        20_000,
      );
      assertOpenClaw('chat-send-1.5m.response', largeResponse);
      assertBridge('image.local-to-bridge', largeResponse);
      assertBridge('image.bridge-to-relay', largeResponse);

      const legacyTick = await legacyClient.nextJson((frame) => frame.type === 'tick');
      assertOpenClaw('legacy.tick', legacyTick);
      await delay(1_500);
      expect(legacyClient.socket.readyState).toBe(WebSocket.OPEN);

      assertOpenClaw(
        'capable-client.connection',
        openClawClientConnectionPayload(paired, 'compat-ios-pong', ['relay.client-pong.v1']),
      );
      capableClient = await openOpenClawClient(paired, 'compat-ios-pong', ['relay.client-pong.v1']);
      const capableTick = await capableClient.nextJson((frame) => frame.type === 'tick' && frame.ack === 'relay.client-pong.v1');
      assertOpenClaw('capable.tick', capableTick);
      capableClient.socket.send(JSON.stringify({ type: 'pong', ts: capableTick.ts }));
      assertOpenClaw('capable.pong', { type: 'pong', ts: capableTick.ts });
      await delay(100);
      expect(gatewayFrames.some((frame) => frame.type === 'pong')).toBe(false);
    } finally {
      if (capableClient) closeWebSocket(capableClient);
      if (legacyClient) closeWebSocket(legacyClient);
      await runtime.stop();
      await closeWebSocketServer(gatewayServer);
    }
  }, 60_000);

  it('enforces observable OpenClaw Relay close-code behavior', async () => {
    const assertClose = createFixtureAsserter(openClawFixture);
    await expectReplacementCloseCodes(assertClose);
    await expectRateLimitCloseCode(assertClose);
    await expectPongTimeoutCloseCode(assertClose);
    await expectGatewayUnavailableCloseCode(assertClose);
    await expectGatewayReconnectCloseCode(assertClose);
  }, 60_000);

  it('replays Hermes health and sessions.list without inventing an OpenClaw handshake', async () => {
    const assertHermes = createFixtureAsserter(hermesFixture);
    const paired = await pairHermes('Hermes Replay');
    const clientConnection = hermesClientConnectionPayload(paired, 'compat-hermes-ios');
    const client = await openHermesClient(paired, 'compat-hermes-ios');
    const localPort = await getFreePort();
    const localFrames: Record<string, unknown>[] = [];
    const bridgeRelayConnections: JsonValue[] = [];
    const localServer = await startWebSocketServer(localPort, (socket) => {
      socket.on('message', (data: RawData, isBinary: boolean) => {
        if (isBinary) return;
        const parsed = parseJson(toText(data));
        if (!parsed) return;
        localFrames.push(parsed);
        if (parsed.method === 'sessions.list') {
          socket.send(frameWire(hermesFixture, 'sessions-list.bridge-response'));
        }
        if (parsed.method === 'health' && typeof parsed.id === 'string') {
          socket.send(JSON.stringify({ type: 'res', id: parsed.id, ok: true, payload: { status: 'ok' } }));
        }
      });
      socket.send(frameWire(hermesFixture, 'health.event'));
    });
    const runtime = new HermesRelayRuntime({
      config: {
        serverUrl: hermesRegistry.baseUrl,
        bridgeId: paired.bridgeId,
        relaySecret: paired.relaySecret,
        relayUrl: paired.relayUrl,
        instanceId: 'compat-hermes-runtime',
        displayName: 'Hermes Replay',
        createdAt: '2026-09-05T00:00:00.000Z',
        updatedAt: '2026-09-05T00:00:00.000Z',
      },
      bridgeUrl: `ws://127.0.0.1:${localPort}/v1/hermes/ws?token=fixture-local-token`,
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 500,
      bridgeStatusPollIntervalMs: 120_000,
      bridgeHealthProbeIntervalMs: 120_000,
      createWebSocket: (url, options) => {
        if (url.startsWith(paired.relayUrl)) bridgeRelayConnections.push(connectionPayload(url, options?.headers));
        return new WebSocket(url, options);
      },
    });

    try {
      runtime.start();
      await waitFor(
        () => runtime.getSnapshot().relayConnected && runtime.getSnapshot().bridgeConnected,
        'HermesRelayRuntime did not connect both legs',
      );
      expect(bridgeRelayConnections).toHaveLength(1);
      assertHermes('bridge.connection', bridgeRelayConnections[0]);
      assertHermes('client.connection', clientConnection);
      assertHermes(
        'health.event',
        await client.nextJson((frame) => frame.type === 'event' && frame.event === 'health'),
      );

      const sessionsRequest = frameObject(hermesFixture, 'sessions-list.request');
      assertHermes('sessions-list.request', sessionsRequest);
      client.socket.send(JSON.stringify(sessionsRequest));
      await waitFor(() => localFrames.some((frame) => frame.id === 'hermes-sessions-v1'), 'Hermes runtime did not forward sessions.list');
      const localRequest = takeFrame(localFrames, 'hermes-sessions-v1');
      assertHermes('sessions-list.bridge-receive', localRequest);
      expect(localFrames.some((frame) => frame.method === 'connect' || frame.method === 'connect.start')).toBe(false);
      const sessionsResponse = await client.nextJson((frame) => frame.type === 'res' && frame.id === 'hermes-sessions-v1');
      assertHermes('sessions-list.bridge-response', sessionsResponse);
      assertHermes('sessions-list.response', sessionsResponse);
    } finally {
      closeWebSocket(client);
      await runtime.stop();
      await closeWebSocketServer(localServer);
    }
  }, 60_000);
});

type FixtureAsserter = (label: string, actual: unknown) => void;

function createFixtureAsserter(fixture: CompatFixture): FixtureAsserter {
  const context = createCompatComparisonContext();
  return (label, actual) => assertFixtureFrame(fixture, label, actual, context);
}

async function expectReplacementCloseCodes(assertClose: FixtureAsserter): Promise<void> {
  const gatewayPair = await pairOpenClaw('Close Replacement Gateway');
  const gatewayOne = await openRawGateway(gatewayPair, 'close-gateway-owner');
  await delay(100);
  const gatewayTwo = await openRawGateway(gatewayPair, 'close-gateway-owner');
  assertClose('close.replaced-gateway', await waitForCloseWithRelayLogs(gatewayOne));
  closeWebSocket(gatewayTwo);

  const clientPair = await pairOpenClaw('Close Replacement Client');
  const gateway = await openRawGateway(clientPair, 'close-client-gateway');
  const clientOne = await openOpenClawClient(clientPair, 'duplicate-client');
  await delay(100);
  const clientTwo = await openOpenClawClient(clientPair, 'duplicate-client');
  assertClose('close.replaced-client', await waitForCloseWithRelayLogs(clientOne));
  closeWebSocket(clientTwo);
  closeWebSocket(gateway);
}

async function waitForCloseWithRelayLogs(inbox: WebSocketInbox): Promise<{ code: number; reason: string }> {
  try {
    return await inbox.waitForCloseFrameWithMiniflareWorkaround();
  } catch (error) {
    const logs = openClawRelay.output.slice(-20_000);
    throw new Error(`${String(error)}\nOpenClaw Relay logs:\n${logs || '<empty>'}`);
  }
}

async function expectRateLimitCloseCode(assertClose: FixtureAsserter): Promise<void> {
  const paired = await pairOpenClaw('Close Rate Limit');
  const client = await openOpenClawClient(paired, 'rate-limited-client');
  for (let index = 0; index < 21; index += 1) {
    client.socket.send(JSON.stringify({ type: 'req', id: `rate-${index}`, method: 'health', params: {} }));
  }
  assertClose('close.rate-limited', await waitForCloseWithRelayLogs(client));
}

async function expectPongTimeoutCloseCode(assertClose: FixtureAsserter): Promise<void> {
  const paired = await pairOpenClaw('Close Pong Timeout');
  const client = await openOpenClawClient(paired, 'missed-pong-client', ['relay.client-pong.v1']);
  assertClose('close.pong-timeout', await waitForCloseWithRelayLogs(client));
}

async function expectGatewayUnavailableCloseCode(assertClose: FixtureAsserter): Promise<void> {
  const paired = await pairOpenClaw('Close Gateway Unavailable');
  const gateway = await openRawGateway(paired, 'unavailable-gateway');
  const client = await openOpenClawClient(paired, 'unavailable-client');
  gateway.socket.close(1000, 'fixture_gateway_stop');
  assertClose('close.gateway-unavailable', await waitForCloseWithRelayLogs(client));
}

async function expectGatewayReconnectCloseCode(assertClose: FixtureAsserter): Promise<void> {
  const paired = await pairOpenClaw('Close Gateway Reconnect');
  const gateway = await openRawGateway(paired, 'reconnect-gateway');
  const client = await openOpenClawClient(paired, 'reconnect-client');
  gateway.socket.send(`${CONTROL_PREFIX}${JSON.stringify({ type: 'control', event: 'client.reconnect-required' })}`);
  assertClose('close.gateway-reconnect', await waitForCloseWithRelayLogs(client));
  closeWebSocket(gateway);
}

async function pairOpenClaw(displayName: string): Promise<{
  gatewayId: string;
  relaySecret: string;
  relayUrl: string;
  clientToken: string;
}> {
  const register = await postJson(openClawRegistry.baseUrl, '/v1/pair/register', { displayName, preferredRegion: 'us' });
  expect(register.status).toBe(200);
  const registered = requireRecord(register.body, 'OpenClaw register');
  const claim = await postJson(openClawRegistry.baseUrl, '/v1/pair/claim', {
    gatewayId: requireString(registered, 'gatewayId'),
    accessCode: requireString(registered, 'accessCode'),
    clientLabel: 'Compatibility Test',
  });
  expect(claim.status).toBe(200);
  const claimed = requireRecord(claim.body, 'OpenClaw claim');
  return {
    gatewayId: requireString(registered, 'gatewayId'),
    relaySecret: requireString(registered, 'relaySecret'),
    relayUrl: requireString(registered, 'relayUrl'),
    clientToken: requireString(claimed, 'clientToken'),
  };
}

async function pairHermes(displayName: string): Promise<{
  bridgeId: string;
  relaySecret: string;
  relayUrl: string;
  clientToken: string;
}> {
  const register = await postJson(hermesRegistry.baseUrl, '/v1/hermes/pair/register', { displayName, preferredRegion: 'us' });
  expect(register.status).toBe(200);
  const registered = requireRecord(register.body, 'Hermes register');
  const claim = await postJson(hermesRegistry.baseUrl, '/v1/hermes/pair/claim', {
    bridgeId: requireString(registered, 'bridgeId'),
    accessCode: requireString(registered, 'accessCode'),
    clientLabel: 'Compatibility Test',
  });
  expect(claim.status).toBe(200);
  const claimed = requireRecord(claim.body, 'Hermes claim');
  return {
    bridgeId: requireString(registered, 'bridgeId'),
    relaySecret: requireString(registered, 'relaySecret'),
    relayUrl: requireString(registered, 'relayUrl'),
    clientToken: requireString(claimed, 'clientToken'),
  };
}

function openOpenClawClient(
  paired: { gatewayId: string; relayUrl: string; clientToken: string },
  clientId: string,
  capabilities: string[] = [],
): Promise<WebSocketInbox> {
  return openWebSocket(openClawClientUrl(paired, clientId, capabilities));
}

function openClawClientUrl(
  paired: { gatewayId: string; relayUrl: string; clientToken: string },
  clientId: string,
  capabilities: string[] = [],
): string {
  return wsUrl(paired.relayUrl, {
    gatewayId: paired.gatewayId,
    role: 'client',
    clientId,
    token: paired.clientToken,
    ...(capabilities.length > 0 ? { capabilities: capabilities.join(',') } : {}),
  });
}

function openClawClientConnectionPayload(
  paired: { gatewayId: string; relayUrl: string; clientToken: string },
  clientId: string,
  capabilities: string[] = [],
): JsonValue {
  return connectionPayload(openClawClientUrl(paired, clientId, capabilities));
}

function openRawGateway(
  paired: { gatewayId: string; relayUrl: string; relaySecret: string },
  clientId: string,
): Promise<WebSocketInbox> {
  return openWebSocket(wsUrl(paired.relayUrl, {
    gatewayId: paired.gatewayId,
    role: 'gateway',
    clientId,
  }), { headers: { Authorization: `Bearer ${paired.relaySecret}` } });
}

function openHermesClient(
  paired: { bridgeId: string; relayUrl: string; clientToken: string },
  clientId: string,
): Promise<WebSocketInbox> {
  return openWebSocket(hermesClientUrl(paired, clientId));
}

function hermesClientUrl(
  paired: { bridgeId: string; relayUrl: string; clientToken: string },
  clientId: string,
): string {
  return wsUrl(paired.relayUrl, {
    bridgeId: paired.bridgeId,
    role: 'client',
    clientId,
    token: paired.clientToken,
  });
}

function hermesClientConnectionPayload(
  paired: { bridgeId: string; relayUrl: string; clientToken: string },
  clientId: string,
): JsonValue {
  return connectionPayload(hermesClientUrl(paired, clientId));
}

function connectionPayload(urlValue: string, headers?: Record<string, string>): JsonValue {
  const url = new URL(urlValue);
  const authorization = headers?.Authorization ?? headers?.authorization;
  return {
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    ...(authorization ? { authorization } : {}),
  };
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<{ status: number; body: JsonValue }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as JsonValue };
}

function httpRequest(path: string, body: JsonValue): JsonValue {
  return { method: 'POST', path, body };
}

function relayMap(relayUrl: string): string {
  return JSON.stringify({ us: relayUrl, sg: relayUrl, eu: relayUrl, cn: relayUrl });
}

function frameObject(fixture: CompatFixture, label: string): Record<string, unknown> {
  return requireRecord(materializeFixtureValue(findFrame(fixture, label).payload), `${fixture.id}:${label}`);
}

function frameWire(fixture: CompatFixture, label: string): string {
  return JSON.stringify(frameObject(fixture, label));
}

function assertFixtureFrame(
  fixture: CompatFixture,
  label: string,
  actual: unknown,
  context?: CompatComparisonContext,
): void {
  const errors = compareCompatValues(
    actual,
    materializeFixtureValue(findFrame(fixture, label).payload),
    fixture.ignoredPaths,
    context,
  );
  expect(errors, `${fixture.id}:${label}`).toEqual([]);
  const labels = liveFixtureCoverage.get(fixture.id) ?? new Set<string>();
  labels.add(label);
  liveFixtureCoverage.set(fixture.id, labels);
}

function assertLiveFixtureCoverage(
  fixtures: Array<CompatFixture | undefined>,
  exemptions: ReadonlyMap<string | undefined, ReadonlySet<string>>,
): void {
  for (const fixture of fixtures) {
    if (!fixture) continue;
    const covered = liveFixtureCoverage.get(fixture.id) ?? new Set<string>();
    const exempt = exemptions.get(fixture.id) ?? new Set<string>();
    const missing = fixture.frames
      .map(({ label }) => label)
      .filter((label) => !covered.has(label) && !exempt.has(label));
    expect(missing, `${fixture.id} contains fixture frames that were never asserted by live replay`).toEqual([]);
  }
}

function takeFrame(frames: Record<string, unknown>[], id: string): Record<string, unknown> {
  const index = frames.findIndex((frame) => frame.id === id);
  if (index < 0) throw new Error(`Missing captured frame ${id}`);
  return frames.splice(index, 1)[0];
}

function decodedAttachmentBytes(frame: Record<string, unknown>): number {
  const params = requireRecord(frame.params, 'chat params');
  if (!Array.isArray(params.attachments) || params.attachments.length !== 1) {
    throw new Error('Expected one attachment.');
  }
  const attachment = requireRecord(params.attachments[0], 'chat attachment');
  return Buffer.from(requireString(attachment, 'content'), 'base64').byteLength;
}

function attachmentSha256(frame: Record<string, unknown>): string {
  const params = requireRecord(frame.params, 'chat params');
  if (!Array.isArray(params.attachments) || params.attachments.length !== 1) {
    throw new Error('Expected one attachment.');
  }
  const attachment = requireRecord(params.attachments[0], 'chat attachment');
  return createHash('sha256').update(Buffer.from(requireString(attachment, 'content'), 'base64')).digest('hex');
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function toText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
