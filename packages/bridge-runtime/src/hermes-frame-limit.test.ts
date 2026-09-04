import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { HermesLocalBridge } from './hermes.js';
import {
  FRAME_TOO_LARGE_ERROR_CODE,
  WEBSOCKET_FRAME_LIMIT_BYTES,
} from './frame-limit.js';

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
