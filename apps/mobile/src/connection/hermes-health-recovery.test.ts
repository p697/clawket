import { ConnectionCoordinator } from './index';
import { ConnectionStore } from './registry/connection-store';
import { RosterCache } from './registry/roster-cache';
import { UnreadWatermarks } from './registry/unread-watermarks';
import { HermesAdapter } from './adapters/hermes';
import { HERMES_GATEWAY_PROTOCOL_PROFILE } from './adapters/gateway-profiles';
import { GatewayClient } from './protocol';
import type { WebSocketLike } from './transports';

class Socket implements WebSocketLike {
  readyState = 0;
  onopen: WebSocketLike['onopen'] = null;
  onmessage: WebSocketLike['onmessage'] = null;
  onclose: WebSocketLike['onclose'] = null;
  onerror: WebSocketLike['onerror'] = null;
  requests: Array<{ id: string; method: string }> = [];
  send(value: unknown) { this.requests.push(JSON.parse(String(value))); }
  close(code?: number) { this.readyState = 3; this.onclose?.({ code }); }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  healthy() { this.receive({ type: 'event', event: 'health', payload: { status: 'ok', hermesApiReachable: true } }); }
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Expected lifecycle transition did not occur');
}

async function fixture() {
  const secure = new Map<string, string>();
  const storage = { getItemAsync: async (key: string) => secure.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { secure.set(key, value); },
    deleteItemAsync: async (key: string) => { secure.delete(key); } };
  const dashboard = { getDashboardCache: async () => null, setDashboardCache: async () => {} };
  const store = new ConnectionStore({ secureStorage: storage,
    legacyStorage: { readLegacyGatewayConfigsState: async () => ({ activeId: null, configs: [] }) } });
  await store.load();
  await store.add({ id: 'hermes-recovery', backendKind: 'hermes', transportKind: 'local',
    environment: 'production', label: 'Hermes', url: 'ws://hermes.fixture.invalid/v1/hermes/ws',
    hermes: { bridgeUrl: 'ws://hermes.fixture.invalid/v1/hermes/ws' }, createdAt: 1 });
  const sockets: Socket[] = [];
  const gateway = new GatewayClient({ profile: HERMES_GATEWAY_PROTOCOL_PROFILE,
    webSocketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; },
    handshakeTimeoutMs: 1000, directFirstFrameTimeoutMs: 1000, reconnectJitter: false });
  let adapter!: HermesAdapter;
  const coordinator = new ConnectionCoordinator({ store,
    cache: new RosterCache({ storage: dashboard }), watermarks: new UnreadWatermarks({ storage: dashboard }),
    rosterRefreshIntervalMs: 0, hermesProbeIntervalMs: 0,
    adapterFactory: record => {
      adapter = new HermesAdapter(record, { gateway, historyCache: null });
      jest.spyOn(adapter, 'listSessions').mockResolvedValue([]);
      return adapter;
    } });
  const starting = coordinator.start();
  await until(() => sockets.length === 1); sockets[0].open(); sockets[0].healthy();
  await starting; await until(() => adapter.state === 'ready');
  return { coordinator, adapter, sockets, gateway };
}

describe('Hermes health through protocol, adapter and coordinator', () => {
  it('reconnects once after a fresh degraded foreground RPC and waits for new healthy evidence', async () => {
    const f = await fixture();
    const disconnect = jest.spyOn(f.adapter, 'disconnect'); const connect = jest.spyOn(f.adapter, 'connect');
    try {
      f.coordinator.setAppActive(false); f.coordinator.setAppActive(true);
      const resumed = f.coordinator.probeActive(2000, 'foreground');
      await until(() => f.sockets[0].requests.some(request => request.method === 'health'));
      const request = f.sockets[0].requests.find(request => request.method === 'health')!;
      f.sockets[0].receive({ type: 'res', id: request.id, ok: true, payload: { status: 'degraded', hermesApiReachable: false } });
      await until(() => f.sockets.length === 2);
      expect(disconnect).toHaveBeenCalledTimes(1); expect(connect).toHaveBeenCalledTimes(1);
      expect(f.adapter.state).not.toBe('ready');
      f.sockets[1].open(); f.sockets[1].healthy();
      await expect(resumed).resolves.toBe(true);
      expect(f.adapter.state).toBe('ready');
    } finally { await f.coordinator.stop(); }
  });

  it('does not let a retired failed probe erase successor health or reconnect the retired socket', async () => {
    const f = await fixture();
    try {
      const probe = f.adapter.probe(2000);
      await until(() => f.sockets[0].requests.some(request => request.method === 'health'));
      const oldMessage = f.sockets[0].onmessage;
      f.adapter.disconnect(); const connecting = f.adapter.connect();
      await until(() => f.sockets.length === 2); f.sockets[1].open(); f.sockets[1].healthy();
      await connecting; await expect(probe).resolves.toBe(false);
      const oldRequest = f.sockets[0].requests.find(request => request.method === 'health')!;
      oldMessage?.({ data: JSON.stringify({ type: 'res', id: oldRequest.id, ok: true, payload: { status: 'degraded' } }) });
      const fresh = f.adapter.probe(2000);
      const request = f.sockets[1].requests.at(-1)!;
      f.sockets[1].receive({ type: 'res', id: request.id, ok: true, payload: { status: 'healthy' } });
      await expect(fresh).resolves.toBe(true); expect(f.adapter.state).toBe('ready');
      expect(f.sockets).toHaveLength(2);
    } finally { await f.coordinator.stop(); }
  });
});
