import { YOUMIND_SPRITE_DEFAULT_AVATAR_URI } from '../connection/adapters/youmind-sprite-avatar';
import {
  isBundledAgentAvatarUri,
  pickAgentIdentityAvatarUri,
  resolveAgentAvatarImageSource,
  resolveAgentAvatarUri,
} from './agent-avatar-uri';

describe('agent-avatar-uri', () => {
  it('passes bundled sentinel URIs through like direct URLs', () => {
    expect(isBundledAgentAvatarUri(YOUMIND_SPRITE_DEFAULT_AVATAR_URI)).toBe(true);
    expect(isBundledAgentAvatarUri('clawket-bundled://unknown')).toBe(false);
    expect(resolveAgentAvatarUri(` ${YOUMIND_SPRITE_DEFAULT_AVATAR_URI} `, () => null))
      .toBe(YOUMIND_SPRITE_DEFAULT_AVATAR_URI);
    expect(pickAgentIdentityAvatarUri({ avatarUrl: YOUMIND_SPRITE_DEFAULT_AVATAR_URI }, () => null))
      .toBe(YOUMIND_SPRITE_DEFAULT_AVATAR_URI);
    expect(resolveAgentAvatarUri('clawket-bundled://unknown', () => null)).toBeNull();
  });

  it('still resolves relative and remote avatars as before', () => {
    expect(resolveAgentAvatarUri('/avatar.png', () => 'https://gateway.invalid')).toBe('https://gateway.invalid/avatar.png');
    expect(resolveAgentAvatarUri('/avatar.png', () => null)).toBeNull();
    expect(resolveAgentAvatarUri('https://cdn.invalid/a.png', () => null)).toBe('https://cdn.invalid/a.png');
    expect(resolveAgentAvatarUri('avatar.png', () => null)).toBeNull();
  });

  it('maps sentinels to the packaged asset and everything else to a uri source', () => {
    // jest.setup.ts resolves the PNG to a numeric Metro asset handle.
    expect(resolveAgentAvatarImageSource(YOUMIND_SPRITE_DEFAULT_AVATAR_URI)).toBe(306);
    expect(resolveAgentAvatarImageSource('https://cdn.invalid/a.png')).toEqual({ uri: 'https://cdn.invalid/a.png' });
    expect(resolveAgentAvatarImageSource('  ')).toBeNull();
    expect(resolveAgentAvatarImageSource(undefined)).toBeNull();
  });
});
