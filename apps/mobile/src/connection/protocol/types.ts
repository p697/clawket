import type {
  ConnectionState,
  DeviceIdentity,
  GatewayConfig,
} from '../../types';
import type { WebSocketFactory } from '../transports';

export type GatewayProtocolEvents = {
  connection: { state: ConnectionState; reason?: string };
  chatDelta: { runId: string; sessionKey: string; text: string };
  chatTool: {
    runId: string;
    sessionKey?: string;
    toolCallId: string;
    name: string;
    phase: 'start' | 'update' | 'result';
    timestampMs?: number;
    args?: unknown;
    output?: string;
    status: 'running' | 'success' | 'error';
  };
  chatFinal: {
    runId: string;
    sessionKey?: string;
    message?: {
      role?: string;
      content?: string | Array<{ type: string; text?: string }>;
      provider?: string;
      model?: string;
    };
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      total?: number;
    };
  };
  chatAborted: { runId: string; sessionKey?: string };
  chatError: { runId: string; sessionKey?: string; message: string };
  chatRunStart: { runId: string; sessionKey?: string };
  chatCompaction: { runId: string; sessionKey?: string; phase: 'start' | 'end' };
  pairingRequired: { requestId?: string };
  pairingResolved: {
    requestId?: string;
    deviceId?: string;
    decision: 'approved' | 'rejected';
  };
  execApprovalRequested: {
    id: string;
    request: {
      command: string;
      commandArgv?: string[];
      cwd?: string;
      host?: string;
      security?: string;
      sessionKey?: string;
    };
    createdAtMs: number;
    expiresAtMs: number;
  };
  execApprovalResolved: { id: string; decision: string };
  seqGap: { sessionKey?: string; fromSeq?: number; toSeq?: number };
  sessionsChanged: { sessions?: unknown[] };
  health: { status?: string; ts?: number; [key: string]: unknown };
  tick: Record<string, never>;
  error: { code: string; message: string; retryable?: boolean; hint?: string };
};

/** Compatibility name used by the strangler adapters during M4. */
export type GatewayEvents = GatewayProtocolEvents;

export type GatewayProtocolListener<T> = (payload: T) => void;

export type DeviceTokenStorageScope = {
  serverUrl?: string | null;
  gatewayId?: string | null;
  gatewayUrl?: string | null;
  role?: string | null;
};

export type DeviceTokenRecord = {
  token: string;
  role: string;
  scopes: string[];
};

export type GatewayProtocolCredentialStore = {
  getDeviceTokenRecord(
    deviceId: string,
    scope?: DeviceTokenStorageScope,
  ): Promise<DeviceTokenRecord | null>;
  setDeviceTokenRecord(
    deviceId: string,
    record: DeviceTokenRecord,
    scope?: DeviceTokenStorageScope,
  ): Promise<void>;
  deleteDeviceToken(deviceId: string, scope?: DeviceTokenStorageScope): Promise<void>;
};

export type GatewayProtocolClientIdentity = {
  id: string;
  platform: string;
  deviceFamily: string;
  version: string;
  displayName?: string;
};

export type GatewayProtocolHealthReadiness =
  | { state: 'ready' }
  | {
      state: 'error';
      code: string;
      message: string;
      retryable?: boolean;
    };

/**
 * Backend protocol differences selected by the adapter that owns the client.
 * The protocol client consumes these values without inferring a backend from
 * legacy configuration fields.
 */
export type GatewayProtocolProfile = Readonly<{
  relayIdQueryParam: 'gatewayId' | 'bridgeId';
  baseUrlSocketPathPattern: RegExp;
  challengeEvent?: string;
  healthReadiness?: (
    payload: GatewayProtocolEvents['health'],
    context: Readonly<{ hasPayload: boolean }>,
  ) => GatewayProtocolHealthReadiness;
  readinessTimeoutOption: 'handshakeTimeoutMs' | 'directFirstFrameTimeoutMs';
  readinessTimeoutMs: number;
  readinessTimeoutError: Readonly<{
    code: string;
    message: string;
  }>;
  currentModelMethod: 'model.get' | 'model.current';
}>;

export type GatewayProtocolClientOptions = {
  profile: GatewayProtocolProfile;
  webSocketFactory?: WebSocketFactory;
  identityProvider?: () => Promise<DeviceIdentity>;
  credentialStore?: GatewayProtocolCredentialStore;
  requestId?: () => string;
  now?: () => number;
  client?: GatewayProtocolClientIdentity;
  requestTimeoutMs?: number;
  connectRequestTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  reconnectFactor?: number;
  reconnectJitter?: boolean;
  openTimeoutMs?: number;
  directFirstFrameTimeoutMs?: number;
  random?: () => number;
};

export type GatewayProtocolSnapshot = {
  config: GatewayConfig | null;
  state: ConnectionState;
  route: 'direct' | 'relay';
};

export type GatewayInfo = {
  version: string;
  connId: string;
  uptimeMs: number;
  host?: string;
  ip?: string;
  platform?: string;
  authMode?: string;
  updateAvailable?: { currentVersion: string; latestVersion: string };
};

export class GatewayRequestError extends Error {
  public readonly code: string;
  public readonly details?: unknown;
  public readonly retryable?: boolean;
  public readonly retryAfterMs?: number;

  constructor(input: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
    retryAfterMs?: number;
  }) {
    super(`[${input.code}] ${input.message}`);
    this.name = 'GatewayRequestError';
    this.code = input.code;
    this.details = input.details;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs;
  }
}
