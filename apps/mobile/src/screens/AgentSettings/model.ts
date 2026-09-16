import type {
  AgentDescriptor,
  Capabilities,
  ConnectionDescriptor,
  ConnectionState,
} from '@clawket/agent-protocol';
import type { AgentSettingsSection } from '../../navigation/root-stack';
import { heartbeatMinutesAgo } from '../../utils/console-heartbeat';
import { formatCompactTokenCount } from '../../utils/usage-format';

export type AgentSettingsPageState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'offline'
  | 'permission'
  | 'ready';

export type AgentSettingsSummary = Readonly<{
  modelCount?: number;
  installedSkillCount?: number;
  cronJobCount?: number;
  cronFailureCount?: number;
  hasCronFailure?: boolean;
  fileCount?: number;
  /** Undefined when the backend reports no reliable dollar figure for today. */
  todayCostUsd?: number;
  todayTokens?: number;
  lastHeartbeatAt?: number | null;
  toolCount?: number;
  pendingConnectionCount?: number;
}>;

export type AgentSettingsStatId = 'cron' | 'usage' | 'models' | 'skills' | 'files';

export type AgentSettingsStatDetail = Readonly<{
  key: '{{count}} failed';
  params: Readonly<Record<string, string | number>>;
  tone: 'bad' | 'neutral';
}>;

/** A tappable number card on the profile: one value, one label, at most one numeric caption. */
export type AgentSettingsStatDescriptor = Readonly<{
  id: AgentSettingsStatId;
  section: AgentSettingsStatId;
  placement: 'hero' | 'tile';
  title: string;
  value?: string;
  detail?: AgentSettingsStatDetail;
  attention: boolean;
  locked: boolean;
}>;

export type AgentSettingsRowDescriptor = Readonly<{
  id: Exclude<AgentSettingsSection, 'identity' | AgentSettingsStatId>;
  section: Exclude<AgentSettingsSection, 'identity' | AgentSettingsStatId>;
  placement: 'primary' | 'advanced';
  title: string;
  value?: string;
  attention: boolean;
  locked: boolean;
}>;

export type AgentSettingsGroupDescriptor = Readonly<{
  id: 'connection';
  rows: ReadonlyArray<AgentSettingsRowDescriptor>;
}>;

export type AgentSettingsModel = Readonly<{
  identity: Readonly<{
    name: string;
    /** Account line supplied by the backend (the YouMind email); the hero shows no line otherwise. */
    detail?: string;
    /** Product the Agent lives on; rendered as the avatar's corner mark, never as a text line. */
    backend: ConnectionDescriptor['backendKind'];
    backendLabel: string;
    /** Whole minutes since the last heartbeat, or null when the backend reports none. */
    activeMinutesAgo: number | null;
    editable: boolean;
    locked: boolean;
  }>;
  stats: ReadonlyArray<AgentSettingsStatDescriptor>;
  groups: ReadonlyArray<AgentSettingsGroupDescriptor>;
}>;

export type BuildAgentSettingsModelInput = Readonly<{
  connection: ConnectionDescriptor;
  agent: AgentDescriptor;
  capabilities: Capabilities;
  connectionState: ConnectionState;
  isPro: boolean;
  permissionDenied?: boolean;
  identityDetail?: string;
  summary?: AgentSettingsSummary;
  /** Agents on this connection; the Gateway heartbeat is global, so it only describes a lone Agent. */
  agentCount?: number;
  now?: number;
}>;

type Gate = Readonly<{
  capabilities?: ReadonlyArray<keyof Capabilities>;
  capabilityMode?: 'all' | 'any';
}>;

type RowDefinition = Gate & Readonly<{
  id: AgentSettingsRowDescriptor['id'];
  placement: AgentSettingsRowDescriptor['placement'];
  title: string;
  requiresPro?: boolean;
  value: (
    summary: AgentSettingsSummary,
    connectionState: ConnectionState,
  ) => string | undefined;
  attention?: (
    summary: AgentSettingsSummary,
    connectionState: ConnectionState,
  ) => boolean;
}>;

type StatDefinition = Gate & Readonly<{
  id: AgentSettingsStatId;
  placement: AgentSettingsStatDescriptor['placement'];
  title: (summary: AgentSettingsSummary) => string;
  value: (summary: AgentSettingsSummary) => string | undefined;
  detail?: (summary: AgentSettingsSummary) => AgentSettingsStatDetail | undefined;
  attention?: (summary: AgentSettingsSummary) => boolean;
}>;

const BACKEND_LABELS: Readonly<Record<ConnectionDescriptor['backendKind'], string>> = {
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  youmind: 'YouMind',
  'local-model': 'Local model',
};

const CONNECTION_STATE_LABELS: Readonly<Record<ConnectionState, string>> = {
  idle: 'Offline',
  connecting: 'Connecting',
  handshaking: 'Connecting',
  ready: 'Online',
  reconnecting: 'Offline',
  offline: 'Offline',
  error: 'Offline',
};

