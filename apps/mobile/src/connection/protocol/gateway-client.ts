import type {
  DoctorResult,
  PermissionsReport,
  RepairResult,
} from '@clawket/agent-protocol';
import nacl from 'tweetnacl';
import type {
  ChannelsStatusResult,
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronListResult,
  CronRunsResult,
  DeviceIdentity,
  DevicePairListResult,
  GatewayBackendKind,
  GatewayConfig,
  NodeListResult,
  NodePairListResult,
  SessionInfo,
  SkillContentDetail,
  SkillStatusReport,
  ToolsCatalogResult,
} from '../../types';
import type {
  AgentCreateResult,
  AgentDeleteResult,
  AgentUpdateResult,
  AgentsListResult,
} from '../../types/agent';
import type {
  HermesCronJob,
  HermesCronJobUpsert,
  HermesCronOutputDetail,
  HermesCronOutputEntry,
} from '../../types/hermes-cron';
import type { CostSummary, UsageResult } from '../../types/usage';
import { APP_PACKAGE_VERSION } from '../../constants/app-version';
import {
  buildDeviceAuthPayload,
  bytesToBase64Url,
  ensureIdentity,
  generateId,
  hexToBytes,
  normalizeWsUrl,
} from '../../services/gateway-auth';
import { StorageService } from '../../services/storage';
import {
  getRuntimeClientId,
  getRuntimeDeviceFamily,
  getRuntimePlatform,
} from '../../utils/platform';
import {
  BaseWebSocketTransport,
  DirectWsTransport,
  RelayWsTransport,
  type TransportStateChange,
} from '../transports';
import { routeGatewayEvent } from './events';
import {
  buildRelayClientWsUrl,
  buildRelayControlFrame,
  isRecord,
  OPENCLAW_MOBILE_SETUP_CAPABILITY,
  parseRelayControlFrame,
  readBootstrapCredential,
  readRelayControlError,
  readString,
  RELAY_CONTROL_PREFIX,
  relaySupportsBootstrapV2,
  selectConnectAuth,
  type RelayBootstrapCredential,
  type RelayConnectAuthSelection,
  type RelayControlFrame,
} from './relay-control';
import {
  GatewayRequestError,
  type DeviceTokenRecord,
  type DeviceTokenStorageScope,
  type GatewayInfo,
  type GatewayProtocolClientOptions,
  type GatewayProtocolEvents,
  type GatewayProtocolListener,
} from './types';

const MIN_PROTOCOL_VERSION = 3;
const PROTOCOL_VERSION = 4;
const REQUEST_TIMEOUT_MS = 15_000;
const CONNECT_REQUEST_TIMEOUT_MS = 8_000;
const HANDSHAKE_TIMEOUT_MS = 20_000;
const HERMES_FIRST_HEALTH_TIMEOUT_MS = 8_000;
const RELAY_BOOTSTRAP_TIMEOUT_MS = 12_000;
const RELAY_CONTROL_TIMEOUT_MS = 30_000;

const DEFAULT_CONNECT_SCOPES = Object.freeze([
  'operator.admin',
  'operator.approvals',
  'operator.pairing',
  'operator.questions',
  'operator.read',
  'operator.talk.secrets',
  'operator.write',
]);

const CLIENT_COMMANDS = Object.freeze([
  'canvas.present',
  'canvas.hide',
  'canvas.navigate',
  'canvas.eval',
  'canvas.snapshot',
]);

type PendingRequest = {
  epoch: number;
  method: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
};

type PendingControl = {
  resultEvent: string;
  errorEvent: string;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (control: RelayControlFrame) => void;
  reject: (error: Error) => void;
};

type ConnectPlan = {
  auth: RelayConnectAuthSelection;
  role: 'operator' | 'node';
  scopes: string[];
  storedRecord: DeviceTokenRecord | null;
};

type ConnectResponse = {
  server?: { version?: string; connId?: string };
  features?: {
    methods?: string[];
    events?: string[];
    capabilities?: string[];
  };
  auth?: {
    deviceToken?: string;
    role?: string;
    scopes?: string[];
    deviceTokens?: Array<{ deviceToken?: string; role?: string; scopes?: string[] }>;
  };
  policy?: { tickIntervalMs?: number };
  snapshot?: {
    uptimeMs?: number;
    presence?: Array<{ host?: string; ip?: string; platform?: string }>;
    authMode?: string;
    updateAvailable?: { currentVersion: string; latestVersion: string };
  };
};

type GatewayModelInfo = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

type GatewayModelSelectionState = {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  models: GatewayModelInfo[];
  providers?: Array<{
    slug: string;
    name: string;
    isCurrent: boolean;
    models: string[];
    totalModels: number;
    source?: string;
    apiUrl?: string;
  }>;
  note?: string | null;
};

type GatewayModelSelectionWriteResult = GatewayModelSelectionState & {
  ok: boolean;
  scope: 'global';
};

type GatewayAgentFileSummary = {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
};

type GatewayAgentFileDetail = GatewayAgentFileSummary & { content?: string };

const defaultCredentialStore = {
  getDeviceTokenRecord: (
    deviceId: string,
    scope?: DeviceTokenStorageScope,
  ): Promise<DeviceTokenRecord | null> => StorageService.getDeviceTokenRecord(deviceId, scope),
  setDeviceTokenRecord: (
    deviceId: string,
    record: DeviceTokenRecord,
    scope?: DeviceTokenStorageScope,
  ): Promise<void> => StorageService.setDeviceTokenRecord(deviceId, record, scope),
  deleteDeviceToken: (
    deviceId: string,
    scope?: DeviceTokenStorageScope,
  ): Promise<void> => StorageService.deleteDeviceToken(deviceId, scope),
};

/**
 * Backend protocol lifecycle above the backend-neutral WebSocket transports.
 * It owns OpenClaw device auth and Hermes first-health readiness, but no UI or
 * adapter selection.
 */
export class GatewayProtocolClient {
  private config: GatewayConfig | null = null;
  private state: import('../../types').ConnectionState = 'idle';
  private route: 'direct' | 'relay' = 'direct';
  private transport: BaseWebSocketTransport | null = null;
  private transportUnsubscribers: Array<() => void> = [];
  private readonly listeners = createListenerStore();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly pendingControls = new Map<string, PendingControl>();
  private readonly options: GatewayProtocolClientOptions;
  private readonly identityProvider: () => Promise<DeviceIdentity>;
  private readonly requestId: () => string;
  private readonly now: () => number;
  private epoch = 0;
  private handshakeSerial = 0;
  private manuallyClosed = false;
  private pairingPending = false;
  private connectRequestInFlight = false;
  private connectRequestCompleted = false;
  private bootstrapDisabledForConfig = false;
  private readinessTimer: ReturnType<typeof setTimeout> | null = null;
  private identity: DeviceIdentity | null = null;
  private connectRequestMeta: { capabilities: string[] } | undefined;
  private connectResponseCapabilities: readonly string[] | undefined;
  private supportedMethods = new Set<string>();
  private gatewayInfo: GatewayInfo | null = null;

  constructor(options: GatewayProtocolClientOptions = {}) {
    this.options = options;
    this.identityProvider = options.identityProvider ?? ensureIdentity;
    this.requestId = options.requestId ?? generateId;
    this.now = options.now ?? Date.now;
  }

