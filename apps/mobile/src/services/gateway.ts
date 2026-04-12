import nacl from 'tweetnacl';
import {
  AgentEventPayload,
  ChannelsStatusResult,
  ChatEventPayload,
  CronJob,
  CronJobCreate,
  CronJobPatch,
  CronListResult,
  CronRunsResult,
  ConnectChallengePayload,
  ConnectionState,
  DevicePairListResult,
  DeviceIdentity,
  GatewayConfig,
  NodeListResult,
  NodePairListResult,
  ReqFrame,
  ResFrame,
  SessionInfo,
  SkillStatusReport,
  SkillContentDetail,
  SessionsListPayload,
  isEventFrame,
  isGatewayFrame,
  isResFrame,
} from '../types';
import type { AgentInfo, AgentsListResult, AgentCreateResult, AgentUpdateResult, AgentDeleteResult } from '../types/agent';
import type { CostSummary, UsageResult } from '../types/usage';
import type { ToolsCatalogResult } from '../types/index';
import type { NodeInvokeRequest, CanvasPresentPayload, CanvasNavigatePayload, CanvasEvalPayload, CanvasSnapshotPayload } from '../types/canvas';
import type {
  HermesCronJob,
  HermesCronJobUpsert,
  HermesCronOutputDetail,
  HermesCronOutputEntry,
} from '../types/hermes-cron';
import { StorageService } from './storage';
import { isUnsupportedDirectLocalTlsConfig } from '../hooks/gatewayConfigForm.utils';
import {
  hexToBytes,
  bytesToBase64Url,
  buildDeviceAuthPayload,
  normalizeWsUrl,
  generateId,
  ensureIdentity,
} from './gateway-auth';
import {
  AGENT_IDENTITY_CACHE_TTL_MS,
  AGENT_LIST_CACHE_TTL_MS,
  CHALLENGE_TIMEOUT_MS,
  CONNECT_REQUEST_TIMEOUT_MS,
  FORCE_RECONNECT_DEBOUNCE_MS,
  PAIRING_WAIT_TIMEOUT_MS,
  PROTOCOL_VERSION,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_RECONNECT_COOLDOWN_MS,
  RELAY_BOOTSTRAP_TIMEOUT_MS,
  SESSION_LIST_CACHE_TTL_MS,
  WS_OPEN_TIMEOUT_MS,
  type ChatHistoryResult,
  type GatewayEvents,
  type GatewayInfo,
  type Listener,
  type ListenerStore,
  type PendingRequest,
  type SessionsListResult,
  type TimedValue,
  extractText,
  handleGatewayRawMessage,
  isBootstrapTokenUnsupportedError,
  isDeviceSignatureInvalidError,
  isNonceMismatchError,
} from './gateway-shared';
import { sanitizeSilentPreviewText } from '../utils/chat-message';
import {
  buildRelayClientWsUrl,
  buildRelayBootstrapRequestFrame,
  buildRelayDoctorRequestFrame,
  buildRelayDoctorFixRequestFrame,
  buildRelayPermissionsRequestFrame,
  lookupRelayRoute,
  parseRelayBootstrapError,
  parseRelayBootstrapIssued,
  parseRelayControlFrame,
  parseRelayDoctorError,
  parseRelayDoctorFixError,
  parseRelayDoctorFixResult,
  parseRelayDoctorResult,
  parseRelayPermissionsError,
  parseRelayPermissionsResult,
  RELAY_CONTROL_PREFIX,
  RelayBootstrapRequestError,
  RelayDoctorRequestError,
  relaySupportsBootstrapV2,
  refreshRelayRouteInBackground,
  resolveRelayAccessToken,
  selectRelayConnectAuth,
  shouldConnectRelayFirst,
  shouldTryRelayFallback,
  tryConnectRelayFastPath,
  tryConnectViaRelay,
} from './gateway-relay';
import type {
  PendingRelayBootstrapRequest,
  PendingRelayDoctorFixRequest,
  PendingRelayDoctorRequest,
  PendingRelayPermissionsRequest,
  RelayDoctorFixResult,
  RelayDoctorResult,
  RelayPermissionsResult,
} from './gateway-relay';
import { APP_PACKAGE_VERSION } from '../constants/app-version';
import { getRuntimeClientId, getRuntimeDeviceFamily, getRuntimePlatform } from '../utils/platform';
import { getGatewayBackendCapabilities, resolveGatewayBackendKind } from './gateway-backends';
import { getGatewayBackendOperations } from './gateway-backend-operations';
import { markHermesConnectTrace } from './hermes-connect-debug';

export { extractText };
export type { ChatHistoryResult, GatewayInfo };

// ---- GatewayClient ----

export class GatewayClient {
  private static readonly CONNECTION_PROBE_TIMEOUT_MS = 2_500;
  private static readonly RECONNECT_READY_TIMEOUT_MS = 6_000;
  private static readonly HISTORY_CACHE_TTL_MS = 1_000;
  private ws: WebSocket | null = null;
  private config: GatewayConfig | null = null;
  private state: ConnectionState = 'idle';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsOpenTimer: ReturnType<typeof setTimeout> | null = null;
  private challengeTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;
  private lastTimeoutReconnectAt = 0;
  private lastForceReconnectAt = 0;
  private connectAttemptId = 0;
  private connectTraceId: string | null = null;
  private connectStartedAt = 0;
  private activeRoute: 'direct' | 'relay' = 'direct';
  private wsOpenedAt = 0;
  private relayAttemptedForCycle = false;
  private relayBootstrapInFlight = false;
  private relayBootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  private relayBootstrapCompatibilityDisabledForKey: string | null = null;
  private reconnectBlockedReason: { code: string; message: string; hint?: string } | null = null;
  private connectRequestInFlight = false;
  private connectRequestCompleted = false;
  private readonly sessionListCache = new Map<string, TimedValue<SessionInfo[]>>();
  private readonly pendingSessionListRequests = new Map<string, Promise<SessionInfo[]>>();
  private readonly historyCache = new Map<string, TimedValue<ChatHistoryResult>>();
  private readonly pendingHistoryRequests = new Map<string, Promise<ChatHistoryResult>>();
  private agentsListCache: TimedValue<AgentsListResult> | null = null;
  private pendingAgentsListRequest: Promise<AgentsListResult> | null = null;
  private readonly agentIdentityCache = new Map<string, TimedValue<{ name?: string; avatar?: string; emoji?: string }>>();
  private readonly pendingAgentIdentityRequests = new Map<string, Promise<{ name?: string; avatar?: string; emoji?: string }>>();

  // Tick watchdog: detect dead connections when ticks stop arriving
  private tickIntervalMs = 15_000;
  private lastTickAt: number | null = null;
  private tickWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

  // Pending req→res futures
  private pendingRequests = new Map<string, PendingRequest>();
  private pendingRelayBootstrapRequests = new Map<string, PendingRelayBootstrapRequest>();
  private pendingRelayDoctorRequests = new Map<string, PendingRelayDoctorRequest>();
  private pendingRelayDoctorFixRequests = new Map<string, PendingRelayDoctorFixRequest>();
  private pendingRelayPermissionsRequests = new Map<string, PendingRelayPermissionsRequest>();

  // Text encoder for signing
  private encoder = new TextEncoder();

  // Pairing state
  private pairingPending = false;
  private pairingTimer: ReturnType<typeof setTimeout> | null = null;

  // Hello-ok snapshot
  private gatewayInfo: GatewayInfo | null = null;

  // Event listeners
  private listeners: ListenerStore = {
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
    canvasPresent: new Set(),
    canvasHide: new Set(),
    canvasNavigate: new Set(),
    canvasEval: new Set(),
    canvasSnapshot: new Set(),
    seqGap: new Set(),
    health: new Set(),
    tick: new Set(),
    error: new Set(),
  };

  // ---- Public API ----

  public getGatewayInfo(): GatewayInfo | null {
    return this.gatewayInfo;
  }

  public configure(config: GatewayConfig | null): void {
    const prev = this.config;
    this.config = config;
    const hasMaterialChange = !prev
      || !config
      || prev.url !== config.url
      || prev.token !== config.token
      || prev.password !== config.password
      || prev.backendKind !== config.backendKind
      || prev.transportKind !== config.transportKind
      || prev.mode !== config.mode
      || prev.hermes?.bridgeUrl !== config.hermes?.bridgeUrl
      || prev.relay?.gatewayId !== config.relay?.gatewayId
      || prev.relay?.serverUrl !== config.relay?.serverUrl
      || prev.relay?.clientToken !== config.relay?.clientToken
      || prev.relay?.protocolVersion !== config.relay?.protocolVersion
      || prev.relay?.supportsBootstrap !== config.relay?.supportsBootstrap;
    if (hasMaterialChange) {
      this.clearReconnectBlock();
      this.clearGatewayMetadataCaches();
    }
  }

  public getConnectionState(): ConnectionState {
    return this.state;
  }

  public getConnectionRoute(): 'direct' | 'relay' {
    return this.activeRoute;
  }

  private getDeviceTokenStorageScope(): {
    serverUrl?: string;
    gatewayId?: string;
    gatewayUrl?: string;
  } | undefined {
    const relayServerUrl = this.config?.relay?.serverUrl?.trim().replace(/\/+$/, '');
    const relayGatewayId = this.config?.relay?.gatewayId?.trim();
    if (relayServerUrl && relayGatewayId) {
      return {
        serverUrl: relayServerUrl,
        gatewayId: relayGatewayId,
      };
    }

    const gatewayUrl = this.config?.url?.trim().replace(/\/+$/, '');
    if (gatewayUrl) {
      return { gatewayUrl };
    }

    return undefined;
  }

  public on<K extends keyof GatewayEvents>(event: K, listener: Listener<GatewayEvents[K]>): () => void {
    (this.listeners[event] as Set<Listener<GatewayEvents[K]>>).add(listener);
    return () => {
      (this.listeners[event] as Set<Listener<GatewayEvents[K]>>).delete(listener);
    };
  }

  public async getDeviceIdentity(): Promise<DeviceIdentity> {
    return this.ensureIdentity();
  }

