import { CodexAdapter } from './codex';
import { LocalSendRejectedError, type ConnectionRecord } from '@clawket/agent-protocol';
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
      payload: { backend: 'codex', model: 'test', vision: false, models: [] }, error: { message: 'Model offline' } }) });
  }
}
const record: ConnectionRecord = { id: 'phone', backendKind: 'codex', transportKind: 'relay',
  label: 'Model', url: 'wss://example.com/ws', createdAt: 1,
  relay: { gatewayId: 'gateway', clientToken: 'token', serverUrl: 'https://example.com' } };
let adapter: CodexAdapter;
let sockets: Socket[];
beforeEach(() => {
  jest.useFakeTimers(); jest.spyOn(Math, 'random').mockReturnValue(0);
  sockets = [];
  adapter = new CodexAdapter(record, { webSocketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
});
afterEach(() => { adapter.disconnect(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });
it('uses health for Relay authentication without starting an OpenClaw challenge', async () => {
  const connected = adapter.connect(); sockets[0].open();
  expect(JSON.parse(sockets[0].sent[0]).method).toBe('health');
  sockets[0].reply(); await connected;
});
it('keeps token-authenticated connect for direct sockets', async () => {
  adapter.disconnect();
  adapter = new CodexAdapter({ ...record, transportKind: 'local', relay: undefined,
    url: 'ws://127.0.0.1:17880/v1/codex/ws', auth: { token: 'private-token' } },
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
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true, payload: [{ key: 's', connectionId: '', agentId: 'codex' }] }) });
  expect((await sessions)[0].connectionId).toBe('phone');
  const selection = adapter.management.models!.setSelection!({ model: 'two', provider: 'fixture', scope: 'session', sessionKey: 's' });
  request = JSON.parse(sockets[0].sent.at(-1)!);
  expect(request).toMatchObject({ method: 'models.select', params: { scope: 'session', sessionKey: 's', provider: 'fixture' } });
  sockets[0].reply(); await selection;
  const listener = jest.fn(); adapter.on('update', listener);
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'event', event: 'codex.update', payload: { type: 'question_requested', sessionKey: 's', question: { id: 'q', kind: 'confirm', title: 'Proceed?' } } }) });
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'question_requested', sessionKey: 's' }));
  expect(adapter.connection).not.toHaveProperty('auth'); expect(adapter.capabilities.execApproval).toBe(true);
});

it('makes a legacy failed turn visible even when the Bridge supplies no failure message', async () => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const listener = jest.fn(); adapter.on('update', listener);
  const update = { type: 'run_finished', sessionKey: 's', runId: 'legacy-run', stopReason: 'error' };
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'event', event: 'codex.update', payload: update }) });
  expect(listener).toHaveBeenCalledWith({ ...update, terminalMessage: {
    id: 'codex-run-error:legacy-run', role: 'system',
    text: "The agent couldn't complete this reply. Please try again.",
  } });
  expect(adapter.state).toBe('ready');
  expect(sockets[0].sent.map(frame => JSON.parse(frame).method)).toEqual(['health']);
});

it.each([
  { stopReason: 'end_turn' },
  { stopReason: 'cancelled' },
  { stopReason: 'error', message: { role: 'assistant', content: 'An existing failure explanation' } },
  { stopReason: 'error', message: { role: 'assistant', content: '', attachments: [{ type: 'image', artifactId: 'image' }] } },
  { stopReason: 'error', terminalMessage: { id: 'codex-turn-error:native', role: 'system', text: 'Model authentication failed. Sign in again on your computer.' } },
])('preserves the authoritative completion and existing failure content: %j', async completion => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const listener = jest.fn(); adapter.on('update', listener);
  const update = { type: 'run_finished', sessionKey: 's', runId: 'run', ...completion };
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'event', event: 'codex.update', payload: update }) });
  expect(listener).toHaveBeenCalledWith(update);
});

it('publishes the selected project before navigating into a newly created conversation', async () => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const updates = jest.fn(); adapter.on('update', updates);
  const created = adapter.createSession('codex', { projectId: 'project-id' });
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
    () => models.setThinkingLevel!('s', 'medium'),
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


it('forwards the selected conversation when listing project skills', async () => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const result = adapter.management.skills!.status!('codex', { sessionKey: 'native:qa-project' });
  expect(JSON.parse(sockets[0].sent.at(-1)!)).toMatchObject({ method: 'skills.list', params: { sessionKey: 'native:qa-project' } });
  sockets[0].reply(); await result;
});