  public configure(config: GatewayConfig | null): void {
    const changed = !sameGatewayConfig(this.config, config);
    this.config = config;
    this.route = resolveRoute(config);
    if (!changed) return;
    this.epoch += 1;
    this.handshakeSerial += 1;
    this.bootstrapDisabledForConfig = false;
    this.connectResponseCapabilities = undefined;
    this.supportedMethods.clear();
    this.gatewayInfo = null;
    this.clearReadinessTimer();
    this.rejectPendingRequests('Configuration changed', 'connection_restarted');
    this.rejectPendingControls('Configuration changed');
    if (this.transport) {
      this.stopTransport('Configuration changed');
      this.setState(config ? 'closed' : 'idle', 'Configuration changed');
    } else if (this.state !== 'idle') {
      this.setState(config ? 'closed' : 'idle', 'Configuration changed');
    } else if (!config) {
      this.setState('idle');
    }
  }

  public getConnectionState(): import('../../types').ConnectionState {
    return this.state;
  }

  public getConnectionRoute(): 'direct' | 'relay' {
    return this.route;
  }

  public getGatewayInfo(): GatewayInfo | null {
    return this.gatewayInfo ? { ...this.gatewayInfo } : null;
  }

  public getBackendKind(): 'openclaw' | 'hermes' {
    return resolveBackendKind(this.config);
  }

