import { describe, expect, it, vi } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { DesktopIpc } from './desktop-ipc.js';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const idle = () => ({ turns: [{ status: 'completed' }], requests: [] });
function fixture() {
  const ipc = new DesktopIpc([]), write = vi.fn();
  Object.assign(ipc, { socket: { destroyed: false, destroy: vi.fn() }, clientId: 'bridge', write });
  const receive = (frame: object) => (ipc as any).receive(frame);
  const snapshot = (id: string, state: any = idle()) => receive({ type: 'broadcast', method: 'thread-stream-state-changed',
    version: 11, sourceClientId: 'owner', params: { hostId: 'local', conversationId: id, change: { type: 'snapshot', conversationState: state } } });
  const openIdle = (id: string) => { ipc.follow(id); snapshot(id); };
  return { ipc, write, receive, snapshot, openIdle };
}

describe('bounded opened-chat desktop observations', () => {
  it('reuses idle follows beyond 64 visits and ignores retired native content', async () => {
    const { ipc, write, snapshot, openIdle } = fixture();
    const released = vi.fn(); ipc.on('observation-released', released);
    try {
      for (let i = 0; i < 100; i++) {
        ipc.follow(`chat-${i}`);
        snapshot(`chat-${i}`, i % 2 ? idle() : { turns: [], requests: [{ completed: true }], turnHistory: { kind: 'canonical',
          history: { entitiesByKey: { terminal: { status: 'interrupted' } }, islands: [{ entries: [{ value: 'terminal' }] }] } } });
      }
      await flush();
      expect(ipc.snapshots.size).toBe(64);
      expect((ipc as any).followed.size).toBe(64);
      expect((ipc as any).followGenerations.size).toBe(64);
      expect(released).toHaveBeenCalledTimes(36);
      const retirements = write.mock.calls.map(([frame]) => frame).filter(frame => frame.params?.following === false);
      expect(retirements).toHaveLength(36);
      expect(retirements[0]).toMatchObject({ type: 'broadcast', method: 'thread-stream-following-changed', version: 1,
        params: { conversationId: 'chat-0', following: false } });
      expect(write.mock.calls.some(([frame]) => frame.type === 'request')).toBe(false);
      snapshot('chat-0', { turns: [{ status: 'inProgress' }], requests: [] });
      expect(ipc.snapshots.has('chat-0')).toBe(false);
      openIdle('chat-0'); expect(ipc.snapshots.has('chat-0')).toBe(true);
      expect(ipc.snapshots.has('chat-36')).toBe(false);
    } finally { ipc.stop(); }
  });

  it('renews a recently read chat and preserves the opened chat against catalog expiry', () => {
    const { ipc, openIdle } = fixture();
    try {
      for (let i = 0; i < 64; i++) openIdle(`chat-${i}`);
      ipc.follow('chat-0'); openIdle('new');
      expect(ipc.snapshots.has('chat-0')).toBe(true); expect(ipc.snapshots.has('chat-1')).toBe(false);
      ipc.observe('chat-0'); ipc.unobserve('chat-0');
      expect(ipc.isObservationOnly('chat-0')).toBe(false); expect(ipc.snapshots.has('chat-0')).toBe(true);
    } finally { ipc.stop(); }
  });

  it.each([
    { turns: [{ status: 'inProgress' }], requests: [] },
    { turns: [{ status: 'future-native-state' }], requests: [] },
    { turns: [null], requests: [] },
    { turns: [], requests: [{ method: 'item/commandExecution/requestApproval' }] },
    { turns: [], requests: [{ method: 'item/tool/requestUserInput' }] },
    { turns: [], requests: [null] },
    { turns: [], requests: [], turnHistory: { kind: 'canonical' } },
    { turns: [], requests: [], turnHistory: { kind: 'canonical', history: { entitiesByKey: { active: { status: 'active' } }, islands: [{ entries: ['active'] }] } } },
    { turns: [], requests: [], turnHistory: { kind: 'canonical', history: { entitiesByKey: { active: { status: 'inProgress' } }, islands: [] } } },
    { turns: [], requests: [], turnHistory: { kind: 'canonical', history: { entitiesByKey: {}, islands: [{ entries: ['missing'] }] } } },
    { turns: [], requests: [], turnHistory: { kind: 'canonical', history: { entitiesByKey: {}, islands: [null] } } },
    { turns: [], requests: [], turnHistory: { kind: 'canonical', history: { entitiesByKey: {}, islands: [{ entries: {} }] } } },
  ])('never reuses a nonterminal, pending or malformed native snapshot: %j', state => {
    const { ipc, snapshot, openIdle } = fixture();
    try {
      ipc.follow('protected'); snapshot('protected', state);
      for (let i = 0; i < 90; i++) openIdle(`idle-${i}`);
      expect(ipc.snapshots.get('protected')?.state).toEqual(state);
      expect((ipc as any).followed.has('protected')).toBe(true);
    } finally { ipc.stop(); }
  });

  it('protects service work and pending native requests even with a terminal snapshot', async () => {
    const { ipc, openIdle, receive, write } = fixture();
    const protectedIds = new Set(['work']); ipc.followProtected = id => protectedIds.has(id);
    try {
      openIdle('work'); openIdle('dispatch');
      for (let i = 2; i < 64; i++) { ipc.follow(`unknown-${i}`); (ipc as any).ownerProbeQueue.delete(`unknown-${i}`); }
      const pending = ipc.request('thread-follower-start-turn', { conversationId: 'dispatch' }); await Promise.resolve();
      expect(() => ipc.follow('new')).toThrow('unconfirmed');
      expect(ipc.snapshots.has('work')).toBe(true); expect(ipc.snapshots.has('dispatch')).toBe(true);
      const frame = write.mock.calls.map(([frame]) => frame).find(frame => frame.method === 'thread-follower-start-turn');
      receive({ type: 'response', requestId: frame.requestId, resultType: 'success', result: {} }); await pending;
      ipc.follow('new'); expect(ipc.snapshots.has('dispatch')).toBe(false); expect(ipc.snapshots.has('work')).toBe(true);
    } finally { ipc.stop(); }
  });

  it('keeps membership intact when native retirement cannot be written', () => {
    const { ipc, write, openIdle } = fixture();
    try {
      for (let i = 0; i < 64; i++) openIdle(`chat-${i}`);
      write.mockImplementation(frame => { if (frame.params?.following === false) throw new Error('transfer busy'); });
      expect(() => ipc.follow('new')).toThrow('transfer busy');
      expect(ipc.snapshots.has('chat-0')).toBe(true); expect((ipc as any).followed.size).toBe(64);
      expect((ipc as any).followed.has('new')).toBe(false);
    } finally { ipc.stop(); }
  });
});

