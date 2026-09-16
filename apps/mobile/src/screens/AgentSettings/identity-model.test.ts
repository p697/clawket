import {
  CAPABILITY_MATRIX,
  type AgentDescriptor,
  type AgentsOperations,
} from '@clawket/agent-protocol';
import {
  buildIdentityAgentPatch,
  buildIdentityFileContent,
  canCreateIdentityAgent,
  canEditIdentityFiles,
  canEditIdentityProfile,
  loadIdentityBundle,
  normalizeIdentityProfile,
  sameIdentityProfile,
  validateAgentCreateName,
  validateIdentityProfile,
} from './identity-model';

const agent: AgentDescriptor = {
  connectionId: 'studio',
  agentId: 'writer',
  name: 'Writer fallback',
  emoji: '✍️',
  isMain: false,
  mainSessionKey: 'agent:writer:main',
};

describe('identity model', () => {
  it('loads the management identity and IDENTITY.md only, with descriptor fallbacks', async () => {
    const get = jest.fn(async (name: string) => ({
      name,
      path: `/${name}`,
      missing: false,
      content: '- **Vibe:** Calm\n- **Emoji:** 🦉',
    }));
    const operations: AgentsOperations = {
      list: jest.fn(async () => ({
        defaultId: 'main',
        mainKey: 'main',
        agents: [{ id: 'writer', name: 'Writer', identity: { avatar: 'avatar.png' } }],
      })),
      files: { get },
    };

    await expect(loadIdentityBundle(operations, agent)).resolves.toEqual({
      profile: expect.objectContaining({
        name: 'Writer',
        emoji: '🦉',
        vibe: 'Calm',
        avatar: 'avatar.png',
      }),
      identityFile: '- **Vibe:** Calm\n- **Emoji:** 🦉',
    });
    // Persona, memory and user documents belong to the Files page; identity never reads them.
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('IDENTITY.md', 'writer');
  });

  it('treats a missing IDENTITY.md as empty and fails only when every available read fails', async () => {
    const missing: AgentsOperations = {
      files: {
        get: jest.fn(async (name: string) => ({ name, path: name, missing: true })),
      },
    };
    await expect(loadIdentityBundle(missing, agent)).resolves.toEqual({
      profile: expect.objectContaining({ name: 'Writer fallback', emoji: '✍️' }),
      identityFile: '',
    });

    const partial: AgentsOperations = {
      list: jest.fn(async () => ({
        defaultId: 'main',
        mainKey: 'main',
        agents: [{ id: 'writer', name: 'Writer', identity: { emoji: '🦉' } }],
      })),
      files: { get: jest.fn(async () => { throw new Error('Missing IDENTITY.md'); }) },
    };
    await expect(loadIdentityBundle(partial, agent)).resolves.toEqual({
      profile: expect.objectContaining({ name: 'Writer', emoji: '🦉' }),
      identityFile: '',
    });

    const failed: AgentsOperations = {
      files: { get: jest.fn(async () => { throw new Error('offline'); }) },
    };
    await expect(loadIdentityBundle(failed, agent)).rejects.toThrow('offline');
  });

  it('derives edit gates, validates names, and builds minimal writes', () => {
    const update = jest.fn();
    const set = jest.fn();
    expect(canEditIdentityProfile(CAPABILITY_MATRIX.openclaw, { update })).toBe(true);
    expect(canEditIdentityProfile(CAPABILITY_MATRIX.hermes, { update })).toBe(false);
    expect(canEditIdentityFiles(CAPABILITY_MATRIX.hermes, { set })).toBe(true);
    expect(canCreateIdentityAgent(CAPABILITY_MATRIX.openclaw, { create: jest.fn() })).toBe(true);
    expect(canCreateIdentityAgent(CAPABILITY_MATRIX.hermes, { create: jest.fn() })).toBe(false);
    expect(validateIdentityProfile({ name: '   ' })).toEqual({ valid: false, error: 'required' });
    expect(validateIdentityProfile({ name: 'a'.repeat(51) })).toEqual({ valid: false, error: 'too-long' });
    expect(validateIdentityProfile({ name: 'Writer' })).toEqual({ valid: true });
    expect(validateAgentCreateName('')).toEqual({ valid: false, error: 'required' });
    expect(validateAgentCreateName('猫')).toEqual({ valid: false, error: 'invalid' });
    expect(validateAgentCreateName('main')).toEqual({ valid: false, error: 'reserved' });
    expect(validateAgentCreateName('Writer 2')).toEqual({ valid: true });

    const previous = {
      name: 'Old', emoji: '', creature: '', vibe: '', theme: '', avatar: '',
    };
    const next = {
      ...previous, name: ' Writer ', emoji: ' 🦉 ', vibe: ' Calm ', avatar: ' avatar.png ',
    };
    // Name and emoji go to the Agent record (it outranks IDENTITY.md); avatar is never patched from the phone.
    expect(buildIdentityAgentPatch(previous, next)).toEqual({ name: 'Writer', emoji: '🦉' });
    expect(buildIdentityAgentPatch(next, { ...next, avatar: 'other.png' })).toEqual({});
    expect(buildIdentityFileContent(next)).toContain('- **Emoji:** 🦉');
    expect(normalizeIdentityProfile(next)).toEqual({
      ...previous, name: 'Writer', emoji: '🦉', vibe: 'Calm', avatar: 'avatar.png',
    });
    expect(normalizeIdentityProfile({ ...next, vibe: 'Warm,\n  curious\n\nand calm ' }).vibe)
      .toBe('Warm, curious and calm');
    expect(sameIdentityProfile(previous, { ...previous })).toBe(true);
    expect(sameIdentityProfile(previous, next)).toBe(false);
  });

  it('merges identity lines into an existing IDENTITY.md and keeps the rest of the file', () => {
    const existing = [
      '# IDENTITY.md - Who Am I?',
      '',
      '- **Name:** Old',
      '- Creature: Owl',
      '- **Vibe:** Calm',
      '- **Vibe:** Duplicate',
      '- **Avatar:** avatars/owl.png',
      '',
      'Some prose the Agent wrote about itself.',
      '',
    ].join('\n');
    const profile = {
      name: 'Writer', emoji: '🦉', creature: 'Owl', vibe: 'Warm and curious', theme: '', avatar: 'avatars/owl.png',
    };
    expect(buildIdentityFileContent(profile, existing)).toBe([
      '# IDENTITY.md - Who Am I?',
      '',
      '- **Name:** Writer',
      '- Creature: Owl',
      '- **Vibe:** Warm and curious',
      '- **Avatar:** avatars/owl.png',
      '- **Emoji:** 🦉',
      '',
      'Some prose the Agent wrote about itself.',
      '',
    ].join('\n'));
    // Clearing the vibe removes its line; the avatar line is left to the desktop.
    expect(buildIdentityFileContent({ ...profile, vibe: '', avatar: '' }, existing)).not.toContain('Vibe');
    expect(buildIdentityFileContent({ ...profile, vibe: '', avatar: '' }, existing)).toContain('- **Avatar:** avatars/owl.png');
    // No file yet: the standard template is generated.
    expect(buildIdentityFileContent(profile, '  \n')).toContain('- **Vibe:** Warm and curious');
    expect(buildIdentityFileContent(profile, '')).toContain('Save this file at the workspace root');
  });
});
