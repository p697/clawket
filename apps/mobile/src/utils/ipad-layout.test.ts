import {
  getIpadModalSheetMetrics,
  getIpadModalSheetWidth,
  IPAD_MODAL_SHEET_MAX_HEIGHT,
  IPAD_MODAL_SHEET_MAX_WIDTH,
  IPAD_MODAL_SHEET_MIN_MARGIN,
} from './ipad-layout';

describe('iPad sheet layout metrics', () => {
  it('caps a regular iPad sheet and centers it in both axes', () => {
    expect(getIpadModalSheetMetrics({
      windowWidth: 1024,
      windowHeight: 1366,
      topInset: 24,
      bottomInset: 20,
    })).toEqual({
      width: IPAD_MODAL_SHEET_MAX_WIDTH,
      height: IPAD_MODAL_SHEET_MAX_HEIGHT,
      horizontalMargin: 192,
      topInset: 323,
      bottomInset: 323,
    });
  });

  it('keeps compact split-screen geometry inside safe-area margins', () => {
    expect(getIpadModalSheetMetrics({
      windowWidth: 600,
      windowHeight: 700,
      topInset: 24,
      bottomInset: 20,
    })).toEqual({
      width: 552,
      height: 608,
      horizontalMargin: IPAD_MODAL_SHEET_MIN_MARGIN,
      topInset: 48,
      bottomInset: 44,
    });
  });

  it('uses a bounded fallback for invalid window widths', () => {
    expect(getIpadModalSheetWidth(Number.NaN)).toBe(IPAD_MODAL_SHEET_MAX_WIDTH);
    expect(getIpadModalSheetWidth(0)).toBe(IPAD_MODAL_SHEET_MAX_WIDTH);
  });
});

import { resolveWorkspaceLayout } from './ipad-layout';

describe('adaptive workspace', () => {
  it.each([899, 600, 320, NaN, 0])('collapses for window width %s', width => {
    expect(resolveWorkspaceLayout({ width, tablet: true }).wide).toBe(false);
  });
  it('uses available width and readable text size, not a device model', () => {
    expect(resolveWorkspaceLayout({ width: 900, tablet: true }).wide).toBe(true);
    expect(resolveWorkspaceLayout({ width: 1366, tablet: false }).wide).toBe(false);
    expect(resolveWorkspaceLayout({ width: 1024, tablet: true, fontScale: 2 }).wide).toBe(false);
  });
  it('never pushes small window sheets beyond their available area', () => {
    const metrics = getIpadModalSheetMetrics({ windowWidth: 320, windowHeight: 300, topInset: 24, bottomInset: 20 });
    expect(metrics.width + metrics.horizontalMargin * 2).toBeLessThanOrEqual(320);
    expect(metrics.height + metrics.topInset + metrics.bottomInset).toBeLessThanOrEqual(300);
  });
});
