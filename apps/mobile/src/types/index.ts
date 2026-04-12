// ---- Core UI types ----

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

// ---- Device / Config ----

export interface DeviceIdentity {
  deviceId: string;
  publicKeyHex: string;
  secretKeyHex: string;
  createdAt: string;
}

export interface RelayGatewayConfig {
  serverUrl: string;
  gatewayId: string;
  clientToken?: string;
  displayName?: string;
  protocolVersion?: number;
  supportsBootstrap?: boolean;
}

export interface HermesGatewayConfig {
  bridgeUrl: string;
  displayName?: string;
}

export type GatewayBackendKind = 'openclaw' | 'hermes';
export type GatewayTransportKind = 'local' | 'tailscale' | 'cloudflare' | 'custom' | 'relay';
export type GatewayMode = GatewayTransportKind | 'hermes';

export interface GatewayConfig {
  url: string;
  token?: string;
  password?: string;
  backendKind?: GatewayBackendKind;
  transportKind?: GatewayTransportKind;
  /** Transitional legacy field: prefer backendKind + transportKind for new code. */
  mode?: GatewayMode;
  relay?: RelayGatewayConfig;
  hermes?: HermesGatewayConfig;
  debugMode?: boolean;
}

export type GatewayProfileMode = 'local' | 'tailscale' | 'cloudflare';

export interface GatewayProfileConfig {
  url: string;
  token?: string;
  password?: string;
}

export interface GatewayProfilesConfig {
  activeMode: GatewayProfileMode;
  local: GatewayProfileConfig;
  tailscale: GatewayProfileConfig;
  cloudflare: GatewayProfileConfig;
}

export interface SavedGatewayConfig {
  id: string;
  name: string;
  backendKind?: GatewayBackendKind;
  transportKind?: GatewayTransportKind;
  /** Transitional legacy field: prefer backendKind + transportKind for new code. */
  mode: GatewayMode;
  url: string;
  token?: string;
  password?: string;
  relay?: RelayGatewayConfig;
  hermes?: HermesGatewayConfig;
  createdAt: number;
  updatedAt: number;
}

export interface GatewayConfigsState {
  activeId: string | null;
  configs: SavedGatewayConfig[];
}

export type ThemeMode = 'system' | 'light' | 'dark';
export type SpeechRecognitionLanguage = 'system' | 'en' | 'zh-Hans' | 'ja' | 'ko' | 'de' | 'es';
export type AccentColorId = 'iceBlue' | 'jadeGreen' | 'oceanTeal' | 'sunsetOrange' | 'rosePink' | 'royalPurple' | 'custom';
export type {
  ChatAppearanceSettings,
  ChatBackgroundFillMode,
  ChatBubbleStyle,
} from './chat-appearance';

// ---- Real Protocol Frames (req / res / event) ----

export interface ReqFrame {
  type: 'req';
  id: string;
  method: string;
  params?: object;
}

export interface ResFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
    retryAfterMs?: number;
  };
}

export interface EventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: { presence: number; health: number };
}

export type GatewayFrame = ReqFrame | ResFrame | EventFrame;

// ---- Event Payloads ----

export interface ConnectChallengePayload {
  nonce: string;
  ts: number;
}

export interface HelloOkPayload {
  protocol: number;
  server: { version: string };
  features?: string[];
  auth?: { deviceToken?: string };
  policy?: unknown;
}

// ---- API Params / Responses ----

export interface SessionInfo {
  key: string;
  sessionId?: string;
  spawnedBy?: string;
  kind?: 'direct' | 'group' | 'global' | 'unknown';
  label?: string;
  title?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  updatedAt?: number | null;
  channel?: string;
  model?: string;
  modelProvider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalTokensFresh?: boolean;
  contextTokens?: number;
}

export interface SessionsListPayload {
  sessions: SessionInfo[];
}

export interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  seq: number;
  state: 'delta' | 'final' | 'aborted' | 'error';
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  errorMessage?: string;
  usage?: unknown;
  stopReason?: string;
}

export interface AgentEventPayload {
  runId: string;
  seq?: number;
  stream?: 'lifecycle' | 'assistant' | 'tool' | 'error' | string;
  ts?: number;
  sessionKey?: string;
  data?: {
    phase?: 'start' | 'update' | 'result' | string;
    name?: string;
    toolCallId?: string;
    args?: unknown;
    result?: unknown;
    partialResult?: unknown;
    isError?: boolean;
    error?: unknown;
    meta?: string;
  };
}

// ---- Connections (Nodes / Devices) ----

