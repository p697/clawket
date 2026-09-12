import { EventEmitter } from 'node:events';
import { afterEach, expect, test, vi } from 'vitest';
import type { LocalModelService } from './server.js';
const state = vi.hoisted(() => ({ sockets: [] as any[] }));
vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  class Socket extends EventEmitter {
    static OPEN = 1; readyState = 1; bufferedAmount = 0;
    send = vi.fn(); ping = vi.fn(); terminate = vi.fn(() => this.emit('close', 1006));
    constructor() { super(); state.sockets.push(this); }
  }
  return { default: Socket };
});
import { LocalModelRelay } from './relay.js';
afterEach(() => { vi.useRealTimers(); state.sockets.length = 0; });
test('failed handshakes back off; stale callbacks cannot reset or reconnect; stop clears all timers', async () => {
  vi.useFakeTimers();
  const conversation = new EventEmitter();
  const logs: string[] = [];
  const relay = new LocalModelRelay({ conversation } as LocalModelService,
    { relayUrl: 'wss://example.test/ws', gatewayId: 'test', relaySecret: 'SECRET' }, () => {}, m => logs.push(m));
  relay.start(); relay.start(); expect(state.sockets).toHaveLength(1);
  const first = state.sockets[0]; first.emit('open'); first.emit('close', 1006);
  await vi.advanceTimersByTimeAsync(1999); expect(state.sockets).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); const second = state.sockets[1]; second.emit('open');
  first.emit('message', '__clawket_relay_control__:{"event":"relay.ready"}');
  first.emit('error', new Error('SECRET')); first.emit('close', 1006);
  second.emit('close', 1006);
  await vi.advanceTimersByTimeAsync(3999); expect(state.sockets).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1); const third = state.sockets[2]; third.emit('open');
  third.emit('message', '__clawket_relay_control__:{"event":"relay.ready"}');
  await relay.waitUntilReady(); third.emit('close', 1006);
  await vi.advanceTimersByTimeAsync(2000); expect(state.sockets).toHaveLength(4);
  relay.stop(); await vi.advanceTimersByTimeAsync(300_000);
  expect(state.sockets).toHaveLength(4); expect(vi.getTimerCount()).toBe(0);
  expect(conversation.listenerCount('update')).toBe(0);
  expect(logs.join('\n')).not.toContain('SECRET');
});
test('open plus pong without application readiness times out even on a reconnect', async () => {
  vi.useFakeTimers();
  const relay = new LocalModelRelay({ conversation: new EventEmitter() } as LocalModelService,
    { relayUrl: 'wss://example.test/ws', gatewayId: 'test', relaySecret: 'test' }, () => {});
  relay.start(); const first = state.sockets[0]; first.emit('open');
  first.emit('message', '__clawket_relay_control__:{"event":"relay.ready"}');
  first.emit('close', 1006); await vi.advanceTimersByTimeAsync(2000);
  const second = state.sockets[1]; second.emit('open'); second.emit('pong');
  await vi.advanceTimersByTimeAsync(15000); expect(second.terminate).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(4000); expect(state.sockets).toHaveLength(3);
  relay.stop(); expect(vi.getTimerCount()).toBe(0);
});
test('a half-open authenticated socket without pong is recycled once, then stopped cleanly', async () => {
  vi.useFakeTimers();
  const relay = new LocalModelRelay({ conversation: new EventEmitter() } as LocalModelService,
    { relayUrl: 'wss://example.test/ws', gatewayId: 'test', relaySecret: 'test' }, () => {});
  relay.start(); const socket = state.sockets[0]; socket.emit('open');
  socket.emit('message', '__clawket_relay_control__:{"event":"relay.ready"}');
  await vi.advanceTimersByTimeAsync(30000); expect(socket.terminate).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2000); expect(state.sockets).toHaveLength(2);
  relay.stop(); expect(vi.getTimerCount()).toBe(0);
});
