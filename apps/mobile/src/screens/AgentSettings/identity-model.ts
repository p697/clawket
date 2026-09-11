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
  parseAgentIdentityProfile,
  type AgentIdentityProfile,
} from '../../utils/agent-identity-profile';
import {
  EMPTY_AGENT_USER_PROFILE,
  mergeAgentUserMarkdown,
  parseAgentUserProfile,
  type AgentUserProfile,
} from '../../utils/agent-user-profile';

export const IDENTITY_FILE_NAMES = [
  'IDENTITY.md',
  'USER.md',
  'SOUL.md',
  'MEMORY.md',
] as const;

export type IdentityFileName = typeof IDENTITY_FILE_NAMES[number];

export type IdentityBundle = Readonly<{
  profile: AgentIdentityProfile;
  user: AgentUserProfile;
  contents: Readonly<Record<IdentityFileName, string>>;
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

export function buildIdentityAgentPatch(
  previous: AgentIdentityProfile,
  next: AgentIdentityProfile,
): Readonly<{ name?: string; avatar?: string }> {
  const patch: { name?: string; avatar?: string } = {};
  const nextName = next.name.trim();
  const nextAvatar = next.avatar.trim();
  if (nextName !== previous.name.trim()) patch.name = nextName;
  if (nextAvatar !== previous.avatar.trim()) patch.avatar = nextAvatar;
  return patch;
}

export function buildIdentityFileContent(profile: AgentIdentityProfile): string {
  return generateAgentIdentityMarkdown({
    ...profile,
    name: profile.name.trim(),
    emoji: profile.emoji.trim(),
    vibe: profile.vibe.trim(),
    avatar: profile.avatar.trim(),
  });
}

export function buildUserFileContent(
  previousContent: string,
  profile: AgentUserProfile,
): string {
  return mergeAgentUserMarkdown(previousContent, profile);
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
  const filePromises = IDENTITY_FILE_NAMES.map(async (name) => {
    if (!files?.get) return { name, content: '' } as const;
    const file = await files.get(name, agent.agentId);
    return { name, content: file.missing ? '' : file.content ?? '' } as const;
  });
  const [listedResult, ...fileResults] = await Promise.allSettled([
    listPromise,
    ...filePromises,
  ]);
  const invokedReads = (operations?.list ? 1 : 0) + (files?.get ? IDENTITY_FILE_NAMES.length : 0);
  const rejectedReads = [listedResult, ...fileResults]
    .filter((result) => result.status === 'rejected');
  if (invokedReads > 0 && rejectedReads.length === invokedReads) {
    throw rejectedReads[0]?.reason ?? new Error('Failed to load identity');
  }

  const listedAgent = listedResult.status === 'fulfilled' ? listedResult.value : undefined;
  const contents = emptyContents();
  for (const result of fileResults) {
    if (result.status === 'fulfilled') {
      contents[result.value.name] = result.value.content;
    }
  }

  const parsedProfile = parseAgentIdentityProfile(contents['IDENTITY.md']);
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

  return {
    profile,
    user: contents['USER.md']
      ? parseAgentUserProfile(contents['USER.md'])
      : { ...EMPTY_AGENT_USER_PROFILE },
    contents,
  };
}

function emptyContents(): Record<IdentityFileName, string> {
  return {
    'IDENTITY.md': '',
    'USER.md': '',
    'SOUL.md': '',
    'MEMORY.md': '',
  };
}
