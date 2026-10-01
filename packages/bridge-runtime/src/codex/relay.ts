import { RelayOwnerCadence } from '../relay-owner-cadence.js';
import { relayNetworkOptions } from '../relay-network.js';
import { advertiseRelayOwnerPong, RelayOwnerPong } from '../relay-owner-pong.js';
import { advertiseRelayTransfer } from '../relay-transfer-lease.js';
import WebSocket from 'ws';
import nacl from 'tweetnacl';
import { randomUUID } from 'node:crypto';
import { createSecurePairingBridgeProof, createSecurePairingClientProof, securePairingProofEquals } from '@clawket/bridge-core';
import { CodexService, type CodexRequest } from './service.js';
import { getWebSocketFrameByteLength, WEBSOCKET_FRAME_LIMIT_BYTES } from '../frame-limit.js';

const PREFIX = '__clawket_relay_control__:';
export interface CodexInvitation { sessionId: string; codeKeyHex: string; qrPayload: string; expiresAt: string; attempts: number }
export interface CodexRelayConfig { registryUrl?: string; relayUrl: string; gatewayId: string; relaySecret: string; invitation?: CodexInvitation }

export class CodexRelay {
  private readonly relayNetwork = relayNetworkOptions();
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private ping: RelayOwnerCadence | null = null;
  private ownerPong: RelayOwnerPong | null = null;
  private readiness: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private attempts = 0;
  private pending = 0;
  private ready = false;
  private readyWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>();
  private readonly instanceId = randomUUID();
  private readonly update = (payload: unknown) => {
    // Relay may switch the active phone to a legacy client. Its RPC response is origin-routed; new events are not.
    if ((payload as { type?: string } | null)?.type === 'session_activity_update') return;
    this.send(JSON.stringify({ type: 'event', event: 'codex.update', payload }));
  };

