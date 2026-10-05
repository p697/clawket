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

describe('native local owner discovery', () => {
  it.each([undefined, 'local'])('includes the native host scope for owner discovery (%s)', async hostId => {
    const ipc = new DesktopIpc([]);
    const write = vi.fn(frame => queueMicrotask(() => (ipc as any).receive({ type: 'response', requestId: frame.requestId,
      method: frame.method, ...(frame.params.hostId === 'local'
        ? { resultType: 'success', result: { supportsUntrustedAppInput: true } }
        : { resultType: 'error', error: 'no-client-found' }) })));
    Object.assign(ipc, { socket: { destroyed: false, destroy: vi.fn() }, clientId: 'qa', write });
    const params = { conversationId: 'native-thread', ...(hostId === undefined ? {} : { hostId }) };
    try {
      await expect(ipc.request('thread-owner-discovery', params)).resolves.toEqual({ supportsUntrustedAppInput: true });
      expect(write.mock.calls[0][0].params).toEqual({ hostId: 'local', conversationId: 'native-thread' });
      expect(params).toEqual({ conversationId: 'native-thread', ...(hostId === undefined ? {} : { hostId }) });
    } finally { ipc.stop(); }
  });
  it.each(['remote', '', null])('rejects an explicitly foreign or malformed discovery scope (%s) before dispatch', async hostId => {
    const ipc = new DesktopIpc([]), write = vi.fn();
    Object.assign(ipc, { socket: { destroyed: false, destroy: vi.fn() }, clientId: 'qa', write });
    try {
      await expect(ipc.request('thread-owner-discovery', { hostId, conversationId: 'native-thread' })).rejects.toMatchObject({ outcome: 'rejected' });
      expect(write).not.toHaveBeenCalled();
    } finally { ipc.stop(); }
  });
  it('uses the same native host scope for background idle-proof probes', async () => {
    const ipc = new DesktopIpc([]);
    const write = vi.fn(frame => {
      if (frame.type === 'request') queueMicrotask(() => (ipc as any).receive({ type: 'response', requestId: frame.requestId,
        method: frame.method, resultType: 'error', error: 'no-client-found' }));
    });
    Object.assign(ipc, { socket: { destroyed: false, destroy: vi.fn() }, clientId: 'qa', write });
    try {
      ipc.follow('native-thread');
      await vi.waitFor(() => expect(write.mock.calls.filter(([frame]) => frame.type === 'request')).toHaveLength(1));
      expect(write.mock.calls.find(([frame]) => frame.type === 'request')![0].params)
        .toEqual({ hostId: 'local', conversationId: 'native-thread' });
    } finally { ipc.stop(); }
  });
});

it.each(['owner-recovers', 'owner-still-disconnected', 'turn-unknown'])('recovers only one read-only discovery after a real IPC disconnect (%s)', async scenario => {
  const directory = mkdtempSync(join(tmpdir(), 'clawket-ipc-recovery-'));
  const path = process.platform === 'win32' ? String.raw`\\.\pipe\clawket-ipc-recovery-${randomUUID()}` : join(directory, 'ipc.sock');
  const peers = new Set<Socket>(), requests: any[] = [];
  let connections = 0;
  const send = (socket: Socket, value: object) => {
    const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4); header.writeUInt32LE(body.length); socket.write(Buffer.concat([header, body]));
  };
  const server = createServer(socket => {
    const generation = ++connections; peers.add(socket); socket.on('close', () => peers.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE()) {
        const size = buffer.readUInt32LE(), frame = JSON.parse(buffer.subarray(4, 4 + size).toString()); buffer = buffer.subarray(4 + size);
        if (frame.method === 'initialize') { send(socket, { type: 'response', requestId: frame.requestId, resultType: 'success', result: { clientId: `bridge-${generation}` } }); continue; }
        requests.push(frame);
        if (generation === 1 || scenario !== 'owner-recovers') socket.destroy();
        else send(socket, { type: 'response', requestId: frame.requestId, method: frame.method, resultType: 'success', result: { supportsUntrustedAppInput: true } });
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  const ipc = new DesktopIpc([path]);
  try {
    const method = scenario === 'turn-unknown' ? 'thread-follower-start-turn' : 'thread-owner-discovery';
    if (scenario === 'owner-recovers') await expect(ipc.request(method, { conversationId: 'native-thread' })).resolves.toEqual({ supportsUntrustedAppInput: true });
    else await expect(ipc.request(method, { conversationId: 'native-thread' })).rejects.toMatchObject({ outcome: 'uncertain', reason: 'connection-lost' });
    expect(requests).toHaveLength(scenario === 'turn-unknown' ? 1 : 2);
    expect(connections).toBe(scenario === 'turn-unknown' ? 1 : 2);
    expect(requests.every(frame => frame.method === method)).toBe(true);
    if (scenario !== 'turn-unknown') expect(requests.every(frame => frame.params.hostId === 'local')).toBe(true);
  } finally { ipc.stop(); for (const peer of peers) peer.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true }); }
});

