import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { HermesLocalBridge } from './index.js';
import {
  FRAME_TOO_LARGE_ERROR_CODE,
  WEBSOCKET_FRAME_LIMIT_BYTES,
} from '../frame-limit.js';

async function reserveAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return port;
}

function waitForInvalidJsonResponse(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    const handleMessage = (data: WebSocket.RawData) => {
      try {
        const frame = JSON.parse(data.toString()) as { error?: { code?: string } };
        if (frame.error?.code !== 'invalid_json') return;
        socket.off('message', handleMessage);
        resolve();
      } catch {
        // Ignore the initial health event or any unrelated frame.
      }
    };
    socket.on('message', handleMessage);
  });
}

describe('HermesLocalBridge WebSocket frame limit', () => {
  it('keeps the hard ws ceiling without an uncaught socket error', async () => {
    const port = await reserveAvailablePort();
    const stateDir = await mkdtemp(join(tmpdir(), 'clawket-hermes-frame-limit-'));
    const logs: string[] = [];
    const bridge = new HermesLocalBridge({
      host: '127.0.0.1',
      port,
      apiBaseUrl: 'http://127.0.0.1:1',
      bridgeToken: 'frame-limit-test',
      startHermesIfNeeded: false,
      hermesSourcePath: join(stateDir, 'missing-hermes-source'),
      hermesHomePath: join(stateDir, 'hermes-home'),
      sessionStorePath: join(stateDir, 'sessions.json'),
      usageLedgerPath: join(stateDir, 'usage.json'),
      hermesStateDbPath: join(stateDir, 'state.db'),
      onLog: (line) => logs.push(line),
    });
    let client: WebSocket | null = null;

    try {
      await bridge.start();
      client = new WebSocket(bridge.getWsUrl());
      await once(client, 'open');

      const exactBoundaryResponse = waitForInvalidJsonResponse(client);
      client.send(Buffer.alloc(WEBSOCKET_FRAME_LIMIT_BYTES));
      await exactBoundaryResponse;
      expect(client.readyState).toBe(WebSocket.OPEN);

      const closed = once(client, 'close');
      client.send(Buffer.alloc(WEBSOCKET_FRAME_LIMIT_BYTES + 1));
      const [code, reason] = await closed as [number, Buffer];

      expect(code).toBe(1009);
      // ws enters CLOSING before emitting WS_ERR_UNSUPPORTED_MESSAGE_LENGTH,
      // so retaining maxPayload=8 MiB necessarily leaves the peer reason empty.
      expect(reason.toString()).toBe('');
      expect(logs).toContain(
        `client_in rejected code=${FRAME_TOO_LARGE_ERROR_CODE} ` +
        `limit=${WEBSOCKET_FRAME_LIMIT_BYTES} source=ws_max_payload`,
      );
      await vi.waitFor(() => {
        expect(bridge.getSnapshot().clientCount).toBe(0);
      }, { timeout: 1_000 });
    } finally {
      if (client?.readyState === WebSocket.OPEN) client.terminate();
      await bridge.stop();
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 15_000);
});

describe('HermesLocalBridge capability advertisement', () => {
  it('returns the same Bridge version and capabilities across every health path', async () => {
    const port = await reserveAvailablePort();
    const stateDir = await mkdtemp(join(tmpdir(), 'clawket-hermes-capabilities-'));
    const bridge = new HermesLocalBridge({
      host: '127.0.0.1',
      port,
      apiBaseUrl: 'http://127.0.0.1:1',
      bridgeToken: 'capabilities-test',
      bridgeVersion: ' 3.0.0-test ',
      startHermesIfNeeded: false,
      hermesSourcePath: join(stateDir, 'missing-hermes-source'),
      hermesHomePath: join(stateDir, 'home'),
      hermesPythonPath: 'python3',
      sessionStorePath: join(stateDir, 'sessions.json'),
      usageLedgerPath: join(stateDir, 'usage.json'),
    });
    try {
      await bridge.start();
      const health = await fetch(`${bridge.getHttpUrl()}/v1/hermes/health`).then((response) => response.json()) as any;
      expect(health.capabilities).toEqual(['bridge.capabilities.v2', 'hermes.multi-session.v2']);
      expect(health.bridgeVersion).toBe('3.0.0-test');

      const socket = new WebSocket(bridge.getWsUrl());
      const [data] = await once(socket, 'message') as [WebSocket.RawData];
      const initial = JSON.parse(data.toString());
      expect(initial).toMatchObject({
        type: 'event',
        event: 'health',
        payload: {
          capabilities: ['bridge.capabilities.v2', 'hermes.multi-session.v2'],
          bridgeVersion: '3.0.0-test',
        },
      });

      const responsePromise = once(socket, 'message');
      socket.send(JSON.stringify({ type: 'req', id: 'health-1', method: 'health', params: {} }));
      const [responseData] = await responsePromise as [WebSocket.RawData];
      expect(JSON.parse(responseData.toString())).toMatchObject({
        type: 'res',
        id: 'health-1',
        ok: true,
        payload: {
          capabilities: ['bridge.capabilities.v2', 'hermes.multi-session.v2'],
          bridgeVersion: '3.0.0-test',
        },
      });

      const periodicPromise = once(socket, 'message');
      await bridge.refreshHermesHealth();
      const [periodicData] = await periodicPromise as [WebSocket.RawData];
      expect(JSON.parse(periodicData.toString())).toMatchObject({
        type: 'event',
        event: 'health',
        payload: { bridgeVersion: '3.0.0-test' },
      });
      socket.close();
    } finally {
      await bridge.stop();
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('omits an invalid blank Bridge version from health responses', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'clawket-hermes-blank-version-'));
    try {
      const bridge = new HermesLocalBridge({
        bridgeVersion: ' \n ',
        sessionStorePath: join(stateDir, 'sessions.json'),
        usageLedgerPath: join(stateDir, 'usage.json'),
        hermesStateDbPath: join(stateDir, 'state.db'),
      });

      const health = await bridge.dispatchRequest('health', {}) as Record<string, unknown>;
      expect(health).not.toHaveProperty('bridgeVersion');
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
