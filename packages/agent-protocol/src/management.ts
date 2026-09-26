import type { ApprovalRequest } from './descriptors';

// These protocol-owned data shapes mirror the existing mobile GatewayClient
// return/input types. Keeping them here avoids a forbidden dependency from a
// platform-neutral package back into the React Native application.

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  /** Optional backend recommendation order within a provider; lower comes first. */
  sortOrder?: number;
  /** Native canonical model behind an alias. Display/search only; writes keep `id`. */
  resolvedModel?: string;
  contextWindow?: number;
  reasoning?: boolean;
  reasoningLevels?: ThinkingLevel[];
  input?: Array<'text' | 'image'>;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

export interface ModelProviderInfo {
  slug: string;
  name: string;
  isCurrent: boolean;
  models: string[];
  totalModels: number;
  source?: string;
  apiUrl?: string;
}

export interface ModelSelectionState {
  thinkingLevel?: ThinkingLevel;
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  models: ModelInfo[];
  providers?: ModelProviderInfo[];
  note?: string | null;
}

export interface ModelSelectionWrite {
  model: string;
  provider?: string;
  scope?: 'global' | 'session';
  sessionKey?: string | null;
}

export interface ModelSelectionWriteResult extends ModelSelectionState {
  ok: boolean;
  scope: 'global' | 'session';
}

/** A catalog entry plus its Gateway config status; `modelManage` backends only. */
export interface ModelCatalogModel extends ModelInfo {
  /** Declared under `models.providers.<slug>.models[]` in Gateway config. */
  configured: boolean;
  /** `cost` comes from an explicit config override rather than the catalog. */
  costOverridden: boolean;
}

export interface ModelCatalogProvider {
  slug: string;
  /** Declared under `models.providers` in Gateway config; only explicit providers accept cost overrides. */
  explicit: boolean;
  baseUrl?: string;
  api?: string;
  models: ModelCatalogModel[];
}

export interface ModelCatalogDefaults {
  /** `provider/model` reference, or empty when the Gateway default is unset. */
  primary: string;
  fallbacks: string[];
  thinkingDefault: string;
}

export interface ModelCatalogState {
  defaults: ModelCatalogDefaults;
  /** `provider/model` references, or `null` when the Gateway has no allowlist and every catalog model is usable. */
  allowlist: string[] | null;
  providers: ModelCatalogProvider[];
}

export interface ModelAllowlistChange {
  provider: string;
  modelId: string;
  enabled: boolean;
}

export interface ModelCatalogWrite {
  defaults?: ModelCatalogDefaults;
  /** Desired state per model; unchanged entries are ignored. */
  allowlist?: ModelAllowlistChange[];
}

export interface ModelCatalogModelRef {
  provider: string;
  modelId: string;
}

export interface ModelCatalogAddInput extends ModelCatalogModelRef {
  modelName: string;
}

export interface ModelDeletionBlock {
  path: string;
  reason: string;
  detail?: string;
}

export interface ModelDeletionPreview {
  canDelete: boolean;
  blocks: ModelDeletionBlock[];
  cleanupCount: number;
}

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCostWrite extends ModelCatalogModelRef {
  modelName: string;
  cost: ModelCost;
}

export type ThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'adaptive'
  | 'none'
  | 'max'
  | 'ultra';

export interface RequirementStatus {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
}

export interface SkillConfigCheck {
  path: string;
  label: string;
  satisfied: boolean;
}

export interface SkillInstallOption {
  id: string;
  kind: 'brew' | 'node' | 'go' | 'uv' | 'download';
  label: string;
  bins: string[];
}

export type SkillLinkedFiles = {
  references?: string[];
  templates?: string[];
  assets?: string[];
  scripts?: string[];
  other?: string[];
} | null;

export interface SkillStatusEntry {
  /** Adapter-authored, explicit invocation prefix for this available installed skill. */
  invocation?: string;
  name: string;
  description: string;
  source: string;
  bundled: boolean;
  filePath: string;
  baseDir: string;
  skillKey: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  always: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  eligible: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
  deletable?: boolean;
  requirements: RequirementStatus;
  missing: RequirementStatus;
  configChecks: SkillConfigCheck[];
  install: SkillInstallOption[];
}

