import type { ImageSourcePropType } from 'react-native';

import { YOUMIND_SPRITE_DEFAULT_AVATAR_URI } from '../connection/adapters/youmind-sprite-avatar';

type AgentIdentityAvatarLike = {
  avatar?: string | null;
  avatarUrl?: string | null;
};

/**
 * Bundled avatar artwork addressed by build-independent sentinel URIs. Adapters
 * emit the sentinel (they cannot require Metro assets); every avatar `Image`
 * resolves it here so the mapping lives in one place.
 */
const BUNDLED_AGENT_AVATARS: Readonly<Record<string, ImageSourcePropType>> = Object.freeze({
  [YOUMIND_SPRITE_DEFAULT_AVATAR_URI]: require('../../assets/avatars/youmind-sprite-default.png'),
});

export function isBundledAgentAvatarUri(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  return Boolean(trimmed) && Object.prototype.hasOwnProperty.call(BUNDLED_AGENT_AVATARS, trimmed as string);
}

function isDirectDisplayableAvatarUri(value: string): boolean {
  return (
    value.startsWith('http')
    || value.startsWith('data:')
    || value.startsWith('file://')
    || value.startsWith('content://')
    || isBundledAgentAvatarUri(value)
  );
}

export function resolveAgentAvatarUri(
  avatar: string | null | undefined,
  getBaseUrl: () => string | null,
): string | null {
  const normalizedAvatar = avatar?.trim();
  if (!normalizedAvatar) return null;

  if (normalizedAvatar.startsWith('/')) {
    const base = getBaseUrl();
    return base ? `${base}${normalizedAvatar}` : null;
  }

  return isDirectDisplayableAvatarUri(normalizedAvatar) ? normalizedAvatar : null;
}

export function pickAgentIdentityAvatarUri(
  identity: AgentIdentityAvatarLike | null | undefined,
  getBaseUrl: () => string | null,
): string | null {
  const directAvatarUrl = resolveAgentAvatarUri(identity?.avatarUrl, getBaseUrl);
  if (directAvatarUrl) return directAvatarUrl;
  return resolveAgentAvatarUri(identity?.avatar, getBaseUrl);
}

/**
 * Turns a display-ready avatar URI into an `Image` source: bundled sentinels
 * become the packaged asset, everything else stays a remote/local `{ uri }`.
 */
export function resolveAgentAvatarImageSource(
  uri: string | null | undefined,
): ImageSourcePropType | null {
  const trimmed = uri?.trim();
  if (!trimmed) return null;
  return BUNDLED_AGENT_AVATARS[trimmed] ?? { uri: trimmed };
}
