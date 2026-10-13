import {
  getIpadModalSheetMetrics,
  hasPanelSpace,
  IPAD_MODAL_SHEET_MAX_HEIGHT,
  IPAD_MODAL_SHEET_MAX_WIDTH,
  IPAD_MODAL_SHEET_MIN_MARGIN,
} from './ipad-layout';

describe('iPad sheet layout metrics', () => {
  it('centers short content and caps its preferred height inside the safe rectangle', () => {
    const window = { windowWidth: 669, windowHeight: 951, topInset: 82, bottomInset: 34 };
    expect(getIpadModalSheetMetrics({ ...window, preferredHeight: 300 })).toMatchObject({ height: 300, topInset: 349, bottomInset: 302 });
    expect(getIpadModalSheetMetrics({ ...window, preferredHeight: 1200 }).height).toBe(720);
    const short = getIpadModalSheetMetrics({ ...window, windowHeight: 240, preferredHeight: 300 });
    expect(short.height + short.topInset + short.bottomInset).toBe(240);
    expect(short.height).toBe(76);
  });
  it('caps a regular iPad sheet and centers it in both axes', () => {
    expect(getIpadModalSheetMetrics({
      windowWidth: 1024,
      windowHeight: 1366,
      topInset: 24,
      bottomInset: 20,
    })).toEqual({
      width: IPAD_MODAL_SHEET_MAX_WIDTH,
      height: IPAD_MODAL_SHEET_MAX_HEIGHT,
      leftMargin: 192,
      rightMargin: 192,
      topInset: 325,
      bottomInset: 321,
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
      leftMargin: IPAD_MODAL_SHEET_MIN_MARGIN,
      rightMargin: IPAD_MODAL_SHEET_MIN_MARGIN,
      topInset: 48,
      bottomInset: 44,
    });
  });

  it('centers inside asymmetric safe areas and follows an edge swap', () => {
    // Synthetic geometry; this is not a device specification or simulator test.
    const window = { windowWidth: 744, windowHeight: 960, topInset: 62, bottomInset: 34 };
    expect(getIpadModalSheetMetrics({ ...window, leftInset: 64, rightInset: 24 })).toEqual({
      width: 608, height: 720, leftMargin: 88, rightMargin: 48, topInset: 134, bottomInset: 106,
    });
    expect(getIpadModalSheetMetrics({ ...window, leftInset: 24, rightInset: 64 })).toEqual({
      width: 608, height: 720, leftMargin: 48, rightMargin: 88, topInset: 134, bottomInset: 106,
    });
  });

  it.each([
    { windowWidth: 700, windowHeight: 500, leftInset: 64, rightInset: 24, topInset: 62, bottomInset: 34 },
    { windowWidth: 100, windowHeight: 80, leftInset: 64, rightInset: 64, topInset: 62, bottomInset: 62 },
    { windowWidth: 320, windowHeight: 300, leftInset: NaN, rightInset: Infinity, topInset: -1, bottomInset: NaN },
  ])('bounds a short or transient window without negative or nonfinite geometry', input => {
    const metrics = getIpadModalSheetMetrics(input);
    expect(Object.values(metrics).every(value => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(metrics.width + metrics.leftMargin + metrics.rightMargin).toBe(input.windowWidth);
    expect(metrics.height + metrics.topInset + metrics.bottomInset).toBe(input.windowHeight);
  });

  it('uses a bounded fallback for invalid window widths', () => {
    expect(getIpadModalSheetMetrics({ windowWidth: Number.NaN, windowHeight: 900 }).width).toBe(IPAD_MODAL_SHEET_MAX_WIDTH);
    expect(getIpadModalSheetMetrics({ windowWidth: 0, windowHeight: 900 }).width).toBe(IPAD_MODAL_SHEET_MAX_WIDTH);
  });
});

import { resolveWorkspaceLayout } from './ipad-layout';

describe('adaptive workspace', () => {
  it.each([599, 600, 744, Number.NaN])('offers a panel only with enough usable width %s', width => {
    expect(hasPanelSpace(width)).toBe(Number.isFinite(width) && width >= 600);
    expect(resolveWorkspaceLayout({ width, enabled: true }).canShowRoster).toBe(hasPanelSpace(width));
    expect(resolveWorkspaceLayout({ width, enabled: false }).canShowRoster).toBe(false);
  });
  it.each([839, 600, 320, NaN, 0])('collapses for window width %s', width => {
    expect(resolveWorkspaceLayout({ width, enabled: true }).wide).toBe(false);
  });
  it('uses available width and readable text size, not a device model', () => {
    expect(resolveWorkspaceLayout({ width: 840, enabled: true }).wide).toBe(true);
    expect(resolveWorkspaceLayout({ width: 951 - 84, enabled: true }).wide).toBe(true);
    expect(resolveWorkspaceLayout({ width: 951 - 84 - 12, enabled: true }).wide).toBe(true);
    expect(resolveWorkspaceLayout({ width: 951 - 84, enabled: true, fontScale: 1.3 }).wide).toBe(false);
    expect(resolveWorkspaceLayout({ width: 1366, enabled: false }).wide).toBe(false);
    expect(resolveWorkspaceLayout({ width: 1024, enabled: true, fontScale: 2 }).wide).toBe(false);
  });
  it('never pushes small window sheets beyond their available area', () => {
    const metrics = getIpadModalSheetMetrics({ windowWidth: 320, windowHeight: 300, topInset: 24, bottomInset: 20 });
    expect(metrics.width + metrics.leftMargin + metrics.rightMargin).toBeLessThanOrEqual(320);
    expect(metrics.height + metrics.topInset + metrics.bottomInset).toBeLessThanOrEqual(300);
  });
});