  public getBaseUrl(): string | null {
    const raw = this.config?.url?.trim();
    if (!raw) return null;
    const pattern = this.getBackendKind() === 'hermes' ? /\/v1\/hermes\/ws\/?$/ : /\/ws\/?$/;
    try {
      const url = new URL(raw.replace(/^ws(s?):\/\//, 'http$1://'));
      url.hash = '';
      url.search = '';
      url.pathname = url.pathname.replace(pattern, '') || '/';
      return url.toString().replace(/\/+$/, '');
    } catch {
      return raw.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/+$/, '').replace(pattern, '');
    }
  }

  public on<K extends keyof GatewayProtocolEvents>(
    event: K,
    listener: GatewayProtocolListener<GatewayProtocolEvents[K]>,
  ): () => void {
    const set = this.listeners[event] as Set<GatewayProtocolListener<GatewayProtocolEvents[K]>>;
    set.add(listener);
    return () => set.delete(listener);
  }

  public setConnectRequestMeta(meta?: { capabilities: string[] }): void {
    this.connectRequestMeta = meta
      ? { capabilities: normalizeStrings(meta.capabilities) }
      : undefined;
  }

  public getConnectResponseCapabilities(): readonly string[] | undefined {
    return this.connectResponseCapabilities
      ? [...this.connectResponseCapabilities]
      : undefined;
  }

  public async getDeviceIdentity(): Promise<DeviceIdentity> {
    const identity = this.identity ?? await this.identityProvider();
    this.identity = identity;
    return identity;
  }

  public connect(): void {
    if (!this.config?.url?.trim()) {
      this.emit('error', { code: 'config_missing', message: 'Gateway URL is not configured' });
      return;
    }
    if (this.transport && this.state !== 'closed' && this.state !== 'idle') return;
    this.manuallyClosed = false;
    this.pairingPending = false;
    const epoch = ++this.epoch;
    this.setState('connecting');
    void this.startTransport(epoch);
  }

  public disconnect(): void {
    this.manuallyClosed = true;
    this.pairingPending = false;
    this.epoch += 1;
    this.handshakeSerial += 1;
    this.clearReadinessTimer();
    this.rejectPendingRequests('Connection closed', 'connection_closed');
    this.rejectPendingControls('Connection closed');
    this.stopTransport('Connection closed');
    this.setState('closed');
  }

  public reconnect(): void {
    if (!this.config?.url?.trim()) {
      this.emit('error', { code: 'config_missing', message: 'Gateway URL is not configured' });
      return;
    }
    this.manuallyClosed = false;
    this.pairingPending = false;
    this.connectRequestCompleted = false;
    this.connectRequestInFlight = false;
    this.connectResponseCapabilities = undefined;
    this.handshakeSerial += 1;
    this.clearReadinessTimer();
    this.rejectPendingRequests('Connection restarted', 'connection_restarted');
    this.rejectPendingControls('Connection restarted');
    if (this.transport) {
      this.setState('reconnecting');
      this.transport.reconnect();
    } else {
      this.connect();
    }
  }

  public async probeConnection(timeoutMs = 5_000): Promise<boolean> {
    if (this.manuallyClosed) return false;
    if (this.state === 'ready' && this.transport?.isSocketOpen) {
      try {
        await this.sendRequest('health', {}, timeoutMs);
        return true;
      } catch {
        this.reconnect();
        return this.waitForReady(Math.max(timeoutMs, 8_000));
      }
    }
    if (this.state === 'idle' || this.state === 'closed') this.connect();
    return this.waitForReady(Math.max(timeoutMs, 8_000));
  }

  public async request<T = unknown>(method: string, params?: object): Promise<T> {
    return this.sendRequest<T>(method, params ?? {});
  }

  private async startTransport(epoch: number): Promise<void> {
    try {
      const config = this.config;
      if (!config || epoch !== this.epoch || this.manuallyClosed) return;
      const identity = await this.getDeviceIdentity();
      if (epoch !== this.epoch || this.manuallyClosed) return;
      const route = resolveRoute(config);
      const url = route === 'relay'
        ? buildConfiguredRelayUrl(config, identity.deviceId, this.getBackendKind())
        : normalizeWsUrl(config.url);
      const shared = {
        url,
        webSocketFactory: this.options.webSocketFactory,
        reconnectBaseMs: this.options.reconnectBaseMs,
        reconnectMaxMs: this.options.reconnectMaxMs,
        reconnectFactor: this.options.reconnectFactor,
        reconnectJitter: this.options.reconnectJitter,
        openTimeoutMs: this.options.openTimeoutMs,
        random: this.options.random,
      };
      const transport = route === 'relay'
        ? new RelayWsTransport({ ...shared, handshakeTimeoutMs: this.options.handshakeTimeoutMs })
        : new DirectWsTransport({
            ...shared,
            firstFrameTimeoutMs: this.options.directFirstFrameTimeoutMs,
            autoReadyOnFirstFrame: false,
          });
      if (epoch !== this.epoch || this.manuallyClosed) {
        transport.disconnect();
        return;
      }
      this.route = route;
      this.installTransport(transport, epoch);
      transport.connect();
    } catch (error) {
      if (epoch !== this.epoch || this.manuallyClosed) return;
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', { code: 'connection_failed', message, retryable: true });
      this.setState('closed', message);
    }
  }

  private installTransport(transport: BaseWebSocketTransport, epoch: number): void {
    this.stopTransport();
    this.transport = transport;
    this.transportUnsubscribers = [
      transport.onStateChange((change) => this.handleTransportState(change, epoch)),
      transport.onOpen(() => this.handleTransportOpen(epoch)),
      transport.onMessage((raw) => this.handleTransportMessage(raw, epoch)),
      transport.onError((error) => {
        if (epoch !== this.epoch || this.manuallyClosed) return;
        this.emit('error', {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        });
      }),
      transport.onClose((event) => {
        if (epoch !== this.epoch || this.manuallyClosed) return;
        const reason = event.reason || 'Connection closed';
        this.rejectPendingRequests(reason, closeErrorCode(event.code));
        this.rejectPendingControls(reason);
      }),
    ];
  }

  private handleTransportState(change: TransportStateChange, epoch: number): void {
    if (epoch !== this.epoch || this.manuallyClosed) return;
    if (change.state === 'connecting') {
      this.setState(change.reconnectAttempt > 0 ? 'reconnecting' : 'connecting', change.reason);
      return;
    }
    if (change.state === 'handshaking') {
      this.setState(this.pairingPending ? 'pairing_pending' : 'challenging', change.reason);
      return;
    }
    if (change.state === 'ready') {
      this.clearReadinessTimer();
      this.setState('ready', change.reason);
      return;
    }
    if (change.state === 'reconnecting') {
      this.handshakeSerial += 1;
      this.connectRequestInFlight = false;
      this.connectRequestCompleted = false;
      this.clearReadinessTimer();
      this.rejectPendingRequests(change.reason || 'Connection closed', 'connection_closed');
      this.rejectPendingControls(change.reason || 'Connection closed');
      this.setState(this.pairingPending ? 'pairing_pending' : 'reconnecting', change.reason);
      return;
    }
    if (change.state === 'closed') {
      this.clearReadinessTimer();
      this.rejectPendingRequests(change.reason || 'Connection closed', 'connection_closed');
      this.rejectPendingControls(change.reason || 'Connection closed');
      this.setState('closed', change.reason);
    }
  }

  private handleTransportOpen(epoch: number): void {
    if (epoch !== this.epoch || this.manuallyClosed) return;
    this.handshakeSerial += 1;
    this.connectRequestInFlight = false;
    this.connectRequestCompleted = false;
    this.connectResponseCapabilities = undefined;
    this.supportedMethods.clear();
    const serial = this.handshakeSerial;
    const timeoutMs = this.getBackendKind() === 'hermes'
      ? this.options.directFirstFrameTimeoutMs ?? HERMES_FIRST_HEALTH_TIMEOUT_MS
      : this.options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    this.startReadinessTimer(epoch, serial, timeoutMs);
  }

  private handleTransportMessage(raw: unknown, epoch: number): void {
    if (epoch !== this.epoch || this.manuallyClosed) return;
    if (typeof raw === 'string' && raw.startsWith(RELAY_CONTROL_PREFIX)) {
      const control = parseRelayControlFrame(raw);
      if (control) this.handleRelayControl(control, epoch);
      return;
    }

    let frame: unknown;
    try {
      frame = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      this.emit('error', { code: 'invalid_json', message: 'Failed to parse server message' });
      return;
    }
    if (!isRecord(frame)) return;
    if (frame.type === 'tick') {
      this.emit('tick', {});
      return;
    }
    if (frame.type === 'res') {
      this.handleResponseFrame(frame);
      return;
    }
    if (frame.type !== 'event' || typeof frame.event !== 'string') return;

    if (frame.event === 'connect.challenge') {
      if (this.getBackendKind() !== 'openclaw') return;
      if (this.connectRequestCompleted || this.connectRequestInFlight) return;
      this.connectRequestInFlight = true;
      const serial = this.handshakeSerial;
      void this.handleOpenClawChallenge(frame.payload, epoch, serial)
        .catch((error) => this.handleHandshakeFailure(error, epoch, serial))
        .finally(() => {
          if (epoch === this.epoch && serial === this.handshakeSerial) {
            this.connectRequestInFlight = false;
          }
        });
      return;
    }

    if (frame.event === 'health') {
      const hasHealthPayload = isRecord(frame.payload);
      const health: GatewayProtocolEvents['health'] = hasHealthPayload
        ? frame.payload as GatewayProtocolEvents['health']
        : {};
      if (this.getBackendKind() === 'hermes' && this.state !== 'ready') {
        if (hasHealthPayload && isHealthyHermesFrame(health)) {
          this.connectRequestCompleted = true;
          this.markTransportReady();
          this.emit('health', health);
        } else {
          this.emit('health', health);
          this.emit('error', {
            code: 'gateway_offline',
            message: 'Hermes did not respond to the Bridge health probe',
            retryable: true,
          });
          this.recycleTransport(epoch, this.handshakeSerial);
        }
      } else {
        this.emit('health', health);
      }
      return;
    }

    const routed = routeGatewayEvent(frame.event, frame.payload, this.emit.bind(this), this.now);
    if (routed.pairingApproved && this.pairingPending) {
      this.pairingPending = false;
      this.reconnect();
    }
  }

  private handleResponseFrame(frame: Record<string, unknown>): void {
    const id = readString(frame.id);
    if (!id) return;
    const pending = this.pendingRequests.get(id);
    if (!pending) return;
    this.pendingRequests.delete(id);
    clearTimeout(pending.timeout);
    if (pending.epoch !== this.epoch) {
      pending.reject(new GatewayRequestError({
        code: 'connection_restarted',
        message: 'Connection restarted',
        retryable: true,
      }));
      return;
    }
    if (frame.ok === true) {
      if (pending.method === 'connect') {
        const meta = isRecord(frame.meta) ? frame.meta : {};
        this.connectResponseCapabilities = normalizeStrings(meta.capabilities);
      }
      pending.resolve(frame.payload);
      return;
    }
    const error = isRecord(frame.error) ? frame.error : {};
    pending.reject(new GatewayRequestError({
      code: readString(error.code) ?? 'unknown',
      message: readString(error.message) ?? 'Request failed',
      details: error.details,
      retryable: typeof error.retryable === 'boolean' ? error.retryable : undefined,
      retryAfterMs: typeof error.retryAfterMs === 'number' ? error.retryAfterMs : undefined,
    }));
  }

  private async handleOpenClawChallenge(
    payload: unknown,
    epoch: number,
    serial: number,
  ): Promise<void> {
    const challenge = isRecord(payload) ? payload : {};
    const nonce = readString(challenge.nonce);
    const signedAt = challenge.ts;
    if (!nonce || !Number.isSafeInteger(signedAt) || (signedAt as number) < 0) {
      throw new GatewayRequestError({
        code: 'invalid_connect_challenge',
        message: 'Gateway returned an invalid connection challenge.',
      });
    }
    const identity = await this.getDeviceIdentity();
    this.assertCurrentHandshake(epoch, serial);
    const publicKey = bytesToBase64Url(hexToBytes(identity.publicKeyHex));
    const plan = await this.resolveConnectPlan(identity, publicKey, epoch, serial);
    this.assertCurrentHandshake(epoch, serial);
    const client = this.options.client ?? {
      id: getRuntimeClientId(),
      platform: getRuntimePlatform(),
      deviceFamily: getRuntimeDeviceFamily(),
      version: APP_PACKAGE_VERSION,
    };
    const clientMode = plan.role === 'node' ? 'node' : 'ui';
    const authPayload = buildDeviceAuthPayload({
      deviceId: identity.deviceId,
      clientId: client.id,
      clientMode,
      role: plan.role,
      scopes: plan.scopes,
      signedAtMs: signedAt as number,
      token: plan.auth.signatureToken,
      nonce,
      platform: client.platform,
      deviceFamily: client.deviceFamily,
    });
    const signature = nacl.sign.detached(
      new TextEncoder().encode(authPayload),
      hexToBytes(identity.secretKeyHex),
    );
    const params = {
      minProtocol: MIN_PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: client.id,
        displayName: client.displayName ?? 'Clawket',
        version: client.version,
        platform: client.platform,
        mode: clientMode,
        deviceFamily: client.deviceFamily,
      },
      caps: plan.role === 'node' ? [] : ['tool-events'],
      commands: plan.role === 'node' ? [] : [...CLIENT_COMMANDS],
      role: plan.role,
      scopes: plan.scopes,
      device: {
        id: identity.deviceId,
        publicKey,
        signature: bytesToBase64Url(signature),
        signedAt,
        nonce,
      },
      auth: plan.auth.auth,
    };
    const response = await this.sendRequest<ConnectResponse>(
      'connect',
      params,
      this.options.connectRequestTimeoutMs ?? CONNECT_REQUEST_TIMEOUT_MS,
      true,
    );
    this.assertCurrentHandshake(epoch, serial);

    const helloAuth = response?.auth;
    const responseRole = readString(helloAuth?.role) ?? plan.role;
    const responseScopes = normalizeStrings(helloAuth?.scopes);
    if (helloAuth?.deviceToken && responseRole === 'operator') {
      await this.persistDeviceToken(identity, helloAuth.deviceToken, responseRole, responseScopes);
      this.assertCurrentHandshake(epoch, serial);
    }
    if (plan.auth.source === 'bootstrap-token' && plan.auth.bootstrapStrategy === 'mobile-setup') {
      const operatorToken = helloAuth?.deviceTokens?.find((entry) => (
        entry.role === 'operator' && Boolean(readString(entry.deviceToken))
      ));
      if (!operatorToken?.deviceToken) {
        throw new GatewayRequestError({
          code: 'bootstrap_handoff_failed',
          message: 'Secure connection setup did not return an operator device token.',
        });
      }
      await this.persistDeviceToken(
        identity,
        operatorToken.deviceToken,
        'operator',
        normalizeStrings(operatorToken.scopes),
      );
      this.assertCurrentHandshake(epoch, serial);
      this.reconnect();
      return;
    }

    this.supportedMethods = new Set(normalizeStrings(response?.features?.methods));
    const presence = response?.snapshot?.presence?.[0];
    this.gatewayInfo = {
      version: response?.server?.version ?? '',
      connId: response?.server?.connId ?? '',
      uptimeMs: response?.snapshot?.uptimeMs ?? 0,
      host: presence?.host,
      ip: presence?.ip,
      platform: presence?.platform,
      authMode: response?.snapshot?.authMode,
      updateAvailable: response?.snapshot?.updateAvailable,
    };
    if (
      this.transport instanceof RelayWsTransport
      && typeof response?.policy?.tickIntervalMs === 'number'
      && response.policy.tickIntervalMs > 0
    ) {
      this.transport.configureHeartbeat({ tickIntervalMs: response.policy.tickIntervalMs });
    }
    this.connectRequestCompleted = true;
    this.pairingPending = false;
    this.markTransportReady();
    this.subscribeToSessionChangesIfSupported(epoch);
  }

