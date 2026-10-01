import { EventEmitter, once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordClawketHermesGateway } from './gateway-process.js';
import { HermesLocalBridge } from './index.js';
import { createTempDirectory, cleanupTempDirectories } from './test-helpers.js';

const fake = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn: fake.spawn,
}));
const bridges: HermesLocalBridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map(bridge => bridge.stop()));
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  await cleanupTempDirectories();
});
async function fixture(owned = true) {
  const root = await createTempDirectory();
  const gatewayOwnerPath = join(root, 'clawket', 'hermes-gateway-owner.json');
  const bridge = new HermesLocalBridge({ hermesHomePath: root, hermesSourcePath: root,
    sessionStorePath: join(root, 'sessions.json'), usageLedgerPath: join(root, 'usage.json'),
    gatewayOwnerPath, keepSpawnedHermesGatewayAliveOnStop: false });
  bridges.push(bridge);
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(), stdout: null, stderr: null });
  fake.spawn.mockReturnValue(child);
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetch);
  if (owned) await bridge.startHermesGatewayProcess();
  bridge.snapshot.running = true;
  const ownerScope = { ownerPath: gatewayOwnerPath, apiBaseUrl: bridge.apiBaseUrl, hermesHomePath: root };
  return { bridge, child, fetch, root, ownerScope };
}
describe('owned Hermes API recovery', () => {
  it('recovers an exited owned child after cooldown, with bounded exponential retry', async () => {
    let now = 100_000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { bridge, child, fetch } = await fixture();
    child.emit('exit', 1);
    fetch.mockResolvedValue({ ok: false, status: 503 });
    const restart = vi.spyOn(bridge, 'ensureHermesApiReady').mockResolvedValue(false);
    await bridge.refreshHermesHealth(); expect(restart).not.toHaveBeenCalled();
    now += 30_000;
    await bridge.refreshHermesHealth(); expect(restart).toHaveBeenCalledTimes(1);
    await bridge.refreshHermesHealth(); expect(restart).toHaveBeenCalledTimes(1);
    now += 30_000;
    await bridge.refreshHermesHealth(); expect(restart).toHaveBeenCalledTimes(2);
    now += 30_000;
    await bridge.refreshHermesHealth(); expect(restart).toHaveBeenCalledTimes(2);
    now += 30_000;
    await bridge.refreshHermesHealth(); expect(restart).toHaveBeenCalledTimes(3);
    fetch.mockResolvedValue({ ok: true, status: 200 });
    await bridge.refreshHermesHealth();
    expect(bridge.snapshot.hermesApiReachable).toBe(true);
    expect(bridge.snapshot.lastError).toBeNull();
  });
  it.each([true, false])('never replaces a live owned or external API (owned=%s)', async owned => {
    const { bridge, fetch } = await fixture(owned);
    fetch.mockRejectedValue(new Error('timeout'));
    const restart = vi.spyOn(bridge, 'ensureHermesApiReady');
    await bridge.refreshHermesHealth();
    expect(restart).not.toHaveBeenCalled();
    expect(bridge.snapshot.lastError).toContain('not reachable');
  });
  it.skipIf(process.platform === 'win32')('replaces a provably Clawket-started gateway that rejects a rotated key', async () => {
    const { spawn: realSpawn } = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    const { bridge, child, fetch, root, ownerScope } = await fixture(false);
    const startGatewayStandIn = () => realSpawn(process.execPath,
      ['-e', 'setInterval(() => {}, 1000)', 'gateway', 'run', '--replace'], { stdio: 'ignore' });
    // An earlier Bridge started and recorded this gateway before a re-pair rotated its key.
    const previous = startGatewayStandIn();
    const replacement = startGatewayStandIn();
    try {
      await Promise.all([once(previous, 'spawn'), once(replacement, 'spawn')]);
      await expect(recordClawketHermesGateway(ownerScope, previous.pid!)).resolves.toBe(true);
      Object.assign(child, { pid: replacement.pid });
      vi.stubEnv('CLAWKET_HERMES_BRIDGE_TOKEN', 'bridge-token');
      fake.spawn.mockClear();
      fetch.mockImplementation(async () => (fake.spawn.mock.calls.length ? { ok: true, status: 200 } : { ok: false, status: 401 }));

      await expect(bridge.ensureHermesApiReady()).resolves.toBe(true);
      expect(fake.spawn).toHaveBeenCalledTimes(1);
      expect(fake.spawn).toHaveBeenCalledWith(expect.any(String), ['gateway', 'run', '--replace'], expect.objectContaining({
        env: expect.objectContaining({ HERMES_HOME: root, API_SERVER_ENABLED: 'true', API_SERVER_KEY: bridge.apiKey }),
      }));
      expect(fake.spawn.mock.calls[0][2].env).not.toHaveProperty('CLAWKET_HERMES_BRIDGE_TOKEN');
      // Hermes' own --replace retires the previous gateway; Clawket never signals it directly.
      expect(previous.exitCode).toBeNull();
      expect(bridge.snapshot).toMatchObject({ hermesApiReachable: true, lastError: null });
      // The new gateway is recorded at spawn, so a later key rotation can replace it too.
      expect(JSON.parse(await readFile(ownerScope.ownerPath, 'utf8'))).toMatchObject({ pid: replacement.pid });
    } finally {
      previous.kill('SIGKILL');
      replacement.kill('SIGKILL');
    }
  });
  it.each(['missing', 'corrupted', 'exited', 'other scope'])(
    'leaves a gateway rejecting the key running when its Clawket record is %s',
    async (evidence) => {
      const { bridge, fetch, ownerScope } = await fixture(false);
      const record = { version: 1, pid: 2_147_483_646, startedAt: 'Wed Oct 1 01:39:23 2026',
        apiBaseUrl: ownerScope.apiBaseUrl, hermesHomePath: ownerScope.hermesHomePath };
      if (evidence !== 'missing') {
        await mkdir(dirname(ownerScope.ownerPath), { recursive: true });
        await writeFile(ownerScope.ownerPath, evidence === 'corrupted' ? '{"version":1,"pid":'
          : JSON.stringify(evidence === 'other scope' ? { ...record, apiBaseUrl: 'http://127.0.0.1:8643' } : record));
      }
      fetch.mockResolvedValue({ ok: false, status: 401 });
      fake.spawn.mockClear();

      await expect(bridge.ensureHermesApiReady()).resolves.toBe(false);
      expect(fake.spawn).not.toHaveBeenCalled();
      expect(bridge.snapshot.lastError).toContain('rejected the configured API key');
      expect(bridge.snapshot.lastError).toContain('--restart-hermes');
    },
  );
  it('does not replace an API rejecting credentials during recovery', async () => {
    let now = 100_000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    const { bridge, child, fetch } = await fixture();
    child.emit('exit', 1); now += 30_000;
    fetch.mockResolvedValue({ ok: false, status: 401 });
    await bridge.refreshHermesHealth();
    expect(fake.spawn).toHaveBeenCalledTimes(1);
    expect(bridge.snapshot.lastError).toContain('rejected the configured API key');
  });
  it('coalesces health probes and ignores their result after stop', async () => {
    const { bridge, fetch } = await fixture();
    let release!: (value: unknown) => void;
    fetch.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    fetch.mockClear();
    const first = bridge.refreshHermesHealth();
    const second = bridge.refreshHermesHealth();
    expect(fetch).toHaveBeenCalledTimes(1);
    await bridge.stop();
    release({ ok: false, status: 503 }); await Promise.all([first, second]);
    expect(bridge.snapshot.running).toBe(false);
    expect(bridge.snapshot.lastError).toBeNull();
  });
  it('does not spawn after stop during a readiness probe', async () => {
    const { bridge, fetch } = await fixture(false);
    let release!: (value: unknown) => void;
    fetch.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    fake.spawn.mockClear();
    const pending = bridge.ensureHermesApiReady();
    await bridge.stop(); release({ ok: false, status: 503 });
    await expect(pending).resolves.toBe(false);
    expect(fake.spawn).not.toHaveBeenCalled();
  });
});
