import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  FRAME_TOO_LARGE_CLOSE_CODE,
  FRAME_TOO_LARGE_ERROR_CODE,
  getWebSocketFrameByteLength,
  isWebSocketMaxPayloadError,
  WEBSOCKET_FRAME_LIMIT_BYTES,
  type WebSocketFrameData,
} from '../frame-limit.js';
import {
  DEFAULT_HERMES_API_HEALTH_PATH,
  HERMES_BRIDGE_CAPABILITIES,
  SLOW_BRIDGE_REQUEST_LOG_THRESHOLD_MS,
  formatError,
  type HermesBridgeRequest,
  readRequestPathname,
} from './internal.js';

export type HermesLocalBridgeClient = { socket: WebSocket; isAlive: boolean };

export type HermesHttpContextSnapshot = {
  running: boolean;
  prewarmComplete: boolean;
  bridgeUrl: string;
  hermesApiReachable: boolean;
};

export abstract class HermesHttpServerMethods {
  declare apiBaseUrl: string;
  declare apiKey: string | null;
  declare bridgeVersion: string | undefined;
  declare bridgeToken: string;
  declare clients: Set<HermesLocalBridgeClient>;
  declare snapshot: HermesHttpContextSnapshot;
  declare dispatchRequest: (method: string, params: unknown) => Promise<unknown>;
  declare updateSnapshot: (patch: { clientCount?: number }) => void;
  declare log: (line: string) => void;

  async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = readRequestPathname(req.url);
    if (req.method === 'GET' && (pathname === '/health' || pathname === '/v1/hermes/health')) {
      const reachable = await probeHermesApi(this.apiBaseUrl, this.apiKey);
      this.writeJson(res, 200, {
        ok: true,
        running: this.snapshot.running,
        prewarmComplete: this.snapshot.prewarmComplete,
        status: reachable ? 'ok' : 'degraded',
        bridgeUrl: this.snapshot.bridgeUrl,
        wsPath: '/v1/hermes/ws',
        hermesApiBaseUrl: this.apiBaseUrl,
        hermesApiReachable: reachable,
        capabilities: [...HERMES_BRIDGE_CAPABILITIES],
        ...(this.bridgeVersion ? { bridgeVersion: this.bridgeVersion } : {}),
      });
      return;
    }