  private async resolveConnectPlan(
    identity: DeviceIdentity,
    publicKey: string,
    epoch: number,
    serial: number,
  ): Promise<ConnectPlan> {
    const store = this.options.credentialStore ?? defaultCredentialStore;
    const storedRecord = await store
      .getDeviceTokenRecord(identity.deviceId, this.getDeviceTokenStorageScope())
      .catch(() => null);
    this.assertCurrentHandshake(epoch, serial);
    if (storedRecord?.token && storedRecord.role === 'operator') {
      return {
        auth: selectConnectAuth({ storedDeviceToken: storedRecord.token }),
        role: 'operator',
        scopes: storedRecord.scopes.length > 0
          ? normalizeStrings(storedRecord.scopes)
          : [...DEFAULT_CONNECT_SCOPES],
        storedRecord,
      };
    }

    let bootstrap: RelayBootstrapCredential | null = null;
    if (
      this.route === 'relay'
      && !this.bootstrapDisabledForConfig
      && relaySupportsBootstrapV2(this.config?.relay)
    ) {
      try {
        const control = await this.requestRelayControl(
          'bootstrap.request',
          'bootstrap.issued',
          'bootstrap.error',
          {
            deviceId: identity.deviceId,
            publicKey,
            role: 'operator',
            scopes: [...DEFAULT_CONNECT_SCOPES],
            capabilities: [OPENCLAW_MOBILE_SETUP_CAPABILITY],
          },
          RELAY_BOOTSTRAP_TIMEOUT_MS,
        );
        bootstrap = readBootstrapCredential(control);
        if (!bootstrap) throw new Error('Relay bootstrap response did not include a credential.');
      } catch (error) {
        if (!this.hasLegacyCredential()) throw error;
        this.bootstrapDisabledForConfig = true;
      }
      this.assertCurrentHandshake(epoch, serial);
    }
    const configured = this.config?.bootstrap;
    if (
      !bootstrap
      && this.route === 'direct'
      && configured?.token?.trim()
      && (configured.expiresAtMs === undefined || configured.expiresAtMs > this.now())
    ) {
      bootstrap = {
        token: configured.token,
        strategy: configured.strategy,
        ...(configured.access ? { access: configured.access } : {}),
      };
    }
    const mobileSetup = bootstrap?.strategy === 'mobile-setup';
    return {
      auth: selectConnectAuth({
        token: this.config?.token,
        password: this.config?.password,
        bootstrapToken: bootstrap?.token,
        bootstrapStrategy: bootstrap?.strategy,
      }),
      role: mobileSetup ? 'node' : 'operator',
      scopes: mobileSetup ? [] : [...DEFAULT_CONNECT_SCOPES],
      storedRecord: null,
    };
  }

  private handleHandshakeFailure(error: unknown, epoch: number, serial: number): void {
    if (!this.isCurrentHandshake(epoch, serial)) return;
    const normalized = error instanceof GatewayRequestError
      ? error
      : new GatewayRequestError({
          code: 'challenge_failed',
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        });
    const message = normalized.message;
    if (isPairingRequired(normalized)) {
      const details = isRecord(normalized.details) ? normalized.details : {};
      const requestId = readString(details.requestId)
        ?? message.match(/requestId[:\s]*([a-f0-9-]+)/i)?.[1];
      this.pairingPending = true;
      this.setState('pairing_pending');
      this.emit('pairingRequired', { requestId });
      return;
    }
    if (
      normalized.code === 'AUTH_TOKEN_MISMATCH'
      || normalized.code === 'AUTH_SCOPE_MISMATCH'
      || message.toLowerCase().includes('device token mismatch')
    ) {
      const identity = this.identity;
      if (identity) {
        void (this.options.credentialStore ?? defaultCredentialStore)
          .deleteDeviceToken(identity.deviceId, this.getDeviceTokenStorageScope())
          .finally(() => this.recycleTransport(epoch, serial));
      } else {
        this.recycleTransport(epoch, serial);
      }
    } else if (isFatalDeviceAuthError(normalized)) {
      this.transport?.disconnect(4008, normalized.code);
    } else {
      queueMicrotask(() => this.recycleTransport(epoch, serial));
    }
    this.emit('error', {
      code: normalized.code,
      message,
      retryable: normalized.retryable,
    });
  }

  private markTransportReady(): void {
    const transport = this.transport;
    if (transport instanceof RelayWsTransport || transport instanceof DirectWsTransport) {
      transport.markReady();
    }
  }

  private recycleTransport(epoch: number, serial: number): void {
    if (!this.isCurrentHandshake(epoch, serial)) return;
    this.handshakeSerial += 1;
    this.clearReadinessTimer();
    this.transport?.reconnect();
  }