it('emits only fixed IPC failure metadata even for private native errors and throwing diagnostic listeners', async () => {
  const ipc = new DesktopIpc([]), events: any[] = [];
  const write = vi.fn(frame => queueMicrotask(() => (ipc as any).receive({ type: 'response', requestId: frame.requestId, resultType: 'error',
    error: 'private prompt token /private/project/path', payload: { secret: 'private-token' } })));
  Object.assign(ipc, { socket: { destroyed: false, destroy: vi.fn() }, clientId: 'private-client-id', write });
  ipc.on('diagnostic', event => events.push(event)); ipc.on('diagnostic', () => { throw new Error('logging failure'); });
  try {
    await expect(ipc.request('thread-follower-start-turn', { conversationId: 'private-thread-id' })).rejects.toMatchObject({ outcome: 'uncertain' });
    expect(events).toEqual([{ reason: 'handler_error', operation: 'turn_start', pendingCount: 0 }]);
    expect(write).toHaveBeenCalledTimes(1);
  } finally { ipc.stop(); }
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


describe('Desktop per-client follow lifecycle', () => {
  function fixture() {
    const ipc = new DesktopIpc([]), write = vi.fn();
    Object.assign(ipc, { socket: { destroyed: false, destroy: vi.fn() }, clientId: 'bridge', write });
    const receive = (method: string, sourceClientId: unknown, params: object, version = 1) =>
      (ipc as any).receive({ type: 'broadcast', method, version, sourceClientId, params });
    return { ipc, write, receive };
  }
  it('retains the broker source of a valid local follow and rejects malformed membership controls', () => {
    const { ipc, receive } = fixture(), follow = vi.fn(); ipc.on('follow', follow);
    try {
      receive('thread-stream-following-changed', 'desktop-a', { hostId: 'local', conversationId: 'thread', following: true });
      receive('thread-stream-following-changed', 'desktop-a', { hostId: 'local', conversationId: 'thread', following: false });
      for (const [source, params, version] of [
        ['', { hostId: 'local', conversationId: 'thread', following: false }, 1],
        ['bridge', { hostId: 'local', conversationId: 'thread', following: false }, 1],
        ['desktop-b', { hostId: 'foreign', conversationId: 'thread', following: true }, 1],
        ['desktop-b', { hostId: 'local', conversationId: 'thread', following: 'false' }, 1],
        ['desktop-b', { hostId: 'local', conversationId: '', following: true }, 1],
        ['x'.repeat(257), { hostId: 'local', conversationId: 'thread', following: true }, 1],
        ['desktop-b', { hostId: 'local', conversationId: 'thread', following: true }, 2],
      ] as const) receive('thread-stream-following-changed', source, params, version);
      expect(follow.mock.calls).toEqual([['thread', true, 'desktop-a'], ['thread', false, 'desktop-a']]);
    } finally { ipc.stop(); }
  });
  it('retires only snapshots owned by the broker-confirmed disconnected client', () => {
    const { ipc, receive, write } = fixture(), offline = vi.fn(); ipc.on('client-offline', offline);
    try {
      ipc.follow('thread-a'); ipc.follow('thread-b'); write.mockClear();
      for (const [id, source] of [['thread-a', 'owner-a'], ['thread-b', 'owner-b']])
        receive('thread-stream-state-changed', source, { hostId: 'local', conversationId: id,
          change: { type: 'snapshot', revision: 1, conversationState: { turns: [], requests: [] } } }, 11);
      receive('client-status-changed', 'owner-a', { clientId: 'owner-b', clientType: 'codex', status: 'disconnected' }, 0);
      receive('client-status-changed', 'owner-a', { clientId: 'owner-a', status: 'disconnected' }, 1);
      expect(ipc.snapshots.get('thread-a')?.fresh).toBe(true);
      receive('client-status-changed', 'owner-a', { clientId: 'owner-a', clientType: 'codex', status: 'disconnected' }, 0);
      expect(ipc.snapshots.get('thread-a')?.fresh).toBe(false);
      expect(ipc.snapshots.get('thread-b')?.fresh).toBe(true);
      expect(offline.mock.calls).toEqual([['owner-a']]);
      expect(ipc.ready).toBe(true); expect(write).not.toHaveBeenCalled();
    } finally { ipc.stop(); }
  });
  it('renews only existing subscriptions for client arrival and local following-status requests', () => {
    const { ipc, receive, write } = fixture();
    try {
      ipc.follow('opened'); ipc.observe('visible'); write.mockClear();
      receive('client-status-changed', 'desktop-a', { clientId: 'desktop-a', clientType: 'codex', status: 'connected' }, 0);
      expect(write.mock.calls.map(([frame]) => [frame.method, frame.params.conversationId, frame.targetClientIds])).toEqual([
        ['thread-stream-following-changed', 'opened', ['desktop-a']], ['thread-stream-following-changed', 'visible', ['desktop-a']],
      ]);
      write.mockClear();
      receive('thread-stream-following-status-requested', 'owner-b', { hostId: 'local', conversationId: 'opened' });
      expect(write.mock.calls.map(([frame]) => [frame.method, frame.params, frame.targetClientIds])).toEqual([
        ['thread-stream-following-changed', { hostId: 'local', conversationId: 'opened', following: true }, ['owner-b']],
      ]);
      write.mockClear();
      receive('thread-stream-following-status-requested', 'owner-b', { hostId: 'foreign', conversationId: 'opened' });
      receive('thread-stream-following-status-requested', 'owner-b', { hostId: 'local', conversationId: 'never-opened' });
      receive('thread-stream-following-status-requested', 'bridge', { hostId: 'local', conversationId: 'opened' });
      receive('thread-stream-following-status-requested', 'owner-b', { hostId: 'local', conversationId: 'opened' }, 2);
      receive('client-status-changed', 'owner-b', { clientId: 'owner-b', status: 'unknown' }, 0);
      expect(write).not.toHaveBeenCalled(); expect(ipc.snapshots.size).toBe(0);
    } finally { ipc.stop(); }
  });
  it('passes the broker source to an explicit complete-history handler without reading it from params', async () => {
    const { ipc, write } = fixture(), request = vi.fn(async () => ({ revision: 1 }));
    ipc.handler = { accepts: () => true, request };
    try {
      const params = { conversationId: 'thread', clientId: 'untrusted-payload-client' };
      (ipc as any).receive({ type: 'request', requestId: 'history', method: 'thread-follower-load-complete-history', version: 1,
        sourceClientId: 'desktop-a', params });
      await new Promise(resolve => setImmediate(resolve));
      expect(request).toHaveBeenCalledWith('thread-follower-load-complete-history', params, 'desktop-a');
      expect(write.mock.calls[0][0]).toMatchObject({ resultType: 'success', result: { revision: 1 } });
    } finally { ipc.stop(); }
  });
});


it('reads per-client lifecycle controls and targeted renewal on an actual framed broker connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clawket-ipc-membership-'));
  const path = process.platform === 'win32' ? String.raw`\\.\pipe\clawket-membership-${randomUUID()}` : join(directory, 'ipc.sock');
  const peers = new Set<Socket>(), received: any[] = [];
  let remote!: Socket, renewed!: () => void, discovered!: () => void;
  const discovery = new Promise<void>(resolve => { discovered = resolve; });
  const renewal = new Promise<void>(resolve => { renewed = resolve; });
  const send = (socket: Socket, value: object) => {
    const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4); header.writeUInt32LE(body.length);
    socket.write(Buffer.concat([header, body]));
  };
  const server = createServer(socket => {
    remote = socket; peers.add(socket); socket.on('close', () => peers.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE()) {
        const size = buffer.readUInt32LE(), frame = JSON.parse(buffer.subarray(4, 4 + size).toString()); buffer = buffer.subarray(4 + size);
        received.push(frame);
        if (frame.method === 'initialize') send(socket, { type: 'response', requestId: frame.requestId, resultType: 'success', result: { clientId: 'bridge' } });
        if (frame.type === 'request' && frame.method === 'thread-owner-discovery') {
          send(socket, { type: 'response', requestId: frame.requestId, resultType: 'success', result: { supportsUntrustedAppInput: false } });
          discovered();
        }
        if (frame.targetClientIds?.[0] === 'owner-b') renewed();
      }
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  const ipc = new DesktopIpc([path]), follow = vi.fn(); ipc.on('follow', follow);
  try {
    await ipc.connect(); ipc.follow('opened'); await discovery;
    const snapshot = new Promise<void>(resolve => ipc.once('snapshot', () => resolve()));
    send(remote, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner-a',
      params: { hostId: 'local', conversationId: 'opened', change: { type: 'snapshot', revision: 1, conversationState: { turns: [], requests: [] } } } });
    await snapshot;
    const departed = new Promise<void>(resolve => ipc.once('client-offline', () => resolve()));
    for (const [source, following] of [['desktop-a', true], ['desktop-b', true], ['desktop-a', false]])
      send(remote, { type: 'broadcast', method: 'thread-stream-following-changed', version: 1, sourceClientId: source,
        params: { hostId: 'local', conversationId: 'opened', following } });
    send(remote, { type: 'broadcast', method: 'client-status-changed', version: 0, sourceClientId: 'owner-a',
      params: { clientId: 'owner-a', clientType: 'codex', status: 'disconnected' } });
    send(remote, { type: 'broadcast', method: 'thread-stream-following-status-requested', version: 1, sourceClientId: 'owner-b',
      params: { hostId: 'local', conversationId: 'opened' } });
    await Promise.all([departed, renewal]);
    expect(follow.mock.calls).toEqual([['opened', true, 'desktop-a'], ['opened', true, 'desktop-b'], ['opened', false, 'desktop-a']]);
    expect(ipc.snapshots.get('opened')?.fresh).toBe(false); expect(ipc.ready).toBe(true);
    expect(received.filter(frame => frame.targetClientIds)).toEqual([expect.objectContaining({ method: 'thread-stream-following-changed',
      version: 1, targetClientIds: ['owner-b'], params: { hostId: 'local', conversationId: 'opened', following: true } })]);
    // Opening the chat performs one bounded owner probe; lifecycle controls
    // must neither repeat that probe nor load history or dispatch another turn.
    expect(received.filter(frame => frame.type === 'request' && frame.method !== 'initialize')).toEqual([
      expect.objectContaining({ method: 'thread-owner-discovery', params: { hostId: 'local', conversationId: 'opened' } }),
    ]);
  } finally {
    ipc.stop(); for (const peer of peers) peer.destroy();
    await new Promise<void>(resolve => server.close(() => resolve())); rmSync(directory, { recursive: true, force: true });
  }
});
