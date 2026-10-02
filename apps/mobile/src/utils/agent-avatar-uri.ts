import type { ImageSourcePropType } from 'react-native';

type AgentIdentityAvatarLike = {
  avatar?: string | null;
  avatarUrl?: string | null;
};

function isDirectDisplayableAvatarUri(value: string): boolean {
  return (
    value.startsWith('http')
    || value.startsWith('data:')
    || value.startsWith('file://')
    || value.startsWith('content://')
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

/** Turns a display-ready avatar URI into an `Image` source. */
export function resolveAgentAvatarImageSource(
  uri: string | null | undefined,
): ImageSourcePropType | null {
  const trimmed = uri?.trim();
  return trimmed ? { uri: trimmed } : null;
}
