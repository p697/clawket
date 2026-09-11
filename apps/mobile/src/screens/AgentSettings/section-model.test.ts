import {
  CAPABILITY_MATRIX,
  type Capabilities,
  type ConnectionDescriptor,
  type ManagementOperations,
} from '@clawket/agent-protocol';
import type { AgentSettingsSection } from '../../navigation/root-stack';
import {
  buildAgentSettingsSectionModel,
  formatAgentSettingsLastReady,
  getAgentSettingsSectionTitle,
  isAgentSettingsSectionLocked,
  isAgentSettingsSectionSupported,
  resolveAgentSettingsSectionState,
  type AgentSettingsSectionAction,
} from './section-model';

const connection: ConnectionDescriptor = {
  id: 'studio',
  backendKind: 'openclaw',
  transportKind: 'relay',
  label: 'Studio',
  environment: 'preview',
  createdAt: 1,
  isFreeSlot: true,
};

const operation = jest.fn();
const management = {
  models: {
    getSelection: operation,
    setSelection: operation,
    listThinkingLevels: operation,
  },
  skills: { status: operation, discover: operation },
  cron: {
    list: operation,
    add: operation,
    heartbeat: { get: operation, set: operation },
  },
  agents: {
    update: operation,
    files: { list: operation, get: operation, set: operation },
  },
  usage: { sessions: operation, cost: operation },
  config: {
    view: operation,
    permissions: operation,
    doctor: operation,
    backups: { list: operation },
  },
  tools: { catalog: operation },
  channels: { status: operation },
  devices: { list: operation },
  nodes: { list: operation },
  logs: { fetch: operation },
} as unknown as ManagementOperations;

const sections: ReadonlyArray<AgentSettingsSection> = [
  'identity',
  'models',
  'skills',
  'cron',
  'files',
  'usage',
  'connection',
  'openclaw',
  'tools',
  'channels-devices',
  'logs',
];

function model(
  section: AgentSettingsSection,
  patch: Partial<Parameters<typeof buildAgentSettingsSectionModel>[0]> = {},
) {
  return buildAgentSettingsSectionModel({
    section,
    capabilities: { ...CAPABILITY_MATRIX.openclaw },
    management,
    connection,
    connectionState: 'ready',
    isPro: true,
    ...patch,
  });
}

function actions(section: AgentSettingsSection): ReadonlyArray<AgentSettingsSectionAction> {
  return model(section).groups.flatMap((group) => group.rows.map((row) => row.id));
}