/** Order is layout order: two hero cards first, then the tile row. */
const STATS: ReadonlyArray<StatDefinition> = [
  {
    id: 'cron',
    placement: 'hero',
    capabilities: ['cron'],
    title: () => 'Cron jobs',
    value: (summary) => formatCount(summary.cronJobCount),
    detail: (summary) => {
      const failed = formatCount(summary.cronFailureCount);
      return failed && failed !== '0'
        ? { key: '{{count}} failed', params: { count: Number(failed) }, tone: 'bad' }
        : undefined;
    },
    attention: (summary) => summary.hasCronFailure === true || (summary.cronFailureCount ?? 0) > 0,
  },
  {
    id: 'usage',
    placement: 'hero',
    capabilities: ['usage'],
    // Dollars only: a token caption competed with the amount for the card's width and both got
    // ellipsised once the day's usage was non-trivial. Tokens remain the fallback headline number.
    title: (summary) => (formatUsd(summary.todayCostUsd) === undefined && formatTokens(summary.todayTokens) !== undefined
      ? 'Tokens today'
      : 'Cost today'),
    value: (summary) => formatUsd(summary.todayCostUsd) ?? formatTokens(summary.todayTokens),
  },
  {
    id: 'models',
    placement: 'tile',
    capabilities: ['models'],
    title: () => 'Models',
    value: (summary) => formatCount(summary.modelCount),
  },
  {
    id: 'skills',
    placement: 'tile',
    capabilities: ['skills'],
    title: () => 'Skills',
    value: (summary) => formatCount(summary.installedSkillCount),
  },
  {
    id: 'files',
    placement: 'tile',
    capabilities: ['files'],
    title: () => 'Memory',
    value: (summary) => formatCount(summary.fileCount),
  },
];

const CONNECTION_ROWS: ReadonlyArray<RowDefinition> = [
  {
    id: 'connection',
    placement: 'primary',
    title: 'Connection',
    value: (_summary, connectionState) => CONNECTION_STATE_LABELS[connectionState],
    attention: (_summary, connectionState) => connectionState !== 'ready',
  },
  {
    id: 'openclaw',
    placement: 'advanced',
    title: 'OpenClaw management',
    capabilities: ['configManage'],
    value: () => undefined,
  },
  {
    id: 'tools',
    placement: 'advanced',
    title: 'Tools',
    capabilities: ['tools'],
    value: (summary) => formatCount(summary.toolCount),
  },
  {
    id: 'channels-devices',
    placement: 'advanced',
    title: 'Channels & devices',
    capabilities: ['channels', 'devices', 'nodes'],
    capabilityMode: 'any',
    value: (summary) => summary.pendingConnectionCount
      ? formatCount(summary.pendingConnectionCount)
      : undefined,
    attention: (summary) => (summary.pendingConnectionCount ?? 0) > 0,
  },
  {
    // Pro gates the live tail inside the page (last-step gate), not the row.
    id: 'logs',
    placement: 'advanced',
    title: 'OpenClaw logs',
    capabilities: ['logs'],
    value: () => undefined,
  },
];

export function resolveAgentSettingsPageState(input: Readonly<{
  initialized: boolean;
  hasAgent: boolean;
  connectionState: ConnectionState;
  permissionDenied?: boolean;
  hasError?: boolean;
}>): AgentSettingsPageState {
  if (!input.initialized) return 'loading';
  if (!input.hasAgent) return 'empty';
  if (input.permissionDenied) return 'permission';
  if (input.hasError || input.connectionState === 'error') return 'error';
  if (input.connectionState !== 'ready') return 'offline';
  return 'ready';
}

export function buildAgentSettingsModel(
  input: BuildAgentSettingsModelInput,
): AgentSettingsModel {
  const summary = input.summary ?? {};
  const permissionDenied = input.permissionDenied === true;
  const backendLabel = BACKEND_LABELS[input.connection.backendKind];

  return {
    identity: {
      name: input.agent.name,
      detail: cleanValue(input.identityDetail),
      backend: input.connection.backendKind,
      backendLabel,
      activeMinutesAgo: input.capabilities.heartbeat && (input.agentCount ?? 1) <= 1
        ? heartbeatMinutesAgo(summary.lastHeartbeatAt, input.now ?? Date.now())
        : null,
      editable: (input.capabilities.agentEdit || input.capabilities.agentCreate) && !permissionDenied,
      locked: permissionDenied,
    },
    stats: STATS
      .filter((definition) => isDefinitionVisible(definition, input.capabilities))
      .map((definition) => ({
        id: definition.id,
        section: definition.id,
        placement: definition.placement,
        title: definition.title(summary),
        value: definition.value(summary),
        detail: definition.detail?.(summary),
        attention: definition.attention?.(summary) ?? false,
        locked: permissionDenied,
      })),
    groups: [
      {
        id: 'connection',
        rows: buildRows(
          CONNECTION_ROWS,
          input.capabilities,
          summary,
          input.connectionState,
          input.isPro,
          permissionDenied,
        ),
      },
    ],
  };
}

function buildRows(
  definitions: ReadonlyArray<RowDefinition>,
  capabilities: Capabilities,
  summary: AgentSettingsSummary,
  connectionState: ConnectionState,
  isPro: boolean,
  permissionDenied: boolean,
): ReadonlyArray<AgentSettingsRowDescriptor> {
  return definitions
    .filter((definition) => isDefinitionVisible(definition, capabilities))
    .map((definition) => ({
      id: definition.id,
      section: definition.id,
      placement: definition.placement,
      title: definition.title,
      value: definition.value(summary, connectionState),
      attention: definition.attention?.(summary, connectionState) ?? false,
      locked: permissionDenied || (definition.requiresPro === true && !isPro),
    }));
}

function isDefinitionVisible(
  definition: Gate,
  capabilities: Capabilities,
): boolean {
  if (!definition.capabilities) return true;
  const values = definition.capabilities.map((capability) => capabilities[capability]);
  return definition.capabilityMode === 'any'
    ? values.some(Boolean)
    : values.every(Boolean);
}

function cleanValue(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

export function formatCount(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return String(Math.max(0, Math.trunc(value)));
}

export function formatUsd(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const normalized = Math.max(0, value);
  return `$${normalized.toFixed(2)}`;
}

export function formatTokens(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return formatCompactTokenCount(Math.max(0, Math.trunc(value)));
}
