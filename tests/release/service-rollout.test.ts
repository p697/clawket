import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prepareRecovery, verifyRecovery } from '../../scripts/release/registry-recovery.mjs';
import WebSocket from 'ws';
import { BridgeRuntime } from '../../packages/bridge-runtime/src/openclaw/runtime';
import { HermesRelayRuntime } from '../../packages/bridge-runtime/src/hermes/relay';
import { getFreePort } from '../integration/harness';
import { CompatWranglerDevProcess, startWebSocketServer, closeWebSocketServer, openWebSocket, closeWebSocket, wsUrl, parseJson, waitFor, delay } from '../compat/live-harness';
import { loadCompatFixture } from '../compat/loader';
import { findFrame, materializeFixtureValue } from '../compat/schema';
import { prepareLegacyBridgeMatrix, preparePublishedHermesRelay } from '../compat/legacy-bridge-build';
// Explicit integration command only: snapshots are read-only exports of the running
// production Workers, never fixtures invented from today's source. Missing input fails.
const snapshotDir = process.env.CLAWKET_RELEASE_SNAPSHOTS;
if (!snapshotDir)
  throw new Error('CLAWKET_RELEASE_SNAPSHOTS must contain the four exported production Worker .js files');
const root = process.cwd();
const phases = [
  { name: 'production snapshot baseline', registry: false, relay: false },
  { name: 'Registry upgraded, Relay old', registry: true, relay: false },
  { name: 'both upgraded', registry: true, relay: true },
  { name: 'Relay rolled back, Registry new', registry: true, relay: false },
  { name: 'both rolled back (local protocol comparison only)', registry: false, relay: false },
  { name: 'migration-safe Registry recovery, old Relay', registry: 'recovery' as const, relay: false },
];
let recoveryDir = process.env.CLAWKET_RELEASE_RECOVERY;
let generatedRecovery: string | undefined;
beforeAll(async () => {
  if (!recoveryDir) {
    generatedRecovery = await mkdtemp(join(tmpdir(), 'clawket-recovery-artifacts-'));
    recoveryDir = join(generatedRecovery, 'artifacts');
    await prepareRecovery({ snapshots: snapshotDir, output: recoveryDir, configs: [
      resolve(root, 'apps/relay-registry/wrangler.toml'), resolve(root, 'apps/relay-registry/wrangler.hermes.toml'),
    ] });
  }
  await verifyRecovery(recoveryDir!);
  const manifest = JSON.parse(await readFile(join(recoveryDir!, 'manifest.json'), 'utf8'));
  expect(manifest.artifacts).toHaveLength(2);
  for (const name of ['clawket-registry', 'clawket-hermes-registry']) {
    const entry = manifest.artifacts.find((item: { name: string }) => item.name === name);
    const bundle = await readFile(join(recoveryDir!, name, 'bundle/index.js'));
    const production = await readFile(join(snapshotDir!, `${name}.js`));
    expect(createHash('sha256').update(bundle).digest('hex')).toBe(entry.recoverySha256);
    expect(createHash('sha256').update(production).digest('hex')).toBe(entry.productionSha256);
  }
});
afterAll(async () => { if (generatedRecovery) await rm(generatedRecovery, { recursive: true, force: true }); });
describe('real production bundles → candidate → rollback, isolated local Workers', () => {
  it.each(['openclaw', 'hermes'].flatMap(backend => ['candidate', 'published-0.7.0'].map(vintage => ({ backend, vintage }))))('$backend / $vintage retains old pairing across all six service phases', async ({ backend, vintage }) => {
    const OpenClawRuntime = backend === 'openclaw' && vintage === 'published-0.7.0'
      ? await (await prepareLegacyBridgeMatrix(root)).find(artifact => artifact.pin.key === 'bd69')!.loadRuntime()
      : BridgeRuntime;
    const HermesRuntime = backend === 'hermes' && vintage === 'published-0.7.0'
      ? await (await preparePublishedHermesRelay(root)).loadRuntime() : HermesRelayRuntime;
    const prefix = backend === 'openclaw' ? 'clawket' : 'clawket-hermes';
    const idKey = backend === 'openclaw' ? 'gatewayId' : 'bridgeId';
    const kv = backend === 'openclaw' ? 'ROUTES_KV' : 'HERMES_ROUTES_KV';
    const room = backend === 'openclaw' ? 'ROOM' : 'HERMES_ROOM';
    const klass = backend === 'openclaw' ? 'RelayRoom' : 'HermesRelayRoom';
    for (const unit of ['registry', 'relay']) {
      const content = await readFile(join(snapshotDir!, `${prefix}-${unit}.js`), 'utf8');
      expect(content).toContain('export');
      console.log(`${backend} ${unit} snapshot sha256=${createHash('sha256').update(content).digest('hex')}`);
    }
    const temp = await mkdtemp(join(tmpdir(), `clawket-rollout-${backend}-`));
    const [regPort, relayPort, localPort, regInspector, relayInspector] = await Promise.all(Array.from({ length: 5 }, () => getFreePort()));
    const relayUrl = `ws://127.0.0.1:${relayPort}/ws`;
    const regUrl = `http://127.0.0.1:${regPort}`;
    let registry: CompatWranglerDevProcess | undefined;
    let relay: CompatWranglerDevProcess | undefined;
    let paired: Record<string, string>;
    let candidateRegistration: Record<string, string> | undefined;
    const fixture = await loadCompatFixture('relay-openclaw/openclaw-v1.json');
    const wire = (label: string) => materializeFixtureValue(findFrame(fixture, label).payload) as Record<string, unknown>;
    const local = await startWebSocketServer(localPort, socket => {
      socket.on('message', data => {
        const frame = parseJson(data.toString());
        if (!frame || frame.type !== 'req')
          return;
        // Model/provider execution is controlled; network routing/Workers/Bridge are real.
        if (frame.method === 'connect' && frame.meta) {
          socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: false, error: { code: 'INVALID_REQUEST', message: 'unexpected property meta' } }));
          return;
        }
        const payload = frame.method === 'connect' ? { protocol: 4, features: { methods: ['chat.send', 'sessions.list'] } }
          : frame.method === 'health' ? { status: 'ok' }
            : frame.method === 'sessions.list' ? { sessions: [{ key: 'agent:main:main' }] }
              : { runId: 'rollout-run' };
        socket.send(JSON.stringify({ type: 'res', id: frame.id, ok: true, payload }));
      });
      socket.send(JSON.stringify(backend === 'openclaw' ? wire('connect.c2.challenge') : { type: 'event', event: 'health', payload: { status: 'ok' } }));
    });
    async function startUnit(unit: 'registry' | 'relay', candidate: boolean | 'recovery') {
      // Production may already have crossed the registration-limiter migration.
      const snapshotHasLimiter = unit === 'registry' && !candidate
        && /export\s*\{[^}]*\bPairRegisterRateLimiter\b/s.test(await readFile(resolve(snapshotDir!, `${prefix}-registry.js`), 'utf8'));
      const config = {
        name: `${prefix}-${unit}`, main: candidate === 'recovery' ? resolve(recoveryDir!, `${prefix}-registry/bundle/index.js`) : candidate ? resolve(root, `apps/${unit === 'relay' ? 'relay-worker' : 'relay-registry'}/src/index.ts`) : resolve(snapshotDir!, `${prefix}-${unit}.js`),
        compatibility_date: '2026-03-03',
        kv_namespaces: [{ binding: kv, id: '00000000000000000000000000000000' }],
        ...(unit === 'relay' ? { durable_objects: { bindings: [{ name: room, class_name: klass }] }, migrations: [{ tag: 'v1', new_sqlite_classes: [klass] }] }
          : candidate || snapshotHasLimiter ? { durable_objects: { bindings: [{ name: 'PAIR_REGISTER_LIMITER', class_name: 'PairRegisterRateLimiter' }] }, migrations: [{ tag: 'v1', new_sqlite_classes: ['PairRegisterRateLimiter'] }] } : {}),
      };
      const configPath = join(temp, `${unit}.json`);
      await writeFile(configPath, JSON.stringify(config));
      return CompatWranglerDevProcess.start({ cwd: root, configPath, port: unit === 'relay' ? relayPort : regPort, inspectorPort: unit === 'relay' ? relayInspector : regInspector, persistencePath: join(temp, 'state'), envVars: {
          RELAY_BACKEND: backend, REGISTRY_VERIFY_URL: regUrl, RELAY_REGION_MAP: JSON.stringify({ us: relayUrl, sg: relayUrl, eu: relayUrl, cn: relayUrl }),
          MAX_MESSAGES_PER_10S: '120', MAX_CLIENT_MESSAGES_PER_10S: '300', HEARTBEAT_INTERVAL_MS: '30000', GATEWAY_OWNER_LEASE_MS: '20000', PAIR_CLIENT_TOKEN_MAX: '8',
        } });
    }
    async function post(path: string, body: unknown) {
      const res = await fetch(regUrl + (backend === 'hermes' ? path.replace('/v1/pair/', '/v1/hermes/pair/') : path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect(res.status, `${backend} ${path}`).toBe(200);
      return await res.json() as Record<string, string>;
    }
    try {
      for (const [index, phase] of phases.entries()) {
        await relay?.stop();
        relay = undefined;
        await registry?.stop();
        registry = undefined;
        registry = await startUnit('registry', phase.registry);
        relay = await startUnit('relay', phase.relay);
        if (index === 0) {
          const registration = await post('/v1/pair/register', { displayName: 'release compatibility', preferredRegion: 'us' });
          const claim = await post('/v1/pair/claim', { [idKey]: registration[idKey], accessCode: registration.accessCode, clientLabel: 'old installed app' });
          paired = { ...registration, clientToken: claim.clientToken };
        }
        if (index === 2) {
          candidateRegistration = await post('/v1/pair/register', { displayName: 'created after upgrade', preferredRegion: 'us' });
        }
        if (candidateRegistration) {
          // An older Registry must also read records created by the new writer.
          const invitation = await post('/v1/pair/access-code', {
            [idKey]: candidateRegistration[idKey], relaySecret: candidateRegistration.relaySecret,
          });
          const claimed = await post('/v1/pair/claim', {
            [idKey]: candidateRegistration[idKey], accessCode: invitation.accessCode, clientLabel: 'new-record-rollback',
          });
          expect(claimed.clientToken).toBeTruthy();
        }
        const config = { serverUrl: regUrl, [idKey]: paired![idKey], relaySecret: paired!.relaySecret, relayUrl, instanceId: 'release-compat-owner', displayName: 'release compatibility', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        const runtime = backend === 'openclaw'
          ? new OpenClawRuntime({ config: config as never, gatewayUrl: `ws://127.0.0.1:${localPort}`, clientChannels: true, reconnectBaseDelayMs: 100, reconnectMaxDelayMs: 500 })
          : new HermesRuntime({ config: config as never, bridgeUrl: `ws://127.0.0.1:${localPort}`, bridgeHealthProbeIntervalMs: 120000, bridgeStatusPollIntervalMs: 120000, reconnectBaseDelayMs: 100, reconnectMaxDelayMs: 500 });
        let client: Awaited<ReturnType<typeof openWebSocket>> | undefined;
        try {
          runtime.start();
          await waitFor(() => runtime.getSnapshot().relayConnected, `${backend} ${phase.name}: bridge not attached`, 15000);
          client = await openWebSocket(wsUrl(relayUrl, { [idKey]: paired![idKey], role: 'client', clientId: 'old-installed-app', token: paired!.clientToken }));
          if (backend === 'openclaw') {
            await client.nextJson(f => f.event === 'connect.challenge');
            const request = wire('connect.c2.request');
            request.params = { ...(request.params as Record<string, unknown>), caps: ['tool-events', 'bridge.capabilities.v2'] };
            client.socket.send(JSON.stringify(request));
            const response = await client.nextJson(f => f.id === request.id);
            expect(response).toMatchObject({ ok: true });
            if (vintage === 'candidate')
              expect(response).toMatchObject({ meta: { capabilities: ['bridge.capabilities.v2'] } });
            else
              expect(response.meta).toBeUndefined();
          }
          else {
            client.socket.send(JSON.stringify({ type: 'req', id: 'health-probe', method: 'health', params: {} }));
            expect(await client.nextJson(f => f.id === 'health-probe')).toMatchObject({ ok: true, payload: { status: 'ok' } });
          }
          for (const method of ['chat.send', 'sessions.list']) {
            const request = { type: 'req', id: `${index}-${method}`, method, params: { sessionKey: 'agent:main:main', message: 'compatibility', idempotencyKey: `rollout-${index}` } };
            client.socket.send(JSON.stringify(request));
            expect(await client.nextJson(f => f.id === request.id), `${backend} ${phase.name} ${method}`).toMatchObject({ ok: true });
          }
          expect(client.socket.readyState).toBe(WebSocket.OPEN);
          // Existing owner credentials must also still refresh a pairing invitation.
          const refreshed = await post('/v1/pair/access-code', { [idKey]: paired![idKey], relaySecret: paired!.relaySecret });
          expect(refreshed.accessCode).toBeTruthy();
          const additional = await post('/v1/pair/claim', { [idKey]: paired![idKey], accessCode: refreshed.accessCode, clientLabel: `phase-${index}` });
          expect(additional.clientToken).toBeTruthy();
          console.log(`${backend} / ${vintage}: ${phase.name} — saved credentials, handshake/health, chat, sessions, access-code refresh/claim PASS`);
        }
        finally {
          if (client)
            closeWebSocket(client);
          await runtime.stop();
          await delay(100);
        }
      }
      const registerPath = backend === 'hermes' ? '/v1/hermes/pair/register' : '/v1/pair/register';
      const registrationStatuses: number[] = [];
      const limiterHeaders = { 'content-type': 'application/json', 'CF-Connecting-IP': '192.0.2.123' };
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const response = await fetch(regUrl + registerPath, { method: 'POST', headers: limiterHeaders,
          body: JSON.stringify({ preferredRegion: 'us' }) });
        registrationStatuses.push(response.status);
      }
      // A fresh source bucket is independent of baseline and candidate registrations.
      expect(registrationStatuses).toEqual([...Array(10).fill(200), 429]);
      await registry!.stop();
      registry = await startUnit('registry', 'recovery');
      const limited = await fetch(regUrl + registerPath, { method: 'POST', headers: limiterHeaders, body: '{}' });
      expect(limited.status).toBe(429);

    }
    finally {
      await Promise.allSettled([relay?.stop(), registry?.stop()]);
      await closeWebSocketServer(local);
      await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
});
