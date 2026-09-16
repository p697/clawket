import { relayNetworkOptions } from '../relay-network.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { PeerCertificate } from 'node:tls';
import type { PairingConfig } from '@clawket/bridge-core';
import WebSocket, { type RawData } from 'ws';
import nacl from 'tweetnacl';
import {
  consumeSecurePairingAttempt,
  createSecurePairingBridgeProof,
  createSecurePairingClientProof,
  securePairingProofEquals,
} from '@clawket/bridge-core';
import {
  issueLegacyOpenClawBootstrapToken,
  issueOpenClawBootstrapToken,
  readOpenClawPermissions,
  readOpenClawInfo,
  runOpenClawDoctor,
  runOpenClawDoctorFix,
  type OpenClawInfo,
} from '../openclaw.js';
import {
  isConnectHandshakeRequest,
  parseConnectHandshakeMeta,
  parseConnectStartIdentity,
  parseControl,
  parsePairingRequestFromError,
  parsePairResolvedEvent,
  parseResponseEnvelopeMeta,
  normalizeBridgeVersion,
  normalizeConnectCapabilities,
  type PendingPairRequest,
} from '../protocol.js';
import {
  FRAME_TOO_LARGE_CLOSE_CODE,
  FRAME_TOO_LARGE_ERROR_CODE,
  getWebSocketFrameByteLength,
  isWebSocketMaxPayloadError,
  WEBSOCKET_FRAME_LIMIT_BYTES,
  type WebSocketFrameData,
} from '../frame-limit.js';
import { RelaySessionState } from '../relay-session.js';

type PendingGatewayMessage =
  | { kind: 'text'; text: string }
  | { kind: 'binary'; data: Buffer };

type PendingGatewayMessageSummary = {
  total: number;
  connectRequests: number;
  otherText: number;
  binary: number;
};

type InFlightConnectHandshake = {
  method: 'connect' | 'connect.start';
  bridgeCapabilitiesRequested: boolean;
  startedAtMs: number;
  slowWarningLogged: boolean;
  text: string;
  startupRetryCount: number;
};

export type ConnectedDevice = {
  id: string;
  label: string;
  state: 'connected' | 'recent';
  lastSeenMs: number;
};

export type BridgeRuntimeSnapshot = {
  running: boolean;
  relayConnected: boolean;
  gatewayConnected: boolean;
  gatewayId: string;
  instanceId: string;
  relayUrl: string;
  gatewayUrl: string;
  clientCount: number;
  connectedDevices: ConnectedDevice[];
  pendingPairRequests: PendingPairRequest[];
  lastError: string | null;
  lastUpdatedMs: number;
};

export type BridgeRuntimeOptions = {
  config: PairingConfig;
  gatewayUrl: string;
  bridgeVersion?: string;
  /** Additive owner negotiation; legacy runtime consumers retain the v1 wire. */
  clientChannels?: boolean;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  gatewayRetryDelayMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  connectHandshakeWarnDelayMs?: number;
  createWebSocket?: (url: string, options?: RuntimeSocketConnectOptions) => RuntimeSocket;
  issueLegacyOpenClawBootstrapToken?: typeof issueLegacyOpenClawBootstrapToken;
  issueOpenClawBootstrapToken?: typeof issueOpenClawBootstrapToken;
  onStatus?: (snapshot: BridgeRuntimeSnapshot) => void;
  onLog?: (line: string) => void;
  onPendingPairRequest?: (request: PendingPairRequest) => void;
};

type RuntimeSocket = Pick<
  WebSocket,
  'readyState' | 'send' | 'close' | 'terminate' | 'ping' | 'on' | 'once'
>;

type RuntimeSocketConnectOptions = {
  agent?: WebSocket.ClientOptions['agent'];
  handshakeTimeout?: number;
  headers?: Record<string, string>;
  maxPayload?: number;
  rejectUnauthorized?: boolean;
  checkServerIdentity?: (hostname: string, cert: PeerCertificate) => Error | undefined;
};

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 35_000;
const GATEWAY_RETRY_DELAY_MS = 1_200;
const GATEWAY_RETRY_MAX_DELAY_MS = 15_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 15_000;
const CONNECT_HANDSHAKE_WARN_DELAY_MS = 8_000;
const CHALLENGE_WAIT_TIMEOUT_MS = 8_000;
const MAX_PENDING_GATEWAY_MESSAGES = 256;
const MAX_DEVICE_DETAILS = 32;
const MAX_PENDING_PAIR_REQUESTS = 16;
export const BRIDGE_CAPABILITIES_V2 = 'bridge.capabilities.v2';
const OPENCLAW_GATEWAY_MIN_PROTOCOL_VERSION = 3;
const OPENCLAW_GATEWAY_MAX_PROTOCOL_VERSION = 4;
const STARTUP_SIDECARS_CONNECT_RETRY_MAX_ATTEMPTS = 4;
const STARTUP_SIDECARS_CONNECT_RETRY_DEFAULT_DELAY_MS = 750;
const STARTUP_SIDECARS_CONNECT_RETRY_MIN_DELAY_MS = 250;
const STARTUP_SIDECARS_CONNECT_RETRY_MAX_DELAY_MS = 3_000;
export const OPENCLAW_MOBILE_SETUP_CAPABILITY = 'openclaw.bootstrap.mobile-setup.v1';

export class BridgeRuntime {
  private readonly relayNetwork = relayNetworkOptions();
  private readonly clientRuntimes = new Map<string, BridgeRuntime>();
  private clientChannelsNegotiated = false;
  private relaySocket: RuntimeSocket | null = null;
  private gatewaySocket: RuntimeSocket | null = null;
  private relayConnecting = false;
  private gatewayConnecting = false;
  private stopped = true;
  private readonly relaySessionState = new RelaySessionState();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private gatewayRetryTimer: NodeJS.Timeout | null = null;
  private gatewayRetryAttempt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private challengeWaitTimer: NodeJS.Timeout | null = null;
  private bootstrapRequestsInFlight = 0;
  private pendingGatewayMessages: PendingGatewayMessage[] = [];
  private gatewayHandshakeStarted = false;
  private gatewayCloseBoundaryPending = false;
  private gatewayCloseExpected = false;
  private clientDemandStartedAtMs: number | null = null;
  private gatewayConnectedAtMs: number | null = null;
  private readonly inFlightConnectHandshakes = new Map<string, InFlightConnectHandshake>();
  private readonly bridgeVersion: string | undefined;
  private readonly snapshot: BridgeRuntimeSnapshot;

  constructor(private readonly options: BridgeRuntimeOptions, private readonly targetConnectionId?: string) {
    this.bridgeVersion = normalizeBridgeVersion(options.bridgeVersion);
    this.snapshot = {
      running: false,
      relayConnected: false,
      gatewayConnected: false,
      gatewayId: options.config.gatewayId,
      instanceId: options.config.instanceId,
      relayUrl: options.config.relayUrl,
      gatewayUrl: options.gatewayUrl,
      clientCount: 0,
      connectedDevices: [],
      pendingPairRequests: [],
      lastError: null,
      lastUpdatedMs: Date.now(),
    };
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.updateSnapshot({ running: true, gatewayUrl: this.options.gatewayUrl });
    this.log(
      `runtime starting gatewayId=${this.options.config.gatewayId} ` +
      `instanceId=${this.options.config.instanceId} ` +
      `gatewayUrl=${redactGatewayWsUrl(this.options.gatewayUrl)}`,
    );
    void this.connectRelay();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimers();
    await this.stopClientRuntimes();
    this.relaySocket?.close();
    this.gatewaySocket?.close();
    this.relaySocket = null;
    this.gatewaySocket = null;
    this.pendingGatewayMessages = [];
    this.gatewayHandshakeStarted = false;
    this.gatewayCloseBoundaryPending = false;
    this.clientDemandStartedAtMs = null;
    this.gatewayConnectedAtMs = null;
    this.gatewayRetryAttempt = 0;
    this.inFlightConnectHandshakes.clear();
    this.relayConnecting = false;
    this.gatewayConnecting = false;
    this.updateSnapshot({
      running: false,
      relayConnected: false,
      gatewayConnected: false,
      clientCount: 0,
      lastError: null,
    });
    this.log('runtime stopped');
    await delay(25);
  }

  async approvePairRequest(requestId: string): Promise<void> {
    const child = [...this.clientRuntimes.values()].find(runtime => runtime.getSnapshot().pendingPairRequests.some(request => request.requestId === requestId));
    if (child) { await child.approvePairRequest(requestId); return; }
    if (this.clientChannelsNegotiated && !this.targetConnectionId) {
      throw new Error('Pairing request is no longer available on a connected client channel');
    }
    this.sendGatewayRequest('device.pair.approve', { requestId });
    this.markPairRequestResolved(requestId, 'approved');
  }

