import type { BackendKind } from './descriptors';

export interface Capabilities {
  chat: boolean;
  abort: boolean;
  history: boolean;
  attachments: boolean;
  sessions: boolean;
  sessionCreate: boolean;
  sessionRename: boolean;
  sessionReset: boolean;
  sessionDelete: boolean;
  agents: boolean;
  agentEdit: boolean;
  agentCreate: boolean;
  models: boolean;
  /** Refines `models.setSelection` to permit `scope: 'session'`; it is not a separate operation. */
  modelPerSession: boolean;
  thinkingLevels: boolean;
  skills: boolean;
  skillDiscover: boolean;
  /** Refines `AgentAdapter.prompt` skill installation; it is not a Management method. */
  skillInstall: boolean;
  cron: boolean;
  cronCreate: boolean;
  heartbeat: boolean;
  files: boolean;
  fileEdit: boolean;
  usage: boolean;
  cost: boolean;
  configManage: boolean;
  permissions: boolean;
  diagnostics: boolean;
  backups: boolean;
  tools: boolean;
  channels: boolean;
  devices: boolean;
  nodes: boolean;
  logs: boolean;
  execApproval: boolean;
  pairRequests: boolean;
}

export type Capability = keyof Capabilities;

export const CAPABILITY_KEYS = [
  'chat',
  'abort',
  'history',
  'attachments',
  'sessions',
  'sessionCreate',
  'sessionRename',
  'sessionReset',
  'sessionDelete',
  'agents',
  'agentEdit',
  'agentCreate',
  'models',
  'modelPerSession',
  'thinkingLevels',
  'skills',
  'skillDiscover',
  'skillInstall',
  'cron',
  'cronCreate',
  'heartbeat',
  'files',
  'fileEdit',
  'usage',
  'cost',
  'configManage',
  'permissions',
  'diagnostics',
  'backups',
  'tools',
  'channels',
  'devices',
  'nodes',
  'logs',
  'execApproval',
  'pairRequests',
] as const satisfies readonly Capability[];

const OPENCLAW_CAPABILITIES: Capabilities = {
  chat: true,
  abort: true,
  history: true,
  attachments: true,
  sessions: true,
  sessionCreate: true,
  sessionRename: true,
  sessionReset: true,
  sessionDelete: true,
  agents: true,
  agentEdit: true,
  agentCreate: true,
  models: true,
  modelPerSession: true,
  thinkingLevels: true,
  skills: true,
  skillDiscover: true,
  skillInstall: true,
  cron: true,
  cronCreate: true,
  heartbeat: true,
  files: true,
  fileEdit: true,
  usage: true,
  cost: true,
  configManage: true,
  permissions: true,
  diagnostics: true,
  backups: true,
  tools: true,
  channels: true,
  devices: true,
  nodes: true,
  logs: true,
  execApproval: true,
  pairRequests: true,
};

const HERMES_CAPABILITIES: Capabilities = {
  chat: true,
  abort: true,
  history: true,
  attachments: true,
  sessions: true,
  sessionCreate: true,
  sessionRename: true,
  sessionReset: true,
  sessionDelete: true,
  agents: true,
  agentEdit: false,
  agentCreate: false,
  models: true,
  modelPerSession: false,
  thinkingLevels: true,
  skills: true,
  skillDiscover: true,
  skillInstall: true,
  cron: true,
  cronCreate: true,
  heartbeat: false,
  files: true,
  fileEdit: true,
  usage: true,
  cost: true,
  configManage: false,
  permissions: false,
  diagnostics: false,
  backups: false,
  tools: false,
  channels: false,
  devices: false,
  nodes: false,
  logs: false,
  execApproval: false,
  pairRequests: false,
};

const YOUMIND_CAPABILITIES: Capabilities = {
  chat: true,
  abort: true,
  history: true,
  attachments: false,
  sessions: false,
  sessionCreate: false,
  sessionRename: false,
  sessionReset: false,
  sessionDelete: false,
  agents: false,
  agentEdit: false,
  agentCreate: false,
  models: false,
  modelPerSession: false,
  thinkingLevels: false,
  skills: false,
  skillDiscover: false,
  skillInstall: false,
  cron: false,
  cronCreate: false,
  heartbeat: false,
  files: false,
  fileEdit: false,
  usage: false,
  cost: false,
  configManage: false,
  permissions: false,
  diagnostics: false,
  backups: false,
  tools: false,
  channels: false,
  devices: false,
  nodes: false,
  logs: false,
  execApproval: false,
  pairRequests: false,
};

export const CAPABILITY_MATRIX: Record<BackendKind, Capabilities> = {
  openclaw: OPENCLAW_CAPABILITIES,
  hermes: HERMES_CAPABILITIES,
  youmind: YOUMIND_CAPABILITIES,
};

/**
 * Applies runtime capability evidence without ever enabling something the
 * backend's product contract marks unsupported.
 */
export function resolveCapabilities(
  backendKind: BackendKind,
  runtime?: Partial<Capabilities>,
): Capabilities {
  const baseline = CAPABILITY_MATRIX[backendKind];
  const resolved = { ...baseline };
  for (const key of CAPABILITY_KEYS) {
    if (runtime?.[key] === false) resolved[key] = false;
  }
  return resolved;
}
