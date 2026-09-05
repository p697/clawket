import type {
  AgentDescriptor,
  Capabilities,
  ConnectionDescriptor,
  ConnectionState,
} from '@clawket/agent-protocol';
import type { AgentSettingsSection } from '../../navigation/root-stack';

export type AgentSettingsPageState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'offline'
  | 'permission'
  | 'ready';

export type AgentSettingsSummary = Readonly<{
  currentModel?: string;
  installedSkillCount?: number;
  cronJobCount?: number;
  hasCronFailure?: boolean;
  todayCostUsd?: number;
  toolCount?: number;
  pendingConnectionCount?: number;
}>;

export type AgentSettingsRowDescriptor = Readonly<{
  id: Exclude<AgentSettingsSection, 'identity'>;
  section: Exclude<AgentSettingsSection, 'identity'>;
  title: string;
  value?: string;
  attention: boolean;
  locked: boolean;
}>;

export type AgentSettingsGroupDescriptor = Readonly<{
  id: 'agent' | 'connection';
  title?: string;
  rows: ReadonlyArray<AgentSettingsRowDescriptor>;
}>;

export type AgentSettingsModel = Readonly<{
  identity: Readonly<{
    name: string;
    detail: string;
    editable: boolean;
    locked: boolean;
  }>;
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
}>;

type RowDefinition = Readonly<{
  id: Exclude<AgentSettingsSection, 'identity'>;
  title: string;
  capabilities?: ReadonlyArray<keyof Capabilities>;
  capabilityMode?: 'all' | 'any';
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

const BACKEND_LABELS: Readonly<Record<ConnectionDescriptor['backendKind'], string>> = {
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  youmind: 'YouMind',
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

const AGENT_ROWS: ReadonlyArray<RowDefinition> = [
  {
    id: 'models',
    title: 'Models',
    capabilities: ['models'],
    value: (summary) => cleanValue(summary.currentModel),
  },
  {
    id: 'skills',
    title: 'Skills',
    capabilities: ['skills'],
    value: (summary) => formatCount(summary.installedSkillCount),
  },
  {
    id: 'cron',
    title: 'Scheduled tasks',
    capabilities: ['cron'],
    value: (summary) => formatCount(summary.cronJobCount),
    attention: (summary) => summary.hasCronFailure === true,
  },
  {
    id: 'files',
    title: 'Files',
    capabilities: ['files'],
    value: () => undefined,
  },
  {
    id: 'usage',
    title: 'Usage',
    capabilities: ['usage'],
    value: (summary) => formatUsd(summary.todayCostUsd),
  },
];

const CONNECTION_ROWS: ReadonlyArray<RowDefinition> = [
  {
    id: 'connection',
    title: 'Connection',
    value: (_summary, connectionState) => CONNECTION_STATE_LABELS[connectionState],
    attention: (_summary, connectionState) => connectionState !== 'ready',
  },
  {
    id: 'openclaw',
    title: 'OpenClaw management',
    capabilities: ['configManage'],
    requiresPro: true,
    value: () => undefined,
  },
  {
    id: 'tools',
    title: 'Tools',
    capabilities: ['tools'],
    value: (summary) => formatCount(summary.toolCount),
  },
  {
    id: 'channels-devices',
    title: 'Channels & devices',
    capabilities: ['channels', 'devices', 'nodes'],
    capabilityMode: 'any',
    value: (summary) => summary.pendingConnectionCount
      ? formatCount(summary.pendingConnectionCount)
      : undefined,
    attention: (summary) => (summary.pendingConnectionCount ?? 0) > 0,
  },
  {
    id: 'logs',
    title: 'Logs',
    capabilities: ['logs'],
    requiresPro: true,
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
  const identityDetail = cleanValue(input.identityDetail)
    ?? `${input.connection.label} · ${BACKEND_LABELS[input.connection.backendKind]}`;

  return {
    identity: {
      name: input.agent.name,
      detail: identityDetail,
      editable: (input.capabilities.agentEdit || input.capabilities.files) && !permissionDenied,
      locked: permissionDenied,
    },
    groups: [
      {
        id: 'agent',
        rows: buildRows(
          AGENT_ROWS,
          input.capabilities,
          summary,
          input.connectionState,
          input.isPro,
          permissionDenied,
        ),
      },
      {
        id: 'connection',
        title: input.connection.label,
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
      title: definition.title,
      value: definition.value(summary, connectionState),
      attention: definition.attention?.(summary, connectionState) ?? false,
      locked: permissionDenied || (definition.requiresPro === true && !isPro),
    }));
}

function isDefinitionVisible(
  definition: RowDefinition,
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