  public connect(): void {
    if (this.reconnectBlockedReason) {
      this.emitBlockedReconnectError();
      return;
    }
    if (!this.config?.url) {
      this.emit('error', { code: 'config_missing', message: 'Gateway URL is not configured' });
      return;
    }

    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (this.shouldConnectRelayFirst() && this.relayBootstrapInFlight) {
      this.logTelemetry('connect_skipped', {
        attemptId: this.connectAttemptId,
        reason: 'relay_bootstrap_in_flight',
      });
      return;
    }

    this.connectAttemptId += 1;
    const attemptId = this.connectAttemptId;
    this.connectStartedAt = Date.now();
    this.connectTraceId = this.makeConnectTraceId(attemptId);
    this.clearReconnectTimer();
    this.manuallyClosed = false;
    this.relayAttemptedForCycle = false;
    this.clearPendingRelayBootstrapRequests('Connection restarted');
    this.clearPendingRelayDoctorRequests('Connection restarted');
    this.clearPendingRelayDoctorFixRequests('Connection restarted');
    this.clearPendingRelayPermissionsRequests('Connection restarted');
    this.logTelemetry('connect_start', {
      attemptId,
      mode: this.config?.mode ?? 'local',
      hasRelayConfig: Boolean(
        this.config?.relay?.gatewayId
        && (this.config?.token || this.config?.password)
        && this.config?.url,
      ),
    });

    if (this.shouldConnectRelayFirst()) {
      this.relayBootstrapInFlight = true;
      this.startRelayBootstrapTimer(attemptId);
      void this.tryConnectRelayFastPath(attemptId);
      return;
    }

    const wsUrl = normalizeWsUrl(this.config.url);
    const unsupportedLocalTlsReason = this.resolveUnsupportedDirectLocalTlsReason(wsUrl);
    if (unsupportedLocalTlsReason) {
      this.blockReconnect(unsupportedLocalTlsReason);
      this.setState('closed', unsupportedLocalTlsReason.message);
      return;
    }
    this.openSocket(wsUrl, 'direct', attemptId);
  }

  private openSocket(wsUrl: string, route: 'direct' | 'relay', attemptId: number): void {
    this.activeRoute = route;
    this.connectRequestInFlight = false;
    this.connectRequestCompleted = false;
    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    this.clearConnectionWatchdogs();
    this.logTelemetry('ws_connecting', {
      attemptId,
      route,
      endpoint: this.redactWsUrl(wsUrl),
    });
    this.ws = new WebSocket(wsUrl);
    this.startWsOpenTimer(attemptId);

    this.ws.onopen = () => {
      if (attemptId !== this.connectAttemptId) return;
      this.clearWsOpenTimer();
      this.reconnectAttempts = 0;
      this.connectRequestInFlight = false;
      this.connectRequestCompleted = false;
      this.wsOpenedAt = Date.now();
      if (!this.getBackendOperations().usesConnectHandshake) {
        this.setState('ready');
        this.startTickWatchdog();
        this.logTelemetry('ws_open', {
          attemptId,
          route,
          elapsedMs: Date.now() - this.connectStartedAt,
          mode: this.getBackendKind(),
        });
        return;
      }
      // Wait for connect.challenge event — don't send anything yet
      this.setState('challenging');
      this.logTelemetry('ws_open', {
        attemptId,
        route,
        elapsedMs: Date.now() - this.connectStartedAt,
      });
      this.startChallengeTimer(attemptId);
    };

    this.ws.onmessage = (event: WebSocketMessageEvent) => {
      if (attemptId !== this.connectAttemptId) return;
      this.handleRawMessage(event.data);
    };

    this.ws.onerror = (errorEvent?: { message?: string; type?: string }) => {
      if (attemptId !== this.connectAttemptId) return;
      this.logTelemetry('ws_error', {
        attemptId,
        route,
        elapsedMs: Date.now() - this.connectStartedAt,
        errorType: errorEvent?.type,
        errorMessage: errorEvent?.message,
      });
      this.emit('error', { code: 'ws_error', message: 'WebSocket error' });
    };

    this.ws.onclose = (closeEvent?: { code?: number; reason?: string; wasClean?: boolean }) => {
      if (attemptId !== this.connectAttemptId) return;
      this.clearConnectionWatchdogs();
      this.ws = null;
      this.connectRequestInFlight = false;
      this.connectRequestCompleted = false;
      this.logTelemetry('ws_close', {
        attemptId,
        route,
        elapsedMs: Date.now() - this.connectStartedAt,
        manuallyClosed: this.manuallyClosed,
        pairingPending: this.pairingPending,
        closeCode: closeEvent?.code,
        closeReason: closeEvent?.reason,
        closeClean: closeEvent?.wasClean,
      });

      // Reject all pending requests
      this.rejectPendingRequests('Connection closed');
      this.clearPendingRelayBootstrapRequests('Connection closed');
      this.clearPendingRelayDoctorRequests('Connection closed');
      this.clearPendingRelayDoctorFixRequests('Connection closed');
      this.clearPendingRelayPermissionsRequests('Connection closed');

      if (this.manuallyClosed) {
        this.setState('closed');
        return;
      }
      // If server closed the connection while waiting for pairing approval,
      // stay in pairing_pending but schedule a reconnect — the device may get
      // approved asynchronously and the next connect handshake will succeed.
      if (this.pairingPending) {
        this.setState('pairing_pending');
        this.scheduleReconnect();
        return;
      }
      if (this.reconnectBlockedReason) {
        this.setState('closed', this.reconnectBlockedReason.message);
        return;
      }
      if (this.shouldTryRelayFallback(route)) {
        this.relayBootstrapInFlight = true;
        this.startRelayBootstrapTimer(attemptId);
        this.relayAttemptedForCycle = true;
        void this.tryConnectViaRelay(attemptId);
        return;
      }
      this.scheduleReconnect();
    };
  }

  public disconnect(): void {
    this.connectAttemptId += 1;
    this.manuallyClosed = true;
    this.pairingPending = false;
    this.gatewayInfo = null;
    this.relayAttemptedForCycle = false;
    this.relayBootstrapInFlight = false;
    this.clearRelayBootstrapTimer();
    this.clearReconnectTimer();
    this.clearConnectionWatchdogs();
    this.clearPendingRelayBootstrapRequests('Connection closed');
    this.clearPendingRelayDoctorRequests('Connection closed');
    this.clearPendingRelayDoctorFixRequests('Connection closed');
    this.clearPendingRelayPermissionsRequests('Connection closed');
    this.connectRequestInFlight = false;
    this.connectRequestCompleted = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('closed');
  }

  /**
   * Force a transport restart.
   * Useful when app resumes from background and socket looks stale.
   */
  public reconnect(): void {
    if (this.reconnectBlockedReason) {
      this.clearReconnectBlock();
    }
    if (!this.config?.url) {
      this.emit('error', { code: 'config_missing', message: 'Gateway URL is not configured' });
      return;
    }
    const now = Date.now();
    const hasActiveSocket = Boolean(
      this.ws
      && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    );
    const handshakeInFlight = hasActiveSocket
      && (this.state === 'connecting' || this.state === 'challenging' || this.state === 'reconnecting');
    if (handshakeInFlight && this.connectStartedAt > 0 && now - this.connectStartedAt < CHALLENGE_TIMEOUT_MS) {
      this.logTelemetry('reconnect_skipped', {
        attemptId: this.connectAttemptId,
        route: this.activeRoute,
        reason: 'handshake_in_progress',
        state: this.state,
        elapsedMs: now - this.connectStartedAt,
      });
      return;
    }
    const staleReadyTransport = this.state === 'ready'
      && (!this.ws || this.ws.readyState !== WebSocket.OPEN);
    if (!staleReadyTransport && now - this.lastForceReconnectAt < FORCE_RECONNECT_DEBOUNCE_MS) {
      return;
    }
    this.lastForceReconnectAt = now;

    this.manuallyClosed = false;
    this.pairingPending = false;
    this.relayAttemptedForCycle = false;
    this.relayBootstrapInFlight = false;
    this.clearRelayBootstrapTimer();
    this.clearReconnectTimer();
    this.clearConnectionWatchdogs();
    this.reconnectAttempts = 0;
    this.clearPendingRelayBootstrapRequests('Connection restarted');
    this.clearPendingRelayDoctorRequests('Connection restarted');
    this.clearPendingRelayDoctorFixRequests('Connection restarted');
    this.clearPendingRelayPermissionsRequests('Connection restarted');
    this.connectRequestInFlight = false;
    this.connectRequestCompleted = false;

    this.rejectPendingRequests('Connection restarted');

    if (this.ws) {
      // Detach listeners before close so this deliberate restart does not
      // trigger duplicate reconnect scheduling from onclose.
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }

    this.connect();
  }

  public async probeConnection(timeoutMs = GatewayClient.CONNECTION_PROBE_TIMEOUT_MS): Promise<boolean> {
    if (this.manuallyClosed || this.pairingPending || this.reconnectBlockedReason) {
      return false;
    }

    if (!this.config?.url) {
      this.emit('error', { code: 'config_missing', message: 'Gateway URL is not configured' });
      return false;
    }

    const wsReadyState = this.ws?.readyState;
    if (this.state === 'ready' && wsReadyState === WebSocket.OPEN) {
      try {
        await this.sendRequest(
          'health',
          {},
          { timeoutMs, skipAutoReconnectOnTimeout: true },
        );
        return true;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.recoverStaleTransport(`probe failed: ${message}`);
        return this.waitForReady(GatewayClient.RECONNECT_READY_TIMEOUT_MS);
      }
    }

    if (this.state === 'connecting' || this.state === 'challenging' || this.state === 'reconnecting') {
      return this.waitForReady(Math.max(timeoutMs, GatewayClient.RECONNECT_READY_TIMEOUT_MS));
    }

    this.recoverStaleTransport('probe preflight');
    return this.waitForReady(GatewayClient.RECONNECT_READY_TIMEOUT_MS);
  }

