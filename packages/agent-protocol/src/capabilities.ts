import type { BackendKind, PromptAttachment } from './descriptors';

export interface Capabilities {
  agentQuestions?: boolean;
  sessionBranch?: boolean;
  chat: boolean;
  abort: boolean;
  /** Exact active-run guidance; missing means unsupported. */
  steer?: boolean;
  history: boolean;
  /** Supports image attachments. Use `fileAttachments` for non-image files. */
  attachments: boolean;
  /** Refines `attachments` to permit non-image files. Absent means unsupported. */
  fileAttachments?: boolean;
  /** Bounded text, PDF and common Office documents; distinct from arbitrary files. */
  documentAttachments?: boolean;
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
  modelHealth?: boolean;
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
  /** Per-job `agentTurn` model override is stored and honoured; Hermes requires positive Bridge negotiation. */
  cronModel?: boolean;
  heartbeat: boolean;
  /** On-demand, bounded retrieval of explicitly referenced local session files. */
  sessionFiles?: boolean;
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
  /**
   * Refines `channels` with Gateway config writes: the direct-message session
   * scope and per-account enable switches. Absent means unsupported.
   */
  channelManage?: boolean;
  devices: boolean;
  nodes: boolean;
  logs: boolean;
  execApproval: boolean;
  pairRequests: boolean;
}

export type Capability = keyof Capabilities;

export const CAPABILITY_KEYS = [
  'agentQuestions',
  'sessionBranch',
  'chat',
  'abort',
  'steer',
  'history',
  'attachments',
  'fileAttachments',
  'documentAttachments',
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
  'modelHealth',
  'thinkingLevels',
  'slashCommands',
  'skills',
  'skillDiscover',
  'skillInstall',
  'cron',
  'cronCreate',
  'cronTimeZone',
  'cronAdvanced',
  'cronModel',
  'heartbeat',
  'sessionFiles',
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
  'channelManage',
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
  modelHealth: false,
  thinkingLevels: true,
  slashCommands: true,
  skills: true,
  skillDiscover: true,
  skillInstall: true,
  cron: true,
  cronCreate: true,
  cronTimeZone: true,
  cronAdvanced: true,
  cronModel: true,
  heartbeat: true,
  sessionFiles: true,
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
  channelManage: true,
  devices: true,
  nodes: true,
  logs: true,
  execApproval: true,
  pairRequests: true,
};

const HERMES_CAPABILITIES: Capabilities = {
  chat: true,
  steer: true,
  abort: true,
  history: true,
  attachments: true,
  fileAttachments: false,
  documentAttachments: true,
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
  modelHealth: true,
  thinkingLevels: true,
  slashCommands: false,
  skills: true,
  skillDiscover: true,
  skillInstall: true,
  cron: true,
  cronCreate: true,
  heartbeat: false,
  cronModel: true,
  sessionFiles: true,
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
  channelManage: false,
  devices: false,
  nodes: false,
  logs: false,
  execApproval: true,
  pairRequests: false,
};

const YOUMIND_CAPABILITIES: Capabilities = {
  chat: true,
  abort: true,
  history: true,
  attachments: false,
  fileAttachments: false,
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
  channelManage: false,
  devices: false,
  nodes: false,
  logs: false,
  execApproval: false,
  pairRequests: false,
};

export const CAPABILITY_MATRIX: Record<BackendKind, Capabilities> = {
  pi: { ...YOUMIND_CAPABILITIES, chat: true, abort: true, steer: true, history: true, attachments: true,
    sessions: true, sessionCreate: true, sessionRename: true, sessionReset: true, sessionDelete: true,
    models: true, modelPerSession: true, thinkingLevels: true, skills: true, agentQuestions: true, sessionBranch: true },
  openclaw: OPENCLAW_CAPABILITIES,
  hermes: HERMES_CAPABILITIES,
  youmind: YOUMIND_CAPABILITIES,
  'local-model': {
    ...YOUMIND_CAPABILITIES,
    chat: true, abort: true, history: true, attachments: true,
    models: true,
  },
};

export type AttachmentCapabilities = Pick<
  Capabilities,
  'attachments' | 'fileAttachments' | 'documentAttachments'
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
  return capabilities?.attachments === true && (capabilities.fileAttachments === true || capabilities.documentAttachments === true);
}

const DOCUMENT_MIME_TYPES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf', 'application/x-ipynb+json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export function supportsAttachmentMimeType(
  capabilities: AttachmentCapabilities | null | undefined,
  mimeType: string | null | undefined,
): boolean {
  if (capabilities?.attachments !== true) return false;
  return isImageAttachmentMimeType(mimeType) || capabilities.fileAttachments === true
    || (capabilities.documentAttachments === true && DOCUMENT_MIME_TYPES.has(normalizeAttachmentMimeType(mimeType)));
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
