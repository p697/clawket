import { describe, expect, it, jest } from '@jest/globals';
import { persistAgentDetailChanges } from './agent-detail-save';

describe('persistAgentDetailChanges', () => {
  it('writes IDENTITY.md before patching config', async () => {
    const gateway = {
      getConfig: jest.fn(async () => ({
        config: {
          agents: {
            list: [{ id: 'writer', name: 'Writer' }],
          },
        },
        hash: 'hash-1',
      })),
      setAgentFile: jest.fn(async () => ({ ok: true })),
    };
    const patchWithRestart = jest.fn(async () => true);

    await persistAgentDetailChanges({
      agentId: 'writer',
      gateway,
      patchWithRestart,
      agentName: 'Nova',
      identityProfile: {
        name: 'Nova',
        emoji: '🦊',
        creature: 'fox',
        vibe: 'sharp',
        theme: '',
        avatar: '',
      },
      model: 'openai/gpt-5-mini',
      fallbacks: [],
      shouldWriteIdentityFile: true,
      shouldSyncConfig: true,
      previousIdentityFileContent: '# old',
    });

    expect(gateway.setAgentFile as jest.Mock).toHaveBeenNthCalledWith(
      1,
      'IDENTITY.md',
      expect.stringContaining('- **Name:** Nova'),
      'writer',
    );
    expect(patchWithRestart as jest.Mock).toHaveBeenCalledWith(expect.objectContaining({
      configHash: 'hash-1',
    }));
  });

  it('rolls back IDENTITY.md when config patch fails', async () => {
    const gateway = {
      getConfig: jest.fn(async () => ({
        config: {
          agents: {
            list: [{ id: 'writer', name: 'Writer' }],
          },
        },
        hash: 'hash-1',
      })),
      setAgentFile: jest.fn(async () => ({ ok: true })),
    };
    const patchWithRestart = jest.fn(async () => {
      throw new Error('patch failed');
    });

    await expect(
      persistAgentDetailChanges({
        agentId: 'writer',
        gateway,
        patchWithRestart,
        agentName: 'Nova',
        identityProfile: {
          name: 'Nova',
          emoji: '🦊',
          creature: 'fox',
          vibe: 'sharp',
          theme: '',
          avatar: '',
        },
        model: '',
        fallbacks: [],
        shouldWriteIdentityFile: true,
        shouldSyncConfig: true,
        previousIdentityFileContent: '# old identity',
      }),
    ).rejects.toThrow('patch failed');

    expect(gateway.setAgentFile as jest.Mock).toHaveBeenNthCalledWith(
      2,
      'IDENTITY.md',
      '# old identity',
      'writer',
    );
  });

  it('raises a dedicated error when rollback fails', async () => {
    const gateway = {
      getConfig: jest.fn(async () => ({
        config: {
          agents: {
            list: [{ id: 'writer', name: 'Writer' }],
          },
        },
        hash: 'hash-1',
      })),
      setAgentFile: jest
        .fn<() => Promise<{ ok: boolean }>>()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false }),
    };
    const patchWithRestart = jest.fn(async () => {
      throw new Error('patch failed');
    });

    await expect(
      persistAgentDetailChanges({
        agentId: 'writer',
        gateway,
        patchWithRestart,
        agentName: 'Nova',
        identityProfile: {
          name: 'Nova',
          emoji: '🦊',
          creature: 'fox',
          vibe: 'sharp',
          theme: '',
          avatar: '',
        },
        model: '',
        fallbacks: [],
        shouldWriteIdentityFile: true,
        shouldSyncConfig: true,
        previousIdentityFileContent: '# old identity',
      }),
    ).rejects.toThrow(
      'Failed to update agent config after writing IDENTITY.md; original identity could not be restored.',
    );
  });
});