describe('explicit no-owner observation reuse', () => {
  it('visits more than 64 ownerless chats through bounded read-only discovery', async () => {
    const { ipc, write, receive } = fixture();
    write.mockImplementation(frame => {
      if (frame.method === 'thread-owner-discovery') queueMicrotask(() => receive({ type: 'response', requestId: frame.requestId, resultType: 'error', error: 'no-client-found' }));
    });
    try {
      for (let i = 0; i < 100; i++) { ipc.follow(`absent-${i}`); await flush(); }
      expect((ipc as any).followed.size).toBe(64); expect((ipc as any).noOwner.size).toBe(64);
      const requests = write.mock.calls.map(([frame]) => frame).filter(frame => frame.type === 'request');
      expect(requests).toHaveLength(100); expect(new Set(requests.map(frame => frame.method))).toEqual(new Set(['thread-owner-discovery']));
      expect((ipc as any).ownerProbes.size).toBe(0);
    } finally { ipc.stop(); }
  });

  it('bounds discovery and retains new active state received before no-owner resolution', async () => {
    const { ipc, write, receive, snapshot } = fixture();
    try {
      for (let i = 0; i < 64; i++) ipc.follow(`chat-${i}`);
      await flush(); expect((ipc as any).ownerProbes.size).toBe(2);
      const first = write.mock.calls.map(([frame]) => frame).find(frame => frame.method === 'thread-owner-discovery');
      snapshot(first.params.conversationId, { turns: [{ status: 'inProgress' }], requests: [] });
      receive({ type: 'response', requestId: first.requestId, resultType: 'error', error: 'no-client-found' }); await flush();
      expect((ipc as any).noOwner.has(first.params.conversationId)).toBe(false);
      expect(() => ipc.follow('new')).toThrow('unconfirmed');
      expect(ipc.snapshots.get(first.params.conversationId)?.state.turns[0].status).toBe('inProgress');
      expect((ipc as any).ownerProbes.size).toBe(2);
    } finally { ipc.stop(); }
  });

  it.each(['request-timeout', 'error-handling-request', 'request-version-mismatch'])('does not turn %s into idle proof', async error => {
    const { ipc, write, receive } = fixture();
    write.mockImplementation(frame => { if (frame.method === 'thread-owner-discovery') queueMicrotask(() => receive({ type: 'response', requestId: frame.requestId, resultType: 'error', error })); });
    try {
      for (let i = 0; i < 64; i++) ipc.follow(`chat-${i}`);
      await flush(); expect((ipc as any).noOwner.size).toBe(0);
      expect(() => ipc.follow('new')).toThrow('unconfirmed');
    } finally { ipc.stop(); }
  });

  it('rejects no-owner proof from an earlier socket or follow generation', async () => {
    const { ipc, write, receive, snapshot, openIdle } = fixture();
    try {
      ipc.follow('old'); await flush();
      let probe = write.mock.calls.map(([frame]) => frame).find(frame => frame.method === 'thread-owner-discovery');
      Object.assign(ipc, { socket: { destroyed: false, destroy: vi.fn() }, clientId: 'replacement' });
      receive({ type: 'response', requestId: probe.requestId, resultType: 'error', error: 'no-client-found' }); await flush();
      expect((ipc as any).noOwner.has('old')).toBe(false);
      ipc.follow('old'); await flush();
      probe = write.mock.calls.map(([frame]) => frame).filter(frame => frame.method === 'thread-owner-discovery').at(-1);
      snapshot('old');
      for (let i = 1; i < 64; i++) { ipc.follow(`active-${i}`); snapshot(`active-${i}`, { turns: [{ status: 'inProgress' }], requests: [] }); }
      receive({ type: 'response', requestId: probe.requestId, resultType: 'error', error: 'no-client-found' });
      openIdle('new'); // Retire old after the response but before its promise settles.
      ipc.follow('old'); // This is a distinct generation, evicting new.
      await flush(); expect((ipc as any).noOwner.has('old')).toBe(false);
      expect(ipc.snapshots.has('old')).toBe(false);
      ipc.stop();
      receive({ type: 'response', requestId: probe.requestId, resultType: 'error', error: 'no-client-found' });
      await flush(); expect((ipc as any).followed.size).toBe(0); expect((ipc as any).noOwner.size).toBe(0);
      expect(() => ipc.follow('late')).toThrow('stopped'); expect(ipc.observe('late')).toBe(false);
    } finally { ipc.stop(); }
  });
});

