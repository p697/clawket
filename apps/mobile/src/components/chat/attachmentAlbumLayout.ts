/**
 * Message album layout for image attachments in the Thread timeline.
 *
 * Pure geometry — no React or React Native imports — so the recipe is unit
 * testable and the overlay clone of a row reproduces the exact same frame.
 *
 * One image shows at its own aspect ratio inside a bounding box. Two or more
 * images pack into rows of at most three (Telegram-style): every row spans the
 * album width, tiles split the row in proportion to their aspect ratios, and
 * the row height follows the shared aspect within clamps so tall screenshots
 * and wide photos both read well. Every image is always visible — no
 * truncation, no horizontal scrolling inside the vertical timeline.
 */

export type AlbumImageSize = { width: number; height: number };

export type AlbumTile = { x: number; y: number; width: number; height: number };

export type AttachmentAlbumLayout = {
  width: number;
  height: number;
  tiles: AlbumTile[];
};

/** Hairline gap between tiles; the album is one clipped surface, not a grid of cards. */
export const ALBUM_TILE_GAP = 3;

/** A single image may grow taller than wide, but not past this multiple of the album width. */
const SINGLE_MAX_HEIGHT_RATIO = 1.25;
const SINGLE_ASPECT_RANGE = { min: 0.5, max: 1.5 } as const;

const ROW_ASPECT_RANGE = { min: 0.5, max: 2 } as const;
/** Row height clamps as a fraction of the album width. */
const ROW_HEIGHT_RANGE = { min: 0.3, max: 0.75 } as const;
const MAX_TILES_PER_ROW = 3;

const EMPTY_LAYOUT: AttachmentAlbumLayout = { width: 0, height: 0, tiles: [] };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isKnownSize(size: AlbumImageSize | undefined): size is AlbumImageSize {
  return Boolean(size)
    && Number.isFinite(size!.width)
    && Number.isFinite(size!.height)
    && size!.width > 0
    && size!.height > 0;
}

/** Aspect ratio (w / h) clamped to a range; unknown or corrupted sizes read as square. */
function aspectOf(size: AlbumImageSize | undefined, range: { min: number; max: number }): number {
  if (!isKnownSize(size)) return 1;
  return clamp(size.width / size.height, range.min, range.max);
}

/**
 * Row sizes for `count` tiles: at most three per row, as even as possible,
 * with the fuller rows at the bottom (2 → [2], 4 → [2, 2], 5 → [2, 3], 6 → [3, 3]).
 */
export function albumRowCounts(count: number): number[] {
  if (!Number.isFinite(count) || count <= 0) return [];
  const total = Math.floor(count);
  const rows = Math.ceil(total / MAX_TILES_PER_ROW);
  const base = Math.floor(total / rows);
  const fuller = total - base * rows;
  return Array.from({ length: rows }, (_, index) => (index >= rows - fuller ? base + 1 : base));
}

function singleImageLayout(size: AlbumImageSize | undefined, maxWidth: number): AttachmentAlbumLayout {
  const aspect = aspectOf(size, SINGLE_ASPECT_RANGE);
  const boxWidth = maxWidth;
  const boxHeight = Math.round(maxWidth * SINGLE_MAX_HEIGHT_RATIO);
  let width: number;
  let height: number;
  if (aspect >= boxWidth / boxHeight) {
    width = boxWidth;
    height = Math.round(boxWidth / aspect);
  } else {
    height = boxHeight;
    width = Math.round(boxHeight * aspect);
  }
  width = Math.min(width, boxWidth);
  height = Math.min(height, boxHeight);
  return { width, height, tiles: [{ x: 0, y: 0, width, height }] };
}

/**
 * Lay out `sizes` inside an album no wider than `maxWidth`. Unknown sizes
 * (missing, zero or non-finite) are treated as square so the album keeps a
 * stable footprint while dimensions resolve.
 */
export function computeAttachmentAlbumLayout(
  sizes: readonly (AlbumImageSize | undefined)[],
  maxWidth: number,
): AttachmentAlbumLayout {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0 || sizes.length === 0) return EMPTY_LAYOUT;
  const width = Math.round(maxWidth);
  if (sizes.length === 1) return singleImageLayout(sizes[0], width);

  const minRowHeight = Math.round(width * ROW_HEIGHT_RANGE.min);
  const maxRowHeight = Math.round(width * ROW_HEIGHT_RANGE.max);
  const tiles: AlbumTile[] = [];
  let y = 0;
  let cursor = 0;
  for (const count of albumRowCounts(sizes.length)) {
    const rowSizes = sizes.slice(cursor, cursor + count);
    cursor += count;
    const aspects = rowSizes.map((size) => aspectOf(size, ROW_ASPECT_RANGE));
    const totalAspect = aspects.reduce((sum, aspect) => sum + aspect, 0);
    const innerWidth = width - ALBUM_TILE_GAP * (count - 1);
    const rowHeight = clamp(Math.round(innerWidth / totalAspect), minRowHeight, maxRowHeight);
    let x = 0;
    aspects.forEach((aspect, index) => {
      const last = index === aspects.length - 1;
      // The last tile absorbs rounding so the row always spans the album exactly.
      const tileWidth = last ? width - x : Math.round(innerWidth * (aspect / totalAspect));
      tiles.push({ x, y, width: tileWidth, height: rowHeight });
      x += tileWidth + ALBUM_TILE_GAP;
    });
    y += rowHeight + ALBUM_TILE_GAP;
  }
  return { width, height: y - ALBUM_TILE_GAP, tiles };
}
