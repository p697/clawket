import type { YouMindSprite } from './youmind-sprite-api';

/**
 * Build-independent marker for the bundled default Sprite artwork
 * (`assets/avatars/youmind-sprite-default.png`). The adapter must stay free of
 * Metro asset requires so the Node integration tests can load it; the UI side
 * (`resolveAgentAvatarImageSource`) turns this URI into the bundled image at
 * render time. Persisting the marker instead of a resolved Metro/bundle path
 * keeps the roster cache valid across dev servers and app updates.
 */
export const YOUMIND_SPRITE_DEFAULT_AVATAR_URI = 'clawket-bundled://youmind-sprite-default-avatar';

// YouMind reports its own placeholder artwork on Sprites that never chose an
// avatar. Treat both the current and the legacy path as "no custom avatar".
const YOUMIND_SERVER_DEFAULT_AVATAR_PATHS: ReadonlySet<string> = new Set([
  '/assets/sprite_default_static.png',
  '/assets/sprite_default_avator.jpg',
]);

export function isYouMindServerDefaultAvatarUrl(url: string | null | undefined): boolean {
  const trimmed = url?.trim();
  if (!trimmed) return false;
  let pathname: string;
  try {
    pathname = new URL(trimmed).pathname;
  } catch {
    pathname = trimmed;
  }
  return YOUMIND_SERVER_DEFAULT_AVATAR_PATHS.has(pathname);
}

/**
 * Explicit custom avatar (YouMind only stores CDN `https` URLs) wins; anything
 * else, including the server placeholder, resolves to the bundled default so
 * a Sprite never falls back to initials.
 */
export function resolveYouMindSpriteAvatarUrl(
  sprite: Pick<YouMindSprite, 'avatarUrl' | 'avatar_url'> | null | undefined,
): string {
  const explicit = readString(sprite?.avatarUrl) || readString(sprite?.avatar_url);
  if (!explicit || isYouMindServerDefaultAvatarUrl(explicit)) {
    return YOUMIND_SPRITE_DEFAULT_AVATAR_URI;
  }
  return /^https?:\/\//iu.test(explicit) ? explicit : YOUMIND_SPRITE_DEFAULT_AVATAR_URI;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
