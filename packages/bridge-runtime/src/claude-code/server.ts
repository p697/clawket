import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { WEBSOCKET_FRAME_LIMIT_BYTES, isWebSocketMaxPayloadError } from '../frame-limit.js';
import { ClaudeService, type ClaudeRequest } from './service.js';
import { ClaudeFault } from './errors.js';

export class ClaudeServer {
  private http: Server | null = null;
  private ws: WebSocketServer | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private clients = new Set<WebSocket>();
  private readonly service: ClaudeService;
  private readonly update = (value: unknown) => {
    const data = JSON.stringify({ type: 'event', event: 'claude-code.update', payload: value });
    if (Buffer.byteLength(data) > WEBSOCKET_FRAME_LIMIT_BYTES) return;
    for (const socket of this.clients) {
      if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < WEBSOCKET_FRAME_LIMIT_BYTES) socket.send(data);
      else socket.terminate();
    }
  };

  constructor(readonly conversation: ClaudeService, private readonly token: string, private readonly log: (message: string) => void = () => {}) {
    if (Buffer.byteLength(token) < 32) throw new Error('Bridge token must contain at least 32 bytes');
    this.service = conversation;
  }

  async start(port = 17882, host = '127.0.0.1'): Promise<number> {
    if (this.http) throw new Error('Bridge already started');
    await this.conversation.health();
    this.http = createServer((_req, res) => { res.writeHead(404); res.end(); });
    this.ws = new WebSocketServer({ noServer: true, maxPayload: WEBSOCKET_FRAME_LIMIT_BYTES });
    this.http.on('upgrade', (request, socket, head) => {
      if (request.url !== '/v1/claude-code/ws') { socket.destroy(); return; }
      this.ws!.handleUpgrade(request, socket, head, client => this.accept(client));
    });
    this.conversation.on('update', this.update);
    const alive = new Set<WebSocket>();
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        if (!alive.delete(client)) { client.terminate(); continue; }
        client.ping();
        client.send(JSON.stringify({ type: 'tick', ts: Date.now() }));
      }
    }, 30_000);
    this.ws.on('connection', socket => { alive.add(socket); socket.on('pong', () => alive.add(socket)); socket.once('close', () => alive.delete(socket)); });
    try {
      await new Promise<void>((resolve, reject) => { this.http!.once('error', reject); this.http!.listen(port, host, resolve); });
    } catch (error) { await this.stop(); throw error; }
    return (this.http.address() as { port: number }).port;
  }

  private send(socket: WebSocket, value: object): void {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > WEBSOCKET_FRAME_LIMIT_BYTES || socket.bufferedAmount > WEBSOCKET_FRAME_LIMIT_BYTES) { socket.close(1009, 'frame_too_large'); return; }
    if (socket.readyState === WebSocket.OPEN) socket.send(text);
  }

  private accept(socket: WebSocket): void {
    let authenticated = false;
    let pending = 0;
    const timeout = setTimeout(() => socket.close(1008, 'authentication_required'), 10_000);
    socket.on('error', error => { if (isWebSocketMaxPayloadError(error)) this.log('claude-code client rejected code=frame_too_large source=ws_max_payload'); });
    socket.on('close', () => { clearTimeout(timeout); this.clients.delete(socket); });
    socket.on('message', raw => {
      if (++pending > 16) { socket.close(1008, 'too_many_requests'); return; }
      void (async () => {
        let id: string | undefined;
        try {
          const frame = JSON.parse(raw.toString()) as ClaudeRequest;
          id = typeof frame.id === 'string' && frame.id.length <= 200 ? frame.id : undefined;
          if (!authenticated) {
            const supplied = typeof frame.params?.token === 'string' ? Buffer.from(frame.params.token) : Buffer.alloc(0);
            const expected = Buffer.from(this.token);
            if (frame.method !== 'connect' || !id || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
              socket.close(1008, 'unauthorized'); return;
            }
            clearTimeout(timeout); authenticated = true; this.clients.add(socket); this.ws!.emit('connection', socket);
            const payload = await this.service.request({ type: 'req', id, method: 'health' });
            this.send(socket, { type: 'res', id, ok: true, payload });
            return;
          }
          if (frame.method === 'bridge.stop') {
            socket.send(JSON.stringify({ type: 'res', id, ok: true, payload: { ok: true } }), () => this.conversation.emit('shutdown'));
            return;
          }
          const payload = await this.service.request(frame);
          if (socket.readyState === WebSocket.OPEN) this.send(socket, { type: 'res', id, ok: true, payload });
        } catch (error) {
          if (socket.readyState === WebSocket.OPEN) this.send(socket, { type: 'res', id, ok: false, error: { code: 'claude-code_error', message: error instanceof ClaudeFault ? error.message : 'Claude request failed. Check the local Bridge configuration.' } });
        } finally { pending--; }
      })();
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.conversation.off('update', this.update);
    for (const socket of this.ws?.clients ?? []) socket.terminate();
    this.clients.clear();
    this.ws?.close(); this.ws = null;
    const server = this.http; this.http = null;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await this.conversation.stop();
  }
}
