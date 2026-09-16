import {
  ALBUM_TILE_GAP,
  albumRowCounts,
  computeAttachmentAlbumLayout,
  type AlbumImageSize,
} from './attachmentAlbumLayout';

const WIDTH = 274;
const portrait: AlbumImageSize = { width: 1179, height: 2556 };
const landscape: AlbumImageSize = { width: 1920, height: 1080 };
const square: AlbumImageSize = { width: 1000, height: 1000 };
const unknown: AlbumImageSize = { width: 0, height: 0 };

function repeat(size: AlbumImageSize, count: number): AlbumImageSize[] {
  return Array.from({ length: count }, () => size);
}

describe('albumRowCounts', () => {
  it('packs at most three per row with the fuller rows last', () => {
    expect(albumRowCounts(1)).toEqual([1]);
    expect(albumRowCounts(2)).toEqual([2]);
    expect(albumRowCounts(3)).toEqual([3]);
    expect(albumRowCounts(4)).toEqual([2, 2]);
    expect(albumRowCounts(5)).toEqual([2, 3]);
    expect(albumRowCounts(6)).toEqual([3, 3]);
    expect(albumRowCounts(7)).toEqual([2, 2, 3]);
    expect(albumRowCounts(10)).toEqual([2, 2, 3, 3]);
  });

  it('rejects corrupted counts', () => {
    expect(albumRowCounts(0)).toEqual([]);
    expect(albumRowCounts(-2)).toEqual([]);
    expect(albumRowCounts(Number.NaN)).toEqual([]);
  });
});

describe('computeAttachmentAlbumLayout', () => {
  it('returns an empty layout for no images or an unusable width', () => {
    expect(computeAttachmentAlbumLayout([], WIDTH)).toEqual({ width: 0, height: 0, tiles: [] });
    expect(computeAttachmentAlbumLayout([portrait], 0)).toEqual({ width: 0, height: 0, tiles: [] });
    expect(computeAttachmentAlbumLayout([portrait], Number.NaN)).toEqual({ width: 0, height: 0, tiles: [] });
  });

  it('shows a single portrait screenshot tall, capped at 1.25× the album width', () => {
    const layout = computeAttachmentAlbumLayout([portrait], WIDTH);
    expect(layout.tiles).toHaveLength(1);
    expect(layout.height).toBe(Math.round(WIDTH * 1.25));
    // The 9:19.5 screenshot is clamped to a 1:2 ratio, never a sliver.
    expect(layout.width).toBe(Math.round(layout.height * 0.5));
    expect(layout.tiles[0]).toEqual({ x: 0, y: 0, width: layout.width, height: layout.height });
  });

  it('shows a single landscape photo at the full album width', () => {
    const layout = computeAttachmentAlbumLayout([landscape], WIDTH);
    expect(layout.width).toBe(WIDTH);
    expect(layout.height).toBe(Math.round(WIDTH / 1.5));
  });

  it('treats an unknown single size as a square placeholder', () => {
    const layout = computeAttachmentAlbumLayout([unknown], WIDTH);
    expect(layout).toEqual({ width: WIDTH, height: WIDTH, tiles: [{ x: 0, y: 0, width: WIDTH, height: WIDTH }] });
  });

  it('lays six images out as two rows of three that span the album exactly', () => {
    const layout = computeAttachmentAlbumLayout(repeat(unknown, 6), WIDTH);
    expect(layout.tiles).toHaveLength(6);
    expect(layout.width).toBe(WIDTH);
    const rows = new Set(layout.tiles.map((tile) => tile.y));
    expect(rows.size).toBe(2);
    for (const y of rows) {
      const row = layout.tiles.filter((tile) => tile.y === y);
      expect(row).toHaveLength(3);
      const span = row.reduce((sum, tile) => sum + tile.width, 0) + ALBUM_TILE_GAP * (row.length - 1);
      expect(span).toBe(WIDTH);
      expect(new Set(row.map((tile) => tile.height)).size).toBe(1);
    }
    const [first, second] = layout.tiles;
    expect(second.x).toBe(first.x + first.width + ALBUM_TILE_GAP);
    expect(layout.height).toBe(layout.tiles[5].y + layout.tiles[5].height);
  });

  it('splits a two-image row by aspect ratio', () => {
    const layout = computeAttachmentAlbumLayout([landscape, portrait], WIDTH);
    expect(layout.tiles).toHaveLength(2);
    expect(layout.tiles[0].y).toBe(layout.tiles[1].y);
    expect(layout.tiles[0].width).toBeGreaterThan(layout.tiles[1].width);
    expect(layout.tiles[0].width + ALBUM_TILE_GAP + layout.tiles[1].width).toBe(WIDTH);
  });

  it('clamps row heights so wide rows never collapse and tall rows never dominate', () => {
    const wide = computeAttachmentAlbumLayout(repeat(landscape, 3), WIDTH);
    expect(wide.tiles[0].height).toBe(Math.round(WIDTH * 0.3));
    const tall = computeAttachmentAlbumLayout(repeat(portrait, 2), WIDTH);
    expect(tall.tiles[0].height).toBe(Math.round(WIDTH * 0.75));
    const even = computeAttachmentAlbumLayout(repeat(square, 4), WIDTH);
    expect(even.tiles.map((tile) => tile.y)).toEqual([0, 0, even.tiles[2].y, even.tiles[2].y]);
    expect(even.tiles[2].y).toBe(even.tiles[0].height + ALBUM_TILE_GAP);
  });

  it('never yields a tile narrower than its share when sizes are corrupted', () => {
    const corrupted = [
      { width: Number.NaN, height: 10 },
      { width: -5, height: 20 },
      { width: Number.POSITIVE_INFINITY, height: 1 },
      undefined,
    ];
    const layout = computeAttachmentAlbumLayout(corrupted, WIDTH);
    expect(layout.tiles).toHaveLength(4);
    for (const tile of layout.tiles) {
      expect(tile.width).toBeGreaterThan(0);
      expect(tile.height).toBeGreaterThan(0);
      expect(Number.isFinite(tile.x) && Number.isFinite(tile.y)).toBe(true);
    }
    // All four read as squares, so the two rows are identical 2-up rows.
    expect(layout.tiles[0].width).toBe(layout.tiles[2].width);
    expect(layout.tiles[0].height).toBe(layout.tiles[2].height);
  });
});
