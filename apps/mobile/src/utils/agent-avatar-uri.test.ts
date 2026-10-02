import {
  pickAgentIdentityAvatarUri,
  resolveAgentAvatarImageSource,
  resolveAgentAvatarUri,
} from './agent-avatar-uri';

describe('agent-avatar-uri', () => {
  it('resolves relative and remote avatars and rejects other schemes', () => {
    expect(resolveAgentAvatarUri('/avatar.png', () => 'https://gateway.invalid')).toBe('https://gateway.invalid/avatar.png');
    expect(resolveAgentAvatarUri('/avatar.png', () => null)).toBeNull();
    expect(resolveAgentAvatarUri('https://cdn.invalid/a.png', () => null)).toBe('https://cdn.invalid/a.png');
    expect(resolveAgentAvatarUri('avatar.png', () => null)).toBeNull();
    expect(resolveAgentAvatarUri('clawket-bundled://unknown', () => null)).toBeNull();
    expect(pickAgentIdentityAvatarUri({ avatar: '/a.png', avatarUrl: ' https://cdn.invalid/b.png ' }, () => null))
      .toBe('https://cdn.invalid/b.png');
  });

  it('maps an avatar URI to a uri source', () => {
    expect(resolveAgentAvatarImageSource('https://cdn.invalid/a.png')).toEqual({ uri: 'https://cdn.invalid/a.png' });
    expect(resolveAgentAvatarImageSource('  ')).toBeNull();
    expect(resolveAgentAvatarImageSource(undefined)).toBeNull();
  });
});
