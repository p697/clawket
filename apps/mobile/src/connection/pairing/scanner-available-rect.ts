export type ScannerRect = { x: number; y: number; width: number; height: number };
export type ScannerRegionsSnapshot = { width: number; height: number; regions: ScannerRect[] };

/** Keep the scanner's related controls in one region; the camera still fills the view. */
export function availableScannerRect(safeRect: ScannerRect, regions: readonly ScannerRect[]): ScannerRect {
  let candidates = [safeRect];
  for (const region of regions) {
    if (![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.width <= 0 || region.height <= 0) continue;
    const next = candidates.flatMap(available => {
      const left = Math.max(available.x, region.x);
      const top = Math.max(available.y, region.y);
      const right = Math.min(available.x + available.width, region.x + region.width);
      const bottom = Math.min(available.y + available.height, region.y + region.height);
      if (left >= right || top >= bottom) return [available];
      return [
        { ...available, width: left - available.x },
        { ...available, x: right, width: available.x + available.width - right },
        { ...available, height: top - available.y },
        { ...available, y: bottom, height: available.y + available.height - bottom },
      ].filter(rect => rect.width > 0 && rect.height > 0);
    });
    // Keep alternative sides until all regions are considered; another occlusion may
    // cover the initially larger side. Drop duplicates and fully contained choices.
    candidates = next.filter((rect, index) => !next.some((other, otherIndex) =>
      otherIndex !== index && other.x <= rect.x && other.y <= rect.y &&
      other.x + other.width >= rect.x + rect.width && other.y + other.height >= rect.y + rect.height &&
      (other.width * other.height > rect.width * rect.height || otherIndex < index)));
  }
  candidates.sort((a, b) => b.width * b.height - a.width * a.height || b.width - a.width || a.y - b.y || a.x - b.x);
  return candidates[0] ?? { ...safeRect, width: 0, height: 0 };
}