  async rejectPairRequest(requestId: string): Promise<void> {
    const child = [...this.clientRuntimes.values()].find(runtime => runtime.getSnapshot().pendingPairRequests.some(request => request.requestId === requestId));
    if (child) { await child.rejectPairRequest(requestId); return; }
    if (this.clientChannelsNegotiated && !this.targetConnectionId) {
      throw new Error('Pairing request is no longer available on a connected client channel');
    }
    this.sendGatewayRequest('device.pair.reject', { requestId });
    this.markPairRequestResolved(requestId, 'rejected');
  }

  getSnapshot(): BridgeRuntimeSnapshot {
    return {
      ...this.snapshot,
      connectedDevices: [...this.snapshot.connectedDevices],
      pendingPairRequests: [...this.snapshot.pendingPairRequests],
    };
  }

  private async connectRelay(): Promise<void> {
    if (this.stopped || this.relayConnecting || this.isRelayOpen()) return;
    this.relayConnecting = true;
    const attempt = this.relaySessionState.beginConnectAttempt();
    const channelUrl = new URL(buildRelayWsUrl(this.options.config));
    if (this.targetConnectionId) channelUrl.searchParams.set('targetConnectionId', this.targetConnectionId);
    else if (this.options.clientChannels) channelUrl.searchParams.set('capabilities', 'bridge.client-sockets.v1');
    const relayUrl = channelUrl.toString();
    const relayHeaders = buildRelayWsHeaders(this.options.config);
    this.log(
      `relay connect attempt=${attempt} url=${redactRelayWsUrl(relayUrl)} ` +
      `authorization=${redactAuthorizationHeader(relayHeaders.Authorization)}`,
    );
    const relay = this.createWebSocket(relayUrl, {
      ...this.relayNetwork,
      headers: relayHeaders,
      maxPayload: WEBSOCKET_FRAME_LIMIT_BYTES,
    });
    this.relaySocket = relay;

    relay.once('open', () => {
      if (this.stopped || this.relaySocket !== relay) {
        relay.close();
        return;
      }
      this.relayConnecting = false;
      this.relaySessionState.observeActivity();
      this.updateSnapshot({ relayConnected: true, lastError: null });
      this.log(`relay connected attempt=${attempt}`);
      this.startHeartbeat();
      if (shouldKeepGatewayConnected(this.snapshot.clientCount, summarizePendingGatewayMessages(this.pendingGatewayMessages).connectRequests)) {
        this.ensureGatewayConnected();
      }
    });

    relay.on('message', (data: RawData, isBinary: boolean) => {
      if (this.relaySocket !== relay || this.stopped) return;
      void this.handleRelayMessage(data, isBinary);
    });

    relay.on('pong', () => {
      if (this.stopped || this.relaySocket !== relay) return;
      if (this.relaySessionState.confirmHealth()) {
        this.log('relay health confirmed; reconnect backoff reset');
      }
    });

    relay.once('unexpected-response', (_request: unknown, response: { statusCode?: number; destroy(): void }) => {
      if (this.relaySocket !== relay || this.stopped) { response.destroy(); return; }
      const status = response.statusCode;
      if (this.targetConnectionId && status === 409) {
        // This diagnostic socket identity cannot become valid again. The owner
        // will create a fresh child when it receives the next client incarnation.
        this.log('relay channel retired code=client_channel_unavailable httpStatus=409');
        void this.stop();
      } else {
        this.log(`relay upgrade rejected httpStatus=${status ?? 'unknown'}`);
        relay.terminate();
      }
      response.destroy();
    });

    relay.once('error', (error: Error) => {
      if (isWebSocketMaxPayloadError(error)) {
        this.log(
          `relay_in rejected code=${FRAME_TOO_LARGE_ERROR_CODE} ` +
          `limit=${WEBSOCKET_FRAME_LIMIT_BYTES} source=ws_max_payload`,
        );
        return;
      }
      this.log(`relay error: ${String(error)}`);
    });

    relay.once('close', (code: number, reason: Buffer) => {
      if (this.relaySocket !== relay) return;
      if (this.relaySocket === relay) {
        this.relaySocket = null;
      }
      this.relayConnecting = false;
      void this.stopClientRuntimes();
      this.clientChannelsNegotiated = false;
      this.stopHeartbeat();
      this.clientDemandStartedAtMs = null;
      this.gatewayConnectedAtMs = null;
      this.updateSnapshot({
        relayConnected: false,
        gatewayConnected: false,
        clientCount: 0,
        lastError: code === 1000 ? null : `relay closed: ${reason.toString() || code}`,
      });
      this.log(`relay disconnected code=${code} reason=${reason.toString() || '<none>'}`);
      this.closeGateway();
      this.scheduleRelayReconnect();
    });
  }

  private async stopClientRuntimes(): Promise<void> {
    const children = [...this.clientRuntimes.values()];
    this.clientRuntimes.clear();
    await Promise.all(children.map(child => child.stop()));
  }

  private async handleRelayMessage(data: RawData, isBinary: boolean): Promise<void> {
    const relay = this.relaySocket;
    if (relay && this.rejectOversizedFrame(relay, data, 'relay_in')) return;
    this.relaySessionState.observeActivity();
    if (isBinary) {
      this.forwardOrQueueGatewayMessage({ kind: 'binary', data: normalizeBinary(data) });
      return;
    }
    const text = normalizeText(data);
    if (text == null) return;
    const control = parseControl(text);
    if (control) {
      await this.handleRelayControl(control);
      return;
    }
    const identity = parseConnectStartIdentity(text);
    if (identity) {
      this.observeConnectStart(identity.id, identity.label);
    }
    this.forwardOrQueueGatewayMessage({ kind: 'text', text });
  }

