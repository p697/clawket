import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { ClaudeServer } from './server.js';
import { ClaudeFault } from './errors.js';
import type { ClaudeService } from './service.js';

const servers: ClaudeServer[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  sockets.splice(0).forEach(socket => socket.terminate());
  for (const server of servers.splice(0)) await server.stop();
});
async function fixture() {
  const service = Object.assign(new EventEmitter(), {
    health: async () => ({}), stop: vi.fn(async () => {}),
    request: vi.fn(async () => ({ backend: 'claude-code' })),
  });
  const server = new ClaudeServer(service as unknown as ClaudeService, 'test-token-'.repeat(4)); servers.push(server);
  const port = await server.start(0);
  const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/claude-code/ws`); sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  const rpc = (method: string, params = {}) => new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('test RPC timeout')), 2000);
    socket.once('message', data => { clearTimeout(timer); resolve(JSON.parse(data.toString())); });
    socket.send(JSON.stringify({ type: 'req', id: 'request', method, params }));
  });
  return { service, socket, rpc, authenticate: () => rpc('connect', { token: 'test-token-'.repeat(4) }) };
}
it('rejects unauthenticated requests before invoking a native operation', async () => {
  const { service, socket } = await fixture();
  const closed = new Promise<number>(resolve => socket.once('close', resolve));
  socket.send(JSON.stringify({ type: 'req', id: '1', method: 'chat.send', params: { text: 'unauthorized' } }));
  expect(await closed).toBe(1008); expect(service.request).not.toHaveBeenCalled();
});
it('redacts unexpected native errors but preserves deliberate user-facing faults', async () => {
  const { service, authenticate, rpc } = await fixture();
  expect(await authenticate()).toMatchObject({ ok: true });
  service.request.mockRejectedValueOnce(new Error('secret-from-native-stderr'));
  const unknown = await rpc('chat.send');
  expect(unknown.ok).toBe(false); expect(JSON.stringify(unknown)).not.toContain('secret-from-native-stderr');
  service.request.mockRejectedValueOnce(new ClaudeFault('Close the original session first'));
  expect(await rpc('chat.send')).toMatchObject({ error: { message: 'Close the original session first' } });
});
it('keeps native consent and the owned process alive when a phone disconnects', async () => {
  const { service, authenticate, socket } = await fixture(); await authenticate();
  const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
  socket.close(); await closed;
  expect(service.stop).not.toHaveBeenCalled();
});
