import {
  CAPABILITY_MATRIX,
  type AgentDescriptor,
  type AgentsOperations,
} from '@clawket/agent-protocol';
import {
  buildIdentityAgentPatch,
  buildIdentityFileContent,
  buildUserFileContent,
  canCreateIdentityAgent,
  canEditIdentityFiles,
  canEditIdentityProfile,
  loadIdentityBundle,
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
  it('loads management identity and core files with descriptor fallbacks', async () => {
    const get = jest.fn(async (name: string) => ({
      name,
      path: `/${name}`,
      missing: false,
      content: name === 'IDENTITY.md'
        ? '- **Vibe:** Calm\n- **Emoji:** 🦉'
        : name === 'USER.md'
          ? '- **Name:** Lucy\n\n## Context\n\nBuilding Clawket\n\n---'
          : `${name} content`,
    }));
    const operations: AgentsOperations = {
      list: jest.fn(async () => ({
        defaultId: 'main',
        mainKey: 'main',
        agents: [{ id: 'writer', name: 'Writer', identity: { avatar: 'avatar.png' } }],
      })),
      files: { get },
    };

    await expect(loadIdentityBundle(operations, agent)).resolves.toEqual(expect.objectContaining({
      profile: expect.objectContaining({
        name: 'Writer',
        emoji: '🦉',
        vibe: 'Calm',
        avatar: 'avatar.png',
      }),
      user: expect.objectContaining({ name: 'Lucy', context: 'Building Clawket' }),
      contents: expect.objectContaining({
        'SOUL.md': 'SOUL.md content',
        'MEMORY.md': 'MEMORY.md content',
      }),
    }));
    expect(get).toHaveBeenCalledWith('IDENTITY.md', 'writer');
  });

  it('keeps usable partial data and fails only when every available read fails', async () => {
    const partial: AgentsOperations = {
      files: {
        get: jest.fn(async (name: string) => {
          if (name === 'SOUL.md') {
            return { name, path: name, missing: false, content: 'Be kind.' };
          }
          throw new Error(`Missing ${name}`);
        }),
      },
    };
    await expect(loadIdentityBundle(partial, agent)).resolves.toEqual(expect.objectContaining({
      profile: expect.objectContaining({ name: 'Writer fallback', emoji: '✍️' }),
      contents: expect.objectContaining({ 'SOUL.md': 'Be kind.', 'MEMORY.md': '' }),
    }));

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
    expect(buildIdentityAgentPatch(previous, next)).toEqual({ name: 'Writer', avatar: 'avatar.png' });
    expect(buildIdentityFileContent(next)).toContain('- **Emoji:** 🦉');
  });

  it('preserves unrelated USER.md prose while updating structured fields', () => {
    const content = [
      '# USER.md',
      '',
      '- **Name:** Old',
      '',
      'Custom prose stays.',
      '',
      '## Context',
      '',
      'Old context',
      '',
      '---',
    ].join('\n');
    const updated = buildUserFileContent(content, {
      name: 'Lucy',
      whatToCallThem: 'Lucy',
      pronouns: 'she',
      timezone: 'Asia/Tokyo',
      notes: 'Builder',
      context: 'New context',
    });
    expect(updated).toContain('Custom prose stays.');
    expect(updated).toContain('- **Name:** Lucy');
    expect(updated).toContain('New context');
    expect(updated).not.toContain('Old context');
  });
});
