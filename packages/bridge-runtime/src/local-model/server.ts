import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import type { PromptInput } from '@clawket/agent-protocol';
import { WEBSOCKET_FRAME_LIMIT_BYTES } from '../frame-limit.js';
import { LocalModelConversation } from './conversation.js';

export interface LocalModelRequest { type: 'req'; id: string; method: string; params?: Record<string, unknown> }

/** The same bounded RPC dispatcher serves direct and authenticated Relay clients. */
export class LocalModelService {
  constructor(readonly conversation: LocalModelConversation) {}

  async request(frame: LocalModelRequest): Promise<unknown> {
    if (!frame || frame.type !== 'req' || typeof frame.id !== 'string' || !frame.id || frame.id.length > 200) throw new Error('Invalid request');
    const params = frame.params ?? {};
    switch (frame.method) {
      case 'connect':
      case 'health': return { backend: 'local-model', protocol: 1, ...await this.conversation.health() };
      case 'chat.history':
        if (params.cursor !== undefined && typeof params.cursor !== 'string') throw new Error('Invalid history cursor');
        return this.conversation.history(params.cursor as string | undefined);
      case 'chat.send': {
        if (params.sessionKey !== 'main' || typeof params.text !== 'string' || typeof params.idempotencyKey !== 'string'
          || (params.attachments !== undefined && !Array.isArray(params.attachments))) throw new Error('Invalid prompt');
        return this.conversation.prompt(params as unknown as PromptInput);
      }
      case 'chat.abort':
        if (params.runId !== undefined && typeof params.runId !== 'string') throw new Error('Invalid run ID');
        await this.conversation.cancel(params.runId as string | undefined);
        return { ok: true };
      case 'models.list': {
        const health = await this.conversation.health();
        return {
          currentModel: this.conversation.selection, currentProvider: 'local-model', currentBaseUrl: '',
          models: this.conversation.endpoints.map(endpoint => ({
            id: endpoint.id, name: endpoint.name, provider: 'local-model', contextWindow: endpoint.contextWindow,
            input: endpoint.id === this.conversation.selection && health.vision ? ['text', 'image'] : ['text'],
          })),
        };
      }
      case 'models.select':
        if (typeof params.model !== 'string') throw new Error('Invalid model ID');
        await this.conversation.select(params.model);
        return { ok: true, scope: 'global', ...await this.request({ type: 'req', id: frame.id, method: 'models.list' }) as object };
      default: throw new Error('Unsupported local model operation');
    }
  }
}

export class LocalModelServer {
  private http: Server | null = null;
  private ws: WebSocketServer | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private clients = new Set<WebSocket>();
  private readonly service: LocalModelService;
  private readonly update = (value: unknown) => {
    const data = JSON.stringify({ type: 'event', event: 'local-model.update', payload: value });
    for (const socket of this.clients) {
      if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < WEBSOCKET_FRAME_LIMIT_BYTES) socket.send(data);
      else socket.terminate();
    }
  };

  constructor(readonly conversation: LocalModelConversation, private readonly token: string) {
    if (Buffer.byteLength(token) < 32) throw new Error('Bridge token must contain at least 32 bytes');
    this.service = new LocalModelService(conversation);
  }

  async start(port = 17880, host = '127.0.0.1'): Promise<number> {
    if (this.http) throw new Error('Bridge already started');
    await this.conversation.health();
    this.http = createServer((_req, res) => { res.writeHead(404); res.end(); });
    this.ws = new WebSocketServer({ noServer: true, maxPayload: WEBSOCKET_FRAME_LIMIT_BYTES });
    this.http.on('upgrade', (request, socket, head) => {
      if (request.url !== '/v1/local-model/ws') { socket.destroy(); return; }
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
    this.ws.on('connection', socket => { alive.add(socket); socket.on('pong', () => alive.add(socket)); });
    try {
      await new Promise<void>((resolve, reject) => { this.http!.once('error', reject); this.http!.listen(port, host, resolve); });
    } catch (error) { await this.stop(); throw error; }
    return (this.http.address() as { port: number }).port;
  }

  private accept(socket: WebSocket): void {
    let authenticated = false;
    let pending = 0;
    const timeout = setTimeout(() => socket.close(1008, 'authentication_required'), 10_000);
    socket.on('error', () => {});
    socket.on('close', () => { clearTimeout(timeout); this.clients.delete(socket); });
    socket.on('message', raw => {
      if (++pending > 16) { socket.close(1008, 'too_many_requests'); return; }
      void (async () => {
        let id: string | undefined;
        try {
          const frame = JSON.parse(raw.toString()) as LocalModelRequest;
          id = typeof frame.id === 'string' && frame.id.length <= 200 ? frame.id : undefined;
          if (!authenticated) {
            const supplied = typeof frame.params?.token === 'string' ? Buffer.from(frame.params.token) : Buffer.alloc(0);
            const expected = Buffer.from(this.token);
            if (frame.method !== 'connect' || !id || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
              socket.close(1008, 'unauthorized'); return;
            }
            clearTimeout(timeout); authenticated = true; this.clients.add(socket); this.ws!.emit('connection', socket);
            const payload = await this.service.request({ type: 'req', id, method: 'health' });
            socket.send(JSON.stringify({ type: 'res', id, ok: true, payload }));
            return;
          }
          const payload = await this.service.request(frame);
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'res', id, ok: true, payload }));
        } catch (error) {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'res', id, ok: false, error: { code: 'local_model_error', message: error instanceof Error ? error.message : 'Local model request failed' } }));
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
