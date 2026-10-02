import { describe, expect, it, vi } from 'vitest';
import type { SessionCatalogSyncResponse, SessionDescriptor } from '@clawket/agent-protocol';
import { SessionCatalogSync, SESSION_CATALOG_PAGE_BYTES } from './session-catalog.js';
import { SessionCatalogConsumer } from '../../../apps/mobile/src/connection/adapters/session-catalog';

const row = (key: string, title = key): SessionDescriptor => ({ connectionId: '', agentId: 'codex', key, kind: 'direct', title, updatedAt: 1,
  hasActiveRun: false, allowedActions: { rename: false, reset: false, delete: false, pin: true } });
const base = (reply: SessionCatalogSyncResponse) => {
  if (!('revision' in reply)) throw new Error('Expected a complete snapshot reference');
  return { epoch: reply.epoch, revision: reply.revision };
};
async function full(catalog: SessionCatalogSync, first: SessionCatalogSyncResponse) {
  if (first.kind !== 'full') throw new Error('Expected full');
  const rows = [...first.sessions], pages = [first];
  let page = first;
  while (page.nextOffset !== null) {
    const next = await catalog.reply({ page: { ...base(first), offset: page.nextOffset } });
    if (next.kind !== 'full') throw new Error('Expected an immutable continuation');
    expect(base(next)).toEqual(base(first)); expect(next.total).toBe(first.total);
    expect(next.offset).toBe(page.offset + page.sessions.length);
    rows.push(...next.sessions); pages.push(next); page = next;
  }
  for (const part of pages) expect(Buffer.byteLength(JSON.stringify(part))).toBeLessThanOrEqual(SESSION_CATALOG_PAGE_BYTES);
  expect(rows).toHaveLength(first.total);
  return { rows, pages };
}

