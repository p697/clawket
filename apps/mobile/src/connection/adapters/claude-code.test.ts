import { ClaudeCodeAdapter } from './claude-code';
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
      payload: { backend: 'claude-code', model: 'test', vision: false, models: [] }, error: { message: 'Model offline' } }) });
  }
}
const record: ConnectionRecord = { id: 'phone', backendKind: 'claude-code', transportKind: 'relay',
  label: 'Model', url: 'wss://example.com/ws', createdAt: 1,
  relay: { gatewayId: 'gateway', clientToken: 'token', serverUrl: 'https://example.com' } };
let adapter: ClaudeCodeAdapter;
let sockets: Socket[];
beforeEach(() => {
  jest.useFakeTimers(); jest.spyOn(Math, 'random').mockReturnValue(0);
  sockets = [];
  adapter = new ClaudeCodeAdapter(record, { webSocketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
});
afterEach(() => { adapter.disconnect(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
it('uses health for Relay authentication without starting an OpenClaw challenge', async () => {
  const connected = adapter.connect(); sockets[0].open();
  expect(JSON.parse(sockets[0].sent[0]).method).toBe('health');
  sockets[0].reply(); await connected;
});
it('keeps token-authenticated connect for direct sockets', async () => {
  adapter.disconnect();
  adapter = new ClaudeCodeAdapter({ ...record, transportKind: 'local', relay: undefined,
    url: 'ws://127.0.0.1:17880/v1/claude-code/ws', auth: { token: 'private-token' } },
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
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true, payload: [{ key: 's', connectionId: '', agentId: 'claude-code' }] }) });
  expect((await sessions)[0].connectionId).toBe('phone');
  const selection = adapter.management.models!.setSelection!({ model: 'two', provider: 'fixture', scope: 'session', sessionKey: 's' });
  request = JSON.parse(sockets[0].sent.at(-1)!);
  expect(request).toMatchObject({ method: 'models.select', params: { scope: 'session', sessionKey: 's', provider: 'fixture' } });
  sockets[0].reply(); await selection;
  const listener = jest.fn(); adapter.on('update', listener);
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'event', event: 'claude-code.update', payload: { type: 'question_requested', sessionKey: 's', question: { id: 'q', kind: 'confirm', title: 'Proceed?' } } }) });
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'question_requested', sessionKey: 's' }));
  expect(adapter.connection).not.toHaveProperty('auth'); expect(adapter.capabilities.execApproval).toBe(true);
});

it('publishes the selected project before navigating into a newly created conversation', async () => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const updates = jest.fn(); adapter.on('update', updates);
  const created = adapter.createSession('claude-code', { projectId: 'project-id' });
  const request = JSON.parse(sockets[0].sent.at(-1)!);
  expect(request.params).toEqual({ projectId: 'project-id' });
  const session = { key: 'new', project: { id: 'project-id', name: 'Product', path: '/product', available: true } };
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true, payload: session }) });
  await expect(created).resolves.toEqual({ ...session, connectionId: 'phone' });
  expect(updates).toHaveBeenCalledWith({ type: 'session_info_update', session: { ...session, connectionId: 'phone' } });
});

it('preserves native model priority for catalog, selection and settings replies', async () => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const models = adapter.management.models!;
  for (const call of [
    () => models.list!(),
    () => models.getSelection!('s'),
    () => models.setSelection!({ model: 'new', scope: 'session', sessionKey: 's' }),
  ]) {
    const result = call();
    const request = JSON.parse(sockets[0].sent.at(-1)!);
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true,
      payload: { currentModel: 'new', models: [{ id: 'new', name: 'Z new', provider: 'openai' }, { id: 'old', name: 'A old', provider: 'openai' }] } }) });
    const state = await result;
    const catalog = Array.isArray(state) ? state : state.models;
    expect(catalog.map(m => [m.id, m.sortOrder])).toEqual([['new', 0], ['old', 1]]);
  }
});

it('does not advertise unsupported steer, thinking controls, or skill management', () => {
  expect(adapter.capabilities).toMatchObject({ steer: false, thinkingLevels: false, skills: false, sessionBranch: true });
  expect(adapter.management.models?.setThinkingLevel).toBeUndefined();
});

it('restores pending native approvals with the session envelope required by the shared chat controller', async () => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const result = adapter.management.approvals!.listExec!('restored-session');
  const request = JSON.parse(sockets[0].sent.at(-1)!);
  const approval = { kind: 'exec', id: 'pending-write', command: 'native write', category: 'file', decisions: ['allow-once', 'deny'], expiresAtMs: null };
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true, payload: [approval] }) });
  expect(request.params.sessionKey).toBe('restored-session');
  expect(await result).toEqual([{ sessionKey: 'restored-session', approval }]);
});
