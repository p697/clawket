import { describe, expect, it, vi } from 'vitest';
import { policyForBackend } from '../backend-policy';
import { admitHermesOwner, acknowledgeOwnerContention } from './owner-contention';
import { RelayRuntime } from './runtime';
import { rehydrateSockets } from './storage';
import { handleGatewayMessage } from './routing';
import { CONTROL_PREFIX, type Env, type SocketAttachment } from './types';

function fixture(backend = 'hermes', attachment: Partial<SocketAttachment> = {}) {
  let saved: SocketAttachment = { role: 'gateway', clientId: 'same-owner', connectedAt: 1,
    ...attachment };
  const socket = { readyState: WebSocket.OPEN, deserializeAttachment: () => structuredClone(saved),
    serializeAttachment: vi.fn((value: SocketAttachment) => { saved = structuredClone(value); }),
    send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
  const state = { getWebSockets: () => [socket], id: { toString: () => 'test' },
    storage: { getAlarm: vi.fn(), setAlarm: vi.fn(), deleteAlarm: vi.fn() } } as unknown as DurableObjectState;
  const runtime = new RelayRuntime(state, {} as Env, policyForBackend(backend));
  rehydrateSockets(runtime);
  return { runtime, socket, state };
}

describe('legacy Hermes owner contention', () => {
  it('preserves first replacement and modern takeover, and leaves other backends unchanged', () => {
    for (const backend of ['hermes', 'openclaw', 'codex', 'claude-code', 'pi', 'local-model']) {
      const { runtime } = fixture(backend);
      expect(admitHermesOwner(runtime, 'same-owner', [], 100).allowed).toBe(true);
    }
    const { runtime } = fixture('hermes', { ownerContention: { lastAttemptAt: 100 } });
    expect(admitHermesOwner(runtime, 'same-owner', ['relay.owner-pong.v1'], 101).allowed).toBe(true);
    expect(admitHermesOwner(runtime, 'different-owner', [], 101).allowed).toBe(true);
    for (const capability of ['relay.owner-pong.v1', 'relay.transfer-hint.v1']) {
      const current = fixture('hermes', { capabilities: [capability], ownerContention: { lastAttemptAt: 100 } });
      expect(admitHermesOwner(current.runtime, 'same-owner', [], 101).allowed).toBe(true);
      expect(current.socket.send).not.toHaveBeenCalled();
    }
  });

  it('rejects repeated replacement while the current owner answers, retaining all routes and alarm state', async () => {
    const { runtime, socket, state } = fixture('hermes', { ownerContention: { lastAttemptAt: 100 },
      heartbeatEchoBudget: { updatedAt: 1, creditMs: 1000 } });
    const phone = {} as WebSocket; runtime.clients.set('phone', phone);
    expect(admitHermesOwner(runtime, 'same-owner', [], 200).allowed).toBe(false);
    expect(socket.send).toHaveBeenCalledOnce();
    expect(socket.send).toHaveBeenCalledWith(CONTROL_PREFIX + JSON.stringify({ type: 'control', event: 'gateway_ping', ts: 200 }));
    vi.spyOn(Date, 'now').mockReturnValue(201);
    try {
      await handleGatewayMessage(runtime, socket, socket.deserializeAttachment() as SocketAttachment,
        CONTROL_PREFIX + JSON.stringify({ type: 'control', event: 'gateway_pong', ts: 200 }), async () => {});
    } finally { vi.restoreAllMocks(); }
    expect(admitHermesOwner(runtime, 'same-owner', [], 250).allowed).toBe(false);
    expect(runtime.clients.get('phone')).toBe(phone);
    expect(socket.close).not.toHaveBeenCalled();
    expect(state.storage.setAlarm).not.toHaveBeenCalled();
    expect((socket.deserializeAttachment() as SocketAttachment).heartbeatEchoBudget).toEqual({ updatedAt: 1, creditMs: 1000 });
  });

  it('does not renew a silent owner deadline on retries or memory discard', () => {
    const { runtime, socket, state } = fixture('hermes', { ownerContention: { lastAttemptAt: 100 } });
    expect(admitHermesOwner(runtime, 'same-owner', [], 200).allowed).toBe(false);
    const fresh = new RelayRuntime(state, {} as Env, policyForBackend('hermes')); rehydrateSockets(fresh);
    expect(admitHermesOwner(fresh, 'same-owner', [], 12000).allowed).toBe(false);
    expect(socket.send).toHaveBeenCalledOnce();
    expect(admitHermesOwner(fresh, 'same-owner', [], 12200).allowed).toBe(true);
  });

  it('rehydrates responsive-owner evidence, rejects stale/foreign pong, and refreshes only a completed probe', () => {
    const { runtime, socket, state } = fixture('hermes', { ownerContention: { lastAttemptAt: 100 } });
    admitHermesOwner(runtime, 'same-owner', [], 200);
    expect(acknowledgeOwnerContention(runtime, {} as WebSocket, 'gateway_pong', 200, 201)).toBe(false);
    expect(acknowledgeOwnerContention(runtime, socket, 'gateway_pong', 199, 201)).toBe(false);
    expect(acknowledgeOwnerContention(runtime, socket, 'gateway_pong', 200, 201)).toBe(true);
    const fresh = new RelayRuntime(state, {} as Env, policyForBackend('hermes')); rehydrateSockets(fresh);
    expect(admitHermesOwner(fresh, 'same-owner', [], 12200).allowed).toBe(false);
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(acknowledgeOwnerContention(fresh, socket, 'gateway_pong', 200, 12201)).toBe(false);
    expect(acknowledgeOwnerContention(fresh, socket, 'gateway_pong', 12200, 12201)).toBe(true);
  });

  it('allows disconnected owners and quiet-window recovery, bounds clock rollback and persistence failure', () => {
    const { runtime, socket } = fixture('hermes', { ownerContention: { lastAttemptAt: 100, probeAt: 200 } });
    expect(admitHermesOwner(runtime, 'same-owner', [], 150).allowed).toBe(false);
    expect((socket.deserializeAttachment() as SocketAttachment).ownerContention?.probeAt).toBe(150);
    vi.mocked(socket.serializeAttachment).mockImplementation(() => { throw new Error('test persistence'); });
    expect(admitHermesOwner(runtime, 'same-owner', [], 160).allowed).toBe(false);
    expect(admitHermesOwner(runtime, 'same-owner', [], 60160).allowed).toBe(true);
    Object.assign(socket, { readyState: WebSocket.CLOSED });
    expect(admitHermesOwner(runtime, 'same-owner', [], 161).allowed).toBe(true);
  });

  it('ignores a buffered pong if an awaited lease write replaced its owner', async () => {
    const { runtime, socket } = fixture('hermes', { ownerContention: { lastAttemptAt: 100, probeAt: 200 } });
    await handleGatewayMessage(runtime, socket, socket.deserializeAttachment() as SocketAttachment,
      CONTROL_PREFIX + JSON.stringify({ type: 'control', event: 'gateway_pong', ts: 200 }),
      async () => { runtime.gatewaySocket = {} as WebSocket; });
    expect(socket.serializeAttachment).not.toHaveBeenCalled();
  });
});
