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
import { DesktopIpc, DesktopIpcError } from './desktop-ipc.js';

it('negotiates a real framed socket and distinguishes no-owner from a lost acknowledgement', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clawket-ipc-')), path = join(directory, 'ipc.sock');
  const peers = new Set<Socket>();
  const send = (socket: Socket, value: object) => { const body = Buffer.from(JSON.stringify(value)), header = Buffer.alloc(4); header.writeUInt32LE(body.length); socket.write(header); socket.write(body); };
  const server = createServer(socket => {
    peers.add(socket); socket.on('close', () => peers.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE()) {
        const size = buffer.readUInt32LE(), frame = JSON.parse(buffer.subarray(4, 4 + size).toString()); buffer = buffer.subarray(4 + size);
        if (frame.method === 'initialize') send(socket, { type: 'response', requestId: frame.requestId, resultType: 'success', result: { clientId: 'bridge' } });
        if (frame.method === 'absent') send(socket, { type: 'response', requestId: frame.requestId, resultType: 'error', error: 'no-client-found: owner unavailable' });
        if (frame.method === 'lost') socket.destroy();
        if (frame.method === 'thread-follower-load-complete-history') {
          send(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner', params: { hostId: 'remote-host', conversationId: 'thread', change: { type: 'snapshot', revision: 1, conversationState: { turns: [], requests: [{ id: 'wrong-host' }] } } } });
          send(socket, { type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: 'owner', params: { hostId: 'local', conversationId: 'thread', change: { type: 'snapshot', revision: 2, conversationState: { turns: [], requests: [] } } } });
          send(socket, { type: 'response', requestId: frame.requestId, resultType: 'success', result: { revision: 2 } });
        }
      }
    });
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  const ipc = new DesktopIpc([path]);
  try {
    await ipc.connect(); expect(ipc.ready).toBe(true);
    const snapshots: any[] = []; ipc.on('snapshot', (_id, value) => snapshots.push(value));
    const snapshot = new Promise<void>(resolve => ipc.once('snapshot', () => resolve())); ipc.follow('thread'); await snapshot;
    expect(snapshots).toHaveLength(1); expect(snapshots[0].revision).toBe(2);
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