describe('bounded immutable conversation catalog sync', () => {
  it('indexes exact frozen continuation offsets only on request, without rescanning', async () => {
    const rows = Array.from({ length: 1023 }, (_, i) => row(String(i), '目录🙂'.repeat(70)));
    const load = vi.fn(() => rows), catalog = new SessionCatalogSync(load);
    const legacy = await catalog.reply({});
    expect(legacy).not.toHaveProperty('pageOffsets');
    const first = await catalog.reply({ pageIndex: true });
    if (first.kind !== 'full') throw new Error('Expected full');
    const assembled = [...first.sessions];
    let nextOffset = first.nextOffset;
    for (const offset of first.pageOffsets!) {
      expect(offset).toBe(nextOffset);
      const next = await catalog.reply({ page: { ...base(first), offset } });
      if (next.kind !== 'full') throw new Error('Expected frozen page');
      expect(Buffer.byteLength(JSON.stringify(next))).toBeLessThanOrEqual(SESSION_CATALOG_PAGE_BYTES);
      assembled.push(...next.sessions); nextOffset = next.nextOffset;
    }
    expect(nextOffset).toBeNull(); expect(assembled).toEqual(rows);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(SESSION_CATALOG_PAGE_BYTES);
    expect(load).toHaveBeenCalledTimes(2);
    expect(await catalog.reply({ base: base(first), pageIndex: true })).toEqual({ kind: 'unchanged', ...base(first) });
  });
  it('keeps a valid near-limit first row on serial pages when an index cannot fit', async () => {
    const rows = [row('large', 'x'.repeat(SESSION_CATALOG_PAGE_BYTES - 1024)), row('small')];
    const catalog = new SessionCatalogSync(() => rows), first = await catalog.reply({ pageIndex: true });
    expect(first).not.toHaveProperty('pageOffsets');
    expect((await full(catalog, first)).rows).toEqual(rows);
    expect(await new SessionCatalogSync(() => []).reply({ pageIndex: true })).toMatchObject({ sessions: [], nextOffset: null, pageOffsets: [] });
  });
  it('reduces full catalog network waits with the real Mobile consumer and a fixed 300ms RPC latency', async () => {
    vi.useFakeTimers();
    try {
      const rows = Array.from({ length: 1023 }, (_, i) => row(String(i), 'x'.repeat(420)));
      const measurements: Array<{ ms: number; requests: number; peak: number }> = [];
      for (const indexed of [false, true]) {
        const service = new SessionCatalogSync(() => rows);
        let requests = 0, active = 0, peak = 0;
        const consumer = new SessionCatalogConsumer(async (_method, params) => {
          requests++; active++; peak = Math.max(peak, active);
          await new Promise(resolve => setTimeout(resolve, 300));
          try { return await service.reply(params); } finally { active--; }
        });
        consumer.configure(1, indexed ? 1 : undefined);
        const started = Date.now(), listing = consumer.list();
        await vi.runAllTimersAsync();
        expect(await listing).toEqual(rows);
        measurements.push({ ms: Date.now() - started, requests, peak });
      }
      expect(measurements[0].peak).toBe(1); expect(measurements[1].peak).toBe(3);
      expect(measurements[1].ms).toBe(300 * (1 + Math.ceil((measurements[1].requests - 1) / 3)));
      expect(measurements[1].ms).toBeLessThan(measurements[0].ms / 2);
      console.info('Catalog RPC latency simulation (300ms per exchange):', measurements);
    } finally { vi.useRealTimers(); }
  });
  it('joins one fresh scan after an acknowledged management change without publishing the older result', async () => {
    const pending: Array<(rows: SessionDescriptor[]) => void> = [];
    const load = vi.fn(() => new Promise<SessionDescriptor[]>(resolve => pending.push(resolve)));
    const catalog = new SessionCatalogSync(load), old = catalog.reply({}); await Promise.resolve();
    catalog.invalidate(); const current = catalog.reply({}); await Promise.resolve();
    pending[0]([row('a', 'old')]); await Promise.resolve();
    pending[1]([row('a', 'confirmed')]);
    expect(await old).toEqual(await current); expect(load).toHaveBeenCalledTimes(2);
    expect(catalog.cachedRows()).toEqual([row('a', 'confirmed')]);
  });
  it('bounds repeated management invalidations without blocking newer reads or evicting frozen pages', async () => {
    let complete!: (rows: SessionDescriptor[]) => void;
    const load = vi.fn<() => Promise<SessionDescriptor[]>>().mockResolvedValueOnce([row('a')])
      .mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const catalog = new SessionCatalogSync(load), first = await catalog.reply({});
    const old = catalog.reply({ base: base(first) }); await Promise.resolve();
    catalog.invalidate(); complete([row('a', 'stale')]);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    catalog.invalidate(); complete([row('a', 'also stale')]);
    await expect(old).rejects.toThrow('Conversation catalog changed during refresh; try again');
    expect(await catalog.reply({ page: { ...base(first), offset: 0 } })).toEqual(first);
    const next = catalog.reply({}); await Promise.resolve(); complete([row('a', 'fresh')]);
    expect(await next).toMatchObject({ sessions: [row('a', 'fresh')] });
    expect(load).toHaveBeenCalledTimes(4);
  });
  it('does not turn an invalidated failed scan into a stale client failure when one fresh scan succeeds', async () => {
    let reject!: () => void;
    const load = vi.fn<() => Promise<SessionDescriptor[]>>().mockImplementationOnce(() => new Promise((_, fail) => { reject = () => fail(new Error('old failure')); }))
      .mockResolvedValueOnce([row('current')]);
    const catalog = new SessionCatalogSync(load), old = catalog.reply({}); await Promise.resolve();
    catalog.invalidate(); reject();
    expect(await old).toMatchObject({ kind: 'full', sessions: [row('current')] });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('pages the first 971-row catalog below the large-frame threshold without rescanning', async () => {
    const rows = Array.from({ length: 971 }, (_, i) => row(String(i), '目录🙂'.repeat(70)));
    const load = vi.fn(() => rows), catalog = new SessionCatalogSync(load);
    const first = await catalog.reply({}), result = await full(catalog, first);
    expect(result.pages.length).toBeGreaterThan(2); expect(result.rows).toEqual(rows); expect(load).toHaveBeenCalledTimes(1);
    const same = await catalog.reply({ base: base(first) });
    expect(same).toEqual({ ...base(first), kind: 'unchanged' });
    expect(Buffer.byteLength(JSON.stringify(same))).toBeLessThan(150);
  });
  it('canonicalizes object properties but preserves row ordering and returns exact small deltas', async () => {
    let rows = [row('a', 'a'.repeat(1000)), row('b', 'b'.repeat(1000)), row('c', 'c'.repeat(1000))];
    const catalog = new SessionCatalogSync(() => rows), first = await catalog.reply({});
    rows = rows.map(value => Object.fromEntries(Object.entries(value).reverse()) as unknown as SessionDescriptor);
    expect(await catalog.reply({ base: base(first) })).toEqual({ kind: 'unchanged', ...base(first) });
    rows = [rows[2], row('new'), row('a', 'renamed')];
    const delta = await catalog.reply({ base: base(first) });
    expect(delta).toMatchObject({ kind: 'delta', epoch: first.epoch, baseRevision: base(first).revision,
      upserts: [row('new'), row('a', 'renamed')], removedKeys: ['b'], order: ['c', 'new', 'a'] });
  });
  it('falls back to paged full when the delta is too large', async () => {
    let rows = Array.from({ length: 200 }, (_, i) => row(String(i), 'a'.repeat(800)));
    const catalog = new SessionCatalogSync(() => rows), first = await catalog.reply({});
    rows = rows.map(value => ({ ...value, title: 'b'.repeat(800) }));
    const next = await catalog.reply({ base: base(first) });
    expect((await full(catalog, next)).rows).toEqual(rows);
  });
  it('keeps two immutable shared snapshots for concurrent peers and expires only evicted pages', async () => {
    let rows = [row('a', 'x'.repeat(300))]; const load = vi.fn(() => rows);
    const catalog = new SessionCatalogSync(load), first = await catalog.reply({});
    rows = [...rows, row('b')]; const second = await catalog.reply({ base: base(first) });
    expect((await catalog.reply({ page: { ...base(first), offset: 0 } }))).toMatchObject({ kind: 'full', sessions: [row('a', 'x'.repeat(300))] });
    expect(load).toHaveBeenCalledTimes(2);
    rows = [...rows, row('c')]; await catalog.reply({ base: base(second) });
    expect(await catalog.reply({ page: { ...base(first), offset: 0 } })).toEqual({ kind: 'expired', epoch: first.epoch });
    expect(await catalog.reply({ base: base(first) })).toMatchObject({ kind: 'full', offset: 0, total: 3 });
    expect(await catalog.reply({ page: { ...base(second), offset: 0 } })).toMatchObject({ kind: 'full', total: 2 });
    const restarted = new SessionCatalogSync(() => rows);
    const cold = await restarted.reply({ base: base(second) });
    expect(cold.kind).toBe('full'); expect(cold.epoch).not.toBe(first.epoch);
  });
  it('coalesces overlapping complete scans and does not publish a failed or malformed replacement', async () => {
    let release!: (rows: SessionDescriptor[]) => void;
    const load = vi.fn(() => new Promise<SessionDescriptor[]>(resolve => { release = resolve; }));
    const catalog = new SessionCatalogSync(load);
    const a = catalog.reply({}), b = catalog.reply({}); await Promise.resolve(); release([row('a')]);
    const first = await a; expect(await b).toEqual(first); expect(load).toHaveBeenCalledTimes(1);
    load.mockRejectedValueOnce(new Error('native unavailable'));
    await expect(catalog.reply({ base: base(first) })).rejects.toThrow('Conversation catalog could not be refreshed completely');
    load.mockResolvedValueOnce([row('duplicate'), row('duplicate')]);
    await expect(catalog.reply({ base: base(first) })).rejects.toThrow('Invalid conversation catalog');
    expect(await catalog.reply({ page: { ...base(first), offset: 0 } })).toEqual(first);
    load.mockResolvedValueOnce([row('a')]);
    expect(await catalog.reply({ base: base(first) })).toEqual({ kind: 'unchanged', ...base(first) });
  });
  it('does not allow returned objects to mutate frozen pages or cached Pi fallback rows', async () => {
    const catalog = new SessionCatalogSync(() => [row('a')]), first = await catalog.reply({});
    if (first.kind !== 'full') throw new Error('Expected full');
    first.sessions[0].title = 'changed'; catalog.cachedRows()[0].title = 'also changed';
    expect(await catalog.reply({ page: { ...base(first), offset: 0 } })).toMatchObject({ sessions: [row('a')] });
  });
  it('represents an empty successful catalog with one terminal page', async () => {
    const catalog = new SessionCatalogSync(() => []), first = await catalog.reply({});
    expect(first).toMatchObject({ kind: 'full', offset: 0, total: 0, sessions: [], nextOffset: null });
    await full(catalog, first);
  });
  it.each([null, [], { base: null }, { page: null }, { other: true }, { base: {} }, { pageIndex: false }, { pageIndex: 1 },
    { pageIndex: true, page: { epoch: 'a'.repeat(32), revision: 'b'.repeat(32), offset: 0 } },
    { page: { epoch: 'a'.repeat(32), revision: 'b'.repeat(32), offset: -1 } },
    { page: { epoch: 'a'.repeat(32), revision: 'b'.repeat(32), offset: 0.5 } },
    { base: { epoch: 'a'.repeat(32), revision: 'b'.repeat(32), offset: 0 } },
    { base: { epoch: 'a'.repeat(32), revision: 'b'.repeat(32) }, page: {} }])('rejects malformed requests before scanning: %j', async params => {
    const load = vi.fn(() => []), catalog = new SessionCatalogSync(load);
    await expect(catalog.reply(params)).rejects.toThrow('Invalid conversation catalog request'); expect(load).not.toHaveBeenCalled();
  });
  it('bounds rows, total serialized bytes and individual pages without leaking record content', async () => {
    for (const rows of [Array.from({ length: 10001 }, (_, i) => row(String(i))),
      Array.from({ length: 9000 }, (_, i) => row(String(i), 'x'.repeat(1000))), [row('private-key', 'private '.repeat(10000))]]) {
      await expect(new SessionCatalogSync(() => rows).reply({})).rejects.toThrow(/size limit/);
    }
    const catalog = new SessionCatalogSync(() => [row('a')]), first = await catalog.reply({});
    await expect(catalog.reply({ page: { ...base(first), offset: 1 } })).rejects.toThrow('Invalid conversation catalog request');
  });
});
