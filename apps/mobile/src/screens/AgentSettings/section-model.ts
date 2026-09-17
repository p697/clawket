import type {
  Capabilities,
  ConnectionDescriptor,
  ConnectionState,
  ManagementOperations,
} from '@clawket/agent-protocol';
import type { AgentSettingsDetailSection, AgentSettingsSection } from '../../navigation/root-stack';

export type AgentSettingsSectionState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'offline'
  | 'locked'
  | 'unsupported'
  | 'ready';

export type AgentSettingsSectionAction =
  | 'identity.profile'
  | 'models.default'
  | 'models.thinking'
  | 'models.providers-cost'
  | 'skills.installed'
  | 'skills.discover'
  | 'cron.tasks'
  | 'cron.create'
  | 'cron.heartbeat'
  | 'files.browse'
  | 'files.edit'
  | 'usage.activity'
  | 'usage.cost'
  | 'openclaw.config'
  | 'openclaw.permissions'
  | 'openclaw.diagnostics'
  | 'openclaw.backups'
  | 'tools.catalog'
  | 'channels-devices.channels'
  | 'channels-devices.devices'
  | 'channels-devices.nodes'
  | 'logs.view';

export type AgentSettingsSectionRowDescriptor = Readonly<{
  id: AgentSettingsSectionAction;
  title: string;
  value?: string;
  available: boolean;
  actionable: boolean;
  availableOffline: boolean;
  locked: boolean;
  attention: boolean;
  paywallReason?: string;
}>;

export type AgentSettingsSectionGroupDescriptor = Readonly<{
  id: string;
  title?: string;
  rows: ReadonlyArray<AgentSettingsSectionRowDescriptor>;
}>;

export type AgentSettingsSectionModel = Readonly<{
  section: AgentSettingsSection;
  title: string;
  supported: boolean;
  locked: boolean;
  paywallReason?: string;
  groups: ReadonlyArray<AgentSettingsSectionGroupDescriptor>;
}>;

export type BuildAgentSettingsSectionModelInput = Readonly<{
  section: AgentSettingsSection;
  capabilities: Capabilities;
  management?: ManagementOperations;
  connection: ConnectionDescriptor;
  connectionState: ConnectionState;
  isPro: boolean;
  permissionDenied?: boolean;
}>;

type CapabilityGate = Readonly<{
  capabilities: ReadonlyArray<keyof Capabilities>;
  mode?: 'all' | 'any';
}>;

type RowDefinition = Readonly<{
  id: AgentSettingsSectionAction;
  title: string;
  gate?: CapabilityGate;
  operation?: (management: ManagementOperations | undefined) => boolean;
  actionable?: boolean;
  availableOffline?: boolean;
  requiresPro?: boolean;
  paywallReason?: string;
  value?: (input: BuildAgentSettingsSectionModelInput) => string | undefined;
  attention?: (input: BuildAgentSettingsSectionModelInput) => boolean;
  showWhenUnsupported?: boolean;
}>;

type GroupDefinition = Readonly<{
  id: string;
  title?: string;
  rows: ReadonlyArray<RowDefinition>;
}>;

type SectionDefinition = Readonly<{
  title: string;
  gate?: CapabilityGate;
  requiresPro?: boolean;
  paywallReason?: string;
  groups: ReadonlyArray<GroupDefinition>;
}>;

const CONNECTION_ROUTE_TITLE = 'Connection';

