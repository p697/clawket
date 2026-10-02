import type { SessionDescriptor } from '@clawket/agent-protocol';
import { SessionCatalogConsumer, SessionCatalogSupersededError } from './session-catalog';

const epoch = 'a'.repeat(32), revision = '1'.repeat(32), updated = '2'.repeat(32);
function session(key: string, extra: Partial<SessionDescriptor> = {}): SessionDescriptor {
  return { connectionId: '', agentId: 'codex', key, kind: 'direct', title: key, updatedAt: 1,
    hasActiveRun: false, allowedActions: { rename: true, reset: true, delete: true, pin: true }, ...extra };
}
function full(rows: SessionDescriptor[], extra: Record<string, unknown> = {}) {
  return { kind: 'full', epoch, revision, offset: 0, total: rows.length, sessions: rows, nextOffset: null, ...extra };
}
function delta(extra: Record<string, unknown> = {}) {
  return { kind: 'delta', epoch, baseRevision: revision, revision: updated, upserts: [], removedKeys: [], order: ['a'], ...extra };
}
function setup(...responses: unknown[]) {
  const request = jest.fn(async () => responses.shift());
  const catalog = new SessionCatalogConsumer(request);
  catalog.configure(1);
  return { request, catalog };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>(done => { resolve = done; });
  return { promise, resolve };
}

