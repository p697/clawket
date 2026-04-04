import { createServer as createNetServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { MemoryKV } from './kv-store.js';
import { createRegistryServer } from './registry.js';
import { createRelayServer } from './relay-server.js';
import type { RoomManager } from './room-manager.js';

async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForHttp(url: string, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      await response.arrayBuffer();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw new Error(`Timed out waiting for HTTP server: ${String(lastError)}`);
}

async function waitForSocketClose(
  ws: WebSocket,
  timeoutMs = 5_000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        // ignore timeout cleanup error
      }
      reject(new Error('Timed out waiting for WebSocket close'));
    }, timeoutMs);

    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString('utf8') });
    });

    ws.once('error', () => {
      // The server may close immediately after reporting an error.
      // The close event is the assertion target for these tests.
    });
  });
}

describe('relay-docker runtime smoke tests', () => {
  it('serves registry health and pairing flow', async () => {
    const registryPort = await allocatePort();
    const kv = new MemoryKV();
    const registry = createRegistryServer({
      routesKv: kv,
      relayRegionMap: '',
      pairAccessCodeTtlSec: '600',
      pairClientTokenMax: '8',
      relayUrl: 'ws://relay.local/ws',
    }, registryPort);

    registry.start();
    try {
      const baseUrl = `http://127.0.0.1:${registryPort}`;
      await waitForHttp(`${baseUrl}/v1/health`);

      const healthRes = await fetch(`${baseUrl}/v1/health`);
      expect(healthRes.status).toBe(200);
      await expect(healthRes.json()).resolves.toEqual(expect.objectContaining({ ok: true }));

      const registerRes = await fetch(`${baseUrl}/v1/pair/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Relay Host', preferredRegion: 'us' }),
      });
      expect(registerRes.status).toBe(200);
      const registerBody = await registerRes.json() as {
        gatewayId: string;
        relaySecret: string;
        accessCode: string;
      };

      const claimRes = await fetch(`${baseUrl}/v1/pair/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gatewayId: registerBody.gatewayId,
          accessCode: registerBody.accessCode,
          clientLabel: 'iPhone',
        }),
      });
      expect(claimRes.status).toBe(200);
      const claimBody = await claimRes.json() as { clientToken: string };
      expect(claimBody.clientToken.startsWith('gct_')).toBe(true);

      const verifyBadTokenRes = await fetch(`${baseUrl}/v1/verify/${encodeURIComponent(registerBody.gatewayId)}`, {
        headers: { authorization: 'Bearer invalid-token' },
      });
      expect(verifyBadTokenRes.status).toBe(401);
    } finally {
      await registry.close();
      kv.close();
    }
  });

  it('serves relay health endpoint', async () => {
    const relayPort = await allocatePort();
    const relay = createRelayServer({
      getRoom: () => ({
        handleWebSocket: async () => ({ accepted: true }),
      }),
    } as unknown as RoomManager, relayPort);

    relay.start();
    try {
      const baseUrl = `http://127.0.0.1:${relayPort}`;
      await waitForHttp(`${baseUrl}/v1/health`);

      const healthRes = await fetch(`${baseUrl}/v1/health`);
      expect(healthRes.status).toBe(200);
      await expect(healthRes.json()).resolves.toEqual({ ok: true, runtime: 'docker' });
    } finally {
      await relay.close();
    }
  });

  it('uses non-conflicting close codes for rejected websocket auth', async () => {
    const relayPort = await allocatePort();
    const relay = createRelayServer({
      getRoom: () => ({
        handleWebSocket: async () => ({
          accepted: false,
          status: 401,
          error: 'invalid token',
        }),
      }),
    } as unknown as RoomManager, relayPort);

    relay.start();
    try {
      await waitForHttp(`http://127.0.0.1:${relayPort}/v1/health`);
      const ws = new WebSocket(`ws://127.0.0.1:${relayPort}/ws?gatewayId=gw_test&role=client`);
      const closed = await waitForSocketClose(ws);
      expect(closed.code).toBe(4401);
    } finally {
      await relay.close();
    }
  });

  it('closes websocket with 1011 when upgrade callback throws', async () => {
    const relayPort = await allocatePort();
    const relay = createRelayServer({
      getRoom: () => ({
        handleWebSocket: async () => {
          throw new Error('unexpected failure');
        },
      }),
    } as unknown as RoomManager, relayPort);

    relay.start();
    try {
      await waitForHttp(`http://127.0.0.1:${relayPort}/v1/health`);
      const ws = new WebSocket(`ws://127.0.0.1:${relayPort}/ws?gatewayId=gw_test&role=client`);
      const closed = await waitForSocketClose(ws);
      expect(closed.code).toBe(1011);
    } finally {
      await relay.close();
    }
  });
});