const SECTION_DEFINITIONS: Readonly<Record<AgentSettingsDetailSection, SectionDefinition>> = {
  identity: {
    title: 'Identity',
    groups: [{
      id: 'identity',
      rows: [
        {
          id: 'identity.profile',
          title: 'Name and avatar',
          gate: all('agentEdit'),
          operation: (management) => Boolean(management?.agents?.update),
          showWhenUnsupported: true,
          value: ({ capabilities }) => capabilities.agentEdit ? undefined : 'Read only',
        },
      ],
    }],
  },
  models: {
    title: 'Models',
    gate: all('models'),
    groups: [
      {
        id: 'model',
        rows: [
          {
            id: 'models.default',
            title: 'Default model',
            gate: all('models'),
            operation: (management) => Boolean(management?.models?.getSelection),
          },
          {
            id: 'models.thinking',
            title: 'Thinking level',
            gate: all('thinkingLevels'),
            operation: (management) => Boolean(management?.models?.listThinkingLevels),
          },
        ],
      },
      {
        id: 'providers',
        title: 'Providers',
        rows: [{
          id: 'models.providers-cost',
          title: 'Providers and cost',
          gate: all('models'),
          operation: (management) => Boolean(management?.models?.getSelection),
        }],
      },
    ],
  },
  skills: {
    title: 'Skills',
    gate: all('skills'),
    groups: [{
      id: 'skills',
      rows: [
        {
          id: 'skills.installed',
          title: 'Installed',
          gate: all('skills'),
          operation: (management) => Boolean(management?.skills?.status),
        },
        {
          id: 'skills.discover',
          title: 'Discover',
          gate: all('skillDiscover'),
          operation: (management) => Boolean(management?.skills?.discover),
          value: ({ capabilities }) => capabilities.skillInstall ? undefined : 'Read only',
        },
      ],
    }],
  },
  cron: {
    title: 'Cron jobs',
    gate: all('cron'),
    groups: [{
      id: 'cron',
      rows: [
        {
          id: 'cron.heartbeat',
          title: 'Heartbeat',
          gate: all('heartbeat'),
          operation: (management) => Boolean(
            management?.cron?.heartbeat?.get && management.cron.heartbeat.set,
          ),
        },
        {
          id: 'cron.tasks',
          title: 'Cron jobs',
          gate: all('cron'),
          operation: (management) => Boolean(management?.cron?.list),
          value: ({ capabilities }) => capabilities.cronCreate ? undefined : 'Read only',
        },
        {
          id: 'cron.create',
          title: 'New cron job',
          gate: all('cronCreate'),
          operation: (management) => Boolean(management?.cron?.add),
        },
      ],
    }],
  },
  files: {
    title: 'Memory',
    gate: all('files'),
    groups: [{
      id: 'files',
      rows: [
        {
          id: 'files.browse',
          title: 'Agent files',
          gate: all('files'),
          operation: (management) => Boolean(management?.agents?.files?.list),
          value: ({ capabilities, isPro }) => capabilities.fileEdit && isPro
            ? undefined
            : 'Read only',
        },
        {
          id: 'files.edit',
          title: 'Edit files',
          gate: all('fileEdit'),
          operation: (management) => Boolean(
            management?.agents?.files?.get && management.agents.files.set,
          ),
          requiresPro: true,
          paywallReason: 'coreFileEditing',
        },
      ],
    }],
  },
  usage: {
    title: 'Usage',
    gate: all('usage'),
    groups: [{
      id: 'usage',
      rows: [
        {
          id: 'usage.activity',
          title: 'Activity',
          gate: all('usage'),
          operation: (management) => Boolean(management?.usage?.sessions),
        },
        {
          id: 'usage.cost',
          title: 'Cost',
          gate: all('cost'),
          operation: (management) => Boolean(management?.usage?.cost),
        },
      ],
    }],
  },
  openclaw: {
    title: 'OpenClaw management',
    gate: all('configManage'),
    requiresPro: false,
    paywallReason: 'configManage',
    groups: [{
      id: 'openclaw',
      rows: [
        {
          id: 'openclaw.config',
          title: 'Configuration',
          gate: all('configManage'),
          operation: (management) => Boolean(management?.config?.view),
        },
        {
          id: 'openclaw.permissions',
          title: 'Permissions',
          gate: all('permissions'),
          operation: (management) => Boolean(management?.config?.permissions),
        },
        {
          id: 'openclaw.diagnostics',
          title: 'Diagnostics',
          gate: all('diagnostics'),
          operation: (management) => Boolean(management?.config?.doctor),
        },
        {
          id: 'openclaw.backups',
          title: 'Back up OpenClaw config',
          gate: all('backups'),
          operation: (management) => Boolean(management?.config?.backups?.list),
        },
      ],
    }],
  },
  tools: {
    title: 'Tools',
    gate: all('tools'),
    groups: [{
      id: 'tools',
      rows: [{
        id: 'tools.catalog',
        title: 'Tool access',
        gate: all('tools'),
        operation: (management) => Boolean(management?.tools?.catalog),
      }],
    }],
  },
  'channels-devices': {
    title: 'Channels & devices',
    gate: any('channels', 'devices', 'nodes'),
    groups: [{
      id: 'connections',
      rows: [
        {
          id: 'channels-devices.channels',
          title: 'Channels',
          gate: all('channels'),
          operation: (management) => Boolean(management?.channels?.status),
        },
        {
          id: 'channels-devices.devices',
          title: 'Devices',
          gate: all('devices'),
          operation: (management) => Boolean(management?.devices?.list),
        },
        {
          id: 'channels-devices.nodes',
          title: 'Nodes',
          gate: all('nodes'),
          operation: (management) => Boolean(management?.nodes?.list),
        },
      ],
    }],
  },
  logs: {
    title: 'OpenClaw logs',
    gate: all('logs'),
    // The page opens for everyone; LogsSection gates the live tail at the last step.
    requiresPro: false,
    paywallReason: 'logs',
    groups: [{
      id: 'logs',
      rows: [{
        id: 'logs.view',
        title: 'Gateway logs',
        gate: all('logs'),
        operation: (management) => Boolean(management?.logs?.fetch),
      }],
    }],
  },
};