  private handleRelayControl(control: RelayControlFrame, epoch: number): void {
    if (control.event === 'relay.ready') {
      if (this.transport instanceof RelayWsTransport) {
        const interval = control.payload.tickIntervalMs;
        if (typeof interval === 'number' && interval > 0) {
          this.transport.configureHeartbeat({ tickIntervalMs: interval });
        }
      }
      return;
    }
    const pending = this.findPendingControl(control);
    if (!pending) return;
    clearTimeout(pending.value.timeout);
    this.pendingControls.delete(pending.id);
    if (control.event === pending.value.errorEvent) {
      pending.value.reject(readRelayControlError(control));
    } else if (epoch === this.epoch) {
      pending.value.resolve(control);
    } else {
      pending.value.reject(new Error('Connection restarted'));
    }
  }

  private findPendingControl(
    control: RelayControlFrame,
  ): { id: string; value: PendingControl } | null {
    if (control.requestId) {
      const value = this.pendingControls.get(control.requestId);
      if (value && (control.event === value.resultEvent || control.event === value.errorEvent)) {
        return { id: control.requestId, value };
      }
    }
    const matches = [...this.pendingControls.entries()].filter(([, value]) => (
      control.event === value.resultEvent || control.event === value.errorEvent
    ));
    return matches.length === 1 ? { id: matches[0][0], value: matches[0][1] } : null;
  }

