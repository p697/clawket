import type { AgentAdapter, ConnectionRecord, SessionDescriptor } from '@clawket/agent-protocol';
import type { WebSocketLike, WebSocketCloseEventLike } from '../transports/types';
import { ClaudeCodeAdapter } from './claude-code';
import { CodexAdapter } from './codex';
import { PiAdapter } from './pi';

const epoch = 'a'.repeat(32), revision = '1'.repeat(32);
class Socket implements WebSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror = null;
  onclose: ((event?: WebSocketCloseEventLike) => void) | null = null;
  sent: string[] = [];
  send(data: unknown) { this.sent.push(String(data)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  latest() { return JSON.parse(this.sent.at(-1)!); }
  reply(payload: unknown) { this.onmessage?.({ data: JSON.stringify({ type: 'res', id: this.latest().id, ok: true, payload }) }); }
}

describe.each([
  ['codex', CodexAdapter], ['claude-code', ClaudeCodeAdapter], ['pi', PiAdapter],
] as const)('%s catalog wire negotiation', (backendKind, Adapter) => {
  let adapter: AgentAdapter;
  let sockets: Socket[];
  const row: SessionDescriptor = { connectionId: '', agentId: backendKind, key: 'session', kind: 'direct', title: 'QA',
    updatedAt: 1, hasActiveRun: false, allowedActions: { rename: true, reset: true, delete: true, pin: true } };
  const full = { kind: 'full', epoch, revision, total: 1, offset: 0, sessions: [row], nextOffset: null };
  beforeEach(() => {
    jest.useFakeTimers(); sockets = [];
    const record: ConnectionRecord = { id: 'scoped-connection', backendKind, transportKind: 'relay', label: 'QA',
      url: 'wss://example.com/ws', createdAt: 1, relay: { gatewayId: 'gateway', clientToken: 'fixture', serverUrl: 'https://example.com' } };
    adapter = new Adapter(record, { webSocketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
  });
  afterEach(() => { adapter.disconnect(); jest.clearAllTimers(); jest.useRealTimers(); });
  async function connect(version?: unknown, pageIndexVersion?: unknown) {
    const connected = adapter.connect(); sockets.at(-1)!.open(); sockets.at(-1)!.reply({ backend: backendKind, sessionCatalogSync: version, sessionCatalogPageIndex: pageIndexVersion }); await connected;
  }

  it('enables page indexing only for an explicitly negotiated Codex socket and drops it on downgrade', async () => {
    await connect(1, 1);
    const listing = adapter.listSessions();
    expect(sockets[0].latest().params).toEqual(backendKind === 'codex' ? { pageIndex: true } : {});
    sockets[0].reply({ ...full, pageOffsets: [] }); await listing;
    const probe = adapter.probe(); sockets[0].reply({ backend: backendKind, sessionCatalogSync: 1 }); await probe;
    const next = adapter.listSessions();
    expect(sockets[0].latest().params).toEqual({ base: { epoch, revision } });
    sockets[0].reply({ kind: 'unchanged', epoch, revision }); await next;
  });

  it('keeps old peers on the original list and enables only an exact health version', async () => {
    await connect(true);
    const legacy = adapter.listSessions(); expect(sockets[0].latest().method).toBe('sessions.list'); sockets[0].reply([row]);
    await expect(legacy).resolves.toEqual([{ ...row, connectionId: 'scoped-connection' }]);
    const health = adapter.probe(); sockets[0].reply({ backend: backendKind, sessionCatalogSync: 1 }); await health;
    const current = adapter.listSessions(); expect(sockets[0].latest()).toMatchObject({ method: 'sessions.sync', params: {} }); sockets[0].reply(full);
    await expect(current).resolves.toEqual([{ ...row, connectionId: 'scoped-connection' }]);
  });

  it('coalesces wire reads and does not merge unsolicited session events into its revision', async () => {
    await connect(1);
    const first = adapter.listSessions(), second = adapter.listSessions(); sockets[0].reply(full);
    const [a, b] = await Promise.all([first, second]); expect(a).toEqual(b);
    expect(sockets[0].sent.map(value => JSON.parse(value).method)).toEqual(['health', 'sessions.sync']);
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'event', event: `${backendKind}.update`, payload: {
      type: 'session_info_update', session: { ...row, title: 'Unsolicited local view' },
    } }) });
    const current = adapter.listSessions();
    expect(sockets[0].latest()).toMatchObject({ method: 'sessions.sync', params: { base: { epoch, revision } } });
    sockets[0].reply({ kind: 'unchanged', epoch, revision });
    await expect(current).resolves.toEqual([{ ...row, connectionId: 'scoped-connection' }]);
  });

  it('rejects old pending responses and reuses only a completed baseline after authenticated reconnect', async () => {
    await connect(1);
    const initial = adapter.listSessions(); sockets[0].reply(full); await initial;
    const old = adapter.listSessions().catch(error => error);
    const oldRequest = sockets[0].latest(), lateMessage = sockets[0].onmessage;
    adapter.disconnect(); await expect(old).resolves.toMatchObject({ code: 'network' });
    await connect(1);
    const current = adapter.listSessions();
    expect(sockets[1].latest()).toMatchObject({ method: 'sessions.sync', params: { base: { epoch, revision } } });
    lateMessage?.({ data: JSON.stringify({ type: 'res', id: oldRequest.id, ok: true, payload: { ...full, sessions: [{ ...row, title: 'Stale' }] } }) });
    sockets[1].reply({ kind: 'unchanged', epoch, revision });
    await expect(current).resolves.toEqual([{ ...row, connectionId: 'scoped-connection' }]);
  });

  it('clears a negotiated baseline when a fresh health reports an older peer', async () => {
    await connect(1);
    const initial = adapter.listSessions(); sockets[0].reply(full); await initial;
    const older = adapter.probe(); sockets[0].reply({ backend: backendKind }); await older;
    const legacy = adapter.listSessions(); expect(sockets[0].latest().method).toBe('sessions.list'); sockets[0].reply([]); await legacy;
    const upgrade = adapter.probe(); sockets[0].reply({ backend: backendKind, sessionCatalogSync: 1 }); await upgrade;
    const fresh = adapter.listSessions(); expect(sockets[0].latest().params).toEqual({}); sockets[0].reply(full); await fresh;
  });

  it('does not interpret a malformed new response as permission to use legacy lists', async () => {
    await connect(1);
    const malformed = adapter.listSessions(); sockets[0].reply({ ...full, total: 2 });
    await expect(malformed).rejects.toMatchObject({ code: 'server' });
    expect(sockets[0].sent.map(value => JSON.parse(value).method)).toEqual(['health', 'sessions.sync']);
    expect(adapter.state).toBe('ready');
  });

  it.each(['create', 'rename', 'reset', 'delete'] as const)('starts a fresh catalog read after acknowledged %s', async operation => {
    await connect(1);
    const initial = adapter.listSessions(); sockets[0].reply(full); await initial;
    const old = adapter.listSessions().catch(error => error), oldRequest = sockets[0].latest();
    const write = operation === 'create' ? adapter.createSession!(backendKind, { title: 'New' })
      : operation === 'rename' ? adapter.patchSession!('session', { title: 'New' })
      : operation === 'reset' ? adapter.resetSession!('session') : adapter.deleteSession!('session');
    expect(sockets[0].latest().method).toBe(`sessions.${operation}`);
    sockets[0].reply(operation === 'create' ? row : { ok: true }); await write;
    const fresh = adapter.listSessions(), freshRequest = sockets[0].latest();
    expect(freshRequest.id).not.toBe(oldRequest.id);
    expect(freshRequest).toMatchObject({ method: 'sessions.sync', params: { base: { epoch, revision } } });
    const changed = operation === 'delete' ? [] : [{ ...row, title: operation === 'rename' ? 'New' : row.title,
      ...(operation === 'reset' ? { sessionId: 'new-native-id' } : {}) }, ...(operation === 'create' ? [{ ...row, key: 'created', title: 'New' }] : [])];
    sockets[0].reply({ ...full, revision: '2'.repeat(32), total: changed.length, sessions: changed });
    await expect(fresh).resolves.toEqual(changed.map(value => ({ ...value, connectionId: 'scoped-connection' })));
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: oldRequest.id, ok: true, payload: { kind: 'unchanged', epoch, revision } }) });
    await expect(old).resolves.toMatchObject({ code: 'network' });
    expect(adapter.state).toBe('ready');
  });

  it('does not retry a failed management write or invalidate unrelated reads', async () => {
    await connect(1);
    const initial = adapter.listSessions(); sockets[0].reply(full); await initial;
    const pending = adapter.listSessions(), readRequest = sockets[0].latest();
    const write = adapter.patchSession!('session', { title: 'New' }).catch(error => error);
    const writeRequest = sockets[0].latest();
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: writeRequest.id, ok: false, error: { code: 'server', message: 'fixture' } }) });
    await expect(write).resolves.toMatchObject({ code: 'server' });
    const joined = adapter.listSessions(); expect(sockets[0].latest().id).toBe(writeRequest.id);
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: readRequest.id, ok: true, payload: { kind: 'unchanged', epoch, revision } }) });
    await expect(pending).resolves.toHaveLength(1); await expect(joined).resolves.toHaveLength(1);
    expect(sockets[0].sent.map(value => JSON.parse(value).method)).toEqual(['health', 'sessions.sync', 'sessions.sync', 'sessions.rename']);
  });

  if (backendKind === 'codex') it.each([true, false])('invalidates older reads after native archive=%s succeeds', async archived => {
    const connected = adapter.connect(); sockets[0].open(); sockets[0].reply({ backend: backendKind, sessionCatalogSync: 1, sessionArchive: true }); await connected;
    const initial = adapter.listSessions(); sockets[0].reply(full); await initial;
    const old = adapter.listSessions().catch(error => error), oldRequest = sockets[0].latest();
    const write = adapter.archiveSession!('session', archived); sockets[0].reply({ ok: true }); await write;
    const fresh = adapter.listSessions(); expect(sockets[0].latest().id).not.toBe(oldRequest.id);
    sockets[0].reply({ ...full, revision: '2'.repeat(32), ...(archived ? { total: 0, sessions: [] } : {}) });
    await expect(fresh).resolves.toHaveLength(archived ? 0 : 1);
    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'res', id: oldRequest.id, ok: true, payload: full }) });
    await expect(old).resolves.toMatchObject({ code: 'network' });
  });
});
