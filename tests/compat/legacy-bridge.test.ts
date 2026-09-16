import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket, { type RawData, type WebSocketServer } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getFreePort } from '../integration/harness';
import { loadCompatFixture } from './loader';
import {
  closeWebSocket,
  closeWebSocketServer,
  CompatWranglerDevProcess,
  isRecord,
  openWebSocket,
  parseJson,
  startWebSocketServer,
  waitFor,
  type WebSocketInbox,
  wsUrl,
} from './live-harness';
import {
  LEGACY_BRIDGE_REPLAY_PINS,
  prepareLegacyBridgeMatrix,
  type PreparedLegacyBridge,
  validateLegacyBridgeCacheManifest,
} from './legacy-bridge-build';
import {
  compareCompatValues,
  findFrame,
  materializeFixtureValue,
  type CompatFixture,
  type JsonValue,
} from './schema';

let registry: CompatWranglerDevProcess | undefined;
let relay: CompatWranglerDevProcess | undefined;
let fixture: CompatFixture;
let prepared: PreparedLegacyBridge[] = [];
let isolatedOpenClawState = '';
let servicePersistence = '';

const savedOpenClawEnv = new Map<string, string | undefined>();
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
  fixture = await loadCompatFixture('relay-openclaw/openclaw-v1.json');
  prepared = await prepareLegacyBridgeMatrix(process.cwd());

  [isolatedOpenClawState, servicePersistence] = await Promise.all([
    mkdtemp(join(tmpdir(), 'clawket-legacy-bridge-state-')),
    mkdtemp(join(tmpdir(), 'clawket-legacy-bridge-services-')),
  ]);
  for (const name of isolatedEnvNames) {
    savedOpenClawEnv.set(name, process.env[name]);
    delete process.env[name];
  }
  process.env.OPENCLAW_STATE_DIR = isolatedOpenClawState;

  const [registryPort, relayPort, registryInspectorPort, relayInspectorPort] = await Promise.all([
    getFreePort(),
    getFreePort(),
    getFreePort(),
    getFreePort(),
  ]);
  const relayUrl = `ws://127.0.0.1:${relayPort}/ws`;
  registry = await CompatWranglerDevProcess.start({
    cwd: process.cwd(),
    configPath: 'apps/relay-registry/wrangler.toml',
    port: registryPort,
    inspectorPort: registryInspectorPort,
    persistencePath: servicePersistence,
    envVars: {
      RELAY_REGION_MAP: relayMap(relayUrl),
      PAIR_ACCESS_CODE_TTL_SEC: '600',
      PAIR_CLIENT_TOKEN_MAX: '16',
    },
  });
  relay = await CompatWranglerDevProcess.start({
    cwd: process.cwd(),
    configPath: 'apps/relay-worker/wrangler.toml',
    port: relayPort,
    inspectorPort: relayInspectorPort,
    persistencePath: servicePersistence,
    envVars: {
      REGISTRY_VERIFY_URL: registry.baseUrl,
      MAX_MESSAGES_PER_10S: '120',
      MAX_CLIENT_MESSAGES_PER_10S: '120',
      HEARTBEAT_INTERVAL_MS: '30000',
      CLIENT_PONG_TIMEOUT_MS: '30000',
      AWAITING_CHALLENGE_TTL_MS: '10000',
      GATEWAY_OWNER_LEASE_MS: '30000',
    },
  });
}, 300_000);