  private requestRelayControl(
    requestEvent: string,
    resultEvent: string,
    errorEvent: string,
    payload?: Record<string, unknown>,
    timeoutMs = RELAY_CONTROL_TIMEOUT_MS,
  ): Promise<RelayControlFrame> {
    if (this.route !== 'relay' || !this.transport?.isSocketOpen) {
      return Promise.reject(new Error('Relay socket is not connected.'));
    }
    const requestId = this.requestId();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingControls.delete(requestId);
        reject(new Error(`${requestEvent} timed out.`));
      }, timeoutMs);
      this.pendingControls.set(requestId, {
        resultEvent,
        errorEvent,
        timeout,
        resolve,
        reject,
      });
      try {
        this.transport?.send(buildRelayControlFrame(requestEvent, requestId, payload));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingControls.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private sendRequest<T>(
    method: string,
    params: object,
    timeoutMs = this.options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    allowBeforeReady = false,
  ): Promise<T> {
    if (!this.transport?.isSocketOpen || (!allowBeforeReady && this.state !== 'ready')) {
      return Promise.reject(new GatewayRequestError({
        code: 'not_connected',
        message: 'Gateway is not connected',
        retryable: true,
      }));
    }
    const id = this.requestId();
    const epoch = this.epoch;
    const frame = {
      type: 'req' as const,
      id,
      method,
      params,
      ...(allowBeforeReady && this.route === 'relay' && this.connectRequestMeta
        ? { meta: { capabilities: [...this.connectRequestMeta.capabilities] } }
        : {}),
    };
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new GatewayRequestError({
          code: 'request_timeout',
          message: `${method} request timed out`,
          retryable: true,
        }));
      }, timeoutMs);
      this.pendingRequests.set(id, {
        epoch,
        method,
        timeout,
        resolve: (payload) => resolve(payload as T),
        reject,
      });
      try {
        this.transport?.send(JSON.stringify(frame));
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private subscribeToSessionChangesIfSupported(epoch: number): void {
    if (!this.supportedMethods.has('sessions.subscribe')) return;
    void this.request<{ sessions?: unknown[] }>('sessions.subscribe', {})
      .then((result) => {
        if (epoch !== this.epoch) return;
        if (Array.isArray(result?.sessions)) {
          this.emit('sessionsChanged', { sessions: result.sessions });
        }
      })
      .catch(() => {
        // Subscription is an additive optimization; polling remains valid.
      });
  }

  private async waitForReady(timeoutMs: number): Promise<boolean> {
    if (this.state === 'ready') return true;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        off();
        resolve(value);
      };
      const off = this.on('connection', ({ state }) => {
        if (state === 'ready') finish(true);
        if (state === 'closed' && this.manuallyClosed) finish(false);
      });
      const timer = setTimeout(() => finish(false), timeoutMs);
    });
  }

  private startReadinessTimer(epoch: number, serial: number, timeoutMs: number): void {
    this.clearReadinessTimer();
    this.readinessTimer = setTimeout(() => {
      this.readinessTimer = null;
      if (!this.isCurrentHandshake(epoch, serial) || this.state === 'ready') return;
      this.emit('error', {
        code: this.getBackendKind() === 'hermes' ? 'first_health_timeout' : 'challenge_timeout',
        message: this.getBackendKind() === 'hermes'
          ? 'Hermes health frame timed out'
          : 'Gateway handshake timed out',
        retryable: true,
      });
      this.recycleTransport(epoch, serial);
    }, readPositiveNumber(timeoutMs, HANDSHAKE_TIMEOUT_MS));
  }

  private clearReadinessTimer(): void {
    if (!this.readinessTimer) return;
    clearTimeout(this.readinessTimer);
    this.readinessTimer = null;
  }

  private stopTransport(reason?: string): void {
    const transport = this.transport;
    this.transport = null;
    for (const unsubscribe of this.transportUnsubscribers.splice(0)) unsubscribe();
    if (transport) transport.disconnect(undefined, reason);
  }

  private rejectPendingRequests(message: string, code: string): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new GatewayRequestError({ code, message, retryable: true }));
    }
    this.pendingRequests.clear();
  }

  private rejectPendingControls(message: string): void {
    for (const pending of this.pendingControls.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.pendingControls.clear();
  }

  private setState(state: import('../../types').ConnectionState, reason?: string): void {
    if (this.state === state && !reason) return;
    this.state = state;
    this.emit('connection', { state, ...(reason ? { reason } : {}) });
  }

  private emit<K extends keyof GatewayProtocolEvents>(
    event: K,
    payload: GatewayProtocolEvents[K],
  ): void {
    const listeners = this.listeners[event] as Set<GatewayProtocolListener<GatewayProtocolEvents[K]>>;
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // A consumer cannot interrupt protocol processing for other listeners.
      }
    }
  }

  private assertCurrentHandshake(epoch: number, serial: number): void {
    if (!this.isCurrentHandshake(epoch, serial)) {
      throw new GatewayRequestError({
        code: 'connection_restarted',
        message: 'Connection restarted',
        retryable: true,
      });
    }
  }

  private isCurrentHandshake(epoch: number, serial: number): boolean {
    return epoch === this.epoch
      && serial === this.handshakeSerial
      && !this.manuallyClosed
      && Boolean(this.transport?.isSocketOpen);
  }

  private async persistDeviceToken(
    identity: DeviceIdentity,
    token: string,
    role: string,
    scopes: string[],
  ): Promise<void> {
    await (this.options.credentialStore ?? defaultCredentialStore).setDeviceTokenRecord(
      identity.deviceId,
      { token, role, scopes: normalizeStrings(scopes) },
      this.getDeviceTokenStorageScope(),
    );
  }

  private getDeviceTokenStorageScope(): DeviceTokenStorageScope | undefined {
    const serverUrl = this.config?.relay?.serverUrl?.trim().replace(/\/+$/, '');
    const gatewayId = this.config?.relay?.gatewayId?.trim();
    if (serverUrl && gatewayId) return { serverUrl, gatewayId };
    const gatewayUrl = this.config?.url?.trim().replace(/\/+$/, '');
    return gatewayUrl ? { gatewayUrl } : undefined;
  }

  private hasLegacyCredential(): boolean {
    return Boolean(this.config?.token?.trim() || this.config?.password?.trim());
  }

  // Thin management helpers intentionally stay mechanical: backend semantics
  // and capability gating remain in OpenClawAdapter/HermesAdapter.

  public async listSessions(options?: { limit?: number }): Promise<SessionInfo[]> {
    const result = await this.request<{
      sessions?: SessionInfo[];
      defaults?: { contextTokens?: number | null };
    }>('sessions.list', {
      limit: options?.limit ?? 100,
      includeLastMessage: true,
      includeDerivedTitles: true,
    });
    const defaultContext = result?.defaults?.contextTokens;
    return (result?.sessions ?? []).map((session) => ({
      ...session,
      ...(typeof session.contextTokens !== 'number' && typeof defaultContext === 'number'
        ? { contextTokens: defaultContext }
        : {}),
    }));
  }

  public async patchSession(
    key: string,
    patch: { label?: string | null },
  ): Promise<{ ok: boolean; key: string }> {
    const result = await this.request<{ ok?: boolean; key?: string }>('sessions.patch', { key, ...patch });
    return { ok: result?.ok ?? true, key: result?.key ?? key };
  }

  public async resetSession(
    key: string,
    reason: 'new' | 'reset' = 'reset',
  ): Promise<{ ok: boolean; key: string }> {
    const result = await this.request<{ ok?: boolean; key?: string }>('sessions.reset', { key, reason });
    return { ok: result?.ok ?? true, key: result?.key ?? key };
  }

  public async deleteSession(
    key: string,
    options?: { deleteTranscript?: boolean },
  ): Promise<{ ok: boolean; key: string }> {
    const result = await this.request<{ ok?: boolean; key?: string }>('sessions.delete', {
      key,
      ...(typeof options?.deleteTranscript === 'boolean'
        ? { deleteTranscript: options.deleteTranscript }
        : {}),
    });
    return { ok: result?.ok ?? true, key: result?.key ?? key };
  }

  public async sendChat(
    sessionKey: string,
    text: string,
    attachments?: Array<{ type: string; mimeType: string; content: string }>,
    options?: { idempotencyKey?: string },
  ): Promise<{ runId: string }> {
    const idempotencyKey = options?.idempotencyKey ?? this.requestId();
    const result = await this.request<{ runId?: string }>('chat.send', {
      sessionKey,
      message: text,
      thinking: 'off',
      deliver: false,
      idempotencyKey,
      ...(attachments?.length ? { attachments } : {}),
    });
    return { runId: result?.runId ?? idempotencyKey };
  }

  public async fetchHistory(
    sessionKey: string,
    limit = 50,
  ): Promise<{
    messages: Array<{ role: string; content: unknown }>;
    sessionId?: string;
    thinkingLevel?: string;
  }> {
    const result = await this.request<{
      messages?: Array<{ role: string; content: unknown }>;
      sessionId?: string;
      thinkingLevel?: string;
    }>('chat.history', { sessionKey, limit });
    return {
      messages: result?.messages ?? [],
      sessionId: result?.sessionId,
      thinkingLevel: result?.thinkingLevel,
    };
  }

  public async abortChat(sessionKey: string, runId?: string): Promise<void> {
    await this.request('chat.abort', { sessionKey, ...(runId ? { runId } : {}) });
  }

  public async fetchIdentity(
    agentId = 'main',
  ): Promise<{ name?: string; avatar?: string; emoji?: string }> {
    try {
      const result = await this.request<{
        name?: string;
        avatar?: string;
        avatarUrl?: string;
        emoji?: string;
      }>('agent.identity.get', { agentId });
      return {
        name: result?.name,
        avatar: result?.avatarUrl ?? result?.avatar,
        emoji: result?.emoji,
      };
    } catch {
      return {};
    }
  }

  public async listAgents(): Promise<AgentsListResult> {
    try {
      const result = await this.request<AgentsListResult>('agents.list', {});
      return result ?? { defaultId: 'main', mainKey: 'main', agents: [] };
    } catch {
      return { defaultId: 'main', mainKey: 'main', agents: [] };
    }
  }

  public async createAgent(input: {
    name: string;
    emoji?: string;
    avatar?: string;
  }): Promise<AgentCreateResult> {
    const agentId = input.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
    if (!agentId || agentId === 'main') {
      throw new Error('Invalid agent name.');
    }
    return this.request('agents.create', {
      name: input.name,
      workspace: `~/.openclaw/workspace-${agentId}`,
      emoji: input.emoji,
      avatar: input.avatar,
    });
  }

  public async updateAgent(
    agentId: string,
    patch: { name?: string; workspace?: string; model?: string; avatar?: string },
  ): Promise<AgentUpdateResult> {
    return this.request('agents.update', { agentId, ...patch });
  }

  public async deleteAgent(agentId: string, deleteFiles = false): Promise<AgentDeleteResult> {
    return this.request('agents.delete', { agentId, deleteFiles });
  }

  public async listModels(): Promise<GatewayModelInfo[]> {
    const result = await this.request<{ models?: GatewayModelInfo[] }>('models.list', {});
    return result?.models ?? [];
  }

  public async getCurrentModelState(): Promise<{
    currentModel: string;
    currentProvider: string;
    currentBaseUrl: string;
    note?: string | null;
  }> {
    const method = this.getBackendKind() === 'hermes' ? 'model.current' : 'model.get';
    const result = await this.request<Partial<GatewayModelSelectionState>>(method, {});
    return {
      currentModel: result?.currentModel ?? '',
      currentProvider: result?.currentProvider ?? '',
      currentBaseUrl: result?.currentBaseUrl ?? '',
      note: result?.note ?? null,
    };
  }

  public async getModelSelectionState(): Promise<GatewayModelSelectionState> {
    const result = await this.request<Partial<GatewayModelSelectionState>>('model.get', {});
    return {
      currentModel: result?.currentModel ?? '',
      currentProvider: result?.currentProvider ?? '',
      currentBaseUrl: result?.currentBaseUrl ?? '',
      models: result?.models ?? [],
      providers: result?.providers ?? [],
      note: result?.note ?? null,
    };
  }

  public async setModelSelection(input: {
    model: string;
    provider?: string;
    scope?: 'global' | 'session';
    sessionKey?: string | null;
  }): Promise<GatewayModelSelectionWriteResult> {
    const result = await this.request<Partial<GatewayModelSelectionWriteResult>>('model.set', input);
    return {
      ok: result?.ok ?? false,
      scope: result?.scope ?? 'global',
      currentModel: result?.currentModel ?? '',
      currentProvider: result?.currentProvider ?? '',
      currentBaseUrl: result?.currentBaseUrl ?? '',
      models: result?.models ?? [],
      providers: result?.providers ?? [],
      note: result?.note ?? null,
    };
  }

  public async getSkillsStatus(agentId = 'main'): Promise<SkillStatusReport> {
    return this.request('skills.status', { agentId });
  }

  public async updateSkill(
    skillKey: string,
    patch: { enabled?: boolean; apiKey?: string; env?: Record<string, string> },
  ): Promise<{ ok: boolean; skillKey: string; config: unknown }> {
    return this.request('skills.update', { skillKey, ...patch });
  }

  public async getSkillDetail(
    skillKey: string,
    input?: { agentId?: string; filePath?: string | null },
  ): Promise<SkillContentDetail> {
    return this.request('skills.get', {
      skillKey,
      agentId: input?.agentId ?? 'main',
      ...(input?.filePath ? { filePath: input.filePath } : {}),
    });
  }

  public async updateSkillContent(
    skillKey: string,
    content: string,
    agentId = 'main',
  ): Promise<{ ok: boolean; skillKey: string; path: string }> {
    return this.request('skills.content.update', { skillKey, content, agentId });
  }

  public async deleteSkill(
    skillKey: string,
    agentId = 'main',
  ): Promise<{ ok: boolean; skillKey: string }> {
    return this.request('skills.delete', { skillKey, agentId });
  }

  public async listCronJobs(input?: {
    includeDisabled?: boolean;
    limit?: number;
    offset?: number;
    query?: string;
    enabled?: 'all' | 'enabled' | 'disabled';
    sortBy?: 'nextRunAtMs' | 'updatedAtMs' | 'name';
    sortDir?: 'asc' | 'desc';
  }): Promise<CronListResult> {
    return this.request('cron.list', input ?? {});
  }

  public async addCronJob(job: CronJobCreate): Promise<CronJob> {
    return this.request('cron.add', job);
  }

  public async updateCronJob(id: string, patch: CronJobPatch): Promise<CronJob> {
    return this.request('cron.update', { id, patch });
  }

  public async removeCronJob(id: string): Promise<{ ok: boolean }> {
    return this.request('cron.remove', { id });
  }

  public async runCronJob(id: string, mode: 'due' | 'force' = 'force'): Promise<unknown> {
    return this.request('cron.run', { id, mode });
  }

  public async listCronRuns(input: {
    scope?: 'job' | 'all';
    id?: string;
    limit?: number;
    offset?: number;
    sortDir?: 'asc' | 'desc';
  }): Promise<CronRunsResult> {
    return this.request('cron.runs', input);
  }

  public async listHermesCronJobs(
    input?: { includeDisabled?: boolean },
  ): Promise<HermesCronJob[]> {
    const result = await this.request<{ jobs?: HermesCronJob[] }>(
      'hermes.cron.jobs.list',
      input ?? {},
    );
    return Array.isArray(result?.jobs) ? result.jobs : [];
  }

  public async getHermesCronJob(jobId: string): Promise<HermesCronJob | null> {
    const result = await this.request<{ job?: HermesCronJob | null }>(
      'hermes.cron.jobs.get',
      { jobId },
    );
    return result?.job ?? null;
  }

  public async createHermesCronJob(job: HermesCronJobUpsert): Promise<HermesCronJob | null> {
    const result = await this.request<{ job?: HermesCronJob | null }>(
      'hermes.cron.jobs.create',
      job,
    );
    return result?.job ?? null;
  }

  public async updateHermesCronJob(
    jobId: string,
    patch: Partial<HermesCronJobUpsert>,
  ): Promise<HermesCronJob | null> {
    const result = await this.request<{ job?: HermesCronJob | null }>(
      'hermes.cron.jobs.update',
      { jobId, ...patch },
    );
    return result?.job ?? null;
  }

  public async pauseHermesCronJob(jobId: string): Promise<HermesCronJob | null> {
    const result = await this.request<{ job?: HermesCronJob | null }>(
      'hermes.cron.jobs.pause',
      { jobId },
    );
    return result?.job ?? null;
  }

  public async resumeHermesCronJob(jobId: string): Promise<HermesCronJob | null> {
    const result = await this.request<{ job?: HermesCronJob | null }>(
      'hermes.cron.jobs.resume',
      { jobId },
    );
    return result?.job ?? null;
  }

  public async runHermesCronJob(jobId: string): Promise<HermesCronJob | null> {
    const result = await this.request<{ job?: HermesCronJob | null }>(
      'hermes.cron.jobs.run',
      { jobId },
    );
    return result?.job ?? null;
  }

  public async removeHermesCronJob(jobId: string): Promise<boolean> {
    const result = await this.request<{ ok?: boolean }>('hermes.cron.jobs.remove', { jobId });
    return Boolean(result?.ok);
  }

  public async listHermesCronOutputs(input?: {
    jobId?: string;
    limit?: number;
  }): Promise<HermesCronOutputEntry[]> {
    const result = await this.request<{ outputs?: HermesCronOutputEntry[] }>(
      'hermes.cron.outputs.list',
      input ?? {},
    );
    return Array.isArray(result?.outputs) ? result.outputs : [];
  }

  public async getHermesCronOutput(
    jobId: string,
    fileName: string,
  ): Promise<HermesCronOutputDetail | null> {
    const result = await this.request<{ output?: HermesCronOutputDetail | null }>(
      'hermes.cron.outputs.get',
      { jobId, fileName },
    );
    return result?.output ?? null;
  }

  public async listAgentFiles(agentId = 'main'): Promise<GatewayAgentFileSummary[]> {
    const result = await this.request<{ files?: GatewayAgentFileSummary[] }>(
      'agents.files.list',
      { agentId },
    );
    return result?.files ?? [];
  }

  public async getAgentFile(name: string, agentId = 'main'): Promise<GatewayAgentFileDetail> {
    const result = await this.request<{ file?: GatewayAgentFileDetail }>(
      'agents.files.get',
      { agentId, name },
    );
    if (!result?.file) throw new Error('File not found');
    return result.file;
  }

  public async setAgentFile(
    name: string,
    content: string,
    agentId = 'main',
  ): Promise<{ ok: boolean }> {
    const result = await this.request<{ ok?: boolean }>('agents.files.set', {
      agentId,
      name,
      content,
    });
    return { ok: result?.ok ?? false };
  }

  public async fetchUsage(input: {
    startDate: string;
    endDate: string;
  }): Promise<UsageResult> {
    return this.request('sessions.usage', {
      startDate: input.startDate,
      endDate: input.endDate,
      limit: 500,
      includeContextWeight: false,
    });
  }

  public async fetchCostSummary(input: {
    startDate: string;
    endDate: string;
  }): Promise<CostSummary> {
    return this.request('usage.cost', input);
  }

  public async getConfig(): Promise<{
    config: Record<string, unknown> | null;
    hash: string | null;
  }> {
    const result = await this.request<{
      config?: Record<string, unknown> | null;
      hash?: string | null;
    }>('config.get', {});
    return { config: result?.config ?? null, hash: result?.hash ?? null };
  }

  public async patchConfig(
    raw: string,
    baseHash: string,
  ): Promise<{ ok: boolean; config?: Record<string, unknown>; hash?: string }> {
    const result = await this.request<{
      ok?: boolean;
      config?: Record<string, unknown>;
      hash?: string;
    }>('config.patch', { raw, baseHash });
    return {
      ok: result?.ok ?? false,
      config: result?.config,
      hash: result?.hash,
    };
  }

  public async setConfig(
    raw: string,
    baseHash: string,
  ): Promise<{ ok: boolean; config?: Record<string, unknown>; path?: string }> {
    const result = await this.request<{
      ok?: boolean;
      config?: Record<string, unknown>;
      path?: string;
    }>('config.set', { raw, baseHash });
    return {
      ok: result?.ok ?? false,
      config: result?.config,
      path: result?.path,
    };
  }

  public async fetchToolsCatalog(agentId = 'main'): Promise<ToolsCatalogResult> {
    const result = await this.request<ToolsCatalogResult>('tools.catalog', {
      agentId,
      includePlugins: true,
    });
    return result ?? { agentId, profiles: [], groups: [] };
  }

  public async getChannelsStatus(input?: {
    probe?: boolean;
    timeoutMs?: number;
  }): Promise<ChannelsStatusResult> {
    const result = await this.request<Partial<ChannelsStatusResult>>('channels.status', {
      probe: input?.probe ?? false,
      ...(input?.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    });
    return {
      ts: result?.ts ?? this.now(),
      channelOrder: result?.channelOrder ?? [],
      channelLabels: result?.channelLabels ?? {},
      channelDetailLabels: result?.channelDetailLabels ?? {},
      channelSystemImages: result?.channelSystemImages ?? {},
      channelMeta: result?.channelMeta ?? [],
      channels: result?.channels ?? {},
      channelAccounts: result?.channelAccounts ?? {},
      channelDefaultAccountId: result?.channelDefaultAccountId ?? {},
    };
  }

  public async listNodes(): Promise<NodeListResult> {
    const result = await this.request<Partial<NodeListResult>>('node.list', {});
    return { ts: result?.ts ?? this.now(), nodes: result?.nodes ?? [] };
  }

  public async renameNode(
    nodeId: string,
    displayName: string,
  ): Promise<{ nodeId: string; displayName: string }> {
    const result = await this.request<{ nodeId?: string; displayName?: string }>(
      'node.rename',
      { nodeId, displayName },
    );
    return {
      nodeId: result?.nodeId ?? nodeId,
      displayName: result?.displayName ?? displayName,
    };
  }

  public async listNodePairRequests(): Promise<NodePairListResult> {
    const result = await this.request<Partial<NodePairListResult>>('node.pair.list', {});
    return { pending: result?.pending ?? [], nodes: result?.nodes ?? [] };
  }

  public async approveNodePair(requestId: string): Promise<unknown> {
    return this.request('node.pair.approve', { requestId });
  }

  public async rejectNodePair(requestId: string): Promise<unknown> {
    return this.request('node.pair.reject', { requestId });
  }

  public async listDevices(): Promise<DevicePairListResult> {
    const result = await this.request<Partial<DevicePairListResult>>('device.pair.list', {});
    return { pending: result?.pending ?? [], paired: result?.paired ?? [] };
  }

  public async approveDevicePair(requestId: string): Promise<unknown> {
    return this.request('device.pair.approve', { requestId });
  }

  public async rejectDevicePair(requestId: string): Promise<unknown> {
    return this.request('device.pair.reject', { requestId });
  }

  public async removeDevice(deviceId: string): Promise<unknown> {
    return this.request('device.pair.remove', { deviceId });
  }

  public async fetchLogs(input: {
    cursor?: number;
    limit?: number;
    maxBytes?: number;
  }): Promise<{
    file: string;
    cursor: number;
    size: number;
    lines: string[];
    truncated: boolean;
    reset: boolean;
  }> {
    const result = await this.request<{
      file?: string;
      cursor?: number;
      size?: number;
      lines?: string[];
      truncated?: boolean;
      reset?: boolean;
    }>('logs.tail', {
      cursor: input.cursor,
      limit: input.limit ?? 500,
      maxBytes: input.maxBytes ?? 250_000,
    });
    return {
      file: result?.file ?? '',
      cursor: result?.cursor ?? 0,
      size: result?.size ?? 0,
      lines: result?.lines ?? [],
      truncated: Boolean(result?.truncated),
      reset: Boolean(result?.reset),
    };
  }

  public async resolveExecApproval(
    id: string,
    decision: 'allow-once' | 'allow-always' | 'deny',
  ): Promise<void> {
    await this.request('exec.approval.resolve', { id, decision });
  }

  public async requestDoctor(): Promise<DoctorResult> {
    const control = await this.requestRelayControl(
      'doctor.request',
      'doctor.result',
      'doctor.error',
    );
    return control.payload as unknown as DoctorResult;
  }

  public async requestPermissions(): Promise<PermissionsReport> {
    const control = await this.requestRelayControl(
      'permissions.request',
      'permissions.result',
      'permissions.error',
    );
    return control.payload as unknown as PermissionsReport;
  }

  public async requestDoctorFix(): Promise<RepairResult> {
    const control = await this.requestRelayControl(
      'doctor-fix.request',
      'doctor-fix.result',
      'doctor-fix.error',
      undefined,
      60_000,
    );
    return control.payload as unknown as RepairResult;
  }
}