/**
 * The connection row on the profile opens the shared Connection route; it has
 * no section page of its own, so every lookup treats it as unsupported here.
 */
function sectionDefinition(section: AgentSettingsSection): SectionDefinition | null {
  return section === 'connection' ? null : SECTION_DEFINITIONS[section];
}

export function buildAgentSettingsSectionModel(
  input: BuildAgentSettingsSectionModelInput,
): AgentSettingsSectionModel {
  const definition = sectionDefinition(input.section);
  if (!definition) {
    return {
      section: input.section,
      title: CONNECTION_ROUTE_TITLE,
      supported: false,
      locked: input.permissionDenied === true,
      groups: [],
    };
  }
  const supported = passesGate(definition.gate, input.capabilities);
  const locked = input.permissionDenied === true
    || (definition.requiresPro === true && !input.isPro);

  return {
    section: input.section,
    title: definition.title,
    supported,
    locked,
    ...(definition.paywallReason ? { paywallReason: definition.paywallReason } : {}),
    groups: supported
      ? definition.groups
        .map((group) => ({
          id: group.id,
          ...(group.title ? { title: group.title } : {}),
          rows: group.rows.flatMap((row) => buildRow(row, input)),
        }))
        .filter((group) => group.rows.length > 0)
      : [],
  };
}

export function resolveAgentSettingsSectionState(input: Readonly<{
  initialized: boolean;
  routeIsActive: boolean;
  switching: boolean;
  hasConnection: boolean;
  hasAgent: boolean;
  connectionState: ConnectionState;
  supported: boolean;
  locked: boolean;
  hasError?: boolean;
}>): AgentSettingsSectionState {
  if (!input.initialized || !input.routeIsActive || input.switching) return 'loading';
  if (!input.hasConnection || !input.hasAgent) return 'empty';
  if (!input.supported) return 'unsupported';
  if (input.locked) return 'locked';
  if (input.hasError || input.connectionState === 'error') return 'error';
  if (input.connectionState !== 'ready') return 'offline';
  return 'ready';
}

export function isAgentSettingsSectionSupported(
  section: AgentSettingsSection,
  capabilities: Capabilities,
): boolean {
  const definition = sectionDefinition(section);
  return definition ? passesGate(definition.gate, capabilities) : false;
}

export function getAgentSettingsSectionTitle(section: AgentSettingsSection): string {
  return sectionDefinition(section)?.title ?? CONNECTION_ROUTE_TITLE;
}

export function isAgentSettingsSectionLocked(
  section: AgentSettingsSection,
  isPro: boolean,
  permissionDenied = false,
): boolean {
  return permissionDenied
    || (sectionDefinition(section)?.requiresPro === true && !isPro);
}

export function getAgentSettingsSectionPaywallReason(
  section: AgentSettingsSection,
): string | undefined {
  return sectionDefinition(section)?.paywallReason;
}

function buildRow(
  definition: RowDefinition,
  input: BuildAgentSettingsSectionModelInput,
): ReadonlyArray<AgentSettingsSectionRowDescriptor> {
  const capabilitySupported = passesGate(definition.gate, input.capabilities);
  if (!capabilitySupported && !definition.showWhenUnsupported) return [];
  const operationAvailable = definition.operation?.(input.management) ?? true;
  const available = capabilitySupported && operationAvailable;
  const sectionRequiresPro = sectionDefinition(input.section)?.requiresPro === true;
  const locked = input.permissionDenied === true
    || ((sectionRequiresPro || definition.requiresPro === true) && !input.isPro);
  const fallbackValue = available
    ? undefined
    : definition.showWhenUnsupported
      ? 'Read only'
      : 'Unavailable';

  return [{
    id: definition.id,
    title: definition.title,
    value: definition.value?.(input) ?? fallbackValue,
    available,
    actionable: definition.actionable !== false,
    availableOffline: definition.availableOffline === true,
    locked,
    attention: definition.attention?.(input) ?? false,
    ...(definition.paywallReason ? { paywallReason: definition.paywallReason } : {}),
  }];
}

function passesGate(
  gate: CapabilityGate | undefined,
  capabilities: Capabilities,
): boolean {
  if (!gate) return true;
  const values = gate.capabilities.map((capability) => capabilities[capability]);
  return gate.mode === 'any' ? values.some(Boolean) : values.every(Boolean);
}

function all(...capabilities: ReadonlyArray<keyof Capabilities>): CapabilityGate {
  return { capabilities, mode: 'all' };
}

function any(...capabilities: ReadonlyArray<keyof Capabilities>): CapabilityGate {
  return { capabilities, mode: 'any' };
}

