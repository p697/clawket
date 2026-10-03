import { describe, expect, it, vi } from 'vitest';
import { applyDesktopPatches } from './desktop-ipc.js';

describe('desktop snapshot patches', () => {
  it('replays native array patches without mutating the previous baseline', () => {
    const base = { turns: [{ items: [{ text: 'Hel' }] }], requests: [] };
    const next = applyDesktopPatches(base, [{ op: 'replace', path: ['turns', 0, 'items', 0, 'text'], value: 'Hello' }, { op: 'add', path: ['requests', 0], value: { id: 1 } }]);
    expect(base.turns[0].items[0].text).toBe('Hel'); expect(next.turns[0].items[0].text).toBe('Hello'); expect(next.requests).toHaveLength(1);
  });
  it('rejects prototype keys, missing baselines and invalid array indexes', () => {
    for (const path of [['__proto__', 'polluted'], ['missing', 0], ['turns', -1], ['turns', 999]]) expect(() => applyDesktopPatches({ turns: [] }, [{ op: 'replace', path, value: true }])).toThrow();
    expect(({} as any).polluted).toBeUndefined();
  });
});

import { createServer, type Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DesktopIpc, DesktopIpcError } from './desktop-ipc.js';

it('negotiates a real framed socket and distinguishes no-owner from a lost acknowledgement', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clawket-ipc-'));
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\clawket-ipc-${randomUUID()}` : join(directory, 'ipc.sock');
  const peers = new Set<Socket>();
  const methods: string[] = [];
  const send = (socket: Socket, value: object) => { const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4); header.writeUInt32LE(body.length); socket.write(header); socket.write(body); };
  const server = createServer(socket => {
    peers.add(socket); socket.on('close', () => peers.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE()) {
        const size = buffer.readUInt32LE(), frame = JSON.parse(buffer.subarray(4, 4 + size).toString()); buffer = buffer.subarray(4 + size);
        methods.push(frame.method);
        if (frame.method === 'initialize') send(socket, { type: 'response', requestId: frame.requestId, resultType: 'success', result: { clientId: 'bridge' } });
        if (frame.method === 'absent') send(socket, { type: 'response', requestId: frame.requestId, resultType: 'error', error: 'no-client-found: owner unavailable' });
        if (frame.method === 'lost') socket.destroy();
        if (frame.method === 'thread-stream-following-changed' && frame.params.conversationId === 'large') {
          send(socket, { type:'broadcast', method:'thread-stream-state-changed', version:11, sourceClientId:'owner', params:{hostId:'local',conversationId:'large',change:{type:'snapshot',revision:1,conversationState:{turns:[],requests:[],payload:'x'.repeat(9*1024*1024)}}} });
        } else if (frame.method === 'thread-stream-following-changed') {
          send(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner', params: { hostId: 'remote-host', conversationId: 'thread', change: { type: 'snapshot', revision: 1, conversationState: { turns: [], requests: [{ id: 'wrong-host' }] } } } });
          send(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner', params: { hostId: 'local', conversationId: 'thread', change: { type: 'snapshot', revision: 2, conversationState: { turns: [], requests: [] } } } });
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  const ipc = new DesktopIpc([path]);
  try {
    await ipc.connect(); expect(ipc.ready).toBe(true);
    const snapshots: any[] = []; ipc.on('snapshot', (_id, value) => snapshots.push(value));
    const snapshot = new Promise<void>(resolve => ipc.once('snapshot', () => resolve())); ipc.follow('thread'); await snapshot;
    expect(snapshots).toHaveLength(1); expect(snapshots[0].revision).toBe(2);
    expect(methods).not.toContain('thread-follower-load-complete-history');
    const large = new Promise<void>(resolve => ipc.once('snapshot', () => resolve())); ipc.follow('large'); await large;
    expect(ipc.snapshots.get('large')?.state.payload.length).toBe(9 * 1024 * 1024);
    await expect(ipc.request('absent', {})).rejects.toMatchObject({ outcome: 'no-owner' });
    await expect(ipc.request('lost', {})).rejects.toMatchObject({ outcome: 'uncertain' });
    expect(ipc.snapshots.get('thread')?.fresh).toBe(false);
  } finally { ipc.stop(); for (const peer of peers) peer.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

it('does not send a delayed owner reply on a replacement IPC connection', async () => {
  const ipc = new DesktopIpc([]);
  let complete!: (value: any) => void;
  ipc.handler = { accepts: () => true, request: () => new Promise(resolve => { complete = resolve; }) };
  const write = vi.fn();
  Object.assign(ipc, { socket: { destroyed: false }, clientId: 'old', write });
  (ipc as any).receive({ type: 'request', requestId: 'r', method: 'thread-follower-start-turn', version: 2, params: {} });
  await Promise.resolve();
  Object.assign(ipc, { socket: { destroyed: false }, clientId: 'new' });
  complete({ result: { turn: { id: 'accepted-before-disconnect' } } });
  await new Promise(resolve => setImmediate(resolve));
  expect(write).not.toHaveBeenCalled();
});


it('waits beyond native discovery before accepting an explicit no-owner response', async () => {
  vi.useFakeTimers();
  const ipc = new DesktopIpc([]);
  const write = vi.fn();
  Object.assign(ipc, { socket: { destroyed: false, destroy: vi.fn() }, clientId: 'qa', write });
  try {
    const result = ipc.request('thread-follower-start-turn', { conversationId: 'qa' }).catch(error => error);
    await Promise.resolve();
    const requestId = write.mock.calls[0][0].requestId;
    await vi.advanceTimersByTimeAsync(10_100);
    (ipc as any).receive({ type: 'response', requestId, resultType: 'error', error: 'no-client-found' });
    expect(await result).toMatchObject({ outcome: 'no-owner' });
  } finally { ipc.stop(); vi.useRealTimers(); }
});

it.each(['request-timeout', 'client-disconnected', 'error-handling-request', 'Clawket could not complete this operation'])('retains unknown dispatch for native %s', async error => {
  const ipc = new DesktopIpc([]);
  const write = vi.fn();
  Object.assign(ipc, { socket: { destroyed: false, destroy: vi.fn() }, clientId: 'qa', write });
  try {
    const result = ipc.request('thread-follower-start-turn', {}).catch(error => error);
    await Promise.resolve();
    (ipc as any).receive({ type: 'response', requestId: write.mock.calls[0][0].requestId, resultType: 'error', error });
    expect(await result).toMatchObject({ outcome: 'uncertain' });
  } finally { ipc.stop(); }
});

describe('Desktop settings protocol versions', () => {
  const method = 'thread-follower-update-thread-settings';
  function fixture(reply: (frame: any, ipc: DesktopIpc) => void) {
    const ipc = new DesktopIpc([]);
    const write = vi.fn(frame => queueMicrotask(() => reply(frame, ipc)));
    Object.assign(ipc, { socket: { destroyed: false, destroy: vi.fn() }, clientId: 'qa', write });
    return { ipc, write };
  }
  it.each([1, 2])('uses settings v2 and only negotiates down after an explicit v%s receiver rejection', async supported => {
    const { ipc, write } = fixture((frame, peer) => (peer as any).receive({ type: 'response', requestId: frame.requestId,
      ...(frame.version === supported ? { resultType: 'success', result: { applied: true } }
        : { resultType: 'error', error: 'request-version-mismatch' }) }));
    try {
      await expect(ipc.request(method, { conversationId: 'qa', threadSettings: { effort: 'high' } })).resolves.toEqual({ applied: true });
      expect(write.mock.calls.map(([frame]) => frame.version)).toEqual(supported === 2 ? [2] : [2, 1]);
      expect(new Set(write.mock.calls.map(([frame]) => frame.requestId)).size).toBe(write.mock.calls.length);
    } finally { ipc.stop(); }
  });
  it.each(['request-timeout', 'client-disconnected', 'no-handler-for-request', 'error-handling-request', 'request-version-mismatch: other'])('never retries settings after %s', async error => {
    const { ipc, write } = fixture((frame, peer) => (peer as any).receive({ type: 'response', requestId: frame.requestId, resultType: 'error', error }));
    try { await expect(ipc.request(method, {})).rejects.toBeInstanceOf(DesktopIpcError); expect(write).toHaveBeenCalledTimes(1); }
    finally { ipc.stop(); }
  });
  it.each(['activeTurnId', 'condition'])('does not downgrade version-specific %s semantics', async field => {
    const { ipc, write } = fixture((frame, peer) => (peer as any).receive({ type: 'response', requestId: frame.requestId, resultType: 'error', error: 'request-version-mismatch' }));
    try { await expect(ipc.request(method, { [field]: null })).rejects.toMatchObject({ reason: 'version-mismatch' }); expect(write).toHaveBeenCalledTimes(1); }
    finally { ipc.stop(); }
  });
  it('stops after one downgrade when neither audited version is accepted', async () => {
    const { ipc, write } = fixture((frame, peer) => (peer as any).receive({ type: 'response', requestId: frame.requestId, resultType: 'error', error: 'request-version-mismatch' }));
    try { await expect(ipc.request(method, {})).rejects.toMatchObject({ reason: 'version-mismatch' }); expect(write.mock.calls.map(([frame]) => frame.version)).toEqual([2, 1]); }
    finally { ipc.stop(); }
  });
  it.each(['replacement', 'different-method', 'other-operation'])('does not use a mismatch from %s to retry a write', async scenario => {
    const { ipc, write } = fixture((frame, peer) => {
      (peer as any).receive({ type: 'response', requestId: frame.requestId, resultType: 'error', error: 'request-version-mismatch',
        ...(scenario === 'different-method' ? { method: 'thread-follower-start-turn' } : {}) });
      if (scenario === 'replacement') Object.assign(peer, { socket: { destroyed: false, destroy: vi.fn() }, clientId: 'replacement' });
    });
    try { await expect(ipc.request(scenario === 'other-operation' ? 'thread-follower-start-turn' : method, {})).rejects.toBeInstanceOf(DesktopIpcError); expect(write).toHaveBeenCalledTimes(1); }
    finally { ipc.stop(); }
  });
  it.each([1, 2, 3])('accepts only audited incoming settings version %s', async version => {
    const { ipc, write } = fixture(() => {});
    const request = vi.fn(async () => ({ applied: true })); ipc.handler = { accepts: () => true, request };
    try {
      (ipc as any).receive({ type: 'request', requestId: 'incoming', method, version, params: { conversationId: 'qa', threadSettings: { effort: 'high' } } });
      await new Promise(resolve => setImmediate(resolve));
      expect(request).toHaveBeenCalledTimes(version === 3 ? 0 : 1);
      expect(write.mock.calls[0][0].resultType).toBe(version === 3 ? 'error' : 'success');
    } finally { ipc.stop(); }
  });
});

it('temporary catalog observations share the 64-follow bound and cannot release an opened chat', () => {
  const ipc = new DesktopIpc([]);
  vi.spyOn(ipc, 'connect').mockResolvedValue(undefined);
  try {
    for (let i = 0; i < 64; i++) expect(ipc.observe(`visible-${i}`)).toBe(true);
    expect(ipc.observe('overflow')).toBe(false);
    ipc.follow('visible-0'); expect(ipc.isObservationOnly('visible-0')).toBe(false);
    ipc.unobserve('visible-0'); expect(ipc.observe('overflow')).toBe(false);
    expect(ipc.isObservationOnly('visible-1')).toBe(true);
    ipc.snapshots.set('visible-1', { fresh: true, source: 'owner', state: {} });
    ipc.unobserve('visible-1'); expect(ipc.snapshots.has('visible-1')).toBe(false);
    expect(ipc.observe('overflow')).toBe(true);
  } finally { ipc.stop(); }
});


it('opening a chat evicts a disposable observation instead of letting the catalog exhaust chat capacity', () => {
  const ipc = new DesktopIpc([]); vi.spyOn(ipc, 'connect').mockResolvedValue(undefined);
  const released = vi.fn(); ipc.on('observation-released', released);
  try {
    for (let i = 0; i < 64; i++) ipc.observe(`visible-${i}`);
    expect(() => ipc.follow('opened')).not.toThrow(); expect(released).toHaveBeenCalledWith('visible-0');
    ipc.unobserve('opened'); expect(ipc.isObservationOnly('opened')).toBe(false);
    for (let i = 1; i < 64; i++) ipc.follow(`visible-${i}`);
    expect(() => ipc.follow('overflow')).toThrow('Too many active or unconfirmed desktop conversations');
  } finally { ipc.stop(); }
});
