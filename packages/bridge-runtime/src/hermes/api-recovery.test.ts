import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HermesLocalBridge } from './index.js';
import { createTempDirectory, cleanupTempDirectories } from './test-helpers.js';

const fake = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn: fake.spawn,
}));
const bridges: HermesLocalBridge[] = [];
afterEach(async () => {
  await Promise.all(bridges.splice(0).map(bridge => bridge.stop()));
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  await cleanupTempDirectories();
});
async function fixture(owned = true) {
  const root = await createTempDirectory();
  const bridge = new HermesLocalBridge({ hermesHomePath: root, hermesSourcePath: root,
    sessionStorePath: join(root, 'sessions.json'), usageLedgerPath: join(root, 'usage.json'),
    keepSpawnedHermesGatewayAliveOnStop: false });
  bridges.push(bridge);
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(), stdout: null, stderr: null });
  fake.spawn.mockReturnValue(child);
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetch);
  if (owned) await bridge.startHermesGatewayProcess();
  bridge.snapshot.running = true;
  return { bridge, child, fetch };
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