it('reconnects only current follows and does not reuse stale idle snapshots', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clawket-follow-'));
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\clawket-follow-${randomUUID()}` : join(directory, 'ipc.sock');
  const peers = new Set<Socket>(), follows: string[] = [];
  const send = (socket: Socket, frame: object) => { const body = Buffer.from(JSON.stringify(frame)), header = Buffer.alloc(4); header.writeUInt32LE(body.length); socket.write(Buffer.concat([header, body])); };
  const server = createServer(socket => {
    peers.add(socket); socket.once('close', () => peers.delete(socket)); let bytes = Buffer.alloc(0);
    socket.on('data', chunk => {
      bytes = Buffer.concat([bytes, chunk]);
      while (bytes.length >= 4 && bytes.length >= 4 + bytes.readUInt32LE()) {
        const size = bytes.readUInt32LE(), frame = JSON.parse(bytes.subarray(4, size + 4).toString()); bytes = bytes.subarray(size + 4);
        if (frame.method === 'initialize') send(socket, { type: 'response', requestId: frame.requestId, resultType: 'success', result: { clientId: randomUUID() } });
        if (frame.method === 'thread-owner-discovery') send(socket, { type: 'response', requestId: frame.requestId, resultType: 'success', result: { owner: true } });
        if (frame.method === 'thread-stream-following-changed' && frame.params.following) {
          follows.push(frame.params.conversationId);
          send(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner',
            params: { hostId: 'local', conversationId: frame.params.conversationId, change: { type: 'snapshot', conversationState: idle() } } });
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  const ipc = new DesktopIpc([path]);
  try {
    await ipc.connect();
    for (let i = 0; i < 65; i++) { const next = once(ipc, 'snapshot'); ipc.follow(`chat-${i}`); await next; }
    const offline = once(ipc, 'offline'); for (const peer of peers) peer.destroy(); await offline;
    expect(() => ipc.follow('while-offline')).toThrow('unconfirmed');
    const first = once(ipc, 'snapshot'), previous = follows.length; await ipc.connect(); await first;
    await vi.waitFor(() => { expect(follows.length - previous).toBe(64); expect([...ipc.snapshots.values()].every(snapshot => snapshot.fresh)).toBe(true); }, { timeout: 1_000 });
    expect(follows.slice(previous)).not.toContain('chat-0');
    const refreshed = once(ipc, 'snapshot'); ipc.follow('after-reconnect'); await refreshed;
    expect(ipc.snapshots.has('after-reconnect')).toBe(true); expect(ipc.snapshots.size).toBe(64);
  } finally { ipc.stop(); for (const peer of peers) peer.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});
