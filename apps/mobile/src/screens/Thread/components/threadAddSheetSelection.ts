import type { RecentPhotosAccessState } from '../../../hooks/useRecentPhotos';

/**
 * Ordered photo selection for the Add sheet. Order matters: tiles show the
 * pick number, and photos attach in that order.
 */
export function toggleOrderedSelection(
  current: readonly string[],
  id: string,
  limit: number,
): readonly string[] {
  if (current.includes(id)) return current.filter((item) => item !== id);
  if (limit <= 0 || current.length >= limit) return current;
  return [...current, id];
}

/** Drops ids that are no longer listed and anything past the limit, keeping order. */
export function pruneOrderedSelection(
  current: readonly string[],
  allowed: ReadonlySet<string>,
  limit: number,
): readonly string[] {
  const next = current.filter((id) => allowed.has(id)).slice(0, Math.max(0, limit));
  if (next.length === current.length && next.every((id, index) => id === current[index])) {
    return current;
  }
  return next;
}

/** 1-based pick number for a selected id, or null when unselected. */
export function selectionOrdinal(current: readonly string[], id: string): number | null {
  const index = current.indexOf(id);
  return index === -1 ? null : index + 1;
}

export const MEDIA_STRIP_VISIBLE_TILES = 3.5;
const MEDIA_STRIP_MIN_TILE = 84;
const MEDIA_STRIP_MAX_TILE = 104;

/** Strip tiles size so roughly three and a half fit, hinting that the row scrolls. */
export function resolveMediaStripTileSize(
  contentWidth: number,
  gap: number,
  visibleTiles = MEDIA_STRIP_VISIBLE_TILES,
): number {
  const available = Math.max(0, contentWidth - gap * Math.floor(visibleTiles));
  const raw = Math.floor(available / visibleTiles);
  return Math.max(MEDIA_STRIP_MIN_TILE, Math.min(MEDIA_STRIP_MAX_TILE, raw));
}

export type AddSheetMediaMode = 'none' | 'skeleton' | 'strip' | 'tiles';

/**
 * The Add sheet's media section. Known photo access decides the final layout
 * on the first frame: granted access keeps the strip (placeholder tiles until
 * the list lands) and only unknown access falls back to the skeleton.
 */
export function resolveAddSheetMediaMode({
  recentPhotos,
  access,
  photoCount,
  loading,
  tileCount,
}: Readonly<{
  recentPhotos: boolean;
  access: RecentPhotosAccessState;
  photoCount: number;
  loading: boolean;
  tileCount: number;
}>): AddSheetMediaMode {
  if (recentPhotos && access === 'checking') return 'skeleton';
  if (recentPhotos && access === 'granted' && (photoCount > 0 || loading)) return 'strip';
  return tileCount > 0 ? 'tiles' : 'none';
}