describe('AgentSettings section model', () => {
  it('defines every root-stack section and its canonical child actions', () => {
    expect(sections.map(getAgentSettingsSectionTitle)).toEqual([
      'Identity',
      'Models',
      'Skills',
      'Cron jobs',
      'Files',
      'Usage',
      'Connection',
      'OpenClaw management',
      'Tools',
      'Channels & devices',
      'Logs',
    ]);
    expect(actions('models')).toEqual([
      'models.default',
      'models.thinking',
      'models.providers-cost',
    ]);
    expect(actions('skills')).toEqual(['skills.installed', 'skills.discover']);
    expect(actions('cron')).toEqual(['cron.heartbeat', 'cron.tasks', 'cron.create']);
    expect(actions('openclaw')).toEqual([
      'openclaw.config',
      'openclaw.permissions',
      'openclaw.diagnostics',
      'openclaw.backups',
    ]);
    expect(actions('channels-devices')).toEqual([
      'channels-devices.channels',
      'channels-devices.devices',
      'channels-devices.nodes',
    ]);
    expect(actions('connection')).toEqual([
      'connection.status',
      'connection.last-ready',
      'connection.bridge-version',
      'connection.bridge-capabilities',
      'connection.reconnect',
      'connection.environment',
      'connection.remove',
    ]);
    expect(sections.every((section) => model(section).supported)).toBe(true);
  });

  it('renders connection runtime projection and marks non-ready status for attention', () => {
    const lastReadyAt = Date.UTC(2026, 8, 5, 7, 30);
    const connectionModel = model('connection', {
      connectionState: 'offline',
      connectionDetails: {
        lastReadyAt,
        bridgeVersion: '2026.9.5',
        bridgeCapabilities: ['bridge.capabilities.v2', 'hermes.multi-session.v2'],
      },
      locale: 'en-US',
    });
    const rows = connectionModel.groups.flatMap((group) => group.rows);

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'connection.status', value: 'Offline', attention: true }),
      expect.objectContaining({ id: 'connection.last-ready', value: expect.stringContaining('2026') }),
      expect.objectContaining({ id: 'connection.bridge-version', value: '2026.9.5' }),
      expect.objectContaining({
        id: 'connection.bridge-capabilities',
        value: 'bridge.capabilities.v2, hermes.multi-session.v2',
      }),
    ]));
    expect(formatAgentSettingsLastReady(null, 'en-US')).toBe('—');
    expect(formatAgentSettingsLastReady(Number.NaN, 'en-US')).toBe('—');
  });

  it('uses capability metadata for both section and child visibility', () => {
    const capabilities: Capabilities = {
      ...CAPABILITY_MATRIX.openclaw,
      channels: false,
      nodes: false,
      heartbeat: false,
      skillDiscover: false,
    };
    const connections = model('channels-devices', { capabilities });
    expect(connections.supported).toBe(true);
    expect(connections.groups[0]?.rows.map((row) => row.id)).toEqual([
      'channels-devices.devices',
    ]);
    expect(model('cron', { capabilities }).groups[0]?.rows.map((row) => row.id)).toEqual([
      'cron.tasks',
      'cron.create',
    ]);
    expect(model('skills', { capabilities }).groups[0]?.rows.map((row) => row.id)).toEqual([
      'skills.installed',
    ]);

    const none = { ...CAPABILITY_MATRIX.youmind, devices: false };
    expect(isAgentSettingsSectionSupported('connection', none)).toBe(true);
    expect(isAgentSettingsSectionSupported('models', none)).toBe(false);
    expect(isAgentSettingsSectionSupported('channels-devices', none)).toBe(false);
  });

  it('never upgrades a capability when a management method happens to exist', () => {
    const capabilities = { ...CAPABILITY_MATRIX.openclaw, logs: false };
    const logs = model('logs', { capabilities });
    expect(logs.supported).toBe(false);
    expect(logs.groups).toEqual([]);
  });

  it('downgrades missing runtime operations without hiding supported rows', () => {
    const skills = model('skills', {
      management: { skills: { status: operation } },
    });
    expect(skills.groups[0]?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'skills.installed', available: true }),
      expect.objectContaining({
        id: 'skills.discover',
        available: false,
        value: 'Unavailable',
      }),
    ]));
  });

  it('applies section and row Pro gates from descriptors', () => {
    expect(isAgentSettingsSectionLocked('openclaw', false)).toBe(false);
    expect(isAgentSettingsSectionLocked('logs', false)).toBe(true);
    expect(isAgentSettingsSectionLocked('models', false)).toBe(false);

    const openclaw = model('openclaw', { isPro: false });
    expect(openclaw.locked).toBe(false);
    expect(openclaw.paywallReason).toBe('configManage');
    expect(openclaw.groups[0]?.rows.every((row) => !row.locked)).toBe(true);

    const files = model('files', { isPro: false });
    expect(files.locked).toBe(false);
    expect(files.groups[0]?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'files.browse', locked: false, value: 'Read only' }),
      expect.objectContaining({
        id: 'files.edit',
        locked: true,
        paywallReason: 'coreFileEditing',
      }),
    ]));
  });

  it('resolves all section lifecycle states in priority order', () => {
    const ready = {
      initialized: true,
      routeIsActive: true,
      switching: false,
      hasConnection: true,
      hasAgent: true,
      connectionState: 'ready' as const,
      supported: true,
      locked: false,
    };
    expect(resolveAgentSettingsSectionState({ ...ready, initialized: false })).toBe('loading');
    expect(resolveAgentSettingsSectionState({ ...ready, hasAgent: false })).toBe('empty');
    expect(resolveAgentSettingsSectionState({ ...ready, supported: false })).toBe('unsupported');
    expect(resolveAgentSettingsSectionState({ ...ready, locked: true })).toBe('locked');
    expect(resolveAgentSettingsSectionState({ ...ready, hasError: true })).toBe('error');
    expect(resolveAgentSettingsSectionState({ ...ready, connectionState: 'reconnecting' })).toBe('offline');
    expect(resolveAgentSettingsSectionState(ready)).toBe('ready');
  });
});
