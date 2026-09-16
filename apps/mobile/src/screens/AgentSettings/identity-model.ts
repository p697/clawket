import type {
  AgentDescriptor,
  AgentFileOperations,
  AgentInfo,
  AgentsOperations,
  Capabilities,
} from '@clawket/agent-protocol';
import {
  EMPTY_AGENT_IDENTITY_PROFILE,
  generateAgentIdentityMarkdown,
  mergeAgentIdentityMarkdown,
  parseAgentIdentityProfile,
  type AgentIdentityProfile,
} from '../../utils/agent-identity-profile';

export const IDENTITY_FILE_NAME = 'IDENTITY.md';

export type IdentityBundle = Readonly<{
  profile: AgentIdentityProfile;
  /** Raw IDENTITY.md source, empty when the backend has no such file. */
  identityFile: string;
}>;

export type IdentityProfileValidation = Readonly<{
  valid: boolean;
  error?: 'required' | 'too-long';
}>;

export type AgentCreateValidation = Readonly<{
  valid: boolean;
  error?: 'required' | 'invalid' | 'reserved' | 'too-long';
}>;

export function canEditIdentityProfile(
  capabilities: Pick<Capabilities, 'agentEdit'>,
  operations: AgentsOperations | undefined,
): boolean {
  return capabilities.agentEdit && Boolean(operations?.update);
}

export function canEditIdentityFiles(
  capabilities: Pick<Capabilities, 'fileEdit'>,
  operations: AgentFileOperations | undefined,
): boolean {
  return capabilities.fileEdit && Boolean(operations?.set);
}

export function canCreateIdentityAgent(
  capabilities: Pick<Capabilities, 'agentCreate'>,
  operations: AgentsOperations | undefined,
): boolean {
  return capabilities.agentCreate && Boolean(operations?.create);
}

export function validateIdentityProfile(
  profile: Pick<AgentIdentityProfile, 'name'>,
): IdentityProfileValidation {
  const name = profile.name.trim();
  if (!name) return { valid: false, error: 'required' };
  if (name.length > 50) return { valid: false, error: 'too-long' };
  return { valid: true };
}

export function validateAgentCreateName(name: string): AgentCreateValidation {
  const trimmed = name.trim();
  if (!trimmed) return { valid: false, error: 'required' };
  if (trimmed.length > 50) return { valid: false, error: 'too-long' };
  const candidateId = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!candidateId) return { valid: false, error: 'invalid' };
  if (candidateId === 'main') return { valid: false, error: 'reserved' };
  return { valid: true };
}

/**
 * Name and emoji live in the Agent record (`agents.list[].identity`), which the
 * Gateway resolves ahead of IDENTITY.md; writing them only to the file would
 * leave a stale record in charge. Avatar is not edited from the phone.
 */
export function buildIdentityAgentPatch(
  previous: AgentIdentityProfile,
  next: AgentIdentityProfile,
): Readonly<{ name?: string; emoji?: string }> {
  const patch: { name?: string; emoji?: string } = {};
  const nextName = next.name.trim();
  const nextEmoji = next.emoji.trim();
  if (nextName !== previous.name.trim()) patch.name = nextName;
  if (nextEmoji !== previous.emoji.trim()) patch.emoji = nextEmoji;
  return patch;
}

/**
 * Vibe has no Agent-record field, so it is persisted through IDENTITY.md.
 * An existing file keeps its prose and unrelated fields: only the identity
 * lines are replaced in place (mirroring the Gateway's own merge); a missing
 * file receives the standard template.
 */
export function buildIdentityFileContent(
  profile: AgentIdentityProfile,
  existing = '',
): string {
  const normalized = normalizeIdentityProfile(profile);
  if (!existing.trim()) return generateAgentIdentityMarkdown(normalized);
  return mergeAgentIdentityMarkdown(existing, {
    name: normalized.name,
    emoji: normalized.emoji,
    vibe: normalized.vibe,
  });
}

export function normalizeIdentityProfile(profile: AgentIdentityProfile): AgentIdentityProfile {
  return {
    ...profile,
    name: profile.name.trim(),
    emoji: profile.emoji.trim(),
    // IDENTITY.md fields are single lines; the multiline editor only wraps.
    vibe: profile.vibe.replace(/\s+/g, ' ').trim(),
    avatar: profile.avatar.trim(),
  };
}

export function sameIdentityProfile(
  left: AgentIdentityProfile,
  right: AgentIdentityProfile,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function loadIdentityBundle(
  operations: AgentsOperations | undefined,
  agent: AgentDescriptor,
): Promise<IdentityBundle> {
  const files = operations?.files;
  const listPromise = operations?.list
    ? operations.list().then(
      (result) => result.agents.find((candidate) => candidate.id === agent.agentId),
    )
    : Promise.resolve<AgentInfo | undefined>(undefined);
  const filePromise = files?.get
    ? files.get(IDENTITY_FILE_NAME, agent.agentId)
      .then((file) => (file.missing ? '' : file.content ?? ''))
    : Promise.resolve('');
  const [listedResult, fileResult] = await Promise.allSettled([listPromise, filePromise]);
  const invokedReads = (operations?.list ? 1 : 0) + (files?.get ? 1 : 0);
  const rejectedReads = [listedResult, fileResult]
    .filter((result) => result.status === 'rejected');
  if (invokedReads > 0 && rejectedReads.length === invokedReads) {
    throw rejectedReads[0]?.reason ?? new Error('Failed to load identity');
  }

  const listedAgent = listedResult.status === 'fulfilled' ? listedResult.value : undefined;
  const identityFile = fileResult.status === 'fulfilled' ? fileResult.value : '';
  const parsedProfile = parseAgentIdentityProfile(identityFile);
  const profile: AgentIdentityProfile = {
    ...EMPTY_AGENT_IDENTITY_PROFILE,
    ...parsedProfile,
    name: parsedProfile.name
      || listedAgent?.identity?.name
      || listedAgent?.name
      || agent.name,
    emoji: parsedProfile.emoji || listedAgent?.identity?.emoji || agent.emoji || '',
    avatar: parsedProfile.avatar
      || listedAgent?.identity?.avatar
      || listedAgent?.identity?.avatarUrl
      || agent.avatarUrl
      || '',
  };

  return { profile, identityFile };
}
