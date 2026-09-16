import type { BackendKind, PromptAttachment } from './descriptors';

export interface Capabilities {
  chat: boolean;
  abort: boolean;
  history: boolean;
  /** Supports image attachments. Use `fileAttachments` for non-image files. */
  attachments: boolean;
  /** Refines `attachments` to permit non-image files. Absent means unsupported. */
  fileAttachments?: boolean;
  /** Client may surface local reply notifications for adapter run completions. */
  replyNotifications?: boolean;
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
  /**
   * Refines `models` with Gateway config editing: catalog defaults, allowlist,
   * adding / deleting models and cost overrides. Absent means unsupported.
   */
  modelManage?: boolean;
  thinkingLevels: boolean;
  /**
   * Backend interprets the full `/command` catalog, so the App may offer it as
   * a menu. Hermes handles only its inline directives (`/model`, `/think`,
   * `/reasoning`, `/fast`) and posts anything else as a plain prompt.
   */
  slashCommands: boolean;
  skills: boolean;
  skillDiscover: boolean;
  /** Refines `AgentAdapter.prompt` skill installation; it is not a Management method. */
  skillInstall: boolean;
  cron: boolean;
  cronCreate: boolean;
  /** Per-job IANA timezone and OpenClaw execution options; absent refinements fail closed. */
  cronTimeZone?: boolean;
  cronAdvanced?: boolean;
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
  'fileAttachments',
  'replyNotifications',
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
  'modelManage',
  'thinkingLevels',
  'slashCommands',
  'skills',
  'skillDiscover',
  'skillInstall',
  'cron',
  'cronCreate',
  'cronTimeZone',
  'cronAdvanced',
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
  fileAttachments: true,
  replyNotifications: true,
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
  modelManage: true,
  thinkingLevels: true,
  slashCommands: true,
  skills: true,
  skillDiscover: true,
  skillInstall: true,
  cron: true,
  cronCreate: true,
  cronTimeZone: true,
  cronAdvanced: true,
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
  fileAttachments: false,
  replyNotifications: true,
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
  modelManage: false,
  thinkingLevels: true,
  slashCommands: false,
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
  fileAttachments: false,
  replyNotifications: false,
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
  modelManage: false,
  thinkingLevels: false,
  slashCommands: false,
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
  'local-model': {
    ...YOUMIND_CAPABILITIES,
    chat: true, abort: true, history: true, attachments: true,
    models: true, replyNotifications: true,
  },
};

export type AttachmentCapabilities = Pick<
  Capabilities,
  'attachments' | 'fileAttachments'
>;

/** Canonicalizes MIME for classification, analytics, and serialized prompts. */
export function normalizeAttachmentMimeType(
  mimeType: string | null | undefined,
  fallback = 'application/octet-stream',
): string {
  const normalized = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
  return normalized || fallback.trim().toLowerCase();
}

export function isImageAttachmentMimeType(
  mimeType: string | null | undefined,
): boolean {
  return normalizeAttachmentMimeType(mimeType, '').startsWith('image/');
}

export function supportsFileAttachments(
  capabilities: AttachmentCapabilities | null | undefined,
): boolean {
  return capabilities?.attachments === true && capabilities.fileAttachments === true;
}

export function supportsAttachmentMimeType(
  capabilities: AttachmentCapabilities | null | undefined,
  mimeType: string | null | undefined,
): boolean {
  if (capabilities?.attachments !== true) return false;
  return isImageAttachmentMimeType(mimeType) || capabilities.fileAttachments === true;
}

/** Validates both the declared prompt kind and its normalized MIME class. */
export function supportsPromptAttachment(
  capabilities: AttachmentCapabilities | null | undefined,
  attachment: Pick<PromptAttachment, 'type' | 'mimeType'>,
): boolean {
  const expectedType = isImageAttachmentMimeType(attachment.mimeType) ? 'image' : 'file';
  return attachment.type === expectedType
    && supportsAttachmentMimeType(capabilities, attachment.mimeType);
}

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
