import { CodexAdapter } from './codex';
import { ClaudeCodeAdapter } from './claude-code';
import { PiAdapter } from './pi';
import type { ConnectionRecord } from '@clawket/agent-protocol';

it.each([
  ['codex', CodexAdapter], ['claude-code', ClaudeCodeAdapter], ['pi', PiAdapter],
] as const)('%s enables artifact RPCs only after positive negotiation, then retires them on disconnect', async (backend, Adapter) => {
  let advertised = false;
  const requests: any[] = [];
  const socket: any = { readyState: 0, onopen: null, onmessage: null, onerror: null, onclose: null,
    close() { this.readyState = 3; },
    send(raw: string) {
      const request = JSON.parse(raw); requests.push(request);
      const payload = request.method === 'health' ? { backend, vision: true, artifacts: advertised }
        : request.method === 'clawket.artifacts.open' ? { id: 'handle', name: 'image.png', mimeType: 'image/png', size: 3 }
          : { offset: 0, total: 3, data: 'YWJj', done: true };
      queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'res', id: request.id, ok: true, payload }) }));
    },
  };
  const record: ConnectionRecord = { id: 'test', backendKind: backend, transportKind: 'relay', label: backend, url: 'wss://example.com/ws', createdAt: 1,
    relay: { gatewayId: 'room', clientToken: 'token', serverUrl: 'https://example.com' } };
  const adapter = new Adapter(record, { webSocketFactory: () => socket });
  try {
    expect(adapter.artifacts).toBeUndefined();
    const ready = adapter.connect(); socket.readyState = 1; socket.onopen(); await ready;
    expect(adapter.artifacts).toBeUndefined();
    advertised = true; expect(await adapter.probe()).toBe(true);
    const operations = adapter.artifacts!;
    expect(await operations.open('session', 'artifact')).toMatchObject({ id: 'handle' });
    expect(await operations.read('session', 'handle', 0)).toMatchObject({ done: true });
    expect(requests.slice(-2).map(r => [r.method, r.params])).toEqual([
      ['clawket.artifacts.open', { sessionKey: 'session', artifactId: 'artifact' }],
      ['clawket.artifacts.read', { sessionKey: 'session', id: 'handle', offset: 0 }],
    ]);
    expect(adapter.artifacts).toBe(operations);
    adapter.disconnect(); expect(adapter.artifacts).toBeUndefined();
  } finally { adapter.disconnect(); }
});