export interface SkillStatusReport {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: SkillStatusEntry[];
}

export interface SkillDetail {
  skillKey: string;
  name: string;
  path: string;
  content: string;
  filePath?: string | null;
  fileType?: string | null;
  isBinary?: boolean;
  linkedFiles: SkillLinkedFiles;
  editable: boolean;
}

export interface SkillPatch {
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
}

export type DiscoverSource = 'clawhub' | 'skills_sh';

export interface DiscoverSkillItem {
  id: string;
  source: DiscoverSource;
  slug: string;
  title: string;
  summary: string;
  author: string;
  repository?: string | null;
  detailUrl: string;
  installCommand?: string | null;
  installs?: number | null;
  installsRecent?: number | null;
  rankLabel?: string | null;
  tags?: string[];
  isOfficial?: boolean;
}

export interface DiscoverResult {
  items: DiscoverSkillItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string; staggerMs?: number };

export type CronSessionTarget = 'main' | 'isolated';
export type CronWakeMode = 'next-heartbeat' | 'now';
export type CronRunStatus = 'ok' | 'error' | 'skipped';
export type CronDeliveryStatus = 'delivered' | 'not-delivered' | 'unknown' | 'not-requested';

export interface CronDelivery {
  mode: 'none' | 'announce' | 'webhook';
  channel?: string;
  to?: string;
  bestEffort?: boolean;
}

export type CronPayload =
  | { kind: 'systemEvent'; text: string }
  | {
      kind: 'agentTurn';
      message: string;
      model?: string;
      thinking?: string;
      timeoutSeconds?: number;
      deliver?: boolean;
      channel?: string;
      to?: string;
    };

export interface CronJobState {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: CronRunStatus;
  lastStatus?: CronRunStatus;
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  lastDeliveryStatus?: CronDeliveryStatus;
  lastDeliveryError?: string;
  lastDelivered?: boolean;
}

export interface CronJob {
  id: string;
  agentId?: string;
  sessionKey?: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronPayload;
  delivery?: CronDelivery;
  state: CronJobState;
}

export type CronJobCreate = Omit<CronJob, 'id' | 'createdAtMs' | 'updatedAtMs' | 'state'>;
/**
 * Payload for `CronJobPatch`. `model: null` clears an `agentTurn` override
 * (OpenClaw `cron.update` contract); a string replaces it.
 */
export type CronPayloadPatch =
  | Extract<CronPayload, { kind: 'systemEvent' }>
  | (Omit<Extract<CronPayload, { kind: 'agentTurn' }>, 'model'> & { model?: string | null });

export type CronJobPatch = Partial<Omit<CronJob, 'id' | 'createdAtMs' | 'state' | 'payload'>> & { payload?: CronPayloadPatch };

/** One routing target of a run's delivery trace (OpenClaw `delivery.intended` / `messageToolSentTo`). */
export interface CronDeliveryTraceTarget {
  channel?: string;
  to?: string | null;
  accountId?: string;
  threadId?: string | number;
  source?: string;
}

/**
 * OpenClaw's per-run delivery trace: where the job meant to deliver and where the
 * Agent itself sent through the message tool. Routing only; the sent text is not
 * on the wire and comes from the run transcript (`CronOperations.runContent`).
 */
export interface CronDeliveryTrace {
  intended?: CronDeliveryTraceTarget;
  resolved?: CronDeliveryTraceTarget;
  messageToolSentTo?: CronDeliveryTraceTarget[];
  fallbackUsed?: boolean;
  delivered?: boolean;
}

