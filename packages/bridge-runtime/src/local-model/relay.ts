import { relayNetworkOptions } from '../relay-network.js';
import WebSocket from 'ws';
import nacl from 'tweetnacl';
import { randomUUID } from 'node:crypto';
import { createSecurePairingBridgeProof, createSecurePairingClientProof, securePairingProofEquals } from '@clawket/bridge-core';
import { LocalModelService, type LocalModelRequest } from './server.js';
import { WEBSOCKET_FRAME_LIMIT_BYTES } from '../frame-limit.js';

const PREFIX = '__clawket_relay_control__:';
export interface LocalModelInvitation { sessionId: string; codeKeyHex: string; qrPayload: string; expiresAt: string; attempts: number }
export interface LocalModelRelayConfig { relayUrl: string; gatewayId: string; relaySecret: string; invitation?: LocalModelInvitation }

export class LocalModelRelay {
  private readonly relayNetwork = relayNetworkOptions();
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private attempts = 0;
  private pending = 0;
  private ready = false;
  private readyWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
  private readonly instanceId = randomUUID();
  private readonly update = (payload: unknown) => this.send(JSON.stringify({ type: 'event', event: 'local-model.update', payload }));

  constructor(private readonly service: LocalModelService, private readonly config: LocalModelRelayConfig,
    private readonly persistInvitation: (invitation: LocalModelInvitation) => void,
    private readonly log: (message: string) => void = () => {}) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.service.conversation.on('update', this.update);
    this.connect();
  }

  async waitUntilReady(timeoutMs = 30_000): Promise<void> {
    if (this.ready) return;
    if (this.stopped) throw new Error('Relay is stopped');
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => { clearTimeout(timer); this.readyWaiters.delete(waiter); error ? reject(error) : resolve(); };
      const waiter = { resolve: () => finish(), reject: (error: Error) => finish(error) };
      const timer = setTimeout(() => finish(new Error('Relay did not become ready in time')), timeoutMs);
      this.readyWaiters.add(waiter);
    });
  }

  stop(): void {
    this.stopped = true;
    this.ready = false;
    for (const waiter of this.readyWaiters) waiter.reject(new Error('Relay stopped'));
    if (this.retry) clearTimeout(this.retry);
    if (this.ping) clearInterval(this.ping);
    this.retry = null; this.ping = null;
    const socket = this.socket; this.socket = null; socket?.terminate();
    this.service.conversation.off('update', this.update);
  }

  private connect(): void {
    if (this.stopped) return;
    const url = new URL(this.config.relayUrl);
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Invalid Relay URL');
    url.searchParams.set('gatewayId', this.config.gatewayId);
    url.searchParams.set('role', 'gateway');
    url.searchParams.set('clientId', this.instanceId);
    const socket = new WebSocket(url, { ...this.relayNetwork, headers: { Authorization: `Bearer ${this.config.relaySecret}` }, maxPayload: WEBSOCKET_FRAME_LIMIT_BYTES, handshakeTimeout: 15_000 });
    this.socket = socket;
    let alive = true;
    socket.on('open', () => {
      if (this.socket !== socket || this.stopped) { socket.terminate(); return; }
      this.log('local-model relay transport connected');
      this.ping = setInterval(() => {
        if (!alive) { socket.terminate(); return; }
        alive = false; socket.ping();
      }, 15_000);
    });
    socket.on('pong', () => { if (this.socket === socket) alive = true; });
    socket.on('message', raw => {
      if (this.socket !== socket || this.stopped) return;
      const text = raw.toString();
      if (text.startsWith(PREFIX)) {
        try {
          const control = JSON.parse(text.slice(PREFIX.length));
          if (control.event === 'relay.ready') {
            this.attempts = 0; this.ready = true;
            for (const waiter of this.readyWaiters) waiter.resolve();
          }
          if (control.event === 'pairing.secure.start') this.pair(control);
        } catch { this.log('local-model invalid relay control'); }
        return;
      }
      if (++this.pending > 16) { this.pending--; this.log('local-model request capacity reached'); return; }
      void (async () => {
        let id: string | undefined;
        try {
          const frame = JSON.parse(text) as LocalModelRequest;
          id = typeof frame.id === 'string' && frame.id.length <= 200 ? frame.id : undefined;
          const payload = await this.service.request(frame);
          if (this.socket === socket) this.send(JSON.stringify({ type: 'res', id, ok: true, payload }));
        } catch (error) {
          if (id && this.socket === socket) this.send(JSON.stringify({ type: 'res', id, ok: false, error: { code: 'local_model_error', message: error instanceof Error ? error.message : 'Local model request failed' } }));
        } finally { this.pending--; }
      })();
    });
    socket.on('error', error => {
      if (this.socket !== socket || this.stopped) return;
      const code = (error as NodeJS.ErrnoException).code;
      const safeCode = typeof code === 'string' && /^[A-Z0-9_]{1,48}$/.test(code) ? code : 'transport_error';
      this.log(`local-model relay transport error code=${safeCode}`);
    });
    socket.on('close', code => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.ready = false;
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      if (!this.stopped) {
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(++this.attempts, 5));
        this.log(`local-model relay closed code=${code} attempt=${this.attempts} retryMs=${delay}`);
        this.retry = setTimeout(() => this.connect(), delay);
      }
    });
  }

  private send(data: string): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (Buffer.byteLength(data) > WEBSOCKET_FRAME_LIMIT_BYTES || socket.bufferedAmount > WEBSOCKET_FRAME_LIMIT_BYTES) { socket.terminate(); return; }
    socket.send(data);
  }

  private pair(control: { requestId?: string; sourceClientId?: string; payload?: Record<string, unknown> }): void {
    const invitation = this.config.invitation;
    const requestId = control.requestId;
    const targetClientId = control.sourceClientId;
    const payload = control.payload ?? {};
    if (!requestId || !targetClientId || !invitation || invitation.sessionId !== payload.sessionId) return;
    const respond = (event: string, result: object) => this.send(PREFIX + JSON.stringify({ type: 'control', event, requestId, targetClientId, payload: result }));
    if (Date.parse(invitation.expiresAt) <= Date.now() || invitation.attempts >= 5) { respond('pairing.secure.error', { protocol: 2, code: 'unavailable' }); return; }
    invitation.attempts++; this.persistInvitation(invitation);
    const clientPublicKey = typeof payload.clientPublicKey === 'string' ? payload.clientPublicKey : '';
    const clientProof = typeof payload.clientProof === 'string' ? payload.clientProof : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(clientPublicKey) || !securePairingProofEquals(clientProof, createSecurePairingClientProof({ codeKeyHex: invitation.codeKeyHex, sessionId: invitation.sessionId, requestId, clientPublicKey }))) {
      respond('pairing.secure.error', { protocol: 2, code: 'invalid_code' }); return;
    }
    const keys = nacl.box.keyPair();
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const ciphertext = nacl.box(Buffer.from(invitation.qrPayload), nonce, Buffer.from(clientPublicKey, 'base64url'), keys.secretKey);
    const result = { protocol: 2, sessionId: invitation.sessionId, bridgePublicKey: Buffer.from(keys.publicKey).toString('base64url'), nonce: Buffer.from(nonce).toString('base64url'), ciphertext: Buffer.from(ciphertext).toString('base64url') };
    const bridgeProof = createSecurePairingBridgeProof({ ...result, codeKeyHex: invitation.codeKeyHex, requestId, clientPublicKey });
    respond('pairing.secure.result', { ...result, bridgeProof });
  }
}
