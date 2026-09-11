import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';
import { SOCKET_CLOSE_CODES } from '../../apps/relay-worker/src/relay/types';
import { getFreePort } from '../integration/harness';
import { startCompatWranglerDevProcesses } from './live-harness';
import { loadAllCompatFixtures, loadCompatFixture } from './loader';
import {
  compareCompatValues,
  createCompatComparisonContext,
  findFrame,
  materializeFixtureValue,
  validateCompatFixture,
  type JsonValue,
} from './schema';

describe('v1 compatibility fixtures', () => {
  it('loads every fixture through the strict schema', async () => {
    const fixtures = await loadAllCompatFixtures();
    expect(fixtures.map(({ path }) => path)).toEqual([
      'bridge/openclaw-forwarding-v1.json',
      'registry/openclaw-v1.json',
      'relay-hermes/hermes-v1.json',
      'relay-openclaw/openclaw-v1.json',
      'relay-openclaw/unknown-control-v1.json',
    ]);
    expect(fixtures.every(({ fixture }) => fixture.frames.length > 0)).toBe(true);
  });

  it('rejects malformed or accidentally emptied fixtures', () => {
    expect(() => validateCompatFixture({
      schemaVersion: 1,
      id: 'corrupt',
      backend: 'openclaw',
      recordedAt: 'not-a-date',
      description: 'corrupted input regression',
      captureMethod: 'test',
      sources: [],
      ignoredPaths: [],
      frames: [],
    })).toThrow(/recordedAt.*sources.*frames/s);
  });

  it('cleans a partially started Wrangler group when a sibling fails closed', async () => {
    const [healthyPort, healthyInspectorPort, failedPort, failedInspectorPort] = await Promise.all([
      getFreePort(),
      getFreePort(),
      getFreePort(),
      getFreePort(),
    ]);
    await expect(startCompatWranglerDevProcesses([
      {
        cwd: process.cwd(),
        configPath: 'apps/relay-registry/wrangler.toml',
        port: healthyPort,
        inspectorPort: healthyInspectorPort,
        envVars: { RELAY_REGION_MAP: JSON.stringify({ us: 'ws://127.0.0.1:1/ws' }) },
      },
      {
        cwd: process.cwd(),
        configPath: 'tests/compat/fixtures/missing-wrangler.toml',
        port: failedPort,
        inspectorPort: failedInspectorPort,
      },
    ])).rejects.toThrow();

    const probe = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        probe.once('error', reject);
        probe.listen(healthyPort, '127.0.0.1', resolve);
      });
      expect(probe.address()).toMatchObject({ port: healthyPort });
    } finally {
      await new Promise<void>((resolve) => probe.close(() => resolve()));
    }
  }, 30_000);

  it('binds dynamic values across frames and scopes ignores by JSON Pointer', () => {
    const context = createCompatComparisonContext();
    expect(compareCompatValues(
      { token: 'token-one' },
      { token: '$capture:clientToken:nonempty-string' },
      [],
      context,
    )).toEqual([]);
    expect(compareCompatValues(
      { token: 'token-two' },
      { token: '$ref:clientToken' },
      [],
      context,
    )).toEqual([expect.stringContaining('expected captured clientToken')]);

    expect(compareCompatValues(
      { ts: 3, payload: { ts: 2 } },
      { ts: 4, payload: { ts: 1 } },
      ['/payload/ts'],
    )).toEqual([expect.stringContaining('/ts expected 4')]);
  });

  it('materializes exactly 1.5 MiB of decoded image data in chat.send', async () => {
    const fixture = await loadCompatFixture('relay-openclaw/openclaw-v1.json');
    const payload = materializeFixtureValue(findFrame(fixture, 'chat-send-1.5m.request').payload);
    const attachment = readAttachment(payload);
    const decoded = Buffer.from(attachment.content, 'base64');
    const wire = JSON.stringify(payload);

    expect(decoded.byteLength).toBe(1_572_864);
    expect(attachment.content.length).toBe(2_097_152);
    expect(decoded.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(createHash('sha256').update(decoded).digest('hex'))
      .toBe('be152331d7e2a258a0aed29704c0d34f889fa2f3bdaf17036a830bbe77a5c27c');
    expect(Buffer.byteLength(wire, 'utf8')).toBe(2_097_412);
    expect(Buffer.byteLength(wire, 'utf8')).toBeLessThan(8 * 1024 * 1024);
  });

  it('pins every public OpenClaw Relay close code and reason', async () => {
    const fixture = await loadCompatFixture('relay-openclaw/openclaw-v1.json');
    const expected: Record<string, JsonValue> = {
      'close.replaced-gateway': { code: SOCKET_CLOSE_CODES.REPLACED_BY_NEW_GATEWAY, reason: 'replaced_by_new_gateway' },
      'close.replaced-client': { code: SOCKET_CLOSE_CODES.REPLACED_BY_NEW_CLIENT_SOCKET, reason: 'replaced_by_new_client_socket' },
      'close.rate-limited': { code: SOCKET_CLOSE_CODES.RATE_LIMITED, reason: 'rate_limited' },
      'close.pong-timeout': { code: SOCKET_CLOSE_CODES.IDLE_OR_STALE_TIMEOUT, reason: 'client_pong_timeout' },
      'close.dead-socket': { code: SOCKET_CLOSE_CODES.DEAD_SOCKET, reason: 'dead_socket' },
      'close.gateway-unavailable': { code: SOCKET_CLOSE_CODES.GATEWAY_UNAVAILABLE, reason: 'gateway_unavailable' },
      'close.gateway-reconnect': { code: SOCKET_CLOSE_CODES.GATEWAY_RECONNECT_REQUIRED, reason: 'gateway_reconnect_required' },
    };

    for (const [label, actual] of Object.entries(expected)) {
      expect(compareCompatValues(actual, findFrame(fixture, label).payload, fixture.ignoredPaths), label)
        .toEqual([]);
    }
  });

  it('keeps connect.start and the absent 2.1.1 provenance explicit', async () => {
    const fixture = await loadCompatFixture('relay-openclaw/openclaw-v1.json');
    expect(findFrame(fixture, 'connect-start.request').annotation).toMatch(/synthetic compatibility alias/i);
    expect(fixture.sources.find(({ commit }) => commit.startsWith('31a857'))).toMatchObject({
      provenance: 'inferred-protocol',
    });
  });

  it('verifies the deterministic Ed25519 signatures for each pinned connect shape', async () => {
    const fixture = await loadCompatFixture('relay-openclaw/openclaw-v1.json');
    const legacyScopes = ['operator.admin', 'operator.read', 'operator.write', 'operator.pairing'];
    const d9cScopes = [
      'operator.admin',
      'operator.approvals',
      'operator.pairing',
      'operator.questions',
      'operator.read',
      'operator.talk.secrets',
      'operator.write',
    ];
    const cases = [
      { label: 'connect.c2.request', challenge: 'connect.c2.challenge', min: 3, max: 3, version: '2.1.0', scopes: legacyScopes, reusesTs: false },
      { label: 'connect.31a.request', challenge: 'connect.31a.challenge', min: 3, max: 4, version: '2.1.0', scopes: legacyScopes, reusesTs: false },
      { label: 'connect.d9c.request', challenge: 'connect.d9c.challenge', min: 3, max: 4, version: '2.1.2', scopes: d9cScopes, reusesTs: true },
    ] as const;

    for (const testCase of cases) {
      const request = frameRecord(fixture, testCase.label);
      const challenge = frameRecord(fixture, testCase.challenge);
      const params = recordAt(request, 'params');
      const client = recordAt(params, 'client');
      const device = recordAt(params, 'device');
      const auth = recordAt(params, 'auth');
      const challengePayload = recordAt(challenge, 'payload');
      const scopes = params.scopes;
      expect(params.minProtocol).toBe(testCase.min);
      expect(params.maxProtocol).toBe(testCase.max);
      expect(client.version).toBe(testCase.version);
      expect(scopes).toEqual(testCase.scopes);
      expect(device.nonce).toBe(challengePayload.nonce);
      expect(device.signedAt === challengePayload.ts).toBe(testCase.reusesTs);
      expect(Array.isArray(scopes)).toBe(true);

      const signedPayload = [
        'v3',
        device.id,
        client.id,
        client.mode,
        params.role,
        (scopes as unknown[]).join(','),
        String(device.signedAt),
        auth.token,
        device.nonce,
        client.platform,
        client.deviceFamily,
      ].join('|');
      expect(nacl.sign.detached.verify(
        Buffer.from(signedPayload, 'utf8'),
        Buffer.from(String(device.signature), 'base64url'),
        Buffer.from(String(device.publicKey), 'base64url'),
      ), testCase.label).toBe(true);
      expect(createHash('sha256').update(Buffer.from(String(device.publicKey), 'base64url')).digest('hex'))
        .toBe(device.id);
    }

    const alias = recordAt(frameRecord(fixture, 'connect-start.request'), 'params');
    const d9c = recordAt(frameRecord(fixture, 'connect.d9c.request'), 'params');
    expect(alias).toEqual(d9c);
  });
});

function readAttachment(payload: JsonValue): { content: string } {
  if (!isRecord(payload) || !isRecord(payload.params) || !Array.isArray(payload.params.attachments)) {
    throw new Error('Large chat fixture is missing attachments.');
  }
  const attachment = payload.params.attachments[0];
  if (!isRecord(attachment) || typeof attachment.content !== 'string') {
    throw new Error('Large chat fixture did not materialize base64 content.');
  }
  return { content: attachment.content };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function frameRecord(fixture: Awaited<ReturnType<typeof loadCompatFixture>>, label: string): Record<string, unknown> {
  const value = materializeFixtureValue(findFrame(fixture, label).payload);
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function recordAt(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`${key} must be an object`);
  return value;
}