export interface NodeInfo {
  nodeId: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  remoteIp?: string;
  caps: string[];
  commands: string[];
  connectedAtMs?: number;
  paired: boolean;
  connected: boolean;
}

export interface NodeListResult {
  ts: number;
  nodes: NodeInfo[];
}

export interface NodePairRequest {
  requestId: string;
  nodeId: string;
  displayName?: string;
  platform?: string;
  requestedAtMs?: number;
}

export interface NodePairListResult {
  pending: NodePairRequest[];
  nodes: NodeInfo[];
}

export interface DeviceTokenInfo {
  role: string;
  scopes: string[];
  lastUsedAtMs?: number;
}

export interface DeviceInfo {
  deviceId: string;
  displayName?: string;
  platform?: string;
  role?: string;
  remoteIp?: string;
  pairedAtMs?: number;
  tokens?: Record<string, DeviceTokenInfo>;
}

export interface DevicePairRequest {
  requestId: string;
  deviceId: string;
  displayName?: string;
  platform?: string;
  role?: string;
  requestedAtMs?: number;
}

export interface DevicePairListResult {
  pending: DevicePairRequest[];
  paired: DeviceInfo[];
}

export interface ChannelUiMetaEntry {
  id: string;
  label: string;
  detailLabel: string;
  systemImage?: string;
}

export interface ChannelSummary {
  configured?: boolean;
  linked?: boolean;
  running?: boolean;
  connected?: boolean;
  [key: string]: unknown;
}

export interface ChannelStatusAccount {
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  linked?: boolean;
  running?: boolean;
  connected?: boolean;
  reconnectAttempts?: number;
  lastConnectedAt?: number | null;
  lastMessageAt?: number | null;
  lastEventAt?: number | null;
  lastError?: string | null;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastInboundAt?: number | null;
  lastOutboundAt?: number | null;
  lastProbeAt?: number | null;
  mode?: string;
  dmPolicy?: string;
  allowFrom?: string[];
  [key: string]: unknown;
}

export interface ChannelsStatusResult {
  ts: number;
  channelOrder: string[];
  channelLabels: Record<string, string>;
  channelDetailLabels: Record<string, string>;
  channelSystemImages: Record<string, string>;
  channelMeta: ChannelUiMetaEntry[];
  channels: Record<string, ChannelSummary>;
  channelAccounts: Record<string, ChannelStatusAccount[]>;
  channelDefaultAccountId: Record<string, string>;
}

// ---- Tool Stream ----

export type ToolStreamEntry = {
  toolCallId: string;
  runId: string;
  sessionKey?: string;
  name: string;
  args?: unknown;
  output?: string;
  /** Current status of the tool call */
  status: 'running' | 'success' | 'error';
  startedAt: number;
  updatedAt: number;
};

// ---- Connection State ----

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'challenging'
  | 'ready'
  | 'reconnecting'
  | 'pairing_pending'
  | 'closed';

// ---- Type Guards ----

export function isReqFrame(value: unknown): value is ReqFrame {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v['type'] === 'req' && typeof v['id'] === 'string' && typeof v['method'] === 'string';
}

export function isResFrame(value: unknown): value is ResFrame {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v['type'] === 'res' && typeof v['id'] === 'string' && typeof v['ok'] === 'boolean';
}

export function isEventFrame(value: unknown): value is EventFrame {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v['type'] === 'event' && typeof v['event'] === 'string';
}

export function isGatewayFrame(value: unknown): value is GatewayFrame {
  return isReqFrame(value) || isResFrame(value) || isEventFrame(value);
}

export * from './cron';
export * from './office';
export type { LogEntry, LogLevel } from './logs';
export { LOG_LEVELS } from './logs';
export * from './skills';
export type {
  UsageResult,
  CostSummary,
  UsageTotals,
  UsageAggregates,
  UsageModelEntry,
  UsageToolEntry,
  UsageSessionEntry,
  UsageDailyEntry,
  CostDailyEntry,
} from './usage';

// ---- Tools Catalog ----

export type ToolCatalogEntry = {
  id: string;
  label: string;
  description: string;
  source: 'core' | 'plugin';
  pluginId?: string;
  optional?: boolean;
  defaultProfiles: string[];
};

export type ToolCatalogGroup = {
  id: string;
  label: string;
  source: 'core' | 'plugin';
  pluginId?: string;
  tools: ToolCatalogEntry[];
};

export type ToolsCatalogResult = {
  agentId: string;
  profiles: Array<{ id: string; label: string }>;
  groups: ToolCatalogGroup[];
};
