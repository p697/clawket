import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HermesRelayRuntime } from './relay';
import { WEBSOCKET_FRAME_LIMIT_BYTES } from '../frame-limit';

class Socket extends EventEmitter {
  readyState = 0;
  sent: Array<string | Buffer> = [];
  failSend = false;
  send(data: string | Buffer) { if (this.failSend) throw new Error('test send'); this.sent.push(data); }
  close(code = 1000) { this.readyState = 3; this.emit('close', code, Buffer.from('')); }
  open() { this.readyState = 1; this.emit('open'); }
  message(data: string | Buffer) { this.emit('message', data, Buffer.isBuffer(data)); }
  ping(data: string) { this.emit('pong', Buffer.from(data)); }
}
function fixture(onLog?: (line: string) => void) {
  const sockets: Socket[] = [];
  const runtime = new HermesRelayRuntime({
    config: { serverUrl: 'https://registry.invalid', relayUrl: 'wss://relay.invalid/ws',
      bridgeId: 'hbg_test', relaySecret: 'test-only', instanceId: 'owner', displayName: 'Hermes', createdAt: '', updatedAt: '' },
    bridgeUrl: 'ws://bridge.invalid/ws', reconnectBaseDelayMs: 10, reconnectMaxDelayMs: 10,
    bridgeStatusPollIntervalMs: 1000000, bridgeHealthProbeIntervalMs: 1000000, onLog,
    createWebSocket: () => { const socket = new Socket(); sockets.push(socket); return socket as never; },
  });
  runtime.start(); sockets[0].open();
  return { runtime, sockets, cloud: sockets[0], local: sockets[1] };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Hermes cloud-generation queue safety', () => {
  it('preserves initial text/binary ordering while local transport connects', async () => {
    const f = fixture();
    try {
      f.cloud.message('first'); f.cloud.message(Buffer.from([1, 2])); f.cloud.message('last');
      f.local.open(); expect(f.local.sent).toEqual(['first', Buffer.from([1, 2]), 'last']);
    } finally { await f.runtime.stop(); }
  });

  it('drops queued requests and late frames when their cloud socket retires', async () => {
    const f = fixture();
    try {
      f.cloud.message('retired-write'); f.cloud.message(Buffer.from('retired-binary'));
      f.cloud.close(1006); await vi.advanceTimersByTimeAsync(11);
      f.sockets[2].open(); f.cloud.message('late-old-frame');
      f.sockets[2].message('new-request'); f.sockets[3].open();
      expect(f.sockets[3].sent).toEqual(['new-request']);
      f.local.open(); expect(f.local.sent).toEqual([]);
    } finally { await f.runtime.stop(); }
  });

  it.each(['count', 'bytes'] as const)('fails the whole cloud generation on %s capacity and resets its budget', async kind => {
    const f = fixture();
    try {
      if (kind === 'count') for (let index = 0; index < 257; index++) f.cloud.message('a');
      else {
        f.cloud.message('汉'.repeat(Math.floor(WEBSOCKET_FRAME_LIMIT_BYTES / 3)));
        f.cloud.message(Buffer.alloc(3));
      }
      expect(f.cloud.readyState).toBe(3);
      expect(f.runtime.getSnapshot().lastError).toBe('bridge_queue_capacity');
      await vi.advanceTimersByTimeAsync(11); f.sockets[2].open();
      f.sockets[2].message(Buffer.alloc(WEBSOCKET_FRAME_LIMIT_BYTES)); f.local.open();
      expect(f.local.sent).toHaveLength(1);
      expect(Buffer.byteLength(f.local.sent[0])).toBe(WEBSOCKET_FRAME_LIMIT_BYTES);
    } finally { await f.runtime.stop(); }
  });

  it('admits exactly 8 MiB and clears the budget across stop/start', async () => {
    const f = fixture();
    try {
      f.cloud.message(Buffer.alloc(WEBSOCKET_FRAME_LIMIT_BYTES));
      expect(f.cloud.readyState).toBe(1);
      await f.runtime.stop(); f.runtime.start(); f.sockets[2].open();
      f.sockets[2].message(Buffer.alloc(WEBSOCKET_FRAME_LIMIT_BYTES)); f.sockets[3].open();
      expect(f.sockets[3].sent).toHaveLength(1);
    } finally { await f.runtime.stop(); }
  });

  it('never hands a failed queued batch to the next cloud socket', async () => {
    const f = fixture();
    try {
      f.cloud.message('first'); f.cloud.message('second'); f.local.failSend = true; f.local.open();
      expect(f.cloud.readyState).toBe(3); expect(f.runtime.getSnapshot().lastError).toBe('bridge_queue_send_failed');
      f.local.failSend = false; await vi.advanceTimersByTimeAsync(11); f.sockets[2].open();
      f.sockets[2].message('fresh'); expect(f.local.sent).toEqual(['fresh']);
    } finally { await f.runtime.stop(); }
  });

  it('checks generation again after a synchronous diagnostic callback retires the batch', async () => {
    let retire: (() => void) | undefined;
    const f = fixture(line => { if (line.includes('bridge_flush')) retire?.(); });
    retire = () => { void f.runtime.stop(); };
    f.cloud.message(JSON.stringify({ type: 'req', id: 'one', method: 'health' }));
    f.cloud.message('second'); f.local.open();
    expect(f.local.sent).toEqual([]); expect(f.runtime.getSnapshot().running).toBe(false);
    await f.runtime.stop();
  });

  it.each(['bridge_queue', 'bridge_flush'])('preserves successor work created inside a %s diagnostic callback', async direction => {
    let replace: (() => void) | undefined;
    const f = fixture(line => { if (line.includes(direction)) replace?.(); });
    replace = () => {
      replace = undefined;
      void f.runtime.stop(); f.runtime.start(); f.sockets[2].open();
      f.sockets[2].message(Buffer.alloc(WEBSOCKET_FRAME_LIMIT_BYTES));
    };
    try {
      f.cloud.message(JSON.stringify({ type: 'req', id: 'retired', method: 'health' }));
      if (direction === 'bridge_flush') f.local.open();
      expect(f.sockets[2].readyState).toBe(1);
      f.sockets[3].open();
      expect(f.sockets[3].sent).toHaveLength(1);
      expect(Buffer.byteLength(f.sockets[3].sent[0])).toBe(WEBSOCKET_FRAME_LIMIT_BYTES);
      expect(f.local.sent).toEqual([]);
    } finally { await f.runtime.stop(); }
  });
});