it('uses the latest local connection name even when an Agent reply was already in flight', async () => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const pending = adapter.listAgents();
  adapter.connection.label = 'Work laptop';
  const request = JSON.parse(sockets[0].sent.at(-1)!);
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true,
    payload: [{ agentId: 'main', name: 'Fixed backend name', isMain: true, mainSessionKey: '' }] }) });
  expect(await pending).toEqual([expect.objectContaining({ connectionId: record.id, name: 'Work laptop' })]);
  expect(adapter.state).toBe('ready');
});

it('negotiates permission/archive controls and keeps native IDs in reversible archives', async () => {
  const connected = adapter.connect(); sockets[0].open();
  let request = JSON.parse(sockets[0].sent.at(-1)!);
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true,
    payload: { backend: 'codex', sessionPermissions: true, sessionArchive: true, fastMode: true } }) });
  await connected;
  expect(adapter.capabilities.sessionPermissions).toBe(true);
  const archived = adapter.listArchivedSessions();
  request = JSON.parse(sockets[0].sent.at(-1)!);
  expect(request.method).toBe('sessions.archived');
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true,
    payload: [{ key: 'opaque', sessionId: 'native-id', archived: true, allowedActions: { archive: true } }] }) });
  expect((await archived)[0]).toMatchObject({ sessionId: 'native-id', archived: true, connectionId: 'phone' });
  const restored = adapter.archiveSession('opaque', false);
  request = JSON.parse(sockets[0].sent.at(-1)!);
  expect(request).toMatchObject({ method: 'sessions.archive', params: { sessionKey: 'opaque', archived: false } });
  sockets[0].reply(); await restored;
});

it.each([
  ['ws://192.168.1.2:17880/v1/codex/ws', true],
  ['ws://127.0.0.1:17880/v1/codex/ws', false],
  ['wss://example.com/v1/codex/ws', false],
])('computes permission transport warning locally for %s', async (url, expected) => {
  adapter.disconnect();
  adapter = new CodexAdapter({ ...record, url: url as string, transportKind: 'custom', relay: undefined },
    { webSocketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const state = adapter.management.models!.getSelection!('session');
  const request = JSON.parse(sockets[0].sent.at(-1)!);
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true, payload: {
    models: [], currentModel: 'native', currentProvider: 'provider', currentBaseUrl: '',
    permissions: { mode: 'workspace', available: true, scope: 'session', unencryptedTransport: !expected },
  } }) });
  expect((await state).permissions?.unencryptedTransport).toBe(expected);
});

 it('negotiates profile version and rejects corrupt management replies before rendering', async () => {
  expect(adapter.capabilities.profileManagement).toBe(false);
  await expect(adapter.management.profile!.usage()).rejects.toThrow();
  const connected = adapter.connect(); sockets[0].open();
  let request = JSON.parse(sockets[0].sent.at(-1)!);
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true, payload: { backend: 'codex', profileVersion: 1, models: [] } }) });
  await connected; expect(adapter.capabilities.profileManagement).toBe(true);
  const read = adapter.management.profile!.usage(); request = JSON.parse(sockets[0].sent.at(-1)!);
  expect(request.method).toBe('profile.usage');
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true, payload: { plan: null, quotas: [], lifetimeTokens: null, daily: [] } }) });
  await expect(read).resolves.toMatchObject({ lifetimeTokens: null });
  const corrupted = adapter.management.profile!.usage(); request = JSON.parse(sockets[0].sent.at(-1)!);
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true, payload: { plan: null, quotas: 'broken', lifetimeTokens: null, daily: [] } }) });
  await expect(corrupted).rejects.toThrow();
});

it('reports authenticated Bridge-version evidence and replaces it after reconnecting', async () => {
  const first = adapter.connect(); sockets[0].open();
  const reply = (socket: Socket, bridgeVersion?: string) => { const request = JSON.parse(socket.sent.at(-1)!); socket.onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true, payload: { backend: 'codex', model: 'test', vision: false, bridgeVersion } }) }); };
  reply(sockets[0], '3.1.10'); await first; expect(adapter.getConnectionRuntimeMetadata().bridgeVersion).toBe('3.1.10');
  adapter.disconnect(); const next = adapter.connect(); sockets.at(-1)!.open(); expect(adapter.getConnectionRuntimeMetadata().bridgeVersion).toBeUndefined();
  reply(sockets.at(-1)!, '3.1.11'); await next; expect(adapter.getConnectionRuntimeMetadata().bridgeVersion).toBe('3.1.11');
});


