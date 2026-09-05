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
