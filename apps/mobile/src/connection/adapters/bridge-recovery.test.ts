import type { ConnectionRecord } from '@clawket/agent-protocol';
import type { WebSocketLike } from '../transports/types';
import { ClaudeCodeAdapter } from './claude-code';
import { CodexAdapter } from './codex';
import { PiAdapter } from './pi';
import { LocalModelAdapter } from './local-model';

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
  answer(backend?: string) {
    const request = JSON.parse(this.sent.at(-1)!);
    this.onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: !!backend,
      ...(backend ? { payload: { backend, vision: false } }
        : { error: { code: 'BRIDGE_UNAVAILABLE', message: 'Bridge unavailable' } }) }) });
  }
}

describe.each([
  ['claude-code', ClaudeCodeAdapter], ['codex', CodexAdapter], ['pi', PiAdapter], ['local-model', LocalModelAdapter],
] as const)('%s unavailable Bridge recovery', (backend, Adapter) => {
  beforeEach(() => { jest.useFakeTimers(); jest.spyOn(Math, 'random').mockReturnValue(0); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

  it.each([false, true])('bounds retry traffic and only offers a short recovery window after health (previouslyReady=%s)', async previouslyReady => {
    const record: ConnectionRecord = { id: 'recovery-phone', backendKind: backend, transportKind: 'relay', label: 'QA',
      url: 'wss://example.com/ws', createdAt: 1, relay: { gatewayId: 'qa', clientToken: 'qa', serverUrl: 'https://example.com' } };
    const sockets: Socket[] = [];
    const adapter = new Adapter(record, { webSocketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
    try {
      if (previouslyReady) {
        const first = adapter.connect(); sockets.at(-1)!.open(); sockets.at(-1)!.answer(backend); await first;
        // The coordinator's failed-probe recovery disconnects and connects the
        // same adapter; switching connections creates an unproven new adapter.
        adapter.disconnect();
      }
      void adapter.connect().catch(() => {});
      const delays = previouslyReady && backend !== 'local-model'
        ? [2_000, 4_000, 8_000, 8_000, 30_000, 60_000, 120_000, 120_000]
        : [30_000, 60_000, 120_000, 120_000];
      for (const [index, delay] of delays.entries()) {
        const current = sockets.at(-1)!;
        current.open(); current.answer();
        await jest.advanceTimersByTimeAsync(0);
        const count = sockets.length;
        // Repeated connect calls and raw open events cannot refill the budget.
        void adapter.connect().catch(() => {});
        await jest.advanceTimersByTimeAsync(delay - 1);
        expect(sockets).toHaveLength(count);
        await jest.advanceTimersByTimeAsync(1);
        expect(sockets).toHaveLength(count + 1);
        if (previouslyReady && backend !== 'local-model' && index === 3) {
          // Coordinator retries cannot refill an exhausted warm allowance.
          adapter.disconnect();
          void adapter.connect().catch(() => {});
        }
      }
      sockets.at(-1)!.open(); sockets.at(-1)!.answer(backend);
      await jest.advanceTimersByTimeAsync(0);
      expect(adapter.state).toBe('ready');
      adapter.disconnect();
      void adapter.connect().catch(() => {});
      sockets.at(-1)!.open(); sockets.at(-1)!.answer();
      await jest.advanceTimersByTimeAsync(0);
      const count = sockets.length;
      await jest.advanceTimersByTimeAsync(backend === 'local-model' ? 30_000 : 2_000);
      expect(sockets).toHaveLength(count + 1);
      adapter.disconnect();
      await jest.advanceTimersByTimeAsync(120_000);
      expect(sockets).toHaveLength(count + 1);
    } finally { adapter.disconnect(); }
  });
});

describe.each([
  ['claude-code', ClaudeCodeAdapter], ['codex', CodexAdapter], ['pi', PiAdapter],
] as const)('%s saved connection that was ready in an earlier run', (backend, Adapter) => {
  beforeEach(() => { jest.useFakeTimers(); jest.spyOn(Math, 'random').mockReturnValue(0); });
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

  it('uses the short owner-recovery retries on a new adapter, once', async () => {
    const record: ConnectionRecord = { id: 'recovery-phone', backendKind: backend, transportKind: 'relay', label: 'QA',
      url: 'wss://example.com/ws', createdAt: 1, relay: { gatewayId: 'qa', clientToken: 'qa', serverUrl: 'https://example.com' } };
    const sockets: Socket[] = [];
    const adapter = new Adapter(record, { previouslyReady: true, webSocketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; } });
    try {
      void adapter.connect().catch(() => {});
      for (const [index, delay] of [2_000, 4_000, 8_000, 8_000, 30_000, 60_000].entries()) {
        const current = sockets.at(-1)!;
        current.open(); current.answer();
        await jest.advanceTimersByTimeAsync(0);
        const count = sockets.length;
        await jest.advanceTimersByTimeAsync(delay - 1);
        expect(sockets).toHaveLength(count);
        await jest.advanceTimersByTimeAsync(1);
        expect(sockets).toHaveLength(count + 1);
        if (index === 3) {
          // A coordinator retry cannot refill the exhausted short allowance.
          adapter.disconnect();
          void adapter.connect().catch(() => {});
        }
      }
      sockets.at(-1)!.open(); sockets.at(-1)!.answer(backend);
      await jest.advanceTimersByTimeAsync(0);
      expect(adapter.state).toBe('ready');
    } finally { adapter.disconnect(); }
  });
});