    this.writeJson(res, 404, {
      error: {
        code: 'not_found',
        message: 'Hermes bridge endpoint was not found.',
      },
    });
  }

  handleWsConnection(socket: WebSocket): void {
    const client: HermesLocalBridgeClient = { socket, isAlive: true };
    this.clients.add(client);
    this.updateSnapshot({ clientCount: this.clients.size });

    socket.on('error', (error) => {
      if (isWebSocketMaxPayloadError(error)) {
        // `ws` enforces maxPayload before emitting `message` and has already
        // entered CLOSING with a reasonless 1009 frame when this event fires.
        // Keep that hard receive ceiling and normalize the internal signal.
        this.log(
          `client_in rejected code=${FRAME_TOO_LARGE_ERROR_CODE} ` +
          `limit=${WEBSOCKET_FRAME_LIMIT_BYTES} source=ws_max_payload`,
        );
        return;
      }
      this.log(`client websocket error: ${formatError(error)}`);
    });
    socket.on('message', (raw) => {
      // Any inbound application frame proves the client is alive, so the
      // heartbeat sweep should not terminate it on the next tick.
      client.isAlive = true;
      void this.handleWsMessage(client, raw);
    });
    socket.on('pong', () => {
      client.isAlive = true;
    });
    socket.on('close', () => {
      this.clients.delete(client);
      this.updateSnapshot({ clientCount: this.clients.size });
    });

    this.sendEvent(socket, 'health', {
      status: this.snapshot.hermesApiReachable ? 'ok' : 'degraded',
      ts: Date.now(),
      hermesApiReachable: this.snapshot.hermesApiReachable,
      mode: 'hermes',
      capabilities: [...HERMES_BRIDGE_CAPABILITIES],
      ...(this.bridgeVersion ? { bridgeVersion: this.bridgeVersion } : {}),
    });
  }

  sweepWsHeartbeats(): void {
    for (const client of [...this.clients]) {
      if (client.socket.readyState !== WebSocket.OPEN) {
        this.clients.delete(client);
        continue;
      }
      if (!client.isAlive) {
        this.log('terminating idle ws client (no message or pong within heartbeat window)');
        try {
          client.socket.terminate();
        } catch {
          // Socket may already be detached; the close handler will clean up.
        }
        this.clients.delete(client);
        continue;
      }
      client.isAlive = false;
      try {
        client.socket.ping();
      } catch {
        // Ignore transient ping errors; the next sweep will catch a dead socket.
      }
    }
    this.updateSnapshot({ clientCount: this.clients.size });
  }

  async handleWsMessage(client: HermesLocalBridgeClient, raw: WebSocket.RawData): Promise<void> {
    if (this.rejectOversizedFrame(client.socket, raw, 'client_in')) return;
    let request: HermesBridgeRequest;
    try {
      request = JSON.parse(raw.toString()) as HermesBridgeRequest;
    } catch {
      this.sendError(client.socket, null, 'invalid_json', 'Failed to parse request JSON.');
      return;
    }

    if (request.type !== 'req' || typeof request.id !== 'string' || typeof request.method !== 'string') {
      this.sendError(client.socket, typeof request.id === 'string' ? request.id : null, 'invalid_request', 'Malformed request envelope.');
      return;
    }

    const startedAt = Date.now();
    try {
      const payload = await this.dispatchRequest(request.method, request.params ?? {});
      this.logSlowBridgeRequest(request.method, startedAt);
      this.sendResponse(client.socket, request.id, payload);
    } catch (error) {
      this.logSlowBridgeRequest(request.method, startedAt, error);
      this.sendError(client.socket, request.id, 'request_failed', formatError(error));
    }
  }

  logSlowBridgeRequest(method: string, startedAt: number, error?: unknown): void {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs < SLOW_BRIDGE_REQUEST_LOG_THRESHOLD_MS) {
      return;
    }
    const suffix = error ? ` error=${formatError(error)}` : '';
    this.log(`slow bridge request method=${method} elapsedMs=${elapsedMs}${suffix}`);
  }

  sendResponse(socket: WebSocket, id: string, payload: unknown): void {
    this.sendFrame(socket, JSON.stringify({
      type: 'res',
      id,
      ok: true,
      payload,
    }), 'client_out');
  }

  sendError(socket: WebSocket, id: string | null, code: string, message: string): void {
    this.sendFrame(socket, JSON.stringify({
      type: 'res',
      id: id ?? randomUUID(),
      ok: false,
      error: {
        code,
        message,
      },
    }), 'client_out');
  }

  broadcastEvent(event: string, payload: unknown): void {
    for (const client of this.clients) {
      this.sendEvent(client.socket, event, payload);
    }
  }

  sendEvent(socket: WebSocket, event: string, payload: unknown): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.sendFrame(socket, JSON.stringify({
      type: 'event',
      event,
      payload,
    }), 'client_out');
  }

  rejectOversizedFrame(
    socket: WebSocket,
    data: WebSocketFrameData,
    direction: string,
  ): boolean {
    const byteLength = getWebSocketFrameByteLength(data);
    if (byteLength <= WEBSOCKET_FRAME_LIMIT_BYTES) return false;
    this.log(
      `${direction} rejected code=${FRAME_TOO_LARGE_ERROR_CODE} ` +
      `bytes=${byteLength} limit=${WEBSOCKET_FRAME_LIMIT_BYTES}`,
    );
    socket.close(FRAME_TOO_LARGE_CLOSE_CODE, FRAME_TOO_LARGE_ERROR_CODE);
    return true;
  }

  sendFrame(socket: WebSocket, data: WebSocketFrameData, direction: string): boolean {
    if (this.rejectOversizedFrame(socket, data, direction)) return false;
    socket.send(data as WebSocket.Data);
    return true;
  }

  writeJson(res: ServerResponse, status: number, payload: unknown): void {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  }

  isAuthorized(rawUrl: string | undefined): boolean {
    const token = new URL(rawUrl ?? '/', 'http://localhost').searchParams.get('token')?.trim();
    return token === this.bridgeToken;
  }
}

export async function probeHermesApi(
  apiBaseUrl: string,
  apiKey: string | null,
  options?: { timeoutMs?: number },
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 3_000);
  try {
    const response = await fetch(`${apiBaseUrl}${DEFAULT_HERMES_API_HEALTH_PATH}`, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : undefined,
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
