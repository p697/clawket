import { PiAdapter } from './pi';
import type { ConnectionRecord } from '@clawket/agent-protocol';
import type { WebSocketLike } from '../transports/types';

class Socket implements WebSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror = null;
  onclose = null;
  sent: string[] = [];
  send(data: unknown) { this.sent.push(String(data)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  reply(ok = true) {
    const request = JSON.parse(this.sent.at(-1)!);
    this.onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok,
      payload: { backend: 'pi', model: 'test', vision: false }, error: { message: 'Model offline' } }) });
  }
}
const record: ConnectionRecord = { id: 'phone', backendKind: 'pi', transportKind: 'relay',
  label: 'Model', url: 'wss://example.com/ws', createdAt: 1,
  relay: { gatewayId: 'gateway', clientToken: 'token', serverUrl: 'https://example.com' } };
let adapter: PiAdapter;
let sockets: Socket[];
beforeEach(() => {
  jest.useFakeTimers(); jest.spyOn(Math, 'random').mockReturnValue(0);
  sockets = [];
  adapter = new PiAdapter(record, { webSocketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
});
afterEach(() => { adapter.disconnect(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
it('uses health for Relay authentication without starting an OpenClaw challenge', async () => {
  const connected = adapter.connect(); sockets[0].open();
  expect(JSON.parse(sockets[0].sent[0]).method).toBe('health');
  sockets[0].reply(); await connected;
});
it('keeps token-authenticated connect for direct sockets', async () => {
  adapter.disconnect();
  adapter = new PiAdapter({ ...record, transportKind: 'local', relay: undefined,
    url: 'ws://127.0.0.1:17880/v1/pi/ws', auth: { token: 'private-token' } },
  { webSocketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
  const connected = adapter.connect(); sockets[0].open();
  expect(JSON.parse(sockets[0].sent[0])).toMatchObject({ method: 'connect', params: { token: 'private-token' } });
  sockets[0].reply(); await connected;
});
it('backs off failed handshakes, recovers, and cancels retries on disconnect', async () => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(false);
  await Promise.resolve(); await Promise.resolve();
  expect(sockets).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(599); expect(sockets).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1); expect(sockets).toHaveLength(2);
  sockets[1].open(); sockets[1].reply(false); await Promise.resolve(); await Promise.resolve();
  await jest.advanceTimersByTimeAsync(1019); expect(sockets).toHaveLength(2);
  await jest.advanceTimersByTimeAsync(1); expect(sockets).toHaveLength(3);
  sockets[2].open(); sockets[2].reply(); await connected;
  expect(adapter.state).toBe('ready');
  adapter.disconnect(); await jest.advanceTimersByTimeAsync(120000); expect(sockets).toHaveLength(3);
});
it('tolerates a delayed 30-second tick but recovers from a dead connection', async () => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  await jest.advanceTimersByTimeAsync(60000); expect(adapter.state).toBe('ready');
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'tick', ts: Date.now(), ack: 'relay.client-pong.v1' }) });
  expect(JSON.parse(sockets[0].sent.at(-1)!).type).toBe('pong');
  await jest.advanceTimersByTimeAsync(89999); expect(adapter.state).toBe('ready');
  await jest.advanceTimersByTimeAsync(1); expect(adapter.state).toBe('reconnecting');
});

it('paces missing-Bridge retries and repeated connect calls cannot bypass the wait', async () => {
  const result = adapter.connect().catch(error => error);
  sockets[0].open();
  const request = JSON.parse(sockets[0].sent.at(-1)!);
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: false,
    error: { code: 'BRIDGE_UNAVAILABLE', message: 'legacy backend name' } }) });
  await jest.advanceTimersByTimeAsync(25000);
  expect((await result).code).toBe('bridge_offline');
  const retry = adapter.connect();
  await jest.advanceTimersByTimeAsync(4999); expect(sockets).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(1); expect(sockets).toHaveLength(2);
  sockets[1].open(); sockets[1].reply(); await retry;
  expect(adapter.state).toBe('ready');
});

it('shares connection waiters and cancels them when the connection is switched', async () => {
  const attempt = adapter.connect();
  expect(adapter.connect()).toBe(attempt);
  const result = attempt.catch(error => error);
  adapter.disconnect();
  expect((await result).code).toBe('bridge_offline');
  await jest.advanceTimersByTimeAsync(120000);
  expect(sockets).toHaveLength(1);
});

it('maps session ownership, questions and model writes without credential-bearing descriptors', async () => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const sessions = adapter.listSessions();
  let request = JSON.parse(sockets[0].sent.at(-1)!);
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true, payload: [{ key: 's', connectionId: '', agentId: 'pi' }] }) });
  expect((await sessions)[0].connectionId).toBe('phone');
  const selection = adapter.management.models!.setSelection!({ model: 'two', provider: 'fixture', scope: 'session', sessionKey: 's' });
  request = JSON.parse(sockets[0].sent.at(-1)!);
  expect(request).toMatchObject({ method: 'models.select', params: { scope: 'session', sessionKey: 's', provider: 'fixture' } });
  sockets[0].reply(); await selection;
  const listener = jest.fn(); adapter.on('update', listener);
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'event', event: 'pi.update', payload: { type: 'question_requested', sessionKey: 's', question: { id: 'q', kind: 'confirm', title: 'Proceed?' } } }) });
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'question_requested', sessionKey: 's' }));
  expect(adapter.connection).not.toHaveProperty('auth'); expect(adapter.capabilities.execApproval).toBe(false);
});
