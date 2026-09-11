import {
  pruneOrderedSelection,
  resolveMediaStripTileSize,
  selectionOrdinal,
  toggleOrderedSelection,
} from './threadAddSheetSelection';

describe('threadAddSheetSelection', () => {
  it('toggles ids in pick order and refuses picks past the limit', () => {
    let selection = toggleOrderedSelection([], 'b', 2);
    selection = toggleOrderedSelection(selection, 'a', 2);
    expect(selection).toEqual(['b', 'a']);
    expect(selectionOrdinal(selection, 'b')).toBe(1);
    expect(selectionOrdinal(selection, 'a')).toBe(2);
    expect(selectionOrdinal(selection, 'c')).toBeNull();

    const full = toggleOrderedSelection(selection, 'c', 2);
    expect(full).toBe(selection);
    expect(toggleOrderedSelection(selection, 'c', 0)).toBe(selection);

    const withoutB = toggleOrderedSelection(selection, 'b', 2);
    expect(withoutB).toEqual(['a']);
    expect(selectionOrdinal(withoutB, 'a')).toBe(1);
  });

  it('prunes ids that disappear from the library and keeps the same reference when nothing changes', () => {
    const current = ['a', 'b', 'c'];
    expect(pruneOrderedSelection(current, new Set(['a', 'b', 'c']), 6)).toBe(current);
    expect(pruneOrderedSelection(current, new Set(['a', 'c']), 6)).toEqual(['a', 'c']);
    expect(pruneOrderedSelection(current, new Set(['a', 'b', 'c']), 2)).toEqual(['a', 'b']);
    expect(pruneOrderedSelection(current, new Set(['a', 'b', 'c']), -1)).toEqual([]);
  });

  it('sizes strip tiles so roughly three and a half fit, clamped to a readable range', () => {
    expect(resolveMediaStripTileSize(342, 8)).toBe(90);
    expect(resolveMediaStripTileSize(120, 8)).toBe(84);
    expect(resolveMediaStripTileSize(1000, 8)).toBe(104);
    expect(resolveMediaStripTileSize(0, 8)).toBe(84);
  });
});