export interface CronRunLogEntry {
  ts: number;
  jobId: string;
  action: 'finished';
  status?: CronRunStatus;
  completionStatus?: 'succeeded' | 'failed' | 'unknown';
  error?: string;
  summary?: string;
  delivered?: boolean;
  deliveryStatus?: CronDeliveryStatus;
  deliveryError?: string;
  delivery?: CronDeliveryTrace;
  sessionId?: string;
  /**
   * Session that held the run. OpenClaw reports the hidden per-run key
   * (`agent:<id>:cron:<job>:run:<sessionId>`); the readable transcript lives on the
   * stable job key, see `resolveCronRunSessionKey` in the Mobile adapters.
   */
  sessionKey?: string;
  runId?: string;
  runAtMs?: number;
  durationMs?: number;
  nextRunAtMs?: number;
  model?: string;
  provider?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  jobName?: string;
  /** Backend-owned reference to the run's stored output (Hermes cron output file name). */
  outputRef?: string;
}

/** One message a run sent through a channel tool, in send order. */
export interface CronRunDeliveredMessage {
  channel?: string;
  target?: string;
  text: string;
}

/**
 * What a completed run actually produced for the user, beyond the summary:
 * the messages it sent and/or the output the backend stored.
 */
export interface CronRunContent {
  deliveries: CronRunDeliveredMessage[];
  /** Full stored output when the backend keeps one (Hermes cron output files). */
  output?: string;
  /** Session that still holds this run's transcript; absent once the backend recycled it. */
  sessionKey?: string;
}

export interface CronListParams {
  includeDisabled?: boolean;
  limit?: number;
  offset?: number;
  query?: string;
  enabled?: 'all' | 'enabled' | 'disabled';
  sortBy?: 'nextRunAtMs' | 'updatedAtMs' | 'name';
  sortDir?: 'asc' | 'desc';
}