function createListenerStore(): {
  [K in keyof GatewayProtocolEvents]: Set<GatewayProtocolListener<GatewayProtocolEvents[K]>>;
} {
  return {
    connection: new Set(),
    chatDelta: new Set(),
    chatTool: new Set(),
    chatFinal: new Set(),
    chatAborted: new Set(),
    chatError: new Set(),
    chatRunStart: new Set(),
    chatCompaction: new Set(),
    pairingRequired: new Set(),
    pairingResolved: new Set(),
    execApprovalRequested: new Set(),
    execApprovalResolved: new Set(),
    seqGap: new Set(),
    sessionsChanged: new Set(),
    health: new Set(),
    tick: new Set(),
    error: new Set(),
  };
}

function sameGatewayConfig(left: GatewayConfig | null, right: GatewayConfig | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveBackendKind(config: GatewayConfig | null): 'openclaw' | 'hermes' {
  return config?.backendKind === 'hermes' || config?.mode === 'hermes' ? 'hermes' : 'openclaw';
}

function resolveRoute(config: GatewayConfig | null): 'direct' | 'relay' {
  return config?.transportKind === 'relay' || config?.mode === 'relay' ? 'relay' : 'direct';
}

function buildConfiguredRelayUrl(
  config: GatewayConfig,
  clientId: string,
  backendKind: GatewayBackendKind,
): string {
  const gatewayId = readString(config.relay?.gatewayId);
  const token = readString(config.relay?.clientToken);
  if (!gatewayId || !token) throw new Error('Relay connection is not configured.');
  return buildRelayClientWsUrl({
    relayUrl: config.url,
    gatewayId,
    token,
    clientId,
    backendKind,
  });
}

function normalizeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

function isHealthyHermesFrame(payload: Record<string, unknown>): boolean {
  const status = readString(payload.status)?.toLowerCase();
  return payload.hermesApiReachable !== false
    && (!status || status === 'ok' || status === 'healthy');
}

function isPairingRequired(error: GatewayRequestError): boolean {
  const code = error.code.toUpperCase();
  const message = error.message.toLowerCase();
  return code === 'PAIRING_REQUIRED'
    || message.includes('not_paired')
    || message.includes('pairing required');
}

function isFatalDeviceAuthError(error: GatewayRequestError): boolean {
  const code = error.code.toUpperCase();
  const message = error.message.toLowerCase();
  return code === 'DEVICE_AUTH_NONCE_MISMATCH'
    || code === 'DEVICE_AUTH_SIGNATURE_INVALID'
    || message.includes('device nonce mismatch')
    || message.includes('device signature invalid');
}

function closeErrorCode(code: number | undefined): string {
  if (code === 1009) return 'frame_too_large';
  if (code === 4008) return 'rate_limited';
  if (code === 4011) return 'gateway_offline';
  if (code === 4012) return 'reconnect_required';
  return 'connection_closed';
}

function readPositiveNumber(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