afterAll(async () => {
  await Promise.allSettled([relay?.stop(), registry?.stop()]);
  if (isolatedOpenClawState) await rm(isolatedOpenClawState, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  if (servicePersistence) await rm(servicePersistence, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  for (const name of isolatedEnvNames) {
    const previous = savedOpenClawEnv.get(name);
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
});

describe('historical BridgeRuntime against the current OpenClaw Relay', () => {
  it('fails closed when a cache manifest is tampered to another valid commit SHA', () => {
    expect(() => validateLegacyBridgeCacheManifest({
      schemaVersion: 2,
      cacheKey: 'a'.repeat(64),
      openClawFingerprint: 'b'.repeat(64),
      builtFromCommit: 'd'.repeat(40),
      originalLockSha256: 'c'.repeat(64),
      dependencyVersions: { 'node_modules/ws': '8.20.0' },
      files: { 'runtime/dist/runtime.js': 'f'.repeat(64) },
    }, {
      cacheKey: 'a'.repeat(64),
      openClawFingerprint: 'b'.repeat(64),
      builtFromCommit: 'e'.repeat(40),
    })).toThrow(/does not match the canonical pin/);
  });

  it('machine-verifies the published npm gitHead and c2 App snapshot use the same OpenClaw Bridge', () => {
    const publishedNpm = requirePrepared('a3ed');
    const latestPublishedNpm = requirePrepared('bd69');
    const productionAppSnapshot = requirePrepared('c2');
    expect(latestPublishedNpm.openClawFingerprint).toBe(publishedNpm.openClawFingerprint);
    expect(latestPublishedNpm.builtFromCommit).toBe(publishedNpm.builtFromCommit);
    expect(productionAppSnapshot.openClawFingerprint).toBe(publishedNpm.openClawFingerprint);
    expect(productionAppSnapshot.builtFromCommit).toBe(publishedNpm.builtFromCommit);
  });

  it('machine-verifies the 31a and 3e37 OpenClaw Bridge paths are equivalent', () => {
    const inferred211 = requirePrepared('31a');
    const version212Anchor = requirePrepared('3e37');
    expect(version212Anchor.openClawFingerprint).toBe(inferred211.openClawFingerprint);
    expect(version212Anchor.builtFromCommit).toBe(inferred211.builtFromCommit);
  });

  it.each(LEGACY_BRIDGE_REPLAY_PINS.flatMap(pin =>
    ['legacy', 'current-caps'].map(wireMode => ({ ...pin, wireMode })),
  ))(
    '$release ($key, $wireMode) forwards handshake, chat, history and attachments through the current Relay',
    async (pin) => {
      const artifact = requirePrepared(pin.key);
      const BridgeRuntime = await artifact.loadRuntime();
      const paired = await pairOpenClaw(`${pin.key} historical Bridge`);
      const gatewayPort = await getFreePort();
      const gatewayFrames: Record<string, unknown>[] = [];
      const bridgeLogs: string[] = [];
      const challengeLabel = `${pin.fixturePrefix}.challenge`;
      const connectRequestLabel = `${pin.fixturePrefix}.request`;
      const connectResponseLabel = `${pin.fixturePrefix}.response`;
      const responseById = new Map([
        [frameId(connectRequestLabel), connectResponseLabel],
        [frameId('chat-send.request'), 'chat-send.response'],
        [frameId('sessions-list.request'), 'sessions-list.response'],
        [frameId('chat-send-1.5m.request'), 'chat-send-1.5m.response'],
      ]);
      let gatewayServer: WebSocketServer | undefined;
      let client: WebSocketInbox | undefined;

      const runtime = new BridgeRuntime({
        config: {
          serverUrl: requireRegistry().baseUrl,
          gatewayId: paired.gatewayId,
          relaySecret: paired.relaySecret,
          relayUrl: paired.relayUrl,
          instanceId: `legacy-bridge-${pin.key}`,
          displayName: `${pin.key} historical Bridge`,
          createdAt: '2026-09-05T00:00:00.000Z',
          updatedAt: '2026-09-05T00:00:00.000Z',
        },
        gatewayUrl: `ws://127.0.0.1:${gatewayPort}`,
        reconnectBaseDelayMs: 50,
        reconnectMaxDelayMs: 250,
        heartbeatIntervalMs: 1_000,
        heartbeatTimeoutMs: 15_000,
        onLog: (line) => bridgeLogs.push(line),
      });

      try {
        gatewayServer = await startWebSocketServer(gatewayPort, (socket) => {
          socket.on('message', (data: RawData, isBinary: boolean) => {
            if (isBinary) return;
            const parsed = parseJson(toText(data));
            if (!parsed) return;
            // Gateway RequestFrame has a closed envelope. Historical Bridges do
            // not strip unknown fields, so new clients must stay inside this schema.
            if (parsed.method === 'connect' && Object.keys(parsed).some(key =>
              !['type', 'id', 'method', 'params'].includes(key))) {
              socket.close(1008, 'invalid request frame');
              return;
            }
            gatewayFrames.push(parsed);
            const id = typeof parsed.id === 'string' ? parsed.id : '';
            const responseLabel = responseById.get(id);
            if (responseLabel) socket.send(frameWire(responseLabel));
          });
          setTimeout(() => {
            if (socket.readyState === WebSocket.OPEN) socket.send(frameWire(challengeLabel));
          }, 20);
        });

        runtime.start();
        await waitFor(
          () => runtime.getSnapshot().relayConnected,
          `${pin.key} historical Bridge did not connect to the current Relay`,
          15_000,
        );
        client = await openWebSocket(wsUrl(paired.relayUrl, {
          gatewayId: paired.gatewayId,
          role: 'client',
          clientId: `legacy-client-${pin.key}`,
          token: paired.clientToken,
        }));

        assertFixtureFrame(
          challengeLabel,
          await client.nextJson((frame) => frame.event === 'connect.challenge', 15_000),
        );
        if (pin.wireMode === 'current-caps') {
          const request = frameObject(connectRequestLabel);
          request.params = { ...(request.params as Record<string, unknown>), caps: ['tool-events', 'bridge.capabilities.v2'] };
          client.socket.send(JSON.stringify(request));
          expect(await takeGatewayFrame(gatewayFrames, String(request.id), 'current caps handshake was not forwarded')).toEqual(request);
          assertFixtureFrame(connectResponseLabel, await client.nextJson(frame => frame.id === request.id));
        } else {
          await roundTrip(client, gatewayFrames, connectRequestLabel, connectResponseLabel);
        }
        await roundTrip(client, gatewayFrames, 'chat-send.request', 'chat-send.response');
        await roundTrip(client, gatewayFrames, 'sessions-list.request', 'sessions-list.response');

        const largeRequest = frameObject('chat-send-1.5m.request');
        client.socket.send(JSON.stringify(largeRequest));
        const largeAtGateway = await takeGatewayFrame(
          gatewayFrames,
          frameId('chat-send-1.5m.request'),
          `${pin.key} Bridge did not forward the 1.5 MiB attachment`,
          25_000,
        );
        assertFixtureFrame('chat-send-1.5m.request', largeAtGateway);
        expect(decodedAttachmentBytes(largeAtGateway)).toBe(1_572_864);
        expect(attachmentSha256(largeAtGateway))
          .toBe('be152331d7e2a258a0aed29704c0d34f889fa2f3bdaf17036a830bbe77a5c27c');
        assertFixtureFrame(
          'chat-send-1.5m.response',
          await client.nextJson(
            (frame) => frame.type === 'res' && frame.id === frameId('chat-send-1.5m.request'),
            25_000,
          ),
        );
        expect(client.socket.readyState).toBe(WebSocket.OPEN);
      } catch (error) {
        throw new Error(
          `${pin.key} historical Bridge replay failed. Bridge log tail:\n${bridgeLogs.slice(-20).join('\n')}`,
          { cause: error },
        );
      } finally {
        if (client) closeWebSocket(client);
        await runtime.stop();
        if (gatewayServer) await closeWebSocketServer(gatewayServer);
      }
    },
    75_000,
  );
});

async function roundTrip(
  client: WebSocketInbox,
  gatewayFrames: Record<string, unknown>[],
  requestLabel: string,
  responseLabel: string,
): Promise<void> {
  const request = frameObject(requestLabel);
  const id = frameId(requestLabel);
  client.socket.send(JSON.stringify(request));
  const forwarded = await takeGatewayFrame(
    gatewayFrames,
    id,
    `Historical Bridge did not forward ${requestLabel}`,
  );
  assertFixtureFrame(requestLabel, forwarded);
  assertFixtureFrame(
    responseLabel,
    await client.nextJson((frame) => frame.type === 'res' && frame.id === id),
  );
}

async function takeGatewayFrame(
  frames: Record<string, unknown>[],
  id: string,
  message: string,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
  await waitFor(() => frames.some((frame) => frame.id === id), message, timeoutMs);
  const index = frames.findIndex((frame) => frame.id === id);
  if (index < 0) throw new Error(message);
  return frames.splice(index, 1)[0];
}

async function pairOpenClaw(displayName: string): Promise<{
  gatewayId: string;
  relaySecret: string;
  relayUrl: string;
  clientToken: string;
}> {
  const register = await postJson('/v1/pair/register', { displayName, preferredRegion: 'us' });
  expect(register.status).toBe(200);
  const registered = requireRecord(register.body, 'historical Bridge register response');
  const claim = await postJson('/v1/pair/claim', {
    gatewayId: requireString(registered, 'gatewayId'),
    accessCode: requireString(registered, 'accessCode'),
    clientLabel: 'Historical Bridge compatibility client',
  });
  expect(claim.status).toBe(200);
  const claimed = requireRecord(claim.body, 'historical Bridge claim response');
  return {
    gatewayId: requireString(registered, 'gatewayId'),
    relaySecret: requireString(registered, 'relaySecret'),
    relayUrl: requireString(registered, 'relayUrl'),
    clientToken: requireString(claimed, 'clientToken'),
  };
}

async function postJson(path: string, body: unknown): Promise<{ status: number; body: JsonValue }> {
  const response = await fetch(`${requireRegistry().baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as JsonValue };
}

function relayMap(relayUrl: string): string {
  return JSON.stringify({ us: relayUrl, sg: relayUrl, eu: relayUrl, cn: relayUrl });
}

function frameObject(label: string): Record<string, unknown> {
  return requireRecord(materializeFixtureValue(findFrame(fixture, label).payload), `fixture frame ${label}`);
}

function frameWire(label: string): string {
  return JSON.stringify(frameObject(label));
}

function frameId(label: string): string {
  return requireString(frameObject(label), 'id');
}

function assertFixtureFrame(label: string, actual: unknown): void {
  expect(
    compareCompatValues(
      actual,
      materializeFixtureValue(findFrame(fixture, label).payload),
      fixture.ignoredPaths,
    ),
    `${fixture.id}:${label}`,
  ).toEqual([]);
}

function decodedAttachmentBytes(frame: Record<string, unknown>): number {
  return attachmentBytes(frame).byteLength;
}

function attachmentSha256(frame: Record<string, unknown>): string {
  return createHash('sha256').update(attachmentBytes(frame)).digest('hex');
}

function attachmentBytes(frame: Record<string, unknown>): Buffer {
  const params = requireRecord(frame.params, 'chat params');
  if (!Array.isArray(params.attachments) || params.attachments.length !== 1) {
    throw new Error('Expected one historical Bridge attachment.');
  }
  const attachment = requireRecord(params.attachments[0], 'chat attachment');
  return Buffer.from(requireString(attachment, 'content'), 'base64');
}

function requirePrepared(key: string): PreparedLegacyBridge {
  const artifact = prepared.find((item) => item.pin.key === key);
  if (!artifact) throw new Error(`Missing prepared historical Bridge artifact ${key}.`);
  return artifact;
}

function requireRegistry(): CompatWranglerDevProcess {
  if (!registry) throw new Error('Historical Bridge Registry worker did not start.');
  return registry;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} must be a non-empty string.`);
  return value;
}

function toText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}
