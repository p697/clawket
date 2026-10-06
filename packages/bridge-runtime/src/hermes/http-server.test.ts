import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { probeHermesApi } from './http-server.js';
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
  it('advertises and answers phone-started update only through the injected control', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'clawket-hermes-remote-update-'));
    const status = { id: '5b0c7a0e-3c1f-4e8e-9b2a-6f1d2c3b4a59', state: 'checking' as const, startedAt: 1 };
    const start = vi.fn(async () => ({ accepted: true as const, status }));
    const bridge = (remoteUpdate?: ConstructorParameters<typeof HermesLocalBridge>[0]['remoteUpdate']) => new HermesLocalBridge({
      host: '127.0.0.1', port: 1, apiBaseUrl: 'http://127.0.0.1:1', bridgeToken: 'remote-update-test', startHermesIfNeeded: false,
      hermesSourcePath: join(stateDir, 'missing-hermes-source'), hermesHomePath: join(stateDir, 'home'),
      sessionStorePath: join(stateDir, 'sessions.json'), usageLedgerPath: join(stateDir, 'usage.json'), remoteUpdate,
    });
    try {
      const without = bridge();
      expect(without.getBridgeCapabilities()).not.toContain('bridge.remote-update.v1');
      await expect(without.dispatchRequest('bridge.update.start', {})).rejects.toThrow('unavailable');
      const enabled = bridge({ available: () => true, start, status: () => status });
      expect(enabled.getBridgeCapabilities()).toContain('bridge.remote-update.v1');
      expect(await enabled.dispatchRequest('bridge.update.start', { version: '0.0.1' })).toEqual({ accepted: true, status });
      expect(await enabled.dispatchRequest('bridge.update.status', {})).toEqual({ status });
      expect(start).toHaveBeenCalledExactlyOnceWith();
      expect(bridge({ available: () => false, start, status: () => status }).getBridgeCapabilities()).not.toContain('bridge.remote-update.v1');
    } finally { await rm(stateDir, { recursive: true, force: true }); }
  });

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
      hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
      sessionStorePath: join(stateDir, 'sessions.json'),
      usageLedgerPath: join(stateDir, 'usage.json'),
    });
    try {
      await bridge.start();
      const health = await fetch(`${bridge.getHttpUrl()}/v1/hermes/health`).then((response) => response.json()) as any;
      expect(health.capabilities).toEqual(['bridge.session-files.v1', 'bridge.artifacts.v1', 'bridge.capabilities.v2', 'hermes.multi-session.v2']);
      expect(health.bridgeVersion).toBe('3.0.0-test');

      const socket = new WebSocket(bridge.getWsUrl());
      const [data] = await once(socket, 'message') as [WebSocket.RawData];
      const initial = JSON.parse(data.toString());
      expect(initial).toMatchObject({
        type: 'event',
        event: 'health',
        payload: {
          capabilities: ['bridge.session-files.v1', 'bridge.artifacts.v1', 'bridge.capabilities.v2', 'hermes.multi-session.v2'],
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
          capabilities: ['bridge.session-files.v1', 'bridge.artifacts.v1', 'bridge.capabilities.v2', 'hermes.multi-session.v2'],
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

describe('Hermes authenticated readiness', () => {
  it('does not mistake a public health response for usable API credentials', async () => {
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => new Response('{}', {
      status: url.endsWith('/health') || options?.headers && (options.headers as Record<string, string>).authorization === 'Bearer valid-key' ? 200 : 401,
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await probeHermesApi('http://127.0.0.1:8642', 'wrong-key')).toBe(false);
      expect(await probeHermesApi('http://127.0.0.1:8642', 'valid-key')).toBe(true);
      expect(fetchMock.mock.calls.every(([url]) => url.endsWith('/v1/models'))).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it('reports a fixed Hermes API issue on Bridge health', async () => {
    let apiStatus = 401;
    const api = createServer((request, response) => {
      response.statusCode = request.url === '/v1/models' ? apiStatus : 404;
      response.end('{}');
    });
    await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', () => resolve()));
    const stateDir = await mkdtemp(join(tmpdir(), 'clawket-hermes-api-issue-'));
    const bridge = new HermesLocalBridge({
      host: '127.0.0.1',
      port: await reserveAvailablePort(),
      apiBaseUrl: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
      bridgeToken: 'api-issue-test',
      startHermesIfNeeded: false,
      hermesSourcePath: join(stateDir, 'missing-hermes-source'),
      hermesHomePath: join(stateDir, 'home'),
      hermesPythonPath: (process.platform === 'win32' ? 'python' : 'python3'),
      sessionStorePath: join(stateDir, 'sessions.json'),
      usageLedgerPath: join(stateDir, 'usage.json'),
      gatewayOwnerPath: join(stateDir, 'gateway-owner.json'),
    });
    const readHealth = async () => await (await fetch(`${bridge.getHttpUrl()}/health`)).json() as Record<string, unknown>;
    try {
      await bridge.start();
      await expect(readHealth()).resolves.toMatchObject({
        status: 'degraded',
        hermesApiReachable: false,
        hermesApiIssue: 'credential_mismatch',
      });
      apiStatus = 503;
      await expect(readHealth()).resolves.toMatchObject({ hermesApiReachable: false, hermesApiIssue: 'unreachable' });
      apiStatus = 200;
      const ready = await readHealth();
      expect(ready).toMatchObject({ status: 'ok', hermesApiReachable: true });
      expect(ready).not.toHaveProperty('hermesApiIssue');
    } finally {
      await bridge.stop();
      api.closeAllConnections();
      await new Promise<void>((resolve) => api.close(() => resolve()));
      await rm(stateDir, { recursive: true, force: true });
    }
  }, 15_000);
});