it('proves an oversized image batch is rejected locally before socket dispatch', async () => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const before = sockets[0].sent.length;
  const input = { text: 'QA image batch', idempotencyKey: 'capacity-only', attachments: [
    { type: 'image' as const, mimeType: 'image/gif', content: 'A'.repeat(4 * 1024 * 1024) },
    { type: 'image' as const, mimeType: 'image/gif', content: 'A'.repeat(4 * 1024 * 1024) },
  ] };
  const failure = await adapter.prompt('qa', input).catch(error => error);
  expect(sockets[0].sent).toHaveLength(before);
  expect(failure).toMatchObject({ code: 'frame_too_large', dispatchOutcome: 'not_sent' });
  expect(adapter.state).toBe('ready');
});


it.each([-1, 0, 1])('uses the exact full request UTF-8 size at the 8 MiB boundary (%s)', async extra => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const input = { text: '', idempotencyKey: 'wire-boundary' };
  const overhead = new TextEncoder().encode(JSON.stringify({ type: 'req', id: '0'.repeat(32), method: 'chat.send', params: { sessionKey: 'qa', ...input } })).byteLength;
  input.text = 'a'.repeat(8 * 1024 * 1024 - overhead + extra);
  const before = sockets[0].sent.length;
  if (extra > 0) {
    expect(() => adapter.validatePrompt('qa', input)).toThrow(LocalSendRejectedError);
    await expect(adapter.prompt('qa', input)).rejects.toBeInstanceOf(LocalSendRejectedError);
    expect(sockets[0].sent).toHaveLength(before);
  } else {
    expect(() => adapter.validatePrompt('qa', input)).not.toThrow();
    const pending = adapter.prompt('qa', input);
    const request = JSON.parse(sockets[0].sent.at(-1)!);
    expect(new TextEncoder().encode(sockets[0].sent.at(-1)!).byteLength).toBe(8 * 1024 * 1024 + extra);
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true, payload: { runId: 'boundary-run' } }) });
    expect(await pending).toEqual({ runId: 'boundary-run' });
  }
});

it('keeps a 5 MiB single image within the same envelope and counts multibyte text', async () => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const input = { text: 'QA one image', idempotencyKey: 'one-image', attachments: [{ type: 'image' as const, mimeType: 'image/gif',
    content: 'A'.repeat(4 * Math.ceil(5 * 1024 * 1024 / 3) - 1) + '=' }] };
  expect(() => adapter.validatePrompt('qa', input)).not.toThrow();
  const pending = adapter.prompt('qa', input);
  const request = JSON.parse(sockets[0].sent.at(-1)!);
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true, payload: { runId: 'single-image' } }) });
  expect(await pending).toEqual({ runId: 'single-image' });
  const before = sockets[0].sent.length;
  await expect(adapter.prompt('qa', { text: '图'.repeat(3 * 1024 * 1024), idempotencyKey: 'utf8' })).rejects.toBeInstanceOf(LocalSendRejectedError);
  expect(sockets[0].sent).toHaveLength(before);
});

it('does not infer local rejection from a socket exception or a remote frame code', async () => {
  const connected = adapter.connect(); sockets[0].open(); sockets[0].reply(); await connected;
  const send = jest.spyOn(sockets[0], 'send').mockImplementationOnce(() => { throw Object.assign(new Error('frame_too_large'), { code: 'frame_too_large', name: 'WebSocketFrameTooLargeError' }); });
  const thrown = await adapter.prompt('qa', { text: 'small', idempotencyKey: 'socket-unknown' }).catch(error => error);
  expect(thrown).not.toBeInstanceOf(LocalSendRejectedError);
  send.mockRestore();
  const pending = adapter.prompt('qa', { text: 'small', idempotencyKey: 'remote-unknown' }).catch(error => error);
  const request = JSON.parse(sockets[0].sent.at(-1)!);
  sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: false, error: { code: 'frame_too_large', message: 'frame_too_large' } }) });
  expect(await pending).not.toBeInstanceOf(LocalSendRejectedError);
});
