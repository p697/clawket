import { describe, it, expect, vi } from 'vitest';
import { RelayRuntime } from './runtime';
import { OPENCLAW_BACKEND_POLICY, HERMES_BACKEND_POLICY } from '../backend-policy';
import { CLIENT_CHANNELS, hasClientChannels, routeClientChannel, syncClientChannels } from './client-channels';
import { reconcileSockets } from './storage';
import { CONTROL_PREFIX, type SocketAttachment, type Env } from './types';

class Socket {
  readyState = 1;
  sent: string[] = [];
  close = vi.fn(() => { this.readyState = 3; });
  constructor(private attachment: SocketAttachment) {}
  deserializeAttachment() { return this.attachment; }
  serializeAttachment(value: SocketAttachment) { this.attachment = value; }
  send(value: string) { this.sent.push(value); }
}
function setup(hermes = false) {
  vi.stubGlobal('WebSocket', { OPEN: 1 });
  const owner = new Socket({ role: 'gateway', clientId: 'owner', connectedAt: 1, capabilities: [CLIENT_CHANNELS] });
  const clients = ['a', 'b'].map(id => new Socket({ role: 'client', clientId: id, diagnosticId: id, connectedAt: 2, authScope: 'full' }));
  const channels = ['a', 'b'].map(id => new Socket({ role: 'gateway', clientId: 'owner', targetConnectionId: id, connectedAt: 3 }));
  const sockets = [owner, ...clients, ...channels];
  const state = { getWebSockets: () => sockets, id: { toString: () => 'test' } } as unknown as DurableObjectState;
  const runtime = new RelayRuntime(state, {} as Env, hermes ? HERMES_BACKEND_POLICY : OPENCLAW_BACKEND_POLICY);
  reconcileSockets(runtime);
  return { runtime, clients, channels, owner, state };
}
function route(runtime: RelayRuntime, socket: Socket, text: string) {
  return routeClientChannel(runtime, socket as unknown as WebSocket, socket.deserializeAttachment(), text);
}

describe('independent OpenClaw client channels', () => {
  it('delivers separate challenges and equal request IDs without crossing devices after memory discard', () => {
    const { runtime, clients, channels, state } = setup();
    const restored = new RelayRuntime(state, {} as Env, OPENCLAW_BACKEND_POLICY);
    reconcileSockets(restored);
    expect(restored.clients.size).toBe(2);
    expect(hasClientChannels(restored)).toBe(true);
    for (let i = 0; i < 2; i++) {
      const challenge = JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: String(i) } });
      route(restored, channels[i], challenge);
      expect(clients[i].sent).toEqual([challenge]);
      route(restored, clients[i], '{"type":"req","id":"same","method":"connect","params":{}}');
      expect(channels[i].sent).toHaveLength(1);
      route(restored, channels[i], `{"type":"res","id":"same","ok":true,"payload":${i}}`);
      expect(clients[i].sent.at(-1)).toContain(`"payload":${i}`);
    }
    expect(runtime.gatewaySocket).toBe(restored.gatewaySocket);
  });
  it('isolates restart requests and rejects a replaced client socket', () => {
    const { runtime, clients, channels } = setup();
    route(runtime, channels[0], CONTROL_PREFIX + JSON.stringify({ event: 'client.reconnect-required' }));
    expect(clients[0].close).toHaveBeenCalledOnce();
    expect(clients[1].close).not.toHaveBeenCalled();
    const stale = new Socket({ ...clients[1].deserializeAttachment(), diagnosticId: 'old' });
    route(runtime, stale, '{"type":"req","method":"chat.send"}');
    expect(channels[1].sent).toEqual([]);
  });
  it('preserves maximum-sized application frames without envelope overhead', () => {
    const { runtime, clients, channels } = setup();
    const frame = 'x'.repeat(8 * 1024 * 1024);
    route(runtime, clients[0], frame);
    expect(channels[0].sent[0]).toBe(frame);
  });
  it('cleans disconnected client channels and sends an authoritative lifecycle snapshot', () => {
    const { runtime, channels, owner } = setup();
    runtime.clients.delete('a');
    syncClientChannels(runtime);
    expect(channels[0].close).toHaveBeenCalledOnce();
    expect(channels[1].close).not.toHaveBeenCalled();
    expect(JSON.parse(owner.sent[0].slice(CONTROL_PREFIX.length)).payload.clients).toEqual(['b']);
  });
  it('never enables the protocol for Hermes or legacy owners', () => {
    const { runtime, clients } = setup(true);
    expect(hasClientChannels(runtime)).toBe(false);
    expect(route(runtime, clients[0], '{}')).toBe(false);
    const legacy = setup();
    legacy.owner.serializeAttachment({ role: 'gateway', clientId: 'owner', connectedAt: 1 });
    expect(hasClientChannels(legacy.runtime)).toBe(false);
  });
});
