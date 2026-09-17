import {
  isYouMindServerDefaultAvatarUrl,
  resolveYouMindSpriteAvatarUrl,
  YOUMIND_SPRITE_DEFAULT_AVATAR_URI,
} from './youmind-sprite-avatar';

describe('youmind-sprite-avatar', () => {
  it('recognizes the current and legacy YouMind placeholder artwork', () => {
    expect(isYouMindServerDefaultAvatarUrl('https://youmind.com/assets/sprite_default_static.png')).toBe(true);
    expect(isYouMindServerDefaultAvatarUrl('https://cdn.gooo.ai/assets/sprite_default_avator.jpg?x=1')).toBe(true);
    expect(isYouMindServerDefaultAvatarUrl('/assets/sprite_default_static.png')).toBe(true);
    expect(isYouMindServerDefaultAvatarUrl('https://cdn.gooo.ai/user-files/a/b.png')).toBe(false);
    expect(isYouMindServerDefaultAvatarUrl('')).toBe(false);
    expect(isYouMindServerDefaultAvatarUrl(null)).toBe(false);
  });

  it('keeps a custom CDN avatar and prefers camelCase over snake_case', () => {
    expect(resolveYouMindSpriteAvatarUrl({
      avatarUrl: ' https://cdn.gooo.ai/user-files/a/b.png ',
      avatar_url: 'https://cdn.gooo.ai/user-files/old.png',
    })).toBe('https://cdn.gooo.ai/user-files/a/b.png');
    expect(resolveYouMindSpriteAvatarUrl({
      avatar_url: 'https://cdn.youmindassets.com/user-files/c/d.png',
    })).toBe('https://cdn.youmindassets.com/user-files/c/d.png');
  });

  it('resolves everything else to the bundled default', () => {
    expect(resolveYouMindSpriteAvatarUrl(null)).toBe(YOUMIND_SPRITE_DEFAULT_AVATAR_URI);
    expect(resolveYouMindSpriteAvatarUrl({})).toBe(YOUMIND_SPRITE_DEFAULT_AVATAR_URI);
    expect(resolveYouMindSpriteAvatarUrl({ avatarUrl: null })).toBe(YOUMIND_SPRITE_DEFAULT_AVATAR_URI);
    expect(resolveYouMindSpriteAvatarUrl({ avatarUrl: '   ' })).toBe(YOUMIND_SPRITE_DEFAULT_AVATAR_URI);
    expect(resolveYouMindSpriteAvatarUrl({
      avatarUrl: 'https://youmind.com/assets/sprite_default_static.png',
    })).toBe(YOUMIND_SPRITE_DEFAULT_AVATAR_URI);
    expect(resolveYouMindSpriteAvatarUrl({ avatarUrl: 'not a url' })).toBe(YOUMIND_SPRITE_DEFAULT_AVATAR_URI);
  });
});