  private async handleRelayControl(control: {
    event: string;
    requestId?: string;
    payload?: Record<string, unknown>;
    sourceClientId?: string;
    targetClientId?: string;
    count?: number;
  }): Promise<void> {
    if (control.event === 'client.sockets' && this.options.clientChannels && !this.targetConnectionId) {
      const ids = control.payload?.clients;
      if (!Array.isArray(ids) || ids.length > 128 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id))) return;
      this.clientChannelsNegotiated = true;
      this.closeGateway();
      for (const [id, child] of this.clientRuntimes) {
        if (!ids.includes(id)) {
          this.clientRuntimes.delete(id);
          void child.stop();
        }
      }
      for (const id of ids as string[]) {
        if (this.clientRuntimes.has(id)) continue;
        const child = new BridgeRuntime({
          ...this.options,
          onStatus: () => {
            if (!this.stopped) {
              const snapshots = [...this.clientRuntimes.values()].map(runtime => runtime.getSnapshot());
              this.updateSnapshot({
                gatewayConnected: snapshots.some(snapshot => snapshot.gatewayConnected),
                connectedDevices: snapshots.flatMap(snapshot => snapshot.connectedDevices).slice(-MAX_DEVICE_DETAILS),
                pendingPairRequests: snapshots.flatMap(snapshot => snapshot.pendingPairRequests).slice(-MAX_PENDING_PAIR_REQUESTS),
              });
            }
          },
          onLog: line => this.log(`channel=${id} ${line}`),
        }, id);
        this.clientRuntimes.set(id, child);
        child.start();
      }
      this.updateSnapshot({ clientCount: ids.length, lastError: null });
      this.log(`connection phase=client_channels count=${ids.length}`);
      return;
    }
    if (control.event === 'bootstrap.request') {
      await this.handleBootstrapRequest(control);
      return;
    }

    if (control.event === 'doctor.request') {
      await this.handleDoctorRequest(control);
      return;
    }

    if (control.event === 'doctor-fix.request') {
      await this.handleDoctorFixRequest(control);
      return;
    }

    if (control.event === 'permissions.request') {
      await this.handlePermissionsRequest(control);
      return;
    }

    if (control.event === 'pairing.secure.start') {
      this.handleSecurePairingRequest(control);
      return;
    }

    const { event, count } = control;
    if (this.clientChannelsNegotiated && ['client_connected', 'client_count', 'client_disconnected'].includes(event)) return;
    if (event === 'client_connected' || event === 'client_count') {
      const previousClientCount = this.snapshot.clientCount;
      const clientCount = count ?? Math.max(1, this.snapshot.clientCount);
      if (clientCount > 0 && this.clientDemandStartedAtMs == null) {
        this.clientDemandStartedAtMs = Date.now();
      }
      this.updateSnapshot({ clientCount });
      if (clientCount === 0) {
        this.clientDemandStartedAtMs = null;
        this.clearChallengeWait();
        this.gatewayHandshakeStarted = false;
        this.markDevicesRecent();
        this.dropStaleIdleGatewayQueue();
        const queuedConnectRequests = summarizePendingGatewayMessages(this.pendingGatewayMessages).connectRequests;
        if (shouldScheduleGatewayIdleClose(clientCount, queuedConnectRequests, this.isGatewayOpen())) {
          this.log('client demand dropped to zero; closing idle gateway');
          this.closeGateway();
        } else {
          this.log('client demand dropped to zero; gateway remains needed');
        }
      } else {
        if (shouldRecycleGatewayForFreshClient(previousClientCount, clientCount, this.isGatewayOpen(), false)) {
          const queued = summarizePendingGatewayMessages(this.pendingGatewayMessages);
          this.log(
            `gateway recycle requested for fresh client demand queued=${queued.total} ` +
            `connect=${queued.connectRequests} text=${queued.otherText} binary=${queued.binary} ` +
            `handshakeStarted=${this.gatewayHandshakeStarted}`,
          );
          const pruned = prunePendingGatewayMessagesForFreshDemand(this.pendingGatewayMessages);
          if (pruned.dropped > 0) {
            this.pendingGatewayMessages = pruned.messages;
            this.log(
              `dropped stale gateway queue before recycle dropped=${pruned.dropped} ` +
              `kept=${pruned.messages.length}`,
            );
          }
          this.closeGateway(true);
        }
        if (this.isGatewayOpen() && !this.gatewayCloseBoundaryPending) {
          this.updateSnapshot({ gatewayConnected: true, lastError: null });
          this.log(`gateway already connected sinceGatewayOpenMs=${this.elapsedSince(this.gatewayConnectedAtMs)} handshakeStarted=${this.gatewayHandshakeStarted}`);
        }
      }
      const queuedConnectRequests = summarizePendingGatewayMessages(this.pendingGatewayMessages).connectRequests;
      if (shouldKeepGatewayConnected(clientCount, queuedConnectRequests)) {
        this.ensureGatewayConnected();
      }
      return;
    }
    if (event === 'client_disconnected') {
      this.clientDemandStartedAtMs = null;
      this.clearChallengeWait();
      this.gatewayHandshakeStarted = false;
      this.updateSnapshot({ clientCount: 0 });
      this.markDevicesRecent();
      this.dropStaleIdleGatewayQueue();
      const queuedConnectRequests = summarizePendingGatewayMessages(this.pendingGatewayMessages).connectRequests;
      if (shouldScheduleGatewayIdleClose(0, queuedConnectRequests, this.isGatewayOpen())) {
        this.log('client disconnected; closing idle gateway');
        this.closeGateway();
      } else {
        this.log('client disconnected; gateway remains needed');
        if (shouldKeepGatewayConnected(0, queuedConnectRequests)) {
          this.ensureGatewayConnected();
        }
      }
      return;
    }
  }

  private async handleBootstrapRequest(control: {
    requestId?: string;
    payload?: Record<string, unknown>;
    sourceClientId?: string;
    targetClientId?: string;
  }): Promise<void> {
    const requestId = control.requestId?.trim() ?? '';
    const replyTargetClientId = control.sourceClientId?.trim() || control.targetClientId?.trim() || '';
    if (!requestId) {
      this.log('relay bootstrap request dropped reason=missing_request_id');
      return;
    }

    const parsed = parseBootstrapRequestPayload(control.payload);
    if (!parsed.ok) {
      this.log(`relay bootstrap request rejected requestId=${requestId} code=${parsed.code} reason=${parsed.message}`);
      this.sendRelayControl({
        event: 'bootstrap.error',
        requestId,
        targetClientId: replyTargetClientId || undefined,
        payload: {
          code: parsed.code,
          message: parsed.message,
        },
      });
      return;
    }

    const bootstrapStartedAt = Date.now();
    this.bootstrapRequestsInFlight += 1;
    this.clearChallengeWait();
    try {
      const { capabilities, ...bootstrapRequest } = parsed.value;
      const supportsMobileSetup = capabilities.includes(OPENCLAW_MOBILE_SETUP_CAPABILITY);
      const issueBootstrapToken = supportsMobileSetup
        ? this.options.issueOpenClawBootstrapToken ?? issueOpenClawBootstrapToken
        : this.options.issueLegacyOpenClawBootstrapToken ?? issueLegacyOpenClawBootstrapToken;
      const issued = await issueBootstrapToken({
        ...bootstrapRequest,
        gatewayUrl: this.options.gatewayUrl,
      });
      this.log(
        `relay bootstrap token issued requestId=${requestId} targetClientId=${replyTargetClientId || '<none>'} ` +
        `elapsedMs=${Date.now() - bootstrapStartedAt}`,
      );
      this.sendRelayControl({
        event: 'bootstrap.issued',
        requestId,
        targetClientId: replyTargetClientId || undefined,
        payload: {
          bootstrapToken: issued.token,
          expiresAtMs: issued.expiresAtMs,
          strategy: issued.strategy,
          ...(issued.access ? { access: issued.access } : {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`relay bootstrap token issue failed requestId=${requestId} error=${message}`);
      this.sendRelayControl({
        event: 'bootstrap.error',
        requestId,
        targetClientId: replyTargetClientId || undefined,
        payload: {
          code: 'bootstrap_issue_failed',
          message,
        },
      });
    } finally {
      this.bootstrapRequestsInFlight -= 1;
      this.startChallengeWait();
    }
  }

  private async handleDoctorRequest(control: {
    requestId?: string;
    sourceClientId?: string;
    targetClientId?: string;
  }): Promise<void> {
    const requestId = control.requestId?.trim() ?? '';
    const replyTargetClientId = control.sourceClientId?.trim() || control.targetClientId?.trim() || '';
    if (!requestId) {
      this.log('relay doctor request dropped reason=missing_request_id');
      return;
    }

    this.log(`relay doctor request received requestId=${requestId}`);
    try {
      const result = await runOpenClawDoctor();
      this.log(
        `relay doctor completed requestId=${requestId} ok=${result.ok} checks=${result.checks.length}`,
      );
      this.sendRelayControl({
        event: 'doctor.result',
        requestId,
        targetClientId: replyTargetClientId || undefined,
        payload: {
          ok: result.ok,
          checks: result.checks,
          summary: result.summary,
          raw: result.raw,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`relay doctor failed requestId=${requestId} error=${message}`);
      this.sendRelayControl({
        event: 'doctor.error',
        requestId,
        targetClientId: replyTargetClientId || undefined,
        payload: {
          code: 'doctor_failed',
          message,
        },
      });
    }
  }

  private async handleDoctorFixRequest(control: {
    requestId?: string;
    sourceClientId?: string;
    targetClientId?: string;
  }): Promise<void> {
    const requestId = control.requestId?.trim() ?? '';
    const replyTargetClientId = control.sourceClientId?.trim() || control.targetClientId?.trim() || '';
    if (!requestId) {
      this.log('relay doctor-fix request dropped reason=missing_request_id');
      return;
    }

    this.log(`relay doctor-fix request received requestId=${requestId}`);
    try {
      const result = await runOpenClawDoctorFix();
      this.log(
        `relay doctor-fix completed requestId=${requestId} ok=${result.ok}`,
      );
      this.sendRelayControl({
        event: 'doctor-fix.result',
        requestId,
        targetClientId: replyTargetClientId || undefined,
        payload: {
          ok: result.ok,
          summary: result.summary,
          raw: result.raw,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`relay doctor-fix failed requestId=${requestId} error=${message}`);
      this.sendRelayControl({
        event: 'doctor-fix.error',
        requestId,
        targetClientId: replyTargetClientId || undefined,
        payload: {
          code: 'doctor_fix_failed',
          message,
        },
      });
    }
  }

  private async handlePermissionsRequest(control: {
    requestId?: string;
    sourceClientId?: string;
    targetClientId?: string;
  }): Promise<void> {
    const requestId = control.requestId?.trim() ?? '';
    const replyTargetClientId = control.sourceClientId?.trim() || control.targetClientId?.trim() || '';
    if (!requestId) {
      this.log('relay permissions request dropped reason=missing_request_id');
      return;
    }

    this.log(`relay permissions request received requestId=${requestId}`);
    try {
      const result = await readOpenClawPermissions();
      this.log(
        `relay permissions completed requestId=${requestId} execStatus=${result.exec.status} webStatus=${result.web.status}`,
      );
      this.sendRelayControl({
        event: 'permissions.result',
        requestId,
        targetClientId: replyTargetClientId || undefined,
        payload: result as unknown as Record<string, unknown>,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`relay permissions failed requestId=${requestId} error=${message}`);
      this.sendRelayControl({
        event: 'permissions.error',
        requestId,
        targetClientId: replyTargetClientId || undefined,
        payload: {
          code: 'permissions_failed',
          message,
        },
      });
    }
  }

  private forwardOrQueueGatewayMessage(message: PendingGatewayMessage): void {
    const isConnectHandshake = message.kind === 'text' && isConnectHandshakeRequest(message.text);
    if (this.gatewayCloseBoundaryPending) {
      this.pushPendingGatewayMessage(message);
      if (isConnectHandshake) {
        this.log('gateway unavailable during connect handshake; queued until gateway reconnects');
      }
      return;
    }
    const gateway = this.gatewaySocket;
    if (!gateway || gateway.readyState !== WebSocket.OPEN) {
      this.ensureGatewayConnected();
      this.pushPendingGatewayMessage(message);
      if (isConnectHandshake) {
        this.log('gateway unavailable during connect handshake; queued until gateway reconnects');
      }
      return;
    }
    if (!this.gatewayHandshakeStarted) {
      if (!isConnectHandshake) {
        this.pushPendingGatewayMessage(message);
        return;
      }
      this.gatewayHandshakeStarted = true;
      const meta = parseConnectHandshakeMeta(message.text);
      this.log(
        `gateway handshake started queued=${this.pendingGatewayMessages.length}` +
        formatConnectHandshakeMetaForLog(meta),
      );
    }
    this.sendToGateway(message);
  }

  private ensureGatewayConnected(): void {
    if (
      this.stopped
      || !this.isRelayOpen()
      || this.gatewayConnecting
      || this.isGatewayOpen()
      || this.gatewayCloseBoundaryPending
    ) return;
    this.gatewayConnecting = true;
    this.log(`gateway connect start url=${redactGatewayWsUrl(this.options.gatewayUrl)}`);
    const gateway = this.createWebSocket(this.options.gatewayUrl);
    this.gatewaySocket = gateway;

    gateway.once('open', () => {
      if (this.stopped || this.gatewaySocket !== gateway) {
        gateway.close();
        return;
      }
      this.gatewayConnecting = false;
      this.gatewayHandshakeStarted = false;
      this.gatewayCloseBoundaryPending = false;
      this.gatewayCloseExpected = false;
      this.gatewayConnectedAtMs = Date.now();
      this.updateSnapshot({ gatewayConnected: true, lastError: null });
      this.log(`gateway connected sinceClientDemandMs=${this.elapsedSince(this.clientDemandStartedAtMs)}`);
      this.flushPendingGatewayMessages();
    });

    gateway.on('message', (data: RawData, isBinary: boolean) => {
      if (this.gatewaySocket !== gateway || this.stopped) return;
      this.handleGatewayMessage(data, isBinary);
    });

    gateway.once('error', (error: Error) => {
      if (isWebSocketMaxPayloadError(error)) {
        this.log(
          `gateway_in rejected code=${FRAME_TOO_LARGE_ERROR_CODE} ` +
          `limit=${WEBSOCKET_FRAME_LIMIT_BYTES} source=ws_max_payload`,
        );
        return;
      }
      this.log(`gateway error: ${String(error)}`);
    });

    gateway.once('close', (code: number, reason: Buffer) => {
      if (this.gatewaySocket !== gateway) return;
      this.clearChallengeWait();
      const wasExpectedClose = this.gatewayCloseExpected;
      const queuedConnectRequests = summarizePendingGatewayMessages(this.pendingGatewayMessages).connectRequests;
      const reconnectAfterClose = this.gatewayCloseBoundaryPending
        && shouldKeepGatewayConnected(this.snapshot.clientCount, queuedConnectRequests);
      if (this.gatewaySocket === gateway) {
        this.gatewaySocket = null;
      }
      this.gatewayConnecting = false;
      this.gatewayHandshakeStarted = false;
      this.gatewayCloseBoundaryPending = false;
      this.gatewayCloseExpected = false;
      this.gatewayConnectedAtMs = null;
      this.clearInFlightConnectHandshakes(`gateway disconnected code=${code}`);
      this.updateSnapshot({
        gatewayConnected: false,
        lastError: code === 1000 || reconnectAfterClose
          ? this.snapshot.lastError
          : `gateway closed: ${reason.toString() || code}`,
      });
      this.log(`gateway disconnected code=${code} reason=${reason.toString() || '<none>'} sinceClientDemandMs=${this.elapsedSince(this.clientDemandStartedAtMs)}`);
      if (!wasExpectedClose && this.snapshot.clientCount > 0) {
        this.sendRelayControl({
          event: 'client.reconnect-required',
          payload: { reason: 'gateway_closed' },
        });
      }
      if (reconnectAfterClose) {
        this.log('gateway close boundary reached; reconnecting for fresh demand');
        this.ensureGatewayConnected();
        return;
      }
      this.scheduleGatewayReconnect();
    });
  }

  private handleGatewayMessage(data: RawData, isBinary: boolean): void {
    const gateway = this.gatewaySocket;
    if (gateway && this.rejectOversizedFrame(gateway, data, 'gateway_in')) return;
    const relay = this.relaySocket;
    if (!relay || relay.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      this.sendFrame(relay, normalizeBinary(data), 'relay_out');
      return;
    }
    const text = normalizeText(data);
    if (text == null) return;
    // A missing connect request cannot be fixed by repeatedly opening only
    // the local socket: the Relay may still route challenges to a stale client.
    if (isGatewayChallenge(text)) {
      this.log(`connection phase=challenge_forwarded sinceGatewayOpenMs=${this.elapsedSince(this.gatewayConnectedAtMs)}`);
      this.startChallengeWait();
    }
    const pairReq = parsePairingRequestFromError(text);
    if (pairReq) {
      this.addPendingPairRequest(pairReq);
    }
    const resolved = parsePairResolvedEvent(text);
    if (resolved) {
      this.markPairRequestResolved(resolved.requestId, resolved.decision);
    }
    const response = parseResponseEnvelopeMeta(text);
    let relayText = text;
    if (response) {
      if (this.scheduleStartupSidecarsConnectRetry(response)) {
        return;
      }
      const pending = this.inFlightConnectHandshakes.get(response.id);
      if (response.ok && pending?.bridgeCapabilitiesRequested) {
        relayText = patchConnectResponseBridgeCapabilities(text, this.bridgeVersion).text;
      }
      this.observeGatewayResponse(response);
    }
    this.sendFrame(relay, relayText, 'relay_out');
  }

  private flushPendingGatewayMessages(): void {
    const gateway = this.gatewaySocket;
    if (!gateway || gateway.readyState !== WebSocket.OPEN) return;
    const deferred: PendingGatewayMessage[] = [];
    const queued = dedupePendingGatewayMessages(this.pendingGatewayMessages);
    if (queued.dropped > 0) {
      this.log(`dropped stale queued gateway messages before flush dropped=${queued.dropped} kept=${queued.messages.length}`);
    }
    this.pendingGatewayMessages = [];
    for (const message of queued.messages) {
      if (!this.gatewayHandshakeStarted) {
        if (message.kind !== 'text' || !isConnectHandshakeRequest(message.text)) {
          deferred.push(message);
          continue;
        }
        this.gatewayHandshakeStarted = true;
      }
      this.sendToGateway(message);
    }
    this.pendingGatewayMessages = deferred;
  }

  private sendToGateway(message: PendingGatewayMessage): void {
    const gateway = this.gatewaySocket;
    if (!gateway || gateway.readyState !== WebSocket.OPEN) {
      this.pushPendingGatewayMessage(message);
      return;
    }
    if (message.kind === 'text') {
      const patched = patchOpenClawConnectRequest(message.text, readOpenClawInfo());
      const meta = parseConnectHandshakeMeta(patched.text);
      if (meta) {
        this.clearChallengeWait();
        if (meta.id) {
          this.inFlightConnectHandshakes.set(meta.id, {
            method: meta.method,
            bridgeCapabilitiesRequested: patched.bridgeCapabilitiesRequested,
            startedAtMs: Date.now(),
            slowWarningLogged: false,
            text: patched.text,
            startupRetryCount: 0,
          });
        }
        this.log(`gateway connect request forwarded${formatConnectHandshakeMetaForLog(meta)}`);
      }
      if (patched.authInjected) {
        this.log('gateway connect auth patched mode=password');
      }
      if (patched.protocolPatched) {
        this.log(
          `gateway connect protocol patched min=${OPENCLAW_GATEWAY_MIN_PROTOCOL_VERSION} max=${OPENCLAW_GATEWAY_MAX_PROTOCOL_VERSION}`,
        );
      }
      if (patched.bridgeMetaStripped) {
        this.log('gateway connect top-level meta stripped before OpenClaw Gateway');
      }
      if (patched.bridgeCapabilitiesRequested) {
        this.log(`gateway connect Bridge capability negotiated capability=${BRIDGE_CAPABILITIES_V2}`);
      }
      this.sendFrame(gateway, patched.text, 'gateway_out');
      return;
    }
    this.sendFrame(gateway, message.data, 'gateway_out');
  }

  private sendGatewayRequest(method: string, params: Record<string, unknown>): void {
    const payload = JSON.stringify({
      type: 'req',
      id: `bridge-${randomUUID()}`,
      method,
      params,
    });
    this.forwardOrQueueGatewayMessage({ kind: 'text', text: payload });
  }

  private handleSecurePairingRequest(control: {
    requestId?: string;
    payload?: Record<string, unknown>;
    sourceClientId?: string;
  }): void {
    const requestId = control.requestId?.trim() ?? '';
    const sourceClientId = control.sourceClientId?.trim() ?? '';
    const sessionId = typeof control.payload?.sessionId === 'string' ? control.payload.sessionId.trim() : '';
    const clientPublicKey = typeof control.payload?.clientPublicKey === 'string'
      ? control.payload.clientPublicKey.trim()
      : '';
    const clientProof = typeof control.payload?.clientProof === 'string' ? control.payload.clientProof.trim() : '';
    if (!requestId || !sourceClientId || !/^ps_[a-f0-9]{64}$/.test(sessionId)) return;
    if (!/^[A-Za-z0-9_-]{43}$/.test(clientPublicKey) || !/^[a-f0-9]{64}$/.test(clientProof)) {
      this.sendSecurePairingError(sourceClientId, requestId, 'invalid_request');
      return;
    }
    const state = consumeSecurePairingAttempt(sessionId);
    if (!state || state.gatewayId !== this.options.config.gatewayId) {
      this.sendSecurePairingError(sourceClientId, requestId, 'unavailable');
      return;
    }
    const expectedProof = createSecurePairingClientProof({
      codeKeyHex: state.codeKeyHex,
      sessionId,
      requestId,
      clientPublicKey,
    });
    if (!securePairingProofEquals(clientProof, expectedProof)) {
      this.sendSecurePairingError(sourceClientId, requestId, 'invalid_code');
      return;
    }
    try {
      const clientKeyBytes = Buffer.from(clientPublicKey, 'base64url');
      if (clientKeyBytes.length !== nacl.box.publicKeyLength) throw new Error('invalid client key');
      const bridgeKeys = nacl.box.keyPair();
      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      const ciphertext = nacl.box(
        Buffer.from(state.qrPayload, 'utf8'),
        nonce,
        clientKeyBytes,
        bridgeKeys.secretKey,
      );
      const bridgePublicKey = Buffer.from(bridgeKeys.publicKey).toString('base64url');
      const nonceValue = Buffer.from(nonce).toString('base64url');
      const ciphertextValue = Buffer.from(ciphertext).toString('base64url');
      const bridgeProof = createSecurePairingBridgeProof({
        codeKeyHex: state.codeKeyHex,
        sessionId,
        requestId,
        clientPublicKey,
        bridgePublicKey,
        nonce: nonceValue,
        ciphertext: ciphertextValue,
      });
      this.sendRelayControl({
        event: 'pairing.secure.result',
        requestId,
        targetClientId: sourceClientId,
        payload: {
          protocol: 2,
          sessionId,
          bridgePublicKey,
          nonce: nonceValue,
          ciphertext: ciphertextValue,
          bridgeProof,
        },
      });
      this.log(`secure pairing response sent requestId=${requestId}`);
    } catch {
      this.sendSecurePairingError(sourceClientId, requestId, 'handshake_failed');
    }
  }

  private sendSecurePairingError(targetClientId: string, requestId: string, code: string): void {
    this.sendRelayControl({
      event: 'pairing.secure.error',
      requestId,
      targetClientId,
      payload: { protocol: 2, code },
    });
  }

  private sendRelayControl(control: {
    event: string;
    requestId?: string;
    targetClientId?: string;
    payload?: Record<string, unknown>;
  }): void {
    const relay = this.relaySocket;
    if (!relay || relay.readyState !== WebSocket.OPEN) return;
    this.sendFrame(relay, `__clawket_relay_control__:${JSON.stringify({
      type: 'control',
      event: control.event,
      requestId: control.requestId,
      targetClientId: control.targetClientId,
      payload: control.payload,
    })}`, 'relay_out');
  }

  private closeGateway(reconnectAfterClose = false): void {
    this.clearChallengeWait();
    if (this.gatewayRetryTimer) {
      clearTimeout(this.gatewayRetryTimer);
      this.gatewayRetryTimer = null;
    }
    const queuedConnectRequests = summarizePendingGatewayMessages(this.pendingGatewayMessages).connectRequests;
    const shouldReconnectAfterClose = reconnectAfterClose
      && this.isRelayOpen()
      && shouldKeepGatewayConnected(this.snapshot.clientCount, queuedConnectRequests);
    const gateway = this.gatewaySocket;
    this.gatewayHandshakeStarted = false;
    this.gatewayConnectedAtMs = null;
    if (!gateway) {
      this.gatewayCloseBoundaryPending = false;
      this.gatewayConnecting = false;
      if (!shouldReconnectAfterClose) {
        this.gatewayRetryAttempt = 0;
      }
      if (shouldReconnectAfterClose) {
        this.ensureGatewayConnected();
      }
      return;
    }
    if (gateway.readyState === WebSocket.CLOSING) {
      this.gatewayCloseBoundaryPending = shouldReconnectAfterClose;
      return;
    }
    if (gateway.readyState === WebSocket.CLOSED) {
      if (this.gatewaySocket === gateway) {
        this.gatewaySocket = null;
      }
      this.gatewayCloseBoundaryPending = false;
      this.gatewayConnecting = false;
      if (!shouldReconnectAfterClose) {
        this.gatewayRetryAttempt = 0;
      }
      if (shouldReconnectAfterClose) {
        this.ensureGatewayConnected();
      }
      return;
    }
    this.gatewayCloseBoundaryPending = shouldReconnectAfterClose;
    this.gatewayCloseExpected = true;
    gateway.close();
  }

  private createWebSocket(url: string, options?: RuntimeSocketConnectOptions): RuntimeSocket {
    const gatewayTlsOptions = buildLocalGatewayTlsConnectOptions(url);
    const mergedOptions: RuntimeSocketConnectOptions = {
      ...gatewayTlsOptions,
      ...options,
      maxPayload: options?.maxPayload ?? WEBSOCKET_FRAME_LIMIT_BYTES,
    };
    if (this.options.createWebSocket) {
      return this.options.createWebSocket(url, mergedOptions);
    }
    const wsOptions: {
      maxPayload: number;
      agent?: WebSocket.ClientOptions['agent'];
      handshakeTimeout?: number;
      headers?: Record<string, string>;
      rejectUnauthorized?: boolean;
      checkServerIdentity?: never;
    } = {
      maxPayload: mergedOptions.maxPayload ?? WEBSOCKET_FRAME_LIMIT_BYTES,
      headers: mergedOptions.headers,
      agent: mergedOptions.agent,
      handshakeTimeout: mergedOptions.handshakeTimeout,
    };
    if (mergedOptions.rejectUnauthorized !== undefined) {
      wsOptions.rejectUnauthorized = mergedOptions.rejectUnauthorized;
    }
    if (mergedOptions.checkServerIdentity) {
      wsOptions.checkServerIdentity = mergedOptions.checkServerIdentity as never;
    }
    return new WebSocket(url, wsOptions);
  }

  private scheduleStartupSidecarsConnectRetry(response: {
    id: string;
    ok: boolean;
    errorCode: string | null;
    errorMessage: string | null;
    errorDetails: Record<string, unknown> | null;
    retryAfterMs: number | null;
  }): boolean {
    if (!isStartupSidecarsUnavailableResponse(response)) return false;
    const pending = this.inFlightConnectHandshakes.get(response.id);
    if (!pending) return false;
    if (pending.startupRetryCount >= STARTUP_SIDECARS_CONNECT_RETRY_MAX_ATTEMPTS) return false;

    const gateway = this.gatewaySocket;
    if (!gateway || gateway.readyState !== WebSocket.OPEN) return false;

    pending.startupRetryCount += 1;
    const delayMs = clampStartupSidecarsRetryDelayMs(
      response.retryAfterMs ?? STARTUP_SIDECARS_CONNECT_RETRY_DEFAULT_DELAY_MS,
    );
    this.log(
      `gateway connect startup-sidecars retry scheduled reqId=<redacted> ` +
      `delayMs=${delayMs} attempt=${pending.startupRetryCount}`,
    );
    setTimeout(() => {
      if (this.stopped) return;
      const current = this.inFlightConnectHandshakes.get(response.id);
      if (current !== pending) return;
      const activeGateway = this.gatewaySocket;
      if (!activeGateway || activeGateway.readyState !== WebSocket.OPEN) return;
      current.startedAtMs = Date.now();
      current.slowWarningLogged = false;
      if (!this.sendFrame(activeGateway, current.text, 'gateway_out')) return;
      this.log(
        `gateway connect startup-sidecars retry sent reqId=<redacted> ` +
        `attempt=${current.startupRetryCount}`,
      );
    }, delayMs);
    return true;
  }

  private rejectOversizedFrame(
    socket: RuntimeSocket,
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

  private sendFrame(socket: RuntimeSocket, data: WebSocketFrameData, direction: string): boolean {
    if (this.rejectOversizedFrame(socket, data, direction)) return false;
    socket.send(data as Parameters<RuntimeSocket['send']>[0]);
    return true;
  }

  private observeGatewayResponse(response: { id: string; ok: boolean; errorCode: string | null; errorMessage: string | null }): void {
    const pending = this.inFlightConnectHandshakes.get(response.id);
    if (!pending) return;
    this.inFlightConnectHandshakes.delete(response.id);
    if (response.ok) {
      this.gatewayRetryAttempt = 0;
    }
    const detail = response.ok
      ? 'ok=true'
      : `ok=false errorCode=${response.errorCode ?? '<none>'} errorMessage=${response.errorMessage ?? '<none>'}`;
    this.log(
      `gateway connect response reqId=<redacted> method=${pending.method} elapsedMs=${Date.now() - pending.startedAtMs} ${detail}`,
    );
  }

  private clearInFlightConnectHandshakes(reason: string): void {
    if (this.inFlightConnectHandshakes.size === 0) return;
    for (const [requestId, pending] of this.inFlightConnectHandshakes.entries()) {
      this.log(
        `gateway connect response missing reqId=<redacted> method=${pending.method} elapsedMs=${Date.now() - pending.startedAtMs} reason=${reason}`,
      );
    }
    this.inFlightConnectHandshakes.clear();
  }

  private scheduleRelayReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const base = this.options.reconnectBaseDelayMs ?? RECONNECT_BASE_DELAY_MS;
    const max = this.options.reconnectMaxDelayMs ?? RECONNECT_MAX_DELAY_MS;
    const delayMs = this.relaySessionState.reconnectDelayMs(base, max);
    this.log(`relay reconnect scheduled delayMs=${delayMs}`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectRelay();
    }, delayMs);
  }

  private scheduleGatewayReconnect(): void {
    const queuedConnectRequests = summarizePendingGatewayMessages(this.pendingGatewayMessages).connectRequests;
    if (
      this.stopped
      || this.gatewayRetryTimer
      || !this.isRelayOpen()
      || !shouldKeepGatewayConnected(this.snapshot.clientCount, queuedConnectRequests)
    ) return;
    const delayMs = this.options.gatewayRetryDelayMs ?? GATEWAY_RETRY_DELAY_MS;
    this.gatewayRetryAttempt += 1;
    const maxDelayMs = Math.max(delayMs, GATEWAY_RETRY_MAX_DELAY_MS);
    const retryDelayMs = Math.min(
      maxDelayMs,
      Math.round(delayMs * Math.pow(1.7, Math.max(0, this.gatewayRetryAttempt - 1))),
    );
    this.log(`gateway reconnect scheduled delayMs=${retryDelayMs} attempt=${this.gatewayRetryAttempt}`);
    this.gatewayRetryTimer = setTimeout(() => {
      this.gatewayRetryTimer = null;
      this.ensureGatewayConnected();
    }, retryDelayMs);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const intervalMs = this.options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    let lastTickMs = Date.now();
    this.heartbeatTimer = setInterval(() => {
      const nowMs = Date.now();
      const schedulerDelayMs = Math.max(0, nowMs - lastTickMs - intervalMs);
      lastTickMs = nowMs;
      const relay = this.relaySocket;
      if (!relay || relay.readyState !== WebSocket.OPEN) return;
      this.logSlowConnectHandshakes();
      const timeoutMs = this.options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
      if (this.relaySessionState.heartbeatTimedOut(timeoutMs)) {
        this.log(`relay heartbeat timed out idleMs=${this.relaySessionState.activityAgeMs(nowMs)} timeoutMs=${timeoutMs} schedulerDelayMs=${schedulerDelayMs} queued=${this.pendingGatewayMessages.length} socketKind=${this.targetConnectionId ? 'channel' : 'owner'}`);
        relay.terminate();
        return;
      }
      relay.ping();
    }, this.options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private logSlowConnectHandshakes(): void {
    if (this.inFlightConnectHandshakes.size === 0) return;
    const warnDelayMs = this.options.connectHandshakeWarnDelayMs ?? CONNECT_HANDSHAKE_WARN_DELAY_MS;
    const now = Date.now();
    for (const [requestId, pending] of this.inFlightConnectHandshakes.entries()) {
      const elapsedMs = now - pending.startedAtMs;
      if (pending.slowWarningLogged || elapsedMs < warnDelayMs) continue;
      pending.slowWarningLogged = true;
      this.log(
        `gateway connect still pending reqId=<redacted> method=${pending.method} elapsedMs=${elapsedMs}`,
      );
    }
  }

  private pushPendingGatewayMessage(message: PendingGatewayMessage): void {
    if (this.pendingGatewayMessages.length >= MAX_PENDING_GATEWAY_MESSAGES) {
      this.pendingGatewayMessages.shift();
    }
    this.pendingGatewayMessages.push(message);
  }

  private dropStaleIdleGatewayQueue(): void {
    const queued = summarizePendingGatewayMessages(this.pendingGatewayMessages);
    if (queued.total === 0 || queued.connectRequests > 0) return;
    this.pendingGatewayMessages = [];
    this.log(
      `dropped stale idle gateway queue total=${queued.total} ` +
      `text=${queued.otherText} binary=${queued.binary}`,
    );
  }

  private observeConnectStart(id: string, label: string): void {
    const now = Date.now();
    const map = new Map(this.snapshot.connectedDevices.map((item) => [item.id, { ...item }]));
    const existing = map.get(id) ?? {
      id,
      label,
      state: 'connected' as const,
      lastSeenMs: now,
    };
    existing.label = label;
    existing.state = 'connected';
    existing.lastSeenMs = now;
    map.set(id, existing);
    const connectedDevices = [...map.values()]
      .sort((a, b) => b.lastSeenMs - a.lastSeenMs)
      .slice(0, MAX_DEVICE_DETAILS);
    this.updateSnapshot({ connectedDevices });
  }

  private markDevicesRecent(): void {
    this.updateSnapshot({
      connectedDevices: this.snapshot.connectedDevices.map((item) => ({
        ...item,
        state: 'recent',
      })),
    });
  }

  private addPendingPairRequest(request: PendingPairRequest): void {
    if (this.snapshot.pendingPairRequests.some((item) => item.requestId === request.requestId)) return;
    const next = [...this.snapshot.pendingPairRequests, request].slice(-MAX_PENDING_PAIR_REQUESTS);
    this.updateSnapshot({ pendingPairRequests: next });
    this.options.onPendingPairRequest?.(request);
    this.log(`pair request pending requestId=${request.requestId} deviceId=${request.deviceId || '<unknown>'}`);
  }

  private markPairRequestResolved(requestId: string, decision: 'approved' | 'rejected' | 'unknown'): void {
    const next = this.snapshot.pendingPairRequests.map((item) => (
      item.requestId === requestId
        ? { ...item, status: decision === 'approved' || decision === 'rejected' ? decision : item.status }
        : item
    ));
    this.updateSnapshot({ pendingPairRequests: next });
    this.log(`pair request resolved requestId=${requestId} decision=${decision}`);
  }

  private updateSnapshot(patch: Partial<BridgeRuntimeSnapshot>): void {
    Object.assign(this.snapshot, patch, { lastUpdatedMs: Date.now() });
    this.options.onStatus?.(this.getSnapshot());
  }

  private log(line: string): void {
    this.options.onLog?.(sanitizeRuntimeLogLine(line));
  }

  private isRelayOpen(): boolean {
    return this.relaySocket?.readyState === WebSocket.OPEN;
  }

  private isGatewayOpen(): boolean {
    return this.gatewaySocket?.readyState === WebSocket.OPEN;
  }

  private startChallengeWait(): void {
    this.clearChallengeWait();
    const gateway = this.gatewaySocket;
    const relay = this.relaySocket;
    if (this.stopped || !this.isGatewayOpen() || !this.isRelayOpen()
      || this.gatewayHandshakeStarted || this.bootstrapRequestsInFlight > 0
      || this.snapshot.clientCount === 0) return;
    const startedAtMs = Date.now();
    this.challengeWaitTimer = setTimeout(() => {
      this.challengeWaitTimer = null;
      if (this.stopped || this.gatewaySocket !== gateway || this.relaySocket !== relay
        || this.gatewayHandshakeStarted || this.snapshot.clientCount === 0) return;
      this.log(`connection phase=challenge_wait code=connect_request_missing elapsedMs=${Date.now() - startedAtMs} action=relay_recycle`);
      // Closing the owner transport also resets routing on old Relay versions.
      // Keep the existing backoff; a socket open is not health evidence.
      relay?.terminate();
    }, CHALLENGE_WAIT_TIMEOUT_MS);
  }

  private clearChallengeWait(): void {
    if (this.challengeWaitTimer) clearTimeout(this.challengeWaitTimer);
    this.challengeWaitTimer = null;
  }

  private clearTimers(): void {
    this.clearChallengeWait();
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.gatewayRetryTimer) {
      clearTimeout(this.gatewayRetryTimer);
      this.gatewayRetryTimer = null;
    }
  }

  private elapsedSince(startedAtMs: number | null): number | null {
    return startedAtMs == null ? null : Math.max(0, Date.now() - startedAtMs);
  }
}

// Gateway lifecycle contract:
// 1. Open the local Gateway socket only while Relay has active client demand
//    or the bridge has queued connect handshakes to flush after a reconnect.
// 2. Close idle Gateway sockets once client demand drops to zero and there is
//    no queued work left to preserve.
// 3. When fresh client demand returns after an idle gap, recycle any still-open
//    Gateway socket so the next proxied connect handshake lands on a clean
//    OpenClaw session boundary.
// 4. While Gateway is reopening, keep proxied connect frames queued instead of
//    dropping them.
export function shouldKeepGatewayConnected(clientCount: number, pendingConnectRequests: number): boolean {
  return clientCount > 0 || pendingConnectRequests > 0;
}

export function shouldScheduleGatewayIdleClose(
  clientCount: number,
  pendingConnectRequests: number,
  gatewayConnected: boolean,
): boolean {
  return gatewayConnected && !shouldKeepGatewayConnected(clientCount, pendingConnectRequests);
}

export function shouldRecycleGatewayForFreshClient(
  previousClientCount: number,
  nextClientCount: number,
  gatewayConnected: boolean,
  hadPendingIdleClose: boolean,
): boolean {
  return gatewayConnected && nextClientCount > 0 && (previousClientCount === 0 || hadPendingIdleClose);
}

export function shouldDropStaleConnectAfterGatewayReopen(
  gatewayConnected: boolean,
  isConnectHandshake: boolean,
): boolean {
  return false;
}

export function summarizePendingGatewayMessages(messages: PendingGatewayMessage[]): PendingGatewayMessageSummary {
  const summary: PendingGatewayMessageSummary = {
    total: messages.length,
    connectRequests: 0,
    otherText: 0,
    binary: 0,
  };

  for (const message of messages) {
    if (message.kind === 'binary') {
      summary.binary += 1;
      continue;
    }
    if (isConnectHandshakeRequest(message.text)) {
      summary.connectRequests += 1;
      continue;
    }
    summary.otherText += 1;
  }

  return summary;
}

export function dedupePendingGatewayMessages(messages: PendingGatewayMessage[]): {
  messages: PendingGatewayMessage[];
  dropped: number;
} {
  let latestConnectIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.kind === 'text' && isConnectHandshakeRequest(message.text)) {
      latestConnectIndex = index;
      break;
    }
  }

  if (latestConnectIndex <= 0) {
    return { messages: [...messages], dropped: 0 };
  }

  const deduped = messages.filter((message, index) => (
    index >= latestConnectIndex || (message.kind !== 'text' || !isConnectHandshakeRequest(message.text))
  ));

  return {
    messages: deduped,
    dropped: messages.length - deduped.length,
  };
}

export function prunePendingGatewayMessagesForFreshDemand(messages: PendingGatewayMessage[]): {
  messages: PendingGatewayMessage[];
  dropped: number;
} {
  if (messages.length === 0) {
    return { messages: [], dropped: 0 };
  }

  let latestConnectIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.kind === 'text' && isConnectHandshakeRequest(message.text)) {
      latestConnectIndex = index;
      break;
    }
  }

  if (latestConnectIndex === -1) {
    return { messages: [], dropped: messages.length };
  }

  const kept = messages.slice(latestConnectIndex);
  return {
    messages: kept,
    dropped: messages.length - kept.length,
  };
}

export function patchConnectRequestGatewayAuth(
  text: string,
  openClawInfo: Pick<OpenClawInfo, 'authMode' | 'password'>,
): { text: string; injected: boolean } {
  if (openClawInfo.authMode !== 'password' || !openClawInfo.password) {
    return { text, injected: false };
  }

  try {
    const parsed = JSON.parse(text) as {
      type?: unknown;
      method?: unknown;
      params?: Record<string, unknown>;
    };
    if (parsed.type !== 'req' || (parsed.method !== 'connect' && parsed.method !== 'connect.start')) {
      return { text, injected: false };
    }

    const params = parsed.params && typeof parsed.params === 'object' ? { ...parsed.params } : {};
    const auth = params.auth && typeof params.auth === 'object'
      ? { ...(params.auth as Record<string, unknown>) }
      : {};
    const existingPassword = typeof auth.password === 'string' ? auth.password.trim() : '';
    if (existingPassword) {
      return { text, injected: false };
    }

    auth.password = openClawInfo.password;
    params.auth = auth;
    return {
      text: JSON.stringify({
        ...parsed,
        params,
      }),
      injected: true,
    };
  } catch {
    return { text, injected: false };
  }
}

export function patchOpenClawConnectRequest(
  text: string,
  openClawInfo: Pick<OpenClawInfo, 'authMode' | 'password'>,
): {
  text: string;
  authInjected: boolean;
  protocolPatched: boolean;
  bridgeMetaStripped: boolean;
  bridgeCapabilitiesRequested: boolean;
} {
  const bridgeMeta = stripConnectRequestBridgeMeta(text);
  const authPatched = patchConnectRequestGatewayAuth(bridgeMeta.text, openClawInfo);
  const protocolPatched = patchConnectRequestGatewayProtocolRange(authPatched.text);
  return {
    text: protocolPatched.text,
    authInjected: authPatched.injected,
    protocolPatched: protocolPatched.patched,
    bridgeMetaStripped: bridgeMeta.stripped,
    bridgeCapabilitiesRequested: bridgeMeta.bridgeCapabilitiesRequested,
  };
}

export function stripConnectRequestBridgeMeta(
  text: string,
): { text: string; stripped: boolean; bridgeCapabilitiesRequested: boolean } {
  try {
    const parsed = JSON.parse(text) as {
      type?: unknown;
      method?: unknown;
      meta?: unknown;
      params?: unknown;
    };
    if (parsed.type !== 'req' || (parsed.method !== 'connect' && parsed.method !== 'connect.start')) {
      return { text, stripped: false, bridgeCapabilitiesRequested: false };
    }
    const requestedViaCaps = isRuntimeRecord(parsed.params)
      && Array.isArray(parsed.params.caps)
      && normalizeConnectCapabilities(parsed.params.caps).includes(BRIDGE_CAPABILITIES_V2);
    if (!Object.prototype.hasOwnProperty.call(parsed, 'meta')) {
      return { text, stripped: false, bridgeCapabilitiesRequested: requestedViaCaps };
    }
    // Keep accepting the pre-release meta format while new clients use caps.
    const bridgeCapabilitiesRequested = requestedViaCaps || (isRuntimeRecord(parsed.meta)
      && Array.isArray(parsed.meta.capabilities)
      && normalizeConnectCapabilities(parsed.meta.capabilities).includes(BRIDGE_CAPABILITIES_V2));

    const { meta: _bridgeMeta, ...gatewayRequest } = parsed;
    return {
      text: JSON.stringify(gatewayRequest),
      stripped: true,
      bridgeCapabilitiesRequested,
    };
  } catch {
    return { text, stripped: false, bridgeCapabilitiesRequested: false };
  }
}

export function patchConnectResponseBridgeCapabilities(
  text: string,
  bridgeVersion?: string,
): { text: string; patched: boolean } {
  try {
    const parsed = JSON.parse(text) as {
      type?: unknown;
      id?: unknown;
      ok?: unknown;
      meta?: unknown;
    };
    if (parsed.type !== 'res' || typeof parsed.id !== 'string' || parsed.ok !== true) {
      return { text, patched: false };
    }
    const meta = isRuntimeRecord(parsed.meta) ? parsed.meta : {};
    const { bridgeVersion: _gatewayBridgeVersion, ...preservedMeta } = meta;
    const capabilities = normalizeConnectCapabilities(meta.capabilities);
    const normalizedBridgeVersion = normalizeBridgeVersion(bridgeVersion);
    if (!capabilities.includes(BRIDGE_CAPABILITIES_V2)) {
      capabilities.push(BRIDGE_CAPABILITIES_V2);
    }
    return {
      text: JSON.stringify({
        ...parsed,
        meta: {
          ...preservedMeta,
          capabilities,
          ...(normalizedBridgeVersion ? { bridgeVersion: normalizedBridgeVersion } : {}),
        },
      }),
      patched: true,
    };
  } catch {
    return { text, patched: false };
  }
}

export function patchConnectRequestGatewayProtocolRange(
  text: string,
): { text: string; patched: boolean } {
  try {
    const parsed = JSON.parse(text) as {
      type?: unknown;
      method?: unknown;
      params?: Record<string, unknown>;
    };
    if (parsed.type !== 'req' || (parsed.method !== 'connect' && parsed.method !== 'connect.start')) {
      return { text, patched: false };
    }

    const params = parsed.params && typeof parsed.params === 'object' ? { ...parsed.params } : {};
    const minProtocol = readGatewayProtocolVersion(params.minProtocol);
    const maxProtocol = readGatewayProtocolVersion(params.maxProtocol);
    if ((minProtocol != null && minProtocol > OPENCLAW_GATEWAY_MAX_PROTOCOL_VERSION)
      || (maxProtocol != null && maxProtocol > OPENCLAW_GATEWAY_MAX_PROTOCOL_VERSION)) {
      return { text, patched: false };
    }
    if (minProtocol === OPENCLAW_GATEWAY_MIN_PROTOCOL_VERSION
      && maxProtocol === OPENCLAW_GATEWAY_MAX_PROTOCOL_VERSION) {
      return { text, patched: false };
    }

    params.minProtocol = OPENCLAW_GATEWAY_MIN_PROTOCOL_VERSION;
    params.maxProtocol = OPENCLAW_GATEWAY_MAX_PROTOCOL_VERSION;
    return {
      text: JSON.stringify({
        ...parsed,
        params,
      }),
      patched: true,
    };
  } catch {
    return { text, patched: false };
  }
}

function readGatewayProtocolVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.trunc(value)
    : null;
}

function isRuntimeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildLocalGatewayTlsConnectOptions(url: string): Pick<
  RuntimeSocketConnectOptions,
  'rejectUnauthorized' | 'checkServerIdentity'
> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'wss:') {
      return {};
    }
    if (!isLoopbackHostname(parsed.hostname)) {
      return {};
    }
    const info = readOpenClawInfo();
    const expectedFingerprint = info.gatewayTlsFingerprint;
    if (!info.gatewayTlsEnabled || !expectedFingerprint) {
      return {};
    }
    return {
      rejectUnauthorized: false,
      checkServerIdentity: (_hostname: string, cert: PeerCertificate) => {
        const fingerprint = normalizeFingerprint(
          typeof cert?.fingerprint256 === 'string' ? cert.fingerprint256 : '',
        );
        if (!fingerprint) {
          return new Error('gateway tls fingerprint unavailable');
        }
        if (fingerprint !== expectedFingerprint) {
          return new Error('gateway tls fingerprint mismatch');
        }
        return undefined;
      },
    };
  } catch {
    return {};
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === '127.0.0.1'
    || normalized === 'localhost'
    || normalized === '::1'
    || normalized === '[::1]';
}

function normalizeFingerprint(input: string): string | null {
  const normalized = input.replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  return normalized ? normalized : null;
}

function formatConnectHandshakeMetaForLog(meta: {
  id: string | null;
  method: 'connect' | 'connect.start';
  minProtocol: number | null;
  maxProtocol: number | null;
  noncePresent: boolean;
  nonceLength: number | null;
  authFields: string[];
} | null): string {
  if (!meta) return '';
  return (
    ` method=${meta.method}` +
    ` reqId=${meta.id ? '<redacted>' : '<none>'}` +
    ` minProtocol=${meta.minProtocol ?? '<none>'}` +
    ` maxProtocol=${meta.maxProtocol ?? '<none>'}` +
    ` noncePresent=${meta.noncePresent}` +
    ` nonceLength=${meta.nonceLength ?? 0}` +
    ` authFields=${meta.authFields.length > 0 ? meta.authFields.join(',') : '<none>'}`
  );
}

function parseBootstrapRequestPayload(
  payload: Record<string, unknown> | undefined,
):
  | {
      ok: true;
      value: {
        deviceId: string;
        publicKey: string;
        role: string;
        scopes: string[];
        capabilities: string[];
      };
    }
  | { ok: false; code: string; message: string } {
  if (!payload) {
    return {
      ok: false,
      code: 'invalid_request',
      message: 'bootstrap.request payload is required',
    };
  }

  const deviceId = readRequiredString(payload.deviceId);
  const publicKey = readRequiredString(payload.publicKey);
  const role = readRequiredString(payload.role);
  const scopes = normalizeScopeList(payload.scopes);
  const capabilities = normalizeScopeList(payload.capabilities);

  if (!deviceId) {
    return { ok: false, code: 'invalid_request', message: 'payload.deviceId is required' };
  }
  if (!publicKey) {
    return { ok: false, code: 'invalid_request', message: 'payload.publicKey is required' };
  }
  if (!role) {
    return { ok: false, code: 'invalid_request', message: 'payload.role is required' };
  }
  if (scopes.length === 0) {
    return { ok: false, code: 'invalid_request', message: 'payload.scopes must contain at least one scope' };
  }

  return {
    ok: true,
    value: {
      deviceId,
      publicKey,
      role,
      scopes,
      capabilities,
    },
  };
}

function readRequiredString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeScopeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const scopes = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed) {
      scopes.add(trimmed);
    }
  }
  return [...scopes].sort();
}