  /** Fetch session list from Gateway. */
  public async listSessions(opts?: { limit?: number }): Promise<SessionInfo[]> {
    const cacheKey = String(opts?.limit ?? 100);
    const cached = this.readTimedCache(this.sessionListCache.get(cacheKey));
    if (cached) return cached;

    const inFlight = this.pendingSessionListRequests.get(cacheKey);
    if (inFlight) return inFlight;

    const request = (async () => {
      const payload = await this.sendRequest('sessions.list', {
        limit: opts?.limit ?? 100,
        includeLastMessage: true,
        includeDerivedTitles: true,
      });
      const result = payload as (SessionsListPayload & SessionsListResult) | null;
      const defaultContextTokens = typeof result?.defaults?.contextTokens === 'number'
        ? result.defaults.contextTokens
        : undefined;
      const sessions = (result?.sessions ?? []).map((session) => (
        ({
          ...(
            typeof session.contextTokens === 'number' || defaultContextTokens === undefined
              ? session
              : { ...session, contextTokens: defaultContextTokens }
          ),
          lastMessagePreview: sanitizeSilentPreviewText(session.lastMessagePreview),
        })
      ));
      this.sessionListCache.set(cacheKey, {
        value: sessions,
        expiresAt: Date.now() + SESSION_LIST_CACHE_TTL_MS,
      });
      return sessions;
    })();

    this.pendingSessionListRequests.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.pendingSessionListRequests.delete(cacheKey);
    }
  }

  /** Update mutable session metadata such as the label. */
  public async patchSession(
    key: string,
    patch: { label?: string | null },
  ): Promise<{ ok: boolean; key: string }> {
    const payload = await this.sendRequest('sessions.patch', { key, ...patch }) as
      | { ok?: boolean; key?: string }
      | null;
    this.invalidateSessionMetadataCache();
    return {
      ok: payload?.ok ?? true,
      key: payload?.key ?? key,
    };
  }

  /** Reset a session transcript while keeping the session identity. */
  public async resetSession(
    key: string,
    reason: 'new' | 'reset' = 'reset',
  ): Promise<{ ok: boolean; key: string }> {
    const payload = await this.sendRequest('sessions.reset', { key, reason }) as
      | { ok?: boolean; key?: string }
      | null;
    this.invalidateSessionMetadataCache();
    return {
      ok: payload?.ok ?? true,
      key: payload?.key ?? key,
    };
  }

  /** Delete a non-main session from the gateway. */
  public async deleteSession(
    key: string,
    options?: { deleteTranscript?: boolean },
  ): Promise<{ ok: boolean; key: string }> {
    const payload = await this.sendRequest('sessions.delete', {
      key,
      ...(typeof options?.deleteTranscript === 'boolean' ? { deleteTranscript: options.deleteTranscript } : {}),
    }) as { ok?: boolean; key?: string } | null;
    this.invalidateSessionMetadataCache();
    return {
      ok: payload?.ok ?? true,
      key: payload?.key ?? key,
    };
  }

  /** Fetch available provider models from Gateway. */
  public async listModels(): Promise<Array<{
    id: string;
    name: string;
    provider: string;
    contextWindow?: number;
    reasoning?: boolean;
    input?: Array<'text' | 'image'>;
    cost?: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
  }>> {
    return this.getBackendOperations().listModels(this.sendBackendRequest);
  }

  public async getModelSelectionState(): Promise<{
    currentModel: string;
    currentProvider: string;
    currentBaseUrl: string;
    models: Array<{
      id: string;
      name: string;
      provider: string;
      contextWindow?: number;
      reasoning?: boolean;
      input?: Array<'text' | 'image'>;
      cost?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
      };
    }>;
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
  }> {
    return this.getBackendOperations().getModelSelectionState(this.sendBackendRequest);
  }

  public async getCurrentModelState(): Promise<{
    currentModel: string;
    currentProvider: string;
    currentBaseUrl: string;
    note?: string | null;
  }> {
    return this.getBackendOperations().getCurrentModelState(this.sendBackendRequest);
  }

  public async setModelSelection(params: {
    model: string;
    provider?: string;
    scope?: 'global' | 'session';
    sessionKey?: string | null;
  }): Promise<{
    ok: boolean;
    scope: 'global';
    currentModel: string;
    currentProvider: string;
    currentBaseUrl: string;
    models: Array<{
      id: string;
      name: string;
      provider: string;
      contextWindow?: number;
      reasoning?: boolean;
      input?: Array<'text' | 'image'>;
      cost?: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
      };
    }>;
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
  }> {
    return this.getBackendOperations().setModelSelection(this.sendBackendRequest, params);
  }

  /** Get configured chat channels and account runtime snapshots. */
  public async getChannelsStatus(params?: { probe?: boolean; timeoutMs?: number }): Promise<ChannelsStatusResult> {
    const payload = await this.sendRequest('channels.status', {
      probe: params?.probe ?? false,
      ...(params?.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
    }) as Partial<ChannelsStatusResult> | null;

    return {
      ts: payload?.ts ?? Date.now(),
      channelOrder: Array.isArray(payload?.channelOrder) ? payload.channelOrder : [],
      channelLabels: payload?.channelLabels && typeof payload.channelLabels === 'object'
        ? payload.channelLabels
        : {},
      channelDetailLabels: payload?.channelDetailLabels && typeof payload.channelDetailLabels === 'object'
        ? payload.channelDetailLabels
        : {},
      channelSystemImages: payload?.channelSystemImages && typeof payload.channelSystemImages === 'object'
        ? payload.channelSystemImages
        : {},
      channelMeta: Array.isArray(payload?.channelMeta) ? payload.channelMeta : [],
      channels: payload?.channels && typeof payload.channels === 'object'
        ? payload.channels
        : {},
      channelAccounts: payload?.channelAccounts && typeof payload.channelAccounts === 'object'
        ? payload.channelAccounts
        : {},
      channelDefaultAccountId: payload?.channelDefaultAccountId && typeof payload.channelDefaultAccountId === 'object'
        ? payload.channelDefaultAccountId
        : {},
    };
  }

  /** List all paired/known nodes. */
  public async listNodes(): Promise<NodeListResult> {
    const payload = await this.sendRequest('node.list', {}) as NodeListResult | null;
    return {
      ts: payload?.ts ?? Date.now(),
      nodes: Array.isArray(payload?.nodes) ? payload.nodes : [],
    };
  }

  /** Rename one node by id. */
  public async renameNode(nodeId: string, displayName: string): Promise<{ nodeId: string; displayName: string }> {
    const payload = await this.sendRequest('node.rename', { nodeId, displayName }) as
      | { nodeId?: string; displayName?: string }
      | null;
    return {
      nodeId: payload?.nodeId ?? nodeId,
      displayName: payload?.displayName ?? displayName,
    };
  }

  /** List pending node pair requests and known nodes. */
  public async listNodePairRequests(): Promise<NodePairListResult> {
    const payload = await this.sendRequest('node.pair.list', {}) as NodePairListResult | null;
    return {
      pending: Array.isArray(payload?.pending) ? payload.pending : [],
      nodes: Array.isArray(payload?.nodes) ? payload.nodes : [],
    };
  }

  /** Approve a pending node pair request. */
  public async approveNodePair(requestId: string): Promise<unknown> {
    return this.request('node.pair.approve', { requestId });
  }

  /** Reject a pending node pair request. */
  public async rejectNodePair(requestId: string): Promise<unknown> {
    return this.request('node.pair.reject', { requestId });
  }

  /** List pending/paired device pairings. */
  public async listDevices(): Promise<DevicePairListResult> {
    const payload = await this.sendRequest('device.pair.list', {}) as DevicePairListResult | null;
    return {
      pending: Array.isArray(payload?.pending) ? payload.pending : [],
      paired: Array.isArray(payload?.paired) ? payload.paired : [],
    };
  }

  /** Approve a pending device pair request. */
  public async approveDevicePair(requestId: string): Promise<unknown> {
    return this.request('device.pair.approve', { requestId });
  }

  /** Reject a pending device pair request. */
  public async rejectDevicePair(requestId: string): Promise<unknown> {
    return this.request('device.pair.reject', { requestId });
  }

  /** Remove a paired device by id. */
  public async removeDevice(deviceId: string): Promise<unknown> {
    return this.request('device.pair.remove', { deviceId });
  }

  /** Send a user message to the given session. Streaming response arrives via chatDelta/chatFinal events. */
  public async sendChat(
    sessionKey: string,
    text: string,
    attachments?: Array<{ type: string; mimeType: string; content: string }>,
    options?: { idempotencyKey?: string },
  ): Promise<{ runId: string }> {
    const idempotencyKey = options?.idempotencyKey ?? generateId();
    const result = await this.sendRequest('chat.send', {
      sessionKey,
      message: text,
      thinking: 'off',
      deliver: false,
      idempotencyKey,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    });
    const payload = result as { runId?: string } | null;
    return { runId: payload?.runId ?? idempotencyKey };
  }

  /** Fetch chat history for a session. */
  public async fetchHistory(sessionKey: string, limit = 50): Promise<ChatHistoryResult> {
    const cacheKey = `${sessionKey}::${limit}`;
    const cached = this.readTimedCache(this.historyCache.get(cacheKey));
    if (cached) return cached;

    const inFlight = this.pendingHistoryRequests.get(cacheKey);
    if (inFlight) return inFlight;

    const request = (async () => {
      const payload = await this.sendRequest('chat.history', { sessionKey, limit });
      const result = payload as {
        messages?: Array<{ role: string; content: unknown }>;
        sessionId?: string;
        thinkingLevel?: string;
      } | null;
      const history = {
        messages: result?.messages ?? [],
        sessionId: result?.sessionId,
        thinkingLevel: result?.thinkingLevel,
      };
      this.historyCache.set(cacheKey, {
        value: history,
        expiresAt: Date.now() + GatewayClient.HISTORY_CACHE_TTL_MS,
      });
      return history;
    })();

    this.pendingHistoryRequests.set(cacheKey, request);
    try {
      return await request;
    } finally {
      this.pendingHistoryRequests.delete(cacheKey);
    }
  }

  /** Abort the current running chat in a session. */
  public async abortChat(sessionKey: string, runId?: string): Promise<void> {
    await this.sendRequest('chat.abort', { sessionKey, ...(runId ? { runId } : {}) });
  }

  /** Fetch agent identity (name, avatar, emoji) from gateway. */
  public async fetchIdentity(agentId = 'main'): Promise<{ name?: string; avatar?: string; emoji?: string }> {
    const cached = this.readTimedCache(this.agentIdentityCache.get(agentId));
    if (cached) return cached;

    const inFlight = this.pendingAgentIdentityRequests.get(agentId);
    if (inFlight) return inFlight;

    const request = (async () => {
      try {
        const result = await this.sendRequest('agent.identity.get', { agentId }) as {
        name?: string; avatar?: string; avatarUrl?: string; emoji?: string;
        };
        const identity = {
          name: result.name,
          avatar: result.avatarUrl ?? result.avatar,
          emoji: result.emoji,
        };
        this.agentIdentityCache.set(agentId, {
          value: identity,
          expiresAt: Date.now() + AGENT_IDENTITY_CACHE_TTL_MS,
        });
        return identity;
      } catch {
        return {};
      }
    })();

    this.pendingAgentIdentityRequests.set(agentId, request);
    try {
      return await request;
    } finally {
      this.pendingAgentIdentityRequests.delete(agentId);
    }
  }

  /** List workspace files for an agent. */
  public async listAgentFiles(agentId = 'main'): Promise<Array<{ name: string; path: string; missing: boolean; size?: number; updatedAtMs?: number }>> {
    return this.getBackendOperations().listAgentFiles(this.sendBackendRequest, agentId);
  }

  /** Read an agent workspace file. */
  public async getAgentFile(name: string, agentId = 'main'): Promise<{ name: string; path: string; missing: boolean; size?: number; updatedAtMs?: number; content?: string }> {
    return this.getBackendOperations().getAgentFile(this.sendBackendRequest, agentId, name);
  }

  /** Write content to an agent workspace file. */
  public async setAgentFile(name: string, content: string, agentId = 'main'): Promise<{ ok: boolean }> {
    const result = await this.getBackendOperations().setAgentFile(this.sendBackendRequest, agentId, name, content);
    if (result?.ok && name === 'IDENTITY.md') {
      this.invalidateAgentMetadataCache(agentId);
    }
    return { ok: result?.ok ?? false };
  }

  /** Generic Gateway request wrapper. */
  public async request<T = unknown>(method: string, params?: object): Promise<T> {
    const payload = await this.sendRequest(method, params);
    return payload as T;
  }

  /** Get full skill status report. */
  public async getSkillsStatus(agentId = 'main'): Promise<SkillStatusReport> {
    return this.request('skills.status', { agentId });
  }

  /** Update a skill config (enable/disable, apiKey, env). */
  public async updateSkill(skillKey: string, patch: {
    enabled?: boolean;
    apiKey?: string;
    env?: Record<string, string>;
  }): Promise<{ ok: boolean; skillKey: string; config: unknown }> {
    return this.request('skills.update', { skillKey, ...patch });
  }

  /** Get skill content and linked files. */
  public async getSkillDetail(
    skillKey: string,
    params?: {
      agentId?: string;
      filePath?: string | null;
    },
  ): Promise<SkillContentDetail> {
    return this.request('skills.get', {
      skillKey,
      agentId: params?.agentId ?? 'main',
      ...(params?.filePath ? { filePath: params.filePath } : {}),
    });
  }

  /** Update the main SKILL.md content for one skill. */
  public async updateSkillContent(
    skillKey: string,
    content: string,
    agentId = 'main',
  ): Promise<{ ok: boolean; skillKey: string; path: string }> {
    return this.request('skills.content.update', { skillKey, content, agentId });
  }

  /** Delete one skill when the backend allows it. */
  public async deleteSkill(
    skillKey: string,
    agentId = 'main',
  ): Promise<{ ok: boolean; skillKey: string }> {
    return this.request('skills.delete', { skillKey, agentId });
  }

  /** List cron jobs. */
  public async listCronJobs(params?: {
    includeDisabled?: boolean;
    limit?: number;
    offset?: number;
    query?: string;
    enabled?: 'all' | 'enabled' | 'disabled';
    sortBy?: 'nextRunAtMs' | 'updatedAtMs' | 'name';
    sortDir?: 'asc' | 'desc';
  }): Promise<CronListResult> {
    return this.request('cron.list', params ?? {});
  }

  /** Add a new cron job. */
  public async addCronJob(job: CronJobCreate): Promise<CronJob> {
    return this.request('cron.add', job);
  }

  /** Update an existing cron job. */
  public async updateCronJob(id: string, patch: CronJobPatch): Promise<CronJob> {
    return this.request('cron.update', { id, patch });
  }

  /** Remove a cron job. */
  public async removeCronJob(id: string): Promise<{ ok: boolean }> {
    return this.request('cron.remove', { id });
  }

  /** Manually trigger a cron job. */
  public async runCronJob(id: string, mode: 'due' | 'force' = 'force'): Promise<unknown> {
    return this.request('cron.run', { id, mode });
  }

  /** Get execution history for one cron job or all jobs. */
  public async listCronRuns(params: {
    scope?: 'job' | 'all';
    id?: string;
    limit?: number;
    offset?: number;
    sortDir?: 'asc' | 'desc';
  }): Promise<CronRunsResult> {
    return this.request('cron.runs', params);
  }

  /** List Hermes scheduled tasks. */
  public async listHermesCronJobs(params?: {
    includeDisabled?: boolean;
  }): Promise<HermesCronJob[]> {
    const result = await this.request<{ jobs?: HermesCronJob[] }>('hermes.cron.jobs.list', params ?? {});
    return Array.isArray(result?.jobs) ? result.jobs : [];
  }

  /** Fetch one Hermes scheduled task. */
  public async getHermesCronJob(jobId: string): Promise<HermesCronJob | null> {
    const result = await this.request<{ job?: HermesCronJob | null }>('hermes.cron.jobs.get', { jobId });
    return result?.job ?? null;
  }

  /** Create a Hermes scheduled task. */
  public async createHermesCronJob(job: HermesCronJobUpsert): Promise<HermesCronJob | null> {
    const result = await this.request<{ job?: HermesCronJob | null }>('hermes.cron.jobs.create', job);
    return result?.job ?? null;
  }

  /** Update a Hermes scheduled task. */
  public async updateHermesCronJob(jobId: string, patch: Partial<HermesCronJobUpsert>): Promise<HermesCronJob | null> {
    const result = await this.request<{ job?: HermesCronJob | null }>('hermes.cron.jobs.update', { jobId, ...patch });
    return result?.job ?? null;
  }

  /** Pause a Hermes scheduled task. */
  public async pauseHermesCronJob(jobId: string): Promise<HermesCronJob | null> {
    const result = await this.request<{ job?: HermesCronJob | null }>('hermes.cron.jobs.pause', { jobId });
    return result?.job ?? null;
  }

  /** Resume a Hermes scheduled task. */
  public async resumeHermesCronJob(jobId: string): Promise<HermesCronJob | null> {
    const result = await this.request<{ job?: HermesCronJob | null }>('hermes.cron.jobs.resume', { jobId });
    return result?.job ?? null;
  }

  /** Trigger a Hermes scheduled task to run on the next tick. */
  public async runHermesCronJob(jobId: string): Promise<HermesCronJob | null> {
    const result = await this.request<{ job?: HermesCronJob | null }>('hermes.cron.jobs.run', { jobId });
    return result?.job ?? null;
  }

  /** Remove a Hermes scheduled task. */
  public async removeHermesCronJob(jobId: string): Promise<boolean> {
    const result = await this.request<{ ok?: boolean }>('hermes.cron.jobs.remove', { jobId });
    return Boolean(result?.ok);
  }

  /** List Hermes cron output records. */
  public async listHermesCronOutputs(params?: {
    jobId?: string;
    limit?: number;
  }): Promise<HermesCronOutputEntry[]> {
    const result = await this.request<{ outputs?: HermesCronOutputEntry[] }>('hermes.cron.outputs.list', params ?? {});
    return Array.isArray(result?.outputs) ? result.outputs : [];
  }

  /** Read one Hermes cron output record. */
  public async getHermesCronOutput(jobId: string, fileName: string): Promise<HermesCronOutputDetail | null> {
    const result = await this.request<{ output?: HermesCronOutputDetail | null }>('hermes.cron.outputs.get', { jobId, fileName });
    return result?.output ?? null;
  }

  /** Fetch gateway log tail with cursor-based pagination. */
  public async fetchLogs(params: {
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
    const result = await this.sendRequest('logs.tail', {
      cursor: params.cursor,
      limit: params.limit ?? 500,
      maxBytes: params.maxBytes ?? 250000,
    }) as {
      file?: string;
      cursor?: number;
      size?: number;
      lines?: string[];
      truncated?: boolean;
      reset?: boolean;
    };
    return {
      file: result?.file ?? '',
      cursor: result?.cursor ?? 0,
      size: result?.size ?? 0,
      lines: Array.isArray(result?.lines) ? result.lines : [],
      truncated: Boolean(result?.truncated),
      reset: Boolean(result?.reset),
    };
  }

  /** Fetch aggregated usage data for a date range. */
  public async fetchUsage(params: {
    startDate: string;
    endDate: string;
  }): Promise<UsageResult> {
    return this.getBackendOperations().fetchUsage(this.sendBackendRequest, params);
  }

  /** Fetch daily cost summary for a date range. */
  public async fetchCostSummary(params: {
    startDate: string;
    endDate: string;
  }): Promise<CostSummary> {
    return this.getBackendOperations().fetchCostSummary(this.sendBackendRequest, params);
  }

  /** Create a new agent. */
  public async createAgent(params: { name: string; emoji?: string; avatar?: string }): Promise<AgentCreateResult> {
    // Normalize agent ID the same way the gateway does: lowercase, replace invalid chars with '-'.
    const agentId = params.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
    if (!agentId || agentId === 'main') {
      throw new Error('Invalid agent name — must contain at least one ASCII letter or digit and cannot be "main".');
    }
    const workspace = `~/.openclaw/workspace-${agentId}`;
    const result = await this.request('agents.create', { name: params.name, workspace, emoji: params.emoji, avatar: params.avatar }) as AgentCreateResult;
    this.invalidateAgentMetadataCache();
    return result;
  }

  /** Update an existing agent. Note: emoji is not supported by agents.update — only set at creation. */
  public async updateAgent(agentId: string, patch: { name?: string; workspace?: string; model?: string; avatar?: string }): Promise<AgentUpdateResult> {
    const result = await this.request('agents.update', { agentId, ...patch }) as AgentUpdateResult;
    this.invalidateAgentMetadataCache(agentId);
    return result;
  }

  /** Delete an agent. */
  public async deleteAgent(agentId: string, deleteFiles = false): Promise<AgentDeleteResult> {
    const result = await this.request('agents.delete', { agentId, deleteFiles }) as AgentDeleteResult;
    this.invalidateAgentMetadataCache(agentId);
    return result;
  }

  /** List all configured agents from Gateway. */
  public async listAgents(): Promise<AgentsListResult> {
    const cached = this.readTimedCache(this.agentsListCache);
    if (cached) return cached;
    if (this.pendingAgentsListRequest) return this.pendingAgentsListRequest;

    this.pendingAgentsListRequest = (async () => {
      try {
        const payload = await this.sendRequest('agents.list', {});
        const result = (payload as AgentsListResult | null) ?? { defaultId: 'main', mainKey: 'main', agents: [] };
        this.agentsListCache = {
          value: result,
          expiresAt: Date.now() + AGENT_LIST_CACHE_TTL_MS,
        };
        return result;
      } catch {
        return { defaultId: 'main', mainKey: 'main', agents: [] };
      } finally {
        this.pendingAgentsListRequest = null;
      }
    })();

    return this.pendingAgentsListRequest;
  }


  /** Fetch full gateway config snapshot (for reading agent tool overrides). */
  public async getConfig(): Promise<{ config: Record<string, unknown> | null; hash: string | null }> {
    return this.getBackendOperations().getConfig(this.sendBackendRequest);
  }

  /** Apply a merge-patch to gateway config (for updating agent tool overrides). */
  public async patchConfig(raw: string, baseHash: string): Promise<{ ok: boolean; config?: Record<string, unknown>; hash?: string }> {
    return this.getBackendOperations().patchConfig(
      this.sendBackendRequest,
      raw,
      baseHash,
    );
  }

  /** Replace the full gateway config snapshot after local validation/preparation. */
  public async setConfig(raw: string, baseHash: string): Promise<{ ok: boolean; config?: Record<string, unknown>; path?: string }> {
    return this.getBackendOperations().setConfig(
      this.sendBackendRequest,
      raw,
      baseHash,
    );
  }

  /** Fetch tools catalog from gateway. */
  public async fetchToolsCatalog(agentId = 'main'): Promise<ToolsCatalogResult> {
    return this.getBackendOperations().fetchToolsCatalog(
      this.sendBackendRequest,
      agentId,
    );
  }

  /** Resolve a pending exec approval request. */
  public async resolveExecApproval(id: string, decision: 'allow-once' | 'allow-always' | 'deny'): Promise<void> {
    await this.sendRequest('exec.approval.resolve', { id, decision });
  }

  /** Get the configured gateway base URL (for constructing avatar HTTP URLs). */
  public getBaseUrl(): string | null {
    return this.getBackendOperations().getBaseUrl(this.config);
  }

  public getBackendKind() {
    return resolveGatewayBackendKind(this.config);
  }

  public getBackendCapabilities() {
    return getGatewayBackendCapabilities(this.config);
  }

  private getBackendOperations() {
    return getGatewayBackendOperations(this.config);
  }

  private readonly sendBackendRequest = <T = unknown>(method: string, params?: object): Promise<T> => (
    this.sendRequest(method, params) as Promise<T>
  );

  // ---- Private: event emission ----

  private emit<K extends keyof GatewayEvents>(event: K, payload: GatewayEvents[K]): void {
    for (const listener of this.listeners[event]) {
      (listener as Listener<GatewayEvents[K]>)(payload);
    }
  }

  private setState(state: ConnectionState, reason?: string): void {
    this.state = state;
    this.emit('connection', { state, reason });
  }

  // ---- Private: identity ----

  private async ensureIdentity(): Promise<DeviceIdentity> {
    return ensureIdentity();
  }

  // ---- Private: handshake ----

  private async handleConnectChallenge(payload: ConnectChallengePayload): Promise<void> {
    const attemptId = this.connectAttemptId;
    this.logTelemetry('connect_handshake_start', {
      attemptId,
      route: this.activeRoute,
      elapsedMs: Date.now() - this.connectStartedAt,
      sinceWsOpenMs: this.wsOpenedAt ? Date.now() - this.wsOpenedAt : null,
    });
    const { nonce } = payload;
    const identity = await this.ensureIdentity();
    if (!this.isActiveConnectAttempt(attemptId)) return;
    const secretKey = hexToBytes(identity.secretKeyHex);
    const publicKeyBytes = hexToBytes(identity.publicKeyHex);
    const publicKeyB64 = bytesToBase64Url(publicKeyBytes);

    const signedAt = Date.now();
    const clientId = getRuntimeClientId();
    const clientMode = 'ui';
    const role = this.getConnectRole();
    const scopes = this.getConnectScopes();
    const platform = getRuntimePlatform();
    const deviceFamily = getRuntimeDeviceFamily();
    const connectAuth = await this.resolveConnectAuth({
      identity,
      publicKey: publicKeyB64,
      role,
      scopes,
    });
    if (!this.isActiveConnectAttempt(attemptId)) return;

    // Build the v3 auth payload and sign it
    const authPayload = buildDeviceAuthPayload({
      deviceId: identity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs: signedAt,
      token: connectAuth.signatureToken,
      nonce,
      platform,
      deviceFamily,
    });

    const payloadBytes = this.encoder.encode(authPayload);
    const signatureBytes = nacl.sign.detached(payloadBytes, secretKey);

    // Gateway expects base64url for publicKey and signature
    const signatureB64 = bytesToBase64Url(signatureBytes);

    const connectParams = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: clientId,
        displayName: 'Clawket',
        version: APP_PACKAGE_VERSION,
        platform,
        mode: clientMode,
        deviceFamily,
      },
      caps: ['tool-events'],
      commands: ['canvas.present', 'canvas.hide', 'canvas.navigate', 'canvas.eval', 'canvas.snapshot'],
      role,
      scopes,
      device: {
        id: identity.deviceId,
        publicKey: publicKeyB64,
        signature: signatureB64,
        signedAt,
        nonce,
      },
      auth: connectAuth.auth,
    };

    try {
      this.logTelemetry('connect_req_sent', {
        attemptId,
        route: this.activeRoute,
        elapsedMs: Date.now() - this.connectStartedAt,
      });
      const result = await this.sendRequest('connect', connectParams, {
        timeoutMs: CONNECT_REQUEST_TIMEOUT_MS,
        skipAutoReconnectOnTimeout: true,
      });
      if (!this.isActiveConnectAttempt(attemptId)) return;
      // Save device token and extract gateway info from hello-ok
      const helloOk = result as {
        auth?: { deviceToken?: string };
        server?: { version?: string; connId?: string };
        policy?: { tickIntervalMs?: number };
        snapshot?: {
          uptimeMs?: number;
          presence?: Array<{ host?: string; ip?: string; platform?: string }>;
          authMode?: string;
          updateAvailable?: { currentVersion: string; latestVersion: string };
        };
      } | null;
      if (helloOk?.auth?.deviceToken) {
        const identity = await this.ensureIdentity();
        await StorageService.setDeviceToken(
          identity.deviceId,
          helloOk.auth.deviceToken,
          this.getDeviceTokenStorageScope(),
        );
      }
      // Store gateway info snapshot
      const gwSelf = helloOk?.snapshot?.presence?.[0];
      this.gatewayInfo = {
        version: helloOk?.server?.version ?? '',
        connId: helloOk?.server?.connId ?? '',
        uptimeMs: helloOk?.snapshot?.uptimeMs ?? 0,
        host: gwSelf?.host,
        ip: gwSelf?.ip,
        platform: gwSelf?.platform,
        authMode: helloOk?.snapshot?.authMode,
      };
      // Apply tick interval from server policy (default 15s)
      if (typeof helloOk?.policy?.tickIntervalMs === 'number' && helloOk.policy.tickIntervalMs > 0) {
        this.tickIntervalMs = helloOk.policy.tickIntervalMs;
      }
      this.pairingPending = false;
      this.clearReconnectBlock();
      this.setState('ready');
      this.startTickWatchdog();
      this.logTelemetry('connect_ready', {
        attemptId: this.connectAttemptId,
        route: this.activeRoute,
        elapsedMs: Date.now() - this.connectStartedAt,
        sinceWsOpenMs: this.wsOpenedAt ? Date.now() - this.wsOpenedAt : null,
      });
    } catch (err: unknown) {
      if (!this.isActiveConnectAttempt(attemptId)) return;
      const msg = err instanceof Error ? err.message : String(err);
      this.logTelemetry('connect_res_err', {
        attemptId,
        route: this.activeRoute,
        elapsedMs: Date.now() - this.connectStartedAt,
        message: msg,
      });
      if (isNonceMismatchError(msg)) {
        this.blockReconnect({
          code: 'device_nonce_mismatch',
          message: 'Device authentication nonce mismatch. Please regenerate a new Relay QR code in Clawket Bridge.',
          hint: 'Open Clawket Bridge and scan a newly generated Relay QR code.',
        });
        this.ws?.close();
        return;
      }
      if (isDeviceSignatureInvalidError(msg)) {
        this.blockReconnect({
          code: 'device_signature_invalid',
          message: 'Device authentication failed. Reset the Clawket app device identity and reconnect.',
          hint: 'If this keeps happening, clear the app identity or app data, then reconnect to the Gateway.',
        });
        this.ws?.close();
        return;
      }
      if (
        connectAuth.source === 'device-token'
        && this.activeRoute === 'relay'
        && this.isDeviceTokenMismatchError(msg)
      ) {
        const identity = await this.ensureIdentity();
        await StorageService.deleteDeviceToken(identity.deviceId, this.getDeviceTokenStorageScope());
        this.logTelemetry('relay_device_token_cleared_after_mismatch', {
          attemptId,
          route: this.activeRoute,
          elapsedMs: Date.now() - this.connectStartedAt,
        });
        this.restartConnection('Connection restarted');
        return;
      }
      if (
        connectAuth.source === 'bootstrap-token'
        && this.activeRoute === 'relay'
        && this.hasLegacyConnectCredential()
        && isBootstrapTokenUnsupportedError(msg)
      ) {
        // Temporary compatibility path: some older OpenClaw builds reject
        // auth.bootstrapToken during the connect handshake. In that case we
        // fall back to the legacy token/password path for pairing so first
        // connection can still succeed on those hosts. Once old Gateway
        // versions are no longer in circulation, this downgrade path should
        // be removed.
        this.disableRelayBootstrapCompatibilityForCurrentConfig();
        this.logTelemetry('relay_bootstrap_legacy_schema_fallback', {
          attemptId,
          route: this.activeRoute,
          elapsedMs: Date.now() - this.connectStartedAt,
          message: msg,
        });
        this.restartConnection('Connection restarted');
        return;
      }
      if (msg.includes('NOT_PAIRED') || msg.includes('pairing required')) {
        // Extract requestId from error details if available
        const requestIdMatch = msg.match(/requestId[:\s]*([a-f0-9-]+)/i);
        const requestId = requestIdMatch?.[1];
        this.pairingPending = true;
        this.setState('pairing_pending');
        this.emit('pairingRequired', { requestId });
        // Keep the WebSocket open to receive device.pair.resolved.
        // If approval never arrives, stop reconnecting automatically so the
        // user can approve the device on the OpenClaw host and retry.
        this.clearPairingTimer();
        this.pairingTimer = setTimeout(() => {
          if (this.pairingPending) {
            this.blockReconnect({
              code: 'pairing_required',
              message: 'Pairing approval timed out. Please retry.',
              hint: 'Approve pairing on the OpenClaw host, then reconnect.',
            });
            this.pairingPending = false;
            this.ws?.close();
          }
        }, PAIRING_WAIT_TIMEOUT_MS);
        return;
      }
      if (err instanceof RelayBootstrapRequestError) {
        this.emit('error', { code: err.code, message: err.message });
        this.ws?.close();
        return;
      }
      if (this.isNonRetryableAuthError(msg)) {
        this.blockReconnect({
          code: 'auth_rejected',
          message: 'Relay authentication failed and needs user action.',
          hint: 'Scan a fresh Clawket Bridge QR code to refresh this Relay pairing.',
        });
        this.ws?.close();
        return;
      }
      this.emit('error', { code: 'auth_failed', message: msg });
      this.ws?.close();
    }
  }

  // ---- Private: request/response ----

  private sendRequest(
    method: string,
    params?: object,
    options?: { timeoutMs?: number; skipAutoReconnectOnTimeout?: boolean },
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        if (method !== 'connect' && this.state === 'ready') {
          this.recoverStaleTransport(`request without open socket: ${method}`);
        }
        reject(new Error('WebSocket is not open'));
        return;
      }
      if (method !== 'connect' && this.state !== 'ready') {
        reject(new Error(`Gateway handshake in progress: ${method}`));
        return;
      }
      const id = generateId();
      const frame: ReqFrame = { type: 'req', id, method, params };
      const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
      const traced = this.shouldTraceRequest(method);
      if (traced) {
        this.logTelemetry('req_sent', {
          attemptId: this.connectAttemptId,
          route: this.activeRoute,
          requestId: id,
          method,
          state: this.state,
          elapsedMs: Date.now() - this.connectStartedAt,
        });
      }
      const timeout = setTimeout(() => {
        const pending = this.pendingRequests.get(id);
        if (!pending) return;
        this.pendingRequests.delete(id);
        pending.reject(new Error(`Request timed out: ${method}`));
        if (pending.traced) {
          this.logTelemetry('req_timeout', {
            attemptId: this.connectAttemptId,
            route: this.activeRoute,
            requestId: pending.id,
            method: pending.method,
            durationMs: Date.now() - pending.startedAt,
          });
        }
        if (method === 'connect') {
          this.logTelemetry('connect_req_timeout', {
            attemptId: this.connectAttemptId,
            route: this.activeRoute,
            elapsedMs: Date.now() - this.connectStartedAt,
          });
        }
        if (!options?.skipAutoReconnectOnTimeout) {
          this.maybeReconnectAfterTimeout();
        }
      }, timeoutMs);
      this.pendingRequests.set(id, {
        id,
        method,
        startedAt: Date.now(),
        traced,
        resolve,
        reject,
        timeout,
      });
      try {
        this.ws.send(JSON.stringify(frame));
      } catch (sendErr: unknown) {
        const pending = this.pendingRequests.get(id);
        if (pending) clearTimeout(pending.timeout);
        this.pendingRequests.delete(id);
        reject(sendErr instanceof Error ? sendErr : new Error(String(sendErr)));
      }
    });
  }

  // ---- Private: message routing ----

  private handleRawMessage(rawData: unknown): void {
    if (typeof rawData === 'string' && rawData.startsWith(RELAY_CONTROL_PREFIX)) {
      const control = parseRelayControlFrame(rawData);
      if (!control) {
        this.logTelemetry('relay_control_invalid', {
          attemptId: this.connectAttemptId,
          route: this.activeRoute,
        });
        return;
      }
      this.handleRelayControlFrame(control);
      return;
    }
    handleGatewayRawMessage(this as never, rawData);
  }

  private rejectPendingRequests(reason: string): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  private maybeReconnectAfterTimeout(): void {
    if (this.manuallyClosed || this.pairingPending) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.state === 'ready') {
        this.recoverStaleTransport('request timeout without open socket');
      }
      return;
    }
    const now = Date.now();
    if (now - this.lastTimeoutReconnectAt < REQUEST_TIMEOUT_RECONNECT_COOLDOWN_MS) return;
    this.lastTimeoutReconnectAt = now;
    this.reconnect();
  }

  private handleRelayControlFrame(frame: { event: string; payload: Record<string, unknown> }): void {
    const issued = parseRelayBootstrapIssued(frame);
    if (issued) {
      const pending = this.takePendingRelayBootstrapRequest(issued.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.logTelemetry('relay_bootstrap_issued', {
        attemptId: this.connectAttemptId,
        route: this.activeRoute,
        requestId: pending.requestId,
        durationMs: Date.now() - pending.startedAt,
      });
      pending.resolve(issued.bootstrapToken);
      return;
    }

    const failed = parseRelayBootstrapError(frame);
    if (failed) {
      const pending = this.takePendingRelayBootstrapRequest(failed.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.logTelemetry('relay_bootstrap_failed', {
        attemptId: this.connectAttemptId,
        route: this.activeRoute,
        requestId: pending.requestId,
        durationMs: Date.now() - pending.startedAt,
        detailCode: failed.error.detailCode,
        message: failed.error.message,
      });
      pending.reject(failed.error);
      return;
    }

    const doctorResult = parseRelayDoctorResult(frame);
    if (doctorResult) {
      const pending = this.takePendingRelayDoctorRequest(doctorResult.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pending.resolve(doctorResult.result);
      return;
    }

    const doctorError = parseRelayDoctorError(frame);
    if (doctorError) {
      const pending = this.takePendingRelayDoctorRequest(doctorError.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pending.reject(doctorError.error);
      return;
    }

    const doctorFixResult = parseRelayDoctorFixResult(frame);
    if (doctorFixResult) {
      const pending = this.takePendingRelayDoctorFixRequest(doctorFixResult.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pending.resolve(doctorFixResult.result);
      return;
    }

    const doctorFixError = parseRelayDoctorFixError(frame);
    if (doctorFixError) {
      const pending = this.takePendingRelayDoctorFixRequest(doctorFixError.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pending.reject(doctorFixError.error);
      return;
    }

    const permissionsResult = parseRelayPermissionsResult(frame);
    if (permissionsResult) {
      const pending = this.takePendingRelayPermissionsRequest(permissionsResult.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pending.resolve(permissionsResult.result);
      return;
    }

    const permissionsError = parseRelayPermissionsError(frame);
    if (permissionsError) {
      const pending = this.takePendingRelayPermissionsRequest(permissionsError.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pending.reject(permissionsError.error);
    }
  }

  /** Respond to a node.invoke.request from the Gateway. */
  public async sendNodeInvokeResponse(requestId: string, result: unknown): Promise<void> {
    await this.sendRequest('node.invoke.response', { id: requestId, result });
  }

  private shouldTryRelayFallback(route: 'direct' | 'relay'): boolean {
    return shouldTryRelayFallback(this as never, route);
  }

  private shouldConnectRelayFirst(): boolean {
    return shouldConnectRelayFirst(this as never);
  }

  private async tryConnectRelayFastPath(attemptId: number): Promise<void> {
    return tryConnectRelayFastPath(this as never, attemptId);
  }

  private async refreshRelayRouteInBackground(attemptId: number): Promise<void> {
    return refreshRelayRouteInBackground(this as never, attemptId);
  }

  private async tryConnectViaRelay(attemptId: number): Promise<void> {
    return tryConnectViaRelay(this as never, attemptId);
  }

  private async lookupRelayRoute(
    options: { forceNetwork?: boolean } = {},
  ): Promise<{ relayUrl: string; accessToken: string } | null> {
    return lookupRelayRoute(this as never, options);
  }

  private async resolveRelayAccessToken(relayConfig?: NonNullable<GatewayConfig['relay']>): Promise<string> {
    return resolveRelayAccessToken(this as never, relayConfig);
  }

  private buildRelayClientWsUrl(
    relayUrl: string,
    relayDeviceId: string,
    token: string,
    clientId: string,
    traceId?: string,
  ): string {
    return buildRelayClientWsUrl(
      relayUrl,
      relayDeviceId,
      token,
      clientId,
      this.config?.backendKind ?? 'openclaw',
      traceId,
    );
  }

  private getConnectRole(): string {
    return 'operator';
  }

  private getConnectScopes(): string[] {
    return ['operator.admin', 'operator.read', 'operator.write', 'operator.pairing'];
  }

  private hasLegacyConnectCredential(): boolean {
    return Boolean(this.config?.token?.trim() || this.config?.password?.trim());
  }

  private isDeviceTokenMismatchError(message: string): boolean {
    return message.toLowerCase().includes('device token mismatch');
  }

  private async resolveConnectAuth(input: {
    identity: DeviceIdentity;
    publicKey: string;
    role: string;
    scopes: string[];
  }): Promise<ReturnType<typeof selectRelayConnectAuth>> {
    let storedDeviceToken: string | null = null;
    if (this.activeRoute === 'relay') {
      storedDeviceToken = await StorageService.getDeviceToken(
        input.identity.deviceId,
        this.getDeviceTokenStorageScope(),
      );
    }

    let bootstrapToken: string | null = null;
    if (
      this.activeRoute === 'relay'
      && !storedDeviceToken?.trim()
      && !this.isRelayBootstrapCompatibilityDisabledForCurrentConfig()
      && relaySupportsBootstrapV2(this.config?.relay)
    ) {
      try {
        bootstrapToken = await this.requestRelayBootstrapToken({
          deviceId: input.identity.deviceId,
          publicKey: input.publicKey,
          role: input.role,
          scopes: input.scopes,
        });
      } catch (error: unknown) {
        if (this.hasLegacyConnectCredential()) {
          const message = error instanceof Error ? error.message : String(error);
          this.logTelemetry('relay_bootstrap_fallback_legacy', {
            attemptId: this.connectAttemptId,
            route: this.activeRoute,
            message,
          });
        } else {
          throw error;
        }
      }
    }

    return selectRelayConnectAuth({
      token: this.config?.token,
      password: this.config?.password,
      storedDeviceToken,
      bootstrapToken,
    });
  }

  private async requestRelayBootstrapToken(params: {
    deviceId: string;
    publicKey: string;
    role: string;
    scopes: string[];
  }): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new RelayBootstrapRequestError('relay_bootstrap_failed', 'Relay socket is not open.');
    }
    const requestId = generateId();
    const startedAt = Date.now();
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = this.pendingRelayBootstrapRequests.get(requestId);
        if (!pending) return;
        this.pendingRelayBootstrapRequests.delete(requestId);
        const error = new RelayBootstrapRequestError('relay_bootstrap_timeout', 'Relay bootstrap timed out');
        this.logTelemetry('relay_bootstrap_timeout', {
          attemptId: this.connectAttemptId,
          route: this.activeRoute,
          requestId,
          durationMs: Date.now() - startedAt,
        });
        reject(error);
      }, RELAY_BOOTSTRAP_TIMEOUT_MS);

      this.pendingRelayBootstrapRequests.set(requestId, {
        requestId,
        startedAt,
        timeout,
        resolve,
        reject,
      });

      try {
        this.ws?.send(buildRelayBootstrapRequestFrame({
          requestId,
          deviceId: params.deviceId,
          publicKey: params.publicKey,
          role: params.role,
          scopes: params.scopes,
        }));
        this.logTelemetry('relay_bootstrap_requested', {
          attemptId: this.connectAttemptId,
          route: this.activeRoute,
          requestId,
          role: params.role,
          scopes: params.scopes,
        });
      } catch (error: unknown) {
        clearTimeout(timeout);
        this.pendingRelayBootstrapRequests.delete(requestId);
        reject(new RelayBootstrapRequestError(
          'relay_bootstrap_failed',
          error instanceof Error ? error.message : String(error),
        ));
      }
    });
  }

  private clearPendingRelayBootstrapRequests(reason: string): void {
    for (const [requestId, pending] of this.pendingRelayBootstrapRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new RelayBootstrapRequestError('relay_bootstrap_failed', reason));
      this.pendingRelayBootstrapRequests.delete(requestId);
    }
  }

  private clearPendingRelayDoctorRequests(reason: string): void {
    for (const [requestId, pending] of this.pendingRelayDoctorRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new RelayDoctorRequestError('relay_doctor_failed', reason));
      this.pendingRelayDoctorRequests.delete(requestId);
    }
  }

  private clearPendingRelayPermissionsRequests(reason: string): void {
    for (const [requestId, pending] of this.pendingRelayPermissionsRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new RelayDoctorRequestError('relay_doctor_failed', reason));
      this.pendingRelayPermissionsRequests.delete(requestId);
    }
  }

  private takePendingRelayBootstrapRequest(requestId?: string): PendingRelayBootstrapRequest | null {
    if (requestId) {
      const pending = this.pendingRelayBootstrapRequests.get(requestId) ?? null;
      if (pending) this.pendingRelayBootstrapRequests.delete(requestId);
      return pending;
    }
    if (this.pendingRelayBootstrapRequests.size !== 1) return null;
    const first = this.pendingRelayBootstrapRequests.values().next().value as PendingRelayBootstrapRequest | undefined;
    if (!first) return null;
    this.pendingRelayBootstrapRequests.delete(first.requestId);
    return first;
  }

  // ---- Public: relay doctor ----

  private static RELAY_DOCTOR_TIMEOUT_MS = 30_000;

  public async requestDoctor(): Promise<RelayDoctorResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new RelayDoctorRequestError('relay_doctor_failed', 'NOT_CONNECTED');
    }
    if (this.activeRoute !== 'relay') {
      throw new RelayDoctorRequestError('relay_doctor_failed', 'NOT_RELAY');
    }

    const requestId = `req_doctor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();

    return new Promise<RelayDoctorResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRelayDoctorRequests.delete(requestId);
        reject(new RelayDoctorRequestError('relay_doctor_timeout', 'Doctor request timed out.'));
      }, GatewayClient.RELAY_DOCTOR_TIMEOUT_MS);

      this.pendingRelayDoctorRequests.set(requestId, {
        requestId,
        startedAt,
        timeout,
        resolve,
        reject,
      });

      try {
        this.ws?.send(buildRelayDoctorRequestFrame({ requestId }));
      } catch (error: unknown) {
        clearTimeout(timeout);
        this.pendingRelayDoctorRequests.delete(requestId);
        reject(new RelayDoctorRequestError(
          'relay_doctor_failed',
          error instanceof Error ? error.message : String(error),
        ));
      }
    });
  }

  private takePendingRelayDoctorRequest(requestId?: string): PendingRelayDoctorRequest | null {
    if (requestId) {
      const pending = this.pendingRelayDoctorRequests.get(requestId) ?? null;
      if (pending) this.pendingRelayDoctorRequests.delete(requestId);
      return pending;
    }
    if (this.pendingRelayDoctorRequests.size !== 1) return null;
    const first = this.pendingRelayDoctorRequests.values().next().value as PendingRelayDoctorRequest | undefined;
    if (!first) return null;
    this.pendingRelayDoctorRequests.delete(first.requestId);
    return first;
  }

  // ---- Public: relay doctor fix ----

  private static RELAY_DOCTOR_FIX_TIMEOUT_MS = 60_000;

  private static RELAY_PERMISSIONS_TIMEOUT_MS = 30_000;

  public async requestPermissions(): Promise<RelayPermissionsResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new RelayDoctorRequestError('relay_doctor_failed', 'NOT_CONNECTED');
    }
    if (this.activeRoute !== 'relay') {
      throw new RelayDoctorRequestError('relay_doctor_failed', 'NOT_RELAY');
    }

    const requestId = `req_permissions_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();

    return new Promise<RelayPermissionsResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRelayPermissionsRequests.delete(requestId);
        reject(new RelayDoctorRequestError('relay_doctor_timeout', 'Permissions request timed out.'));
      }, GatewayClient.RELAY_PERMISSIONS_TIMEOUT_MS);

      this.pendingRelayPermissionsRequests.set(requestId, {
        requestId,
        startedAt,
        timeout,
        resolve,
        reject,
      });

      try {
        this.ws?.send(buildRelayPermissionsRequestFrame({ requestId }));
      } catch (error: unknown) {
        clearTimeout(timeout);
        this.pendingRelayPermissionsRequests.delete(requestId);
        reject(new RelayDoctorRequestError(
          'relay_doctor_failed',
          error instanceof Error ? error.message : String(error),
        ));
      }
    });
  }

  public async requestDoctorFix(): Promise<RelayDoctorFixResult> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new RelayDoctorRequestError('relay_doctor_fix_failed', 'NOT_CONNECTED');
    }
    if (this.activeRoute !== 'relay') {
      throw new RelayDoctorRequestError('relay_doctor_fix_failed', 'NOT_RELAY');
    }

    const requestId = `req_doctor_fix_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();

    return new Promise<RelayDoctorFixResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRelayDoctorFixRequests.delete(requestId);
        reject(new RelayDoctorRequestError('relay_doctor_fix_timeout', 'Doctor fix request timed out.'));
      }, GatewayClient.RELAY_DOCTOR_FIX_TIMEOUT_MS);

      this.pendingRelayDoctorFixRequests.set(requestId, {
        requestId,
        startedAt,
        timeout,
        resolve,
        reject,
      });

      try {
        this.ws?.send(buildRelayDoctorFixRequestFrame({ requestId }));
      } catch (error: unknown) {
        clearTimeout(timeout);
        this.pendingRelayDoctorFixRequests.delete(requestId);
        reject(new RelayDoctorRequestError(
          'relay_doctor_fix_failed',
          error instanceof Error ? error.message : String(error),
        ));
      }
    });
  }

  private takePendingRelayDoctorFixRequest(requestId?: string): PendingRelayDoctorFixRequest | null {
    if (requestId) {
      const pending = this.pendingRelayDoctorFixRequests.get(requestId) ?? null;
      if (pending) this.pendingRelayDoctorFixRequests.delete(requestId);
      return pending;
    }
    if (this.pendingRelayDoctorFixRequests.size !== 1) return null;
    const first = this.pendingRelayDoctorFixRequests.values().next().value as PendingRelayDoctorFixRequest | undefined;
    if (!first) return null;
    this.pendingRelayDoctorFixRequests.delete(first.requestId);
    return first;
  }

  private takePendingRelayPermissionsRequest(requestId?: string): PendingRelayPermissionsRequest | null {
    if (requestId) {
      const pending = this.pendingRelayPermissionsRequests.get(requestId) ?? null;
      if (pending) this.pendingRelayPermissionsRequests.delete(requestId);
      return pending;
    }
    if (this.pendingRelayPermissionsRequests.size !== 1) return null;
    const first = this.pendingRelayPermissionsRequests.values().next().value as PendingRelayPermissionsRequest | undefined;
    if (!first) return null;
    this.pendingRelayPermissionsRequests.delete(first.requestId);
    return first;
  }

  private clearPendingRelayDoctorFixRequests(reason: string): void {
    for (const [requestId, pending] of this.pendingRelayDoctorFixRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new RelayDoctorRequestError('relay_doctor_fix_failed', reason));
      this.pendingRelayDoctorFixRequests.delete(requestId);
    }
  }

  // ---- Private: reconnect ----

  private scheduleReconnect(): void {
    if (this.reconnectBlockedReason) {
      this.setState('closed', this.reconnectBlockedReason.message);
      return;
    }
    this.reconnectAttempts += 1;
    const exp = RECONNECT_BASE_MS * Math.pow(1.7, this.reconnectAttempts - 1);
    const backoff = Math.min(RECONNECT_MAX_MS, exp);
    const jitter = 0.75 + Math.random() * 0.5;
    const delay = Math.floor(backoff * jitter);

    // Preserve pairing_pending state during reconnect attempts —
    // the UI should keep showing the pairing prompt, not a generic "reconnecting" state.
    if (!this.pairingPending) {
      this.setState('reconnecting', `retrying in ${delay}ms`);
    }
    this.logTelemetry('reconnect_scheduled', {
      attemptId: this.connectAttemptId,
      route: this.activeRoute,
      reconnectAttempts: this.reconnectAttempts,
      backoffMs: Math.floor(backoff),
      delayMs: delay,
      pairingPending: this.pairingPending,
    });
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startWsOpenTimer(attemptId: number): void {
    this.clearWsOpenTimer();
    this.wsOpenTimer = setTimeout(() => {
      if (attemptId !== this.connectAttemptId || this.manuallyClosed) return;
      if (!this.ws || this.ws.readyState !== WebSocket.CONNECTING) return;
      this.logTelemetry('ws_open_timeout', {
        attemptId,
        route: this.activeRoute,
        elapsedMs: Date.now() - this.connectStartedAt,
      });
      this.emit('error', { code: 'ws_connect_timeout', message: 'WebSocket open timed out' });
      try {
        this.ws.close();
      } catch {
        // Ignore close errors and force a reconnect below.
      }
      this.reconnect();
    }, WS_OPEN_TIMEOUT_MS);
  }

  private clearWsOpenTimer(): void {
    if (this.wsOpenTimer) {
      clearTimeout(this.wsOpenTimer);
      this.wsOpenTimer = null;
    }
  }

  private startChallengeTimer(attemptId: number): void {
    this.clearChallengeTimer();
    this.challengeTimer = setTimeout(() => {
      if (attemptId !== this.connectAttemptId || this.manuallyClosed) return;
      if (!this.ws) return;
      this.logTelemetry('challenge_timeout', {
        attemptId,
        route: this.activeRoute,
        elapsedMs: Date.now() - this.connectStartedAt,
      });
      this.emit('error', { code: 'challenge_timeout', message: 'Gateway challenge timed out' });
      if (this.activeRoute === 'relay') {
        this.logTelemetry('relay_challenge_timeout', { attemptId });
      }
      try {
        this.ws.close();
      } catch {
        // Ignore close errors and force a reconnect below.
      }
      this.reconnect();
    }, CHALLENGE_TIMEOUT_MS);
  }

  private clearChallengeTimer(): void {
    if (this.challengeTimer) {
      clearTimeout(this.challengeTimer);
      this.challengeTimer = null;
    }
  }

  private clearPairingTimer(): void {
    if (this.pairingTimer) {
      clearTimeout(this.pairingTimer);
      this.pairingTimer = null;
    }
  }

  private clearConnectionWatchdogs(): void {
    this.clearWsOpenTimer();
    this.clearChallengeTimer();
    this.clearPairingTimer();
    this.stopTickWatchdog();
  }

  private startTickWatchdog(): void {
    this.stopTickWatchdog();
    this.lastTickAt = Date.now();
    const tolerance = this.tickIntervalMs * 3;
    const check = () => {
      if (this.state !== 'ready') return;
      const elapsed = this.lastTickAt ? Date.now() - this.lastTickAt : tolerance + 1;
      if (elapsed > tolerance) {
        this.lastTickAt = null;
        this.logTelemetry('tick_watchdog_stale', {
          attemptId: this.connectAttemptId,
          route: this.activeRoute,
          elapsedMs: elapsed,
          toleranceMs: tolerance,
        });
        this.reconnect();
        return;
      }
      this.tickWatchdogTimer = setTimeout(check, this.tickIntervalMs);
    };
    this.tickWatchdogTimer = setTimeout(check, tolerance);
  }

  private stopTickWatchdog(): void {
    if (this.tickWatchdogTimer) {
      clearTimeout(this.tickWatchdogTimer);
      this.tickWatchdogTimer = null;
    }
  }

  private startRelayBootstrapTimer(attemptId: number): void {
    this.clearRelayBootstrapTimer();
    this.relayBootstrapTimer = setTimeout(() => {
      if (attemptId !== this.connectAttemptId || this.manuallyClosed) return;
      if (!this.relayBootstrapInFlight) return;
      this.relayBootstrapInFlight = false;
      this.logTelemetry('relay_bootstrap_timeout', {
        attemptId,
        elapsedMs: Date.now() - this.connectStartedAt,
      });
      this.emit('error', { code: 'relay_bootstrap_timeout', message: 'Relay bootstrap timed out' });
      this.reconnect();
    }, RELAY_BOOTSTRAP_TIMEOUT_MS);
  }

  private clearRelayBootstrapTimer(): void {
    if (this.relayBootstrapTimer) {
      clearTimeout(this.relayBootstrapTimer);
      this.relayBootstrapTimer = null;
    }
  }

  private recoverStaleTransport(reason: string): void {
    if (this.manuallyClosed || this.pairingPending || this.reconnectBlockedReason) {
      return;
    }
    this.logTelemetry('stale_transport_recovered', {
      attemptId: this.connectAttemptId,
      route: this.activeRoute,
      reason,
      state: this.state,
      wsReadyState: this.ws?.readyState,
    });
    if (this.state === 'ready') {
      this.setState('reconnecting', reason);
    }
    this.reconnect();
  }

  private waitForReady(timeoutMs: number): Promise<boolean> {
    if (this.state === 'ready' && this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(this.state === 'ready' && this.ws?.readyState === WebSocket.OPEN);
      }, timeoutMs);

      const unsubscribe = this.on('connection', ({ state }) => {
        if (settled || state !== 'ready' || this.ws?.readyState !== WebSocket.OPEN) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(true);
      });
    });
  }

  private makeConnectTraceId(attemptId: number): string {
    return `gw-${Date.now().toString(36)}-${attemptId.toString(36)}`;
  }

  private redactWsUrl(rawUrl: string): string {
    try {
      const url = new URL(rawUrl);
      return `${url.origin}${url.pathname}`;
    } catch {
      return rawUrl;
    }
  }

  private logTelemetry(event: string, fields: Record<string, unknown>): void {
    const payload = {
      scope: 'gateway_client',
      event,
      traceId: this.connectTraceId,
      ts: Date.now(),
      ...fields,
    };
    if (this.getBackendKind() !== 'hermes' || !this.shouldLogHermesTelemetryEvent(event)) {
      return;
    }
    const serialized = Object.entries(payload)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}=${this.serializeHermesTelemetryValue(value)}`)
      .join(' ');
    // console.log(`[hermes-connect] gateway_event=${event} ${serialized}`);
    // markHermesConnectTrace(`gateway_${event}`, fields);
    void serialized;
  }

  private shouldLogHermesTelemetryEvent(event: string): boolean {
    switch (event) {
      case 'connect_start':
      case 'connect_skipped':
      case 'ws_connecting':
      case 'ws_open':
      case 'ws_error':
      case 'ws_close':
      case 'reconnect_scheduled':
      case 'reconnect_skipped':
      case 'ws_open_timeout':
      case 'challenge_timeout':
      case 'relay_challenge_timeout':
      case 'relay_bootstrap_timeout':
      case 'connect_handshake_start':
      case 'connect_req_sent':
      case 'connect_ready':
      case 'connect_res_err':
      case 'relay_bootstrap_issued':
      case 'relay_bootstrap_failed':
      case 'relay_bootstrap_requested':
      case 'relay_bootstrap_fallback_legacy':
      case 'stale_transport_recovered':
      case 'tick_watchdog_stale':
        return true;
      default:
        return false;
    }
  }

  private serializeHermesTelemetryValue(value: unknown): string {
    if (typeof value === 'string') {
      return value.replace(/\s+/g, ' ').trim().slice(0, 160);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  private shouldTraceRequest(method: string): boolean {
    return method === 'connect';
  }

  private emitBlockedReconnectError(): void {
    const reason = this.reconnectBlockedReason;
    if (!reason) return;
    this.emit('error', {
      code: reason.code,
      message: reason.message,
      retryable: false,
      hint: reason.hint,
    });
  }

  private clearReconnectBlock(): void {
    this.reconnectBlockedReason = null;
  }

  private isActiveConnectAttempt(attemptId: number): boolean {
    return !this.manuallyClosed && attemptId === this.connectAttemptId;
  }

  private readTimedCache<T>(entry: TimedValue<T> | null | undefined): T | null {
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) return null;
    return entry.value;
  }

  private clearGatewayMetadataCaches(): void {
    this.invalidateSessionMetadataCache();
    this.invalidateAgentMetadataCache();
  }

  private invalidateSessionMetadataCache(): void {
    this.sessionListCache.clear();
    this.pendingSessionListRequests.clear();
    this.historyCache.clear();
    this.pendingHistoryRequests.clear();
  }

  private invalidateAgentMetadataCache(agentId?: string): void {
    this.agentsListCache = null;
    this.pendingAgentsListRequest = null;
    if (agentId) {
      this.agentIdentityCache.delete(agentId);
      this.pendingAgentIdentityRequests.delete(agentId);
      return;
    }
    this.agentIdentityCache.clear();
    this.pendingAgentIdentityRequests.clear();
  }

  private blockReconnect(reason: { code: string; message: string; hint?: string }): void {
    this.reconnectBlockedReason = reason;
    this.clearReconnectTimer();
    this.clearRelayBootstrapTimer();
    this.relayBootstrapInFlight = false;
    this.emit('error', {
      code: reason.code,
      message: reason.message,
      retryable: false,
      hint: reason.hint,
    });
  }

  private isNonRetryableAuthError(message: string): boolean {
    const code = message.match(/^\[([^\]]+)\]/)?.[1]?.toUpperCase() ?? '';
    if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') {
      return true;
    }
    const normalized = message.toLowerCase();
    return normalized.includes('invalid token')
      || normalized.includes('forbidden')
      || normalized.includes('unauthorized')
      || normalized.includes('relay client token')
      || normalized.includes('pairing credential');
  }

  private getCurrentRelayBootstrapCompatibilityKey(): string | null {
    const serverUrl = this.config?.relay?.serverUrl?.trim();
    const gatewayId = this.config?.relay?.gatewayId?.trim();
    if (!serverUrl || !gatewayId) return null;
    return `${serverUrl}::${gatewayId}`;
  }

  private isRelayBootstrapCompatibilityDisabledForCurrentConfig(): boolean {
    const key = this.getCurrentRelayBootstrapCompatibilityKey();
    return Boolean(key && this.relayBootstrapCompatibilityDisabledForKey === key);
  }

  private disableRelayBootstrapCompatibilityForCurrentConfig(): void {
    this.relayBootstrapCompatibilityDisabledForKey = this.getCurrentRelayBootstrapCompatibilityKey();
  }

  private restartConnection(reason: string): void {
    this.manuallyClosed = false;
    this.pairingPending = false;
    this.relayAttemptedForCycle = false;
    this.relayBootstrapInFlight = false;
    this.clearRelayBootstrapTimer();
    this.clearReconnectTimer();
    this.clearConnectionWatchdogs();
    this.reconnectAttempts = 0;
    this.clearPendingRelayBootstrapRequests(reason);
    this.clearPendingRelayDoctorRequests(reason);
    this.clearPendingRelayDoctorFixRequests(reason);
    this.clearPendingRelayPermissionsRequests(reason);
    this.connectRequestInFlight = false;
    this.connectRequestCompleted = false;

    this.rejectPendingRequests(reason);

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }

    this.connect();
  }

  private resolveUnsupportedDirectLocalTlsReason(
    wsUrl: string,
  ): { code: string; message: string; hint?: string } | null {
    if (!isUnsupportedDirectLocalTlsConfig({
      url: wsUrl,
      hasRelayConfig: Boolean(this.config?.relay?.gatewayId),
    })) {
      return null;
    }
    return {
      code: 'local_tls_unsupported',
      message: 'Clawket mobile does not currently support direct local TLS gateway connections. Disable OpenClaw gateway TLS for LAN pairing, or use Relay/Tailscale instead.',
      hint: 'If you are connecting over your local network, set gateway.tls.enabled to false before pairing.',
    };
  }
}