  constructor(private readonly service: CodexService, private readonly config: CodexRelayConfig,
    private readonly persistInvitation: (invitation: CodexInvitation) => void,
    private readonly log: (message: string) => void = () => {}) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.service.conversation.on('update', this.update);
    this.connect();
  }

  async waitUntilReady(timeoutMs = 90_000): Promise<void> {
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
    this.ownerPong?.dispose(); this.ownerPong = null;
    for (const waiter of this.readyWaiters) waiter.reject(new Error('Relay stopped'));
    if (this.retry) clearTimeout(this.retry);
    this.ping?.dispose();
    if (this.readiness) clearTimeout(this.readiness);
    this.retry = null; this.ping = null; this.readiness = null;
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
    advertiseRelayOwnerPong(url);
    advertiseRelayTransfer(url);
    const socket = new WebSocket(url, { ...this.relayNetwork, headers: { Authorization: `Bearer ${this.config.relaySecret}` }, maxPayload: WEBSOCKET_FRAME_LIMIT_BYTES, handshakeTimeout: 15_000 });
    this.socket = socket;
    let alive = true;
    let missedPongs = 0;
    let lastPongAt = 0;
    const ownerPong = new RelayOwnerPong({
      send: frame => { if (this.socket === socket && !this.stopped) this.send(frame); },
      onConfirmed: () => {
        if (this.socket !== socket || this.stopped) return;
        alive = true; missedPongs = 0; lastPongAt = Date.now();
      },
      onTimeout: () => { if (this.socket === socket && !this.stopped) socket.terminate(); },
      log: line => this.log('codex ' + line),
    });
    this.ownerPong = ownerPong;
    let ownerLeasePending = false;
    socket.on('open', () => {
      if (this.socket !== socket || this.stopped) { socket.terminate(); return; }
      this.log('codex relay transport connected');
      this.readiness = setTimeout(() => {
        if (this.socket === socket && !this.ready) {
          this.log('codex relay readiness timeout'); socket.terminate();
        }
      }, 15_000);
      lastPongAt = Date.now();
      this.ping = new RelayOwnerCadence({ idleIntervalMs: 15_000, negotiated: () => ownerPong.negotiated,
        onTick: schedulerDelayMs => {
          if (this.socket !== socket || this.stopped) return;
          const now = Date.now();
          if (ownerPong.negotiated) {
            if (!ownerPong.startProtocolPing()) return;
            alive = false; socket.ping(ownerPong.protocolPingPayload);
            return;
          }
          if (!alive) missedPongs++;
          if (missedPongs >= 3) {
            this.log(`codex relay heartbeat timeout idleMs=${Math.max(0, now - lastPongAt)} schedulerDelayMs=${schedulerDelayMs} queuedBytes=${socket.bufferedAmount}`);
            socket.terminate(); return;
          }
          if (!alive) this.log(`codex relay heartbeat delayed missedPongs=${missedPongs}`);
          alive = false; socket.ping();
        },
      });
      this.ping.schedule();
    });
    socket.on('pong', (data: Buffer) => {
      if (this.socket !== socket || this.stopped) return;
      if (!ownerPong.confirmTransportPong(data?.toString())) return;
      if (missedPongs) this.log(`codex relay heartbeat recovered missedPongs=${missedPongs}`);
      alive = true; missedPongs = 0; lastPongAt = Date.now();
    });
    socket.on('message', raw => {
      if (this.socket !== socket || this.stopped) return;
      const text = raw.toString();
      ownerPong.noteFrameReceived(getWebSocketFrameByteLength(raw));
      if (text.startsWith(PREFIX)) {
        try {
          const control = JSON.parse(text.slice(PREFIX.length));
          const consumed = ownerPong.handleControl(control);
          this.ping?.observe(control);
          if (consumed) return;
          if (control.event === 'relay.ready') {
            if (this.readiness) clearTimeout(this.readiness); this.readiness = null;
            this.attempts = 0; this.ready = true;
            this.log('codex relay ready');
            for (const waiter of this.readyWaiters) waiter.resolve();
          }
          if (control.event === 'pairing.secure.start') this.pair(control);
        } catch { this.log('codex invalid relay control'); }
        return;
      }
      if (this.pending >= 16) {
        this.log('codex request capacity reached');
        try {
          const frame = JSON.parse(text);
          if (frame?.type === 'req' && typeof frame.id === 'string' && frame.id.length > 0 && frame.id.length <= 200) {
            this.send(JSON.stringify({ type: 'res', id: frame.id, ok: false,
              error: { code: 'BRIDGE_BUSY', message: 'The Bridge is handling other requests. Please retry.' } }));
          }
        } catch { /* Malformed frames cannot be correlated with a client request. */ }
        return;
      }
      this.pending++;
      void (async () => {
        let id: string | undefined;
        try {
          const frame = JSON.parse(text) as CodexRequest;
          id = typeof frame.id === 'string' && frame.id.length <= 200 ? frame.id : undefined;
          const payload = await this.service.request(frame);
          if (this.socket === socket) this.send(JSON.stringify({ type: 'res', id, ok: true, payload }));
        } catch (error) {
          if (id && this.socket === socket) this.send(JSON.stringify({ type: 'res', id, ok: false, error: { code: 'codex_error', message: error instanceof Error ? error.message : 'Codex request failed' } }));
        } finally { this.pending--; }
      })();
    });
    socket.on('error', (error: Error & { code?: string }) => {
      if (this.socket !== socket || this.stopped) return;
      const status = /^Unexpected server response: (\d{3})$/.exec(error.message)?.[1];
      ownerLeasePending = status === '409';
      const code = status ? `HTTP_${status}` : /^[A-Z0-9_]{1,40}$/.test(error.code ?? '') ? error.code : 'WEBSOCKET_ERROR';
      this.log(`codex relay transport error code=${code}`);
    });
    socket.on('close', (code: number) => {
      if (this.socket !== socket) return;
      this.log(`codex relay closed code=${code}`);
      this.socket = null;
      this.ready = false;
      const fastRetryDelayMs = ownerPong.takeReconnectDelay(30_000, code);
      ownerPong.dispose();
      if (this.ownerPong === ownerPong) this.ownerPong = null;
      this.ping?.dispose();
      if (this.readiness) clearTimeout(this.readiness);
      this.ping = null; this.readiness = null;
      if (code === 4010 || code === 4001) { this.stop(); return; }
      if (!this.stopped) {
        if (!ownerLeasePending) this.attempts++;
        // A previous process can hold the 20s owner lease after abrupt shutdown.
        // Do not let exponential delays push the next attempt past startup readiness.
        const delayMs = ownerLeasePending ? 2000 : Math.min(fastRetryDelayMs, 1000 * 2 ** Math.min(this.attempts, 5));
        this.log(`codex relay retry attempt=${this.attempts} delayMs=${delayMs}`);
        this.retry = setTimeout(() => { this.retry = null; this.connect(); }, delayMs);
      }
    });
  }

  private send(data: string): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (Buffer.byteLength(data) > WEBSOCKET_FRAME_LIMIT_BYTES || socket.bufferedAmount > WEBSOCKET_FRAME_LIMIT_BYTES) { socket.terminate(); return; }
    socket.send(data);
    this.ownerPong?.noteTransfer(Buffer.byteLength(data));
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