export function buildRelayWsUrl(config: PairingConfig): string {
  const base = new URL(config.relayUrl);
  if (!base.pathname || base.pathname === '/') {
    base.pathname = '/ws';
  }
  base.searchParams.delete('token');
  base.searchParams.set('gatewayId', config.gatewayId);
  base.searchParams.set('role', 'gateway');
  base.searchParams.set('clientId', config.instanceId);
  return base.toString();
}

export function buildRelayWsHeaders(config: Pick<PairingConfig, 'relaySecret'>): Record<string, string> {
  return {
    Authorization: `Bearer ${config.relaySecret}`,
  };
}

function redactRelayWsUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.username) {
    parsed.username = '<redacted>';
  }
  if (parsed.password) {
    parsed.password = '<redacted>';
  }
  stripSensitiveSearchParams(parsed);
  return parsed.toString();
}

function redactAuthorizationHeader(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '<none>';
  return /^Bearer\s+/i.test(trimmed) ? 'Bearer <redacted>' : '<redacted>';
}

export function sanitizeRuntimeLogLine(line: string): string {
  return line
    .replace(
      /\b(instanceId|clientId|sourceClientId|targetClientId|deviceId|requestId|reqId|traceId)=([^\s]+)/g,
      '$1=<redacted>',
    )
    .replace(/\b(relay|client)=([^\s]+)/g, '$1=<redacted>')
    .replace(/\b(grs_[A-Za-z0-9_-]+|gct_[A-Za-z0-9_-]+)\b/g, '<redacted>');
}

function redactGatewayWsUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.username) {
    parsed.username = '<redacted>';
  }
  if (parsed.password) {
    parsed.password = '<redacted>';
  }
  parsed.hostname = '<redacted-host>';
  stripSensitiveSearchParams(parsed);
  return parsed.toString();
}

function stripSensitiveSearchParams(parsed: URL): void {
  const sensitiveKeys = ['token', 'password', 'gatewayId', 'clientId', 'requestId', 'reqId', 'traceId'];
  for (const key of sensitiveKeys) {
    parsed.searchParams.delete(key);
  }
}

function isStartupSidecarsUnavailableResponse(response: {
  ok: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  errorDetails: Record<string, unknown> | null;
}): boolean {
  if (response.ok || response.errorCode !== 'UNAVAILABLE') return false;
  if (response.errorDetails?.reason === 'startup-sidecars') return true;
  return response.errorMessage?.includes('startup-sidecars') === true;
}

function clampStartupSidecarsRetryDelayMs(value: number): number {
  return Math.max(
    STARTUP_SIDECARS_CONNECT_RETRY_MIN_DELAY_MS,
    Math.min(value, STARTUP_SIDECARS_CONNECT_RETRY_MAX_DELAY_MS),
  );
}

function normalizeText(data: RawData): string | null {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return null;
}

function normalizeBinary(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function isGatewayChallenge(text: string): boolean {
  try {
    const frame = JSON.parse(text);
    return frame?.type === 'event' && frame.event === 'connect.challenge';
  } catch {
    return false;
  }
}