export interface CronListResult {
  jobs: CronJob[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface CronRunsParams {
  scope?: 'job' | 'all';
  id?: string;
  limit?: number;
  offset?: number;
  sortDir?: 'asc' | 'desc';
}

export interface CronRunsResult {
  entries: CronRunLogEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface HeartbeatSettings {
  every: string;
  activeStart: string;
  activeEnd: string;
  activeTimezone: string;
  session: string;
  model: string;
}

export interface HeartbeatStatus {
  /** Epoch milliseconds of the last completed heartbeat, or null when the backend has none. */
  lastHeartbeatAt: number | null;
}

export interface AgentCreate {
  name: string;
  emoji?: string;
  avatar?: string;
}

export interface AgentIdentity {
  name?: string;
  emoji?: string;
  avatar?: string;
  avatarUrl?: string;
}

export interface AgentInfo {
  id: string;
  name?: string;
  identity?: AgentIdentity;
}

export interface AgentsListResult {
  defaultId: string;
  mainKey: string;
  agents: AgentInfo[];
}

export interface AgentCreateResult {
  ok: boolean;
  agentId: string;
  name: string;
  workspace: string;
}

export interface AgentUpdateResult {
  ok: boolean;
  agentId: string;
}

export interface AgentDeleteResult {
  ok: boolean;
  agentId: string;
  removedBindings?: number;
}

export interface AgentPatch {
  name?: string;
  workspace?: string;
  model?: string;
  emoji?: string;
  avatar?: string;
}

export interface AgentFile {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
  content?: string;
}

export type AgentFileSummary = Omit<AgentFile, 'content'>;

export interface UsageQuery {
  startDate: string;
  endDate: string;
  agentId?: string;
}

export type CostQuery = UsageQuery;

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  missingCostEntries: number;
}

export interface CostPresentation {
  mode: 'currency' | 'included' | 'estimated' | 'actual' | 'unknown' | 'mixed';
  relevantSessions?: number;
  includedSessions?: number;
  estimatedSessions?: number;
  actualSessions?: number;
  unknownSessions?: number;
}

export interface UsageSessionEntry {
  key: string;
  label?: string;
  agentId?: string;
  channel?: string;
  model?: string;
  modelProvider?: string;
  updatedAt?: number;
  usage: {
    totalTokens: number;
    totalCost: number;
    costStatus?: string;
    costSource?: string;
    messageCounts?: {
      total: number;
      user: number;
      assistant: number;
      toolCalls: number;
      toolResults: number;
      errors: number;
    };
  } | null;
}

export interface UsageModelEntry {
  provider?: string;
  model?: string;
  count: number;
  totals: UsageTotals;
}

export interface UsageDailyEntry {
  date: string;
  tokens: number;
  cost: number;
  messages: number;
  toolCalls: number;
  errors: number;
}

export interface UsageAggregates {
  messages: {
    total: number;
    user: number;
    assistant: number;
    toolCalls: number;
    toolResults: number;
    errors: number;
  };
  tools: { totalCalls: number; uniqueTools: number; tools: Array<{ name: string; count: number }> };
  byModel: UsageModelEntry[];
  byProvider: UsageModelEntry[];
  byAgent: Array<{ agentId: string; totals: UsageTotals }>;
  byChannel: Array<{ channel: string; totals: UsageTotals }>;
  daily: UsageDailyEntry[];
}

export interface UsageResult {
  updatedAt?: number;
  startDate?: string;
  endDate?: string;
  sessions?: UsageSessionEntry[];
  totals?: UsageTotals;
  aggregates?: UsageAggregates;
  costPresentation?: CostPresentation;
}

export interface CostSummary {
  updatedAt?: number;
  days?: number;
  daily?: Array<UsageTotals & { date: string }>;
  totals?: UsageTotals;
  costPresentation?: CostPresentation;
}

export interface ConfigView {
  config: Record<string, unknown> | null;
  hash: string | null;
}

export interface ConfigPatchResult {
  ok: boolean;
  config?: Record<string, unknown>;
  hash?: string;
}

export interface ConfigSetResult {
  ok: boolean;
  config?: Record<string, unknown>;
  path?: string;
}

export type PermissionStatus =
  | 'available'
  | 'needs_approval'
  | 'restricted'
  | 'disabled'
  | 'configuration_needed';

export interface PermissionSummary {
  status: PermissionStatus;
  summary: string;
  reasons: string[];
}

export interface PermissionsReport {
  configPath: string;
  approvalsPath: string;
  web: PermissionSummary & {
    searchEnabled: boolean;
    searchProvider: string;
    searchConfigured: boolean;
    fetchEnabled: boolean;
    firecrawlConfigured: boolean;
  };
  exec: PermissionSummary & {
    currentAgentId: string;
    currentAgentName: string;
    toolProfile: 'minimal' | 'coding' | 'messaging' | 'full' | 'unset';
    execToolAvailable: boolean;
    hostApprovalsApply: boolean;
    implicitSandboxFallback: boolean;
    configuredHost: 'sandbox' | 'gateway' | 'node';
    effectiveHost: 'sandbox' | 'gateway' | 'node';
    sandboxMode: 'off' | 'non-main' | 'all';
    configSecurity: 'deny' | 'allowlist' | 'full';
    configAsk: 'off' | 'on-miss' | 'always';
    approvalsExists: boolean;
    approvalsSecurity: 'deny' | 'allowlist' | 'full';
    approvalsAsk: 'off' | 'on-miss' | 'always';
    effectiveSecurity: 'deny' | 'allowlist' | 'full';
    effectiveAsk: 'off' | 'on-miss' | 'always';
    allowlistCount: number;
    toolPolicyDenied: boolean;
    safeBins: string[];
    safeBinTrustedDirs: string[];
    trustedDirWarnings: string[];
  };
  codeExecution: PermissionSummary & { inheritsFromExec: true };
}

export interface DoctorResult {
  ok: boolean;
  checks: Array<{ name: string; status: 'pass' | 'fail' | 'warn' | 'skip' | string; message?: string }>;
  summary: string;
  raw?: string;
}

export interface RepairResult {
  ok: boolean;
  summary: string;
  raw?: string;
}

export interface Backup {
  id: string;
  createdAt: number;
}

export interface ToolCatalogEntry {
  id: string;
  label: string;
  description: string;
  source: 'core' | 'plugin';
  pluginId?: string;
  optional?: boolean;
  defaultProfiles: string[];
}

export interface ToolCatalogGroup {
  id: string;
  label: string;
  source: 'core' | 'plugin';
  pluginId?: string;
  tools: ToolCatalogEntry[];
}

export interface ToolCatalog {
  agentId: string;
  profiles: Array<{ id: string; label: string }>;
  groups: ToolCatalogGroup[];
}

export interface ToolPolicy {
  agentId: string;
  profile?: string;
  allow?: string[];
  alsoAllow?: string[];
  deny?: string[];
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

export interface ChannelStatusAccount extends ChannelSummary {
  accountId: string;
  name?: string;
  enabled?: boolean;
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

/**
 * How direct messages arriving on channels map onto sessions (OpenClaw
 * `session.dmScope`). `main` shares the Agent's main session across every
 * channel; the other scopes isolate by sender, by channel + sender, or by
 * receiving account + channel + sender. Group and channel conversations keep
 * their own sessions regardless.
 */
export const DM_SCOPES = ['main', 'per-peer', 'per-channel-peer', 'per-account-channel-peer'] as const;
export type DmScope = typeof DM_SCOPES[number];

export interface ChannelRoutingSettings {
  dmScope: DmScope;
}

export interface ChannelAccountEnabledWrite {
  channelId: string;
  accountId: string;
  enabled: boolean;
}

export type ChannelsOperations = Partial<{
  status(params?: { probe?: boolean; timeoutMs?: number }): Promise<ChannelsStatusResult>;
  /** `channelManage` refinement: Gateway config writes; the Gateway restarts the affected runtime. */
  getRouting(): Promise<ChannelRoutingSettings>;
  setRouting(settings: ChannelRoutingSettings): Promise<void>;
  setAccountEnabled(write: ChannelAccountEnabledWrite): Promise<void>;
}>;

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

export interface LogQuery {
  cursor?: number;
  limit?: number;
  maxBytes?: number;
}

export interface LogPage {
  file: string;
  cursor: number;
  size: number;
  lines: string[];
  truncated: boolean;
  reset: boolean;
}

export interface ModelHealthReport {
  scope: 'global';
  model: string;
  provider: string;
  checkedAtMs: number;
  providers: Array<{ id: string; name: string; credentials: 'configured' | 'missing' | 'unknown' }>;
  checks: Array<{ name: string; status: 'reachable' | 'configured' | 'failed' | 'unknown' }>;
}

export type ModelsOperations = Partial<{
    health(options?: { probe?: boolean }): Promise<ModelHealthReport>;
    list(): Promise<ModelInfo[]>;
    getSelection(sessionKey?: string | null): Promise<ModelSelectionState>;
    setSelection(params: ModelSelectionWrite): Promise<ModelSelectionWriteResult>;
    listThinkingLevels(): ThinkingLevel[];
    setThinkingLevel(sessionKey: string, level: ThinkingLevel): Promise<ModelSelectionState>;
    /** `modelManage` refinement: Gateway config catalog, defaults and allowlist. */
    getCatalog(): Promise<ModelCatalogState>;
    saveCatalog(write: ModelCatalogWrite): Promise<void>;
    addModel(input: ModelCatalogAddInput): Promise<void>;
    inspectDeletion(ref: ModelCatalogModelRef): Promise<ModelDeletionPreview>;
    deleteModel(ref: ModelCatalogModelRef): Promise<void>;
    setCost(write: ModelCostWrite): Promise<void>;
}>;

export type SkillsOperations = Partial<{
    status(agentId?: string): Promise<SkillStatusReport>;
    get(key: string, params?: { agentId?: string; filePath?: string | null }): Promise<SkillDetail>;
    update(key: string, patch: SkillPatch): Promise<{ ok: boolean; skillKey: string; config: unknown }>;
    updateContent(key: string, content: string, agentId?: string): Promise<{ ok: boolean; skillKey: string; path: string }>;
    remove(key: string, agentId?: string): Promise<{ ok: boolean; skillKey: string }>;
    discover(query: string): Promise<DiscoverResult>;
    /** Native, source-pinned install followed by an installed-status readback. */
    install(input: { source: 'clawhub'; owner: string; slug: string }): Promise<SkillStatusEntry>;
}>;

export type CronOperations = Partial<{
    list(params?: CronListParams): Promise<CronListResult>;
    add(job: CronJobCreate): Promise<CronJob>;
    update(id: string, patch: CronJobPatch): Promise<CronJob>;
    remove(id: string): Promise<{ ok: boolean }>;
    run(id: string, mode?: 'due' | 'force'): Promise<unknown>;
    runs(params: CronRunsParams): Promise<CronRunsResult>;
    /** Delivered messages / stored output of one run; resolves to empty content when the backend recycled it. */
    runContent(entry: CronRunLogEntry): Promise<CronRunContent>;
    heartbeat: {
      get(): Promise<HeartbeatSettings>;
      set(settings: HeartbeatSettings): Promise<void>;
      /** Read-only last-heartbeat probe; only backends that report one implement it. */
      last?(): Promise<HeartbeatStatus>;
    };
}>;

export type AgentFileOperations = Partial<{
  list(agentId?: string): Promise<AgentFileSummary[]>;
  get(name: string, agentId?: string): Promise<AgentFile>;
  set(name: string, content: string, agentId?: string): Promise<{ ok: boolean }>;
}>;

export type AgentsOperations = Partial<{
    list(): Promise<AgentsListResult>;
    create(input: AgentCreate): Promise<AgentCreateResult>;
    update(id: string, patch: AgentPatch): Promise<AgentUpdateResult>;
    remove(id: string, deleteFiles?: boolean): Promise<AgentDeleteResult>;
    files: AgentFileOperations;
}>;

export type UsageOperations = Partial<{
    sessions(params: UsageQuery): Promise<UsageResult>;
    cost(params: CostQuery): Promise<CostSummary>;
}>;

export type ConfigOperations = Partial<{
    view(): Promise<ConfigView>;
    patch(raw: string, baseHash: string): Promise<ConfigPatchResult>;
    set(raw: string, baseHash: string): Promise<ConfigSetResult>;
    permissions(): Promise<PermissionsReport>;
    repair(): Promise<RepairResult>;
    doctor(): Promise<DoctorResult>;
    backups: {
      list(): Promise<Backup[]>;
      create(): Promise<Backup>;
      restore(id: string): Promise<void>;
      /** Deletes the phone-local restore point without changing the Gateway. */
      remove?(id: string): Promise<void>;
    };
}>;

export type ManagementOperations = Partial<{
  models: ModelsOperations;
  skills: SkillsOperations;
  cron: CronOperations;
  agents: AgentsOperations;
  usage: UsageOperations;
  config: ConfigOperations;
  tools: { catalog(agentId?: string): Promise<ToolCatalog>; save(params: ToolPolicy): Promise<void> };
  channels: ChannelsOperations;
  devices: Partial<{
    list(): Promise<DevicePairListResult>;
    approve(id: string): Promise<unknown>;
    reject(id: string): Promise<unknown>;
    remove(id: string): Promise<unknown>;
  }>;
  nodes: Partial<{
    list(): Promise<NodeListResult>;
    rename(id: string, name: string): Promise<{ nodeId: string; displayName: string }>;
    pairRequests(): Promise<NodePairListResult>;
    approve(id: string): Promise<unknown>;
    reject(id: string): Promise<unknown>;
  }>;
  logs: { fetch(params: LogQuery): Promise<LogPage> };
  approvals: {
    listExec?(sessionKey: string): Promise<Array<{ sessionKey: string; approval: Extract<ApprovalRequest, { kind: 'exec' }> }>>;
    resolveExec(id: string, decision: 'allow-once' | 'allow-always' | 'deny'): Promise<void>;
  };
}>;