describe('negotiated session catalog', () => {
  it('reads at most three indexed pages together, assembles their order and never exposes a partial list', async () => {
    const pending = new Map<number, ReturnType<typeof deferred>>();
    let active = 0, peak = 0, finished = false;
    const request = jest.fn(async (_method: string, params: any) => {
      if (!params.page) return full([session('0')], { total: 7, nextOffset: 1, pageOffsets: [1, 2, 3, 4, 5, 6] });
      active++; peak = Math.max(peak, active);
      const wait = deferred(); pending.set(params.page.offset, wait);
      try { return await wait.promise; } finally { active--; }
    });
    const catalog = new SessionCatalogConsumer(request); catalog.configure(1, 1);
    const listing = catalog.list().then(rows => { finished = true; return rows; });
    const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
    const reply = (offset: number) => pending.get(offset)!.resolve(full([session(String(offset))], { offset, total: 7, nextOffset: offset < 6 ? offset + 1 : null }));
    await flush();
    expect(request.mock.calls[0][1]).toEqual({ pageIndex: true });
    expect([...pending.keys()]).toEqual([1, 2, 3]);
    reply(3); reply(2); await flush(); expect(finished).toBe(false); expect(request).toHaveBeenCalledTimes(4);
    reply(1); await flush(); expect([...pending.keys()]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(finished).toBe(false); reply(6); reply(5); reply(4);
    await expect(listing).resolves.toEqual(Array.from({ length: 7 }, (_, i) => session(String(i))));
    expect(peak).toBe(3);
  });

  it.each([[], [2], [1, 1], [1, 0], [1, 2.5], [1, 4], 'invalid', Array(513).fill(1)])(
    'rejects a corrupted page index before continuation requests (case %#)', async pageOffsets => {
      const { catalog, request } = setup(full([session('a')], { total: 4, nextOffset: 1, pageOffsets }));
      catalog.configure(1, 1);
      await expect(catalog.list()).rejects.toMatchObject({ code: 'server' });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it('checks indexed page boundaries and retains the last complete baseline on a failed batch', async () => {
    const { catalog, request } = setup(full([session('original')]),
      full([session('a')], { total: 3, nextOffset: 1, revision: updated, pageOffsets: [1, 2] }),
      full([session('b')], { offset: 1, total: 3, nextOffset: 2, revision: updated }),
      full([session('b')], { offset: 2, total: 3, revision: updated }),
      { kind: 'unchanged', epoch, revision });
    catalog.configure(1, 1); await catalog.list();
    await expect(catalog.list()).rejects.toMatchObject({ code: 'server' });
    await expect(catalog.list()).resolves.toEqual([session('original')]);
    expect(request).toHaveBeenLastCalledWith('sessions.sync', { base: { epoch, revision }, pageIndex: true });
  });

  it('settles the whole page window after one fast failure before admitting a retry', async () => {
    const waits = [deferred(), deferred()];
    const failure = new Error('page rejected');
    const request = jest.fn(async (_method: string, params: any) => {
      if (!params.page) return full([session('a')], { total: 4, nextOffset: 1, pageOffsets: [1, 2, 3] });
      if (params.page.offset === 1) throw failure;
      return waits[params.page.offset - 2].promise;
    });
    const catalog = new SessionCatalogConsumer(request); catalog.configure(1, 1);
    let finished = false;
    const listing = catalog.list().catch(error => { finished = true; return error; });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(finished).toBe(false);
    const joined = catalog.list().catch(error => error);
    expect(request).toHaveBeenCalledTimes(4);
    waits.forEach((wait, i) => wait.resolve(full([session(String(i))], { offset: i + 2, total: 4, nextOffset: i === 0 ? 3 : null })));
    await expect(listing).resolves.toBe(failure); await expect(joined).resolves.toBe(failure);
  });

  it('discards an expired indexed batch and restarts the full read only once', async () => {
    const first = full([session('a')], { total: 4, nextOffset: 1, pageOffsets: [1, 2, 3] });
    const batch = () => [full([session('b')], { total: 4, offset: 1, nextOffset: 2 }), { kind: 'expired', epoch },
      full([session('d')], { total: 4, offset: 3 })];
    const { catalog, request } = setup(first, ...batch(), full([session('fresh')], { revision: updated, pageOffsets: [] }));
    catalog.configure(1, 1);
    await expect(catalog.list()).resolves.toEqual([session('fresh')]);
    expect(request).toHaveBeenLastCalledWith('sessions.sync', { pageIndex: true });
    const repeated = setup(first, ...batch(), first, ...batch()); repeated.catalog.configure(1, 1);
    await expect(repeated.catalog.list()).rejects.toMatchObject({ code: 'server' });
    expect(repeated.request).toHaveBeenCalledTimes(8);
  });

  it('fences every outstanding indexed page when the socket retires', async () => {
    const waits = [deferred(), deferred(), deferred()];
    const request = jest.fn(async (_method: string, params: any) => !params.page
      ? full([session('a')], { total: 4, nextOffset: 1, pageOffsets: [1, 2, 3] }) : waits[params.page.offset - 1].promise);
    const catalog = new SessionCatalogConsumer(request); catalog.configure(1, 1);
    const listing = catalog.list().catch(error => error);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(4); catalog.retire();
    waits.forEach((wait, i) => wait.resolve(full([session(String(i))], { offset: i + 1, total: 4, nextOffset: i < 2 ? i + 2 : null })));
    await expect(listing).resolves.toBeInstanceOf(SessionCatalogSupersededError);
  });

  it('keeps serial pagination if an optional index is absent or not exactly negotiated', async () => {
    for (const version of [undefined, true, '1', 2, 1]) {
      const { catalog, request } = setup(full([session('a')], { total: 2, nextOffset: 1 }), full([session('b')], { offset: 1, total: 2 }));
      catalog.configure(1, version); await expect(catalog.list()).resolves.toHaveLength(2);
      expect(request.mock.calls[0]).toEqual(['sessions.sync', version === 1 ? { pageIndex: true } : {}]);
    }
  });
  it.each([undefined, false, true, '1', 0, 2])('preserves sessions.list for version %p', async version => {
    const rows = [session('legacy')];
    const { catalog, request } = setup(rows);
    catalog.configure(version);
    await expect(catalog.list()).resolves.toBe(rows);
    expect(request).toHaveBeenCalledWith('sessions.list', {});
  });

  it('assembles frozen pages before exposing the array and uses only complete baselines', async () => {
    const { catalog, request } = setup(
      full([session('a')], { total: 2, nextOffset: 1 }),
      full([session('b')], { offset: 1, total: 2 }),
      { kind: 'unchanged', epoch, revision },
    );
    await expect(catalog.list()).resolves.toEqual([session('a'), session('b')]);
    await expect(catalog.list()).resolves.toHaveLength(2);
    expect(request.mock.calls).toEqual([
      ['sessions.sync', {}],
      ['sessions.sync', { page: { epoch, revision, offset: 1 } }],
      ['sessions.sync', { base: { epoch, revision } }],
    ]);
  });

  it('atomically applies upserts, removals and explicit ordering', async () => {
    const { catalog, request } = setup(
      full([session('a'), session('b')]),
      delta({ upserts: [session('a', { title: 'Renamed' }), session('c')], removedKeys: ['b'], order: ['c', 'a'] }),
      { kind: 'unchanged', epoch, revision: updated },
    );
    await catalog.list();
    await expect(catalog.list()).resolves.toEqual([session('c'), session('a', { title: 'Renamed' })]);
    await catalog.list();
    expect(request).toHaveBeenLastCalledWith('sessions.sync', { base: { epoch, revision: updated } });
  });

  it('accepts an empty authoritative catalog and a new server epoch only through a full snapshot', async () => {
    const nextEpoch = 'b'.repeat(32);
    const { catalog, request } = setup(full([session('a')]), full([], { epoch: nextEpoch }), { kind: 'unchanged', epoch: nextEpoch, revision });
    await catalog.list();
    await expect(catalog.list()).resolves.toEqual([]);
    await catalog.list();
    expect(request).toHaveBeenLastCalledWith('sessions.sync', { base: { epoch: nextEpoch, revision } });
  });

  it('does not let callers mutate the baseline or share nested presentation objects', async () => {
    const { catalog } = setup(full([session('a', { project: { id: 'p', name: 'Project', path: '/qa', available: true } })]), { kind: 'unchanged', epoch, revision });
    const first = await catalog.list();
    first[0].title = 'Local edit'; first[0].allowedActions.rename = false; first[0].project!.path = '/different'; first.push(session('extra'));
    const second = await catalog.list();
    expect(second).toHaveLength(1); expect(second[0].title).toBe('a');
    expect(second[0].allowedActions.rename).toBe(true); expect(second[0].project?.path).toBe('/qa');
  });

  it('coalesces concurrent lists into one serial page chain', async () => {
    const page = deferred();
    const request = jest.fn().mockResolvedValueOnce(full([session('a')], { total: 2, nextOffset: 1 })).mockReturnValueOnce(page.promise);
    const catalog = new SessionCatalogConsumer(request); catalog.configure(1);
    const first = catalog.list(), second = catalog.list();
    await Promise.resolve(); await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    page.resolve(full([session('b')], { total: 2, offset: 1 }));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b); expect(a).not.toBe(b); expect(a[0]).not.toBe(b[0]);
  });

  it('restarts an expired frozen page once without a base and never combines its partial rows', async () => {
    const newEpoch = 'c'.repeat(32);
    const { catalog, request } = setup(full([session('old')], { total: 2, nextOffset: 1 }), { kind: 'expired', epoch: newEpoch }, full([session('fresh')], { epoch: newEpoch }));
    await expect(catalog.list()).resolves.toEqual([session('fresh')]);
    expect(request).toHaveBeenLastCalledWith('sessions.sync', {});
  });

  it('rejects a second expiry and an expiry outside pagination', async () => {
    const { catalog, request } = setup(
      full([session('a')], { total: 2, nextOffset: 1 }), { kind: 'expired', epoch },
      full([session('b')], { total: 2, nextOffset: 1 }), { kind: 'expired', epoch },
    );
    await expect(catalog.list()).rejects.toMatchObject({ code: 'server' });
    expect(request).toHaveBeenCalledTimes(4);
    await expect(setup({ kind: 'expired', epoch }).catalog.list()).rejects.toMatchObject({ code: 'server' });
  });

  it.each([
    ['offset', full([session('b')], { total: 2, offset: 0 })],
    ['epoch', full([session('b')], { total: 2, offset: 1, epoch: 'b'.repeat(32) })],
    ['revision', full([session('b')], { total: 2, offset: 1, revision: updated })],
    ['total', full([session('b')], { total: 3, offset: 1 })],
    ['duplicate key', full([session('a')], { total: 2, offset: 1 })],
    ['empty non-final page', full([], { total: 2, offset: 1, nextOffset: 1 })],
    ['early end', full([], { total: 2, offset: 1 })],
    ['non-full page', { kind: 'unchanged', epoch, revision }],
  ])('rejects malformed pagination: %s, preserving the last committed revision', async (_name, broken) => {
    const { catalog, request } = setup(full([session('baseline')]), full([session('a')], { total: 2, nextOffset: 1 }), broken,
      { kind: 'unchanged', epoch, revision });
    await catalog.list();
    await expect(catalog.list()).rejects.toMatchObject({ code: 'server' });
    await expect(catalog.list()).resolves.toEqual([session('baseline')]);
    expect(request).toHaveBeenLastCalledWith('sessions.sync', { base: { epoch, revision } });
  });

  it.each([
    ['unknown baseline', { kind: 'unchanged', epoch, revision }],
    ['invalid epoch', full([], { epoch: 'not-an-epoch' })],
    ['invalid revision', full([], { revision: '1' })],
    ['too many sessions', full([], { total: 10_001 })],
    ['negative count', full([], { total: -1 })],
    ['noninteger count', full([], { total: 0.5 })],
    ['wrong next offset', full([session('a')], { total: 2, nextOffset: 2 })],
    ['overflow count', full([session('a')], { total: 0 })],
    ['missing descriptor fields', full([{ key: 'a' } as SessionDescriptor])],
    ['malformed project', full([session('a', { project: {} as SessionDescriptor['project'] })])],
    ['duplicate initial keys', full([session('a'), session('a')])],
    ['non-page response', null],
    ['oversized UTF-8 page', full([session('a', { preview: '界'.repeat(23_000) })])],
  ])('fails closed without legacy retry: %s', async (_name, broken) => {
    const { catalog, request } = setup(broken);
    await expect(catalog.list()).rejects.toMatchObject({ code: 'server' });
    expect(request).toHaveBeenCalledTimes(1); expect(request).toHaveBeenCalledWith('sessions.sync', {});
  });

  it.each([
    ['wrong base', delta({ baseRevision: updated })],
    ['wrong epoch', delta({ epoch: 'b'.repeat(32) })],
    ['unchanged revision', delta({ revision })],
    ['unknown removal', delta({ removedKeys: ['missing'] })],
    ['duplicate removals', delta({ removedKeys: ['a', 'a'], order: [] })],
    ['overlapping upsert/removal', delta({ removedKeys: ['a'], upserts: [session('a')] })],
    ['duplicate upserts', delta({ upserts: [session('a'), session('a')] })],
    ['duplicate order', delta({ order: ['a', 'a'] })],
    ['missing order item', delta({ order: [] })],
    ['unknown order item', delta({ order: ['unknown'] })],
  ])('rejects malformed deltas atomically: %s', async (_name, broken) => {
    const { catalog } = setup(full([session('a')]), broken, { kind: 'unchanged', epoch, revision });
    await catalog.list();
    await expect(catalog.list()).rejects.toMatchObject({ code: 'server' });
    await expect(catalog.list()).resolves.toEqual([session('a')]);
  });

  it('bounds aggregate JSON even when every individual page is valid', async () => {
    const rows = Array.from({ length: 145 }, (_, index) => session(String(index), { preview: 'x'.repeat(60_000) }));
    const pages = rows.map((row, index) => full([row], { total: rows.length, offset: index, nextOffset: index + 1 === rows.length ? null : index + 1 }));
    const { catalog, request } = setup(...pages);
    await expect(catalog.list()).rejects.toMatchObject({ code: 'server' });
    expect(request.mock.calls.length).toBeLessThan(rows.length);
  });

  it.each([
    ['canContinue', { canContinue: 'false' }],
    ['source', { source: 'other' }],
    ['attention', { attention: false }],
    ['attention enum', { attention: 'unknown' }],
    ['attention coercion', { attention: ['input'] }],
    ['blocked reason', { continuationBlockedReason: 'other' }],
    ['blocked reason coercion', { continuationBlockedReason: ['in_use'] }],
    ['archive permission', { allowedActions: { rename: true, reset: true, delete: true, pin: true, archive: 'false' } }],
    ['oversized key', { key: 'a'.repeat(1025) }],
  ])('rejects malformed optional descriptor fields: %s', async (_name, patch) => {
    const broken = { ...session('a'), ...patch } as SessionDescriptor;
    await expect(setup(full([broken])).catalog.list()).rejects.toMatchObject({ code: 'server' });
  });

  it('accepts explicitly unavailable native actions and the maximum valid key', async () => {
    const row = session('a'.repeat(1024), { source: 'native', canContinue: false, attention: null,
      continuationBlockedReason: 'in_use', allowedActions: { rename: false, reset: false, delete: false, pin: true, archive: false } });
    await expect(setup(full([row])).catalog.list()).resolves.toEqual([row]);
  });

  it('fences late pages after retirement but preserves only the completed baseline for fresh negotiation', async () => {
    const late = deferred();
    const request = jest.fn().mockResolvedValueOnce(full([session('stable')])).mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce({ kind: 'unchanged', epoch, revision });
    const catalog = new SessionCatalogConsumer(request); catalog.configure(1); await catalog.list();
    const old = catalog.list().catch(error => error);
    catalog.retire(); catalog.configure(1);
    await expect(catalog.list()).resolves.toEqual([session('stable')]);
    late.resolve(full([session('stale')], { revision: updated }));
    await expect(old).resolves.toMatchObject({ code: 'network' });
    expect(request).toHaveBeenLastCalledWith('sessions.sync', { base: { epoch, revision } });
  });

  it('does not retain partial pages across retirement', async () => {
    const late = deferred();
    const request = jest.fn().mockResolvedValueOnce(full([session('partial')], { total: 2, nextOffset: 1 }))
      .mockReturnValueOnce(late.promise).mockResolvedValueOnce(full([session('fresh')]));
    const catalog = new SessionCatalogConsumer(request); catalog.configure(1);
    const old = catalog.list().catch(error => error);
    await Promise.resolve(); await Promise.resolve();
    catalog.retire(); catalog.configure(1);
    await expect(catalog.list()).resolves.toEqual([session('fresh')]);
    expect(request).toHaveBeenLastCalledWith('sessions.sync', {});
    late.resolve(full([session('late')], { total: 2, offset: 1 }));
    await expect(old).resolves.toMatchObject({ code: 'network' });
  });

  it('clears the baseline on capability downgrade, including a downgrade after retirement', async () => {
    const { catalog, request } = setup(full([session('a')]), [], full([]));
    await catalog.list(); catalog.retire(); catalog.configure(undefined);
    await catalog.list(); expect(request).toHaveBeenLastCalledWith('sessions.list', {});
    catalog.configure(1); await catalog.list(); expect(request).toHaveBeenLastCalledWith('sessions.sync', {});
  });

  it('invalidates frozen pre-mutation pages without clearing negotiation or the complete baseline', async () => {
    const late = deferred(), after = deferred();
    const request = jest.fn().mockResolvedValueOnce(full([session('stable')]))
      .mockResolvedValueOnce(full([session('old-page')], { total: 2, nextOffset: 1, revision: updated }))
      .mockReturnValueOnce(late.promise).mockReturnValueOnce(after.promise)
      .mockResolvedValueOnce({ kind: 'unchanged', epoch, revision: '3'.repeat(32) });
    const catalog = new SessionCatalogConsumer(request); catalog.configure(1); await catalog.list();
    const old = catalog.list().catch(error => error);
    await Promise.resolve(); await Promise.resolve();
    catalog.invalidate();
    const fresh = catalog.list();
    expect(request).toHaveBeenLastCalledWith('sessions.sync', { base: { epoch, revision } });
    // The old flight's finally must not clear the newer coalesced flight.
    late.resolve(full([session('late-page')], { total: 2, offset: 1, revision: updated }));
    await expect(old).resolves.toBeInstanceOf(SessionCatalogSupersededError);
    const joined = catalog.list(); expect(request).toHaveBeenCalledTimes(4);
    after.resolve(full([session('renamed')], { revision: '3'.repeat(32) }));
    await expect(fresh).resolves.toEqual([session('renamed')]);
    await expect(joined).resolves.toEqual([session('renamed')]);
    await catalog.list();
    expect(request).toHaveBeenLastCalledWith('sessions.sync', { base: { epoch, revision: '3'.repeat(32) } });
  });

  it('classifies a late RPC failure from an invalidated read as local supersession only', async () => {
    let reject!: (error: Error) => void;
    const late = new Promise<unknown>((_resolve, fail) => { reject = fail; });
    const request = jest.fn().mockReturnValueOnce(late).mockResolvedValueOnce(full([session('fresh')]));
    const catalog = new SessionCatalogConsumer(request); catalog.configure(1);
    const old = catalog.list().catch(error => error);
    catalog.invalidate(); await expect(catalog.list()).resolves.toEqual([session('fresh')]);
    reject(new Error('Old RPC timed out'));
    await expect(old).resolves.toBeInstanceOf(SessionCatalogSupersededError);
  });
});
