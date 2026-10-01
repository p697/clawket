import type { AgentAdapter, ConnectionRecord } from '@clawket/agent-protocol';
import type { WebSocketLike } from '../transports/types';
import { ClaudeCodeAdapter } from './claude-code';
import { CodexAdapter } from './codex';
import { LocalModelAdapter } from './local-model';
import { validateSessionActivity } from './session-activity';

class Socket implements WebSocketLike {
  readyState = 0; onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null; onerror = null; onclose = null;
  sent: string[] = [];
  send(data: unknown) { this.sent.push(String(data)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  latest() { return JSON.parse(this.sent.at(-1)!); }
  reply(payload: unknown) { this.onmessage?.({ data: JSON.stringify({ type: 'res', id: this.latest().id, ok: true, payload }) }); }
}
describe.each([['codex', CodexAdapter], ['claude-code', ClaudeCodeAdapter], ['local-model', LocalModelAdapter]] as const)
('%s ephemeral activity negotiation', (backendKind, Adapter) => {
  let adapter: AgentAdapter, socket: Socket;
  beforeEach(() => {
    jest.useFakeTimers();
    const record: ConnectionRecord = { id: 'scoped', backendKind, transportKind: 'relay', label: 'Test', createdAt: 1,
      url: 'wss://example.com/ws', relay: { gatewayId: 'room', clientToken: 'fixture', serverUrl: 'https://example.com' } };
    adapter = new Adapter(record, { webSocketFactory: () => { socket = new Socket(); return socket; } });
  });
  afterEach(() => { adapter.disconnect(); jest.clearAllTimers(); jest.useRealTimers(); });
  async function connect(version?: unknown) {
    const ready = adapter.connect(); socket.open(); socket.reply({ backend: backendKind, sessionActivity: version }); await ready;
  }
  it('leaves legacy peers unchanged, and enables only the exact negotiated version', async () => {
    await connect(true); expect(adapter.readSessionActivity).toBeUndefined();
    const probe = adapter.probe(); socket.reply({ backend: backendKind, sessionActivity: 1 }); await probe;
    const activity = adapter.readSessionActivity!(['visible']); expect(socket.latest()).toMatchObject({ method: 'sessions.activity', params: { keys: ['visible'] } });
    socket.reply([{ key: 'visible', state: 'running', private: 'drop' }]);
    await expect(activity).resolves.toEqual([{ key: 'visible', state: 'running' }]);
    const captured = adapter.readSessionActivity!;
    const downgrade = adapter.probe(); socket.reply({ backend: backendKind }); await downgrade;
    const sent = socket.sent.length;
    await expect(captured(['visible'])).rejects.toThrow('Session activity is unavailable');
    expect(socket.sent).toHaveLength(sent);
    adapter.disconnect(); expect(adapter.readSessionActivity).toBeUndefined();
  });
  it('rejects malformed windows before send and malformed replies before rendering', async () => {
    await connect(1); const sent = socket.sent.length;
    await expect(adapter.readSessionActivity!(['same', 'same'])).rejects.toThrow('Invalid session activity response');
    expect(socket.sent).toHaveLength(sent);
    const response = adapter.readSessionActivity!(['visible']); socket.reply([{ key: 'other', state: 'running' }]);
    await expect(response).rejects.toThrow('Invalid session activity response');
    const listener = jest.fn(); adapter.on('update', listener);
    const push = (activity: unknown) => socket.onmessage?.({ data: JSON.stringify({ type: 'event', event: `${backendKind}.update`, payload: { type: 'session_activity_update', activity } }) });
    push({ key: 'visible', state: 'future' }); push(undefined); expect(listener).not.toHaveBeenCalled();
    push({ key: 'visible', state: 'waiting', attention: 'approval', private: 'drop' });
    expect(listener).toHaveBeenLastCalledWith({ type: 'session_activity_update', activity: { key: 'visible', state: 'waiting', attention: 'approval' } });
  });
  it('rejects an activity request across disconnect instead of keeping a stale result', async () => {
    await connect(1); const request = adapter.readSessionActivity!(['visible']); adapter.disconnect();
    await expect(request).rejects.toBeDefined();
  });
});
it('validates a complete bounded activity projection', () => {
  for (const value of [undefined, {}, [], [{ key: 'visible', state: 'running', attention: 'error' }], [{ key: 'visible', state: 'future' }]]) {
    expect(() => validateSessionActivity(value, ['visible'])).toThrow();
  }
  expect(() => validateSessionActivity([{ key: 4, state: 'running' }], [4] as any)).toThrow();
  expect(validateSessionActivity([], [])).toEqual([]);
});
