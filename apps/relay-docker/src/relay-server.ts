/**
 * relay-server.ts — WebSocket relay server for Docker deployment.
 *
 * Replaces the relay-worker Cloudflare Worker entry point.
 * Uses the `ws` library for WebSocket upgrades.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer } from 'ws';
import { parseRelayAuthQuery } from '@clawket/shared';
import type { RoomManager } from './room-manager.js';

export function createRelayServer(
  roomManager: RoomManager,
  port: number,
): { start: () => void; close: () => void } {
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (req.method === 'GET' && url.pathname === '/v1/health') {
      sendJson(res, 200, { ok: true, runtime: 'docker' });
      return;
    }

    // Non-websocket, non-API routes
    if (url.pathname !== '/ws') {
      sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'Route not found' } });
      return;
    }

    // For ws path without upgrade header, return error
    sendJson(res, 426, { error: { code: 'UPGRADE_REQUIRED', message: 'Expected websocket upgrade' } });
  });

  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', async (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const query = parseRelayAuthQuery(url);
    if (!query.gatewayId) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const room = roomManager.getRoom(query.gatewayId);

    wss.handleUpgrade(req, socket, head, async (ws) => {
      // Build headers map for the room
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') {
          headers[key.toLowerCase()] = value;
        }
      }

      const result = await room.handleWebSocket(
        ws,
        url.toString(),
        headers,
      );

      if (!result.accepted) {
        ws.close(
          result.status === 401 ? 4001 : result.status === 409 ? 4009 : 4000,
          result.error ?? 'rejected',
        );
      }
    });
  });

  return {
    start: () => {
      httpServer.listen(port, () => {
        console.log(`[relay-server] WebSocket relay listening on port ${port}`);
      });
    },
    close: () => {
      wss.close();
      httpServer.close();
    },
  };
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}
