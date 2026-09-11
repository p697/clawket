import { describe, expect, it } from 'vitest';
import { policyForBackend } from '../backend-policy';
import { ensureHeartbeat, pruneStaleHandshakeClients } from './heartbeat';
import { RelayRuntime, selectActiveClient } from './runtime';
import { rehydrateSockets } from './storage';
import { clearClientChallengeMarker, handleGatewayMessage, prepareClientMessage } from './routing';
import type { Env, SocketAttachment } from './types';

class Socket {
  readyState: number = WebSocket.OPEN;
  sent: string[] = [];
  constructor(private attachment: SocketAttachment) {}
  deserializeAttachment() { return this.attachment; }
  serializeAttachment(value: SocketAttachment) { this.attachment = value; }
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = WebSocket.CLOSED; }
}

function runtime(backend: string, sockets: Socket[]) {
  return new RelayRuntime({
    getWebSockets: () => sockets,
    id: { toString: () => 'test-room' },
  } as unknown as DurableObjectState, {} as Env, policyForBackend(backend));
}
const attachment = (clientId: string, extra: Partial<SocketAttachment> = {}): SocketAttachment => ({
  role: 'client', clientId, connectedAt: 1, ...extra,
});

describe.each(['openclaw', 'hermes'])('%s hibernation routing', (backend) => {
  it('keeps capable clients alive through a delayed first tick and still expires missing pongs', () => {
    const client = new Socket(attachment('phone', { capabilities: ['relay.client-pong.v1'], lastPongAt: 1 }));
    const restored = runtime(backend, [client]);
    restored.env.HEARTBEAT_INTERVAL_MS = '30000';
    restored.env.CLIENT_PONG_TIMEOUT_MS = '30000';
    restored.clients.set('phone', client as unknown as WebSocket);
    expect(restored.clientPongTimeoutMs()).toBe(90_000);
    pruneStaleHandshakeClients(restored, 30_010);
    expect(restored.clients.has('phone')).toBe(true);
    pruneStaleHandshakeClients(restored, 90_002);
    expect(restored.clients.has('phone')).toBe(false);
  });

  it('resumes requests and responses on a single legacy socket after memory is discarded', async () => {
    const client = new Socket(attachment('phone'));
    const gateway = new Socket(attachment('bridge', { role: 'gateway' }));
    const restored = runtime(backend, [client, gateway]);
    rehydrateSockets(restored);
    expect(restored.activeClientId).toBe('phone');
    const request = JSON.stringify({ type: 'req', id: 'request-1', method: 'sessions.list', params: {} });
    expect(prepareClientMessage(restored, client.deserializeAttachment(), request)).toBe(false);
    const response = JSON.stringify({ type: 'res', id: 'request-1', ok: true, payload: {} });
    await handleGatewayMessage(restored, gateway.deserializeAttachment(), response, async () => {});
    expect(client.sent).toEqual([response]);
  });

  it('restores the selected client, independent of socket iteration order', () => {
    const first = new Socket(attachment('first'));
    const second = new Socket(attachment('second'));
    const before = runtime(backend, [first, second]);
    rehydrateSockets(before);
    selectActiveClient(before, 'second');
    selectActiveClient(before, 'first');
    const restored = runtime(backend, [second, first]);
    rehydrateSockets(restored);
    expect(restored.activeClientId).toBe('first');
    expect(first.deserializeAttachment().activeClient).toBe(true);
    expect(second.deserializeAttachment().activeClient).toBe(false);
  });

  it('does not revive a removed route or choose an ambiguous legacy client', () => {
    const first = new Socket(attachment('first'));
    const second = new Socket(attachment('second'));
    const restored = runtime(backend, [first, second]);
    restored.activeClientId = 'removed';
    rehydrateSockets(restored);
    expect(restored.activeClientId).toBeNull();
  });
});

it('never promotes a restricted pairing socket into a normal route', () => {
  const pairing = new Socket(attachment('pairing', { authScope: 'pairing', activeClient: true }));
  const restored = runtime('openclaw', [pairing]);
  rehydrateSockets(restored);
  expect(restored.activeClientId).toBeNull();
  expect(restored.clients.size).toBe(0);
});

it('clearing a delivered challenge preserves the route selected after the frame was read', () => {
  const client = new Socket(attachment('phone', { challengeDeliveredAt: 10 }));
  const relay = runtime('openclaw', [client]);
  rehydrateSockets(relay);
  const stale = { ...client.deserializeAttachment(), activeClient: false };
  selectActiveClient(relay, 'phone');
  clearClientChallengeMarker(client as unknown as WebSocket, stale);
  expect(client.deserializeAttachment().activeClient).toBe(true);
  expect(client.deserializeAttachment().challengeDeliveredAt).toBeUndefined();
});

it('does not postpone a scheduled heartbeat when socket traffic wakes the room', async () => {
  const client = new Socket(attachment('phone'));
  const scheduledAt = Date.now() + 100;
  let alarmAt: number | null = scheduledAt;
  const relay = new RelayRuntime({
    getWebSockets: () => [client], id: { toString: () => 'room' },
    storage: { getAlarm: async () => alarmAt, setAlarm: async (next: number) => { alarmAt = next; } },
  } as unknown as DurableObjectState, {} as Env, policyForBackend('openclaw'));
  rehydrateSockets(relay);
  await ensureHeartbeat(relay);
  await ensureHeartbeat(relay);
  expect(alarmAt).toBe(scheduledAt);
});
