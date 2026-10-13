export const IPAD_MODAL_SHEET_MAX_WIDTH = 640;
export const IPAD_MODAL_SHEET_MIN_MARGIN = 24;
export const IPAD_MODAL_SHEET_MAX_HEIGHT = 720;

export function getIpadModalSheetMetrics(params: {
  windowWidth: number;
  windowHeight: number;
  topInset?: number;
  bottomInset?: number;
  leftInset?: number;
  rightInset?: number;
  preferredHeight?: number;
}): {
  width: number;
  height: number;
  leftMargin: number;
  rightMargin: number;
  topInset: number;
  bottomInset: number;
} {
  const horizontal = sheetAxis(params.windowWidth, params.leftInset, params.rightInset, IPAD_MODAL_SHEET_MAX_WIDTH);
  const maximumHeight = typeof params.preferredHeight === 'number' && Number.isFinite(params.preferredHeight) && params.preferredHeight > 0
    ? Math.min(IPAD_MODAL_SHEET_MAX_HEIGHT, params.preferredHeight)
    : IPAD_MODAL_SHEET_MAX_HEIGHT;
  const vertical = sheetAxis(params.windowHeight, params.topInset, params.bottomInset, maximumHeight);
  return {
    width: horizontal.size,
    height: vertical.size,
    leftMargin: horizontal.start,
    rightMargin: horizontal.end,
    topInset: vertical.start,
    bottomInset: vertical.end,
  };
}

/** Center in the safe rectangle, whose opposite insets need not be equal. */
function sheetAxis(windowSize: number, startInset: number | undefined, endInset: number | undefined, maximum: number) {
  const extent = Number.isFinite(windowSize) && windowSize > 0
    ? windowSize : maximum + IPAD_MODAL_SHEET_MIN_MARGIN * 2;
  const validInset = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  const start = Math.min(validInset(startInset), Math.max(0, extent - 1));
  const end = Math.min(validInset(endInset), Math.max(0, extent - start - 1));
  const available = extent - start - end;
  const size = Math.min(maximum, Math.max(Math.min(1, available), available - IPAD_MODAL_SHEET_MIN_MARGIN * 2));
  const leading = start + Math.floor((available - size) / 2);
  return { size, start: leading, end: extent - leading - size };
}

export const IPAD_CHAT_MAX_WIDTH = 760;
export const IPAD_SIDEBAR_WIDTH = 300;
// Reserve readable detail space after the window's physical safe areas are consumed.
export const IPAD_WORKSPACE_MIN_WIDTH = IPAD_SIDEBAR_WIDTH + 540;

/** Enough local space for a panel without replacing compact phone navigation. */
export function hasPanelSpace(width: number): boolean {
  return Number.isFinite(width) && width >= 600;
}

/** Layout follows the current window, never physical-screen orientation. */
export function resolveWorkspaceLayout({ width, enabled, fontScale = 1 }: {
  width: number; enabled: boolean; fontScale?: number;
}): { wide: boolean; sidebarWidth: number; canShowRoster: boolean } {
  return {
    wide: enabled && Number.isFinite(width) && width >= IPAD_WORKSPACE_MIN_WIDTH
      && width / Math.max(1, fontScale) >= 720,
    sidebarWidth: IPAD_SIDEBAR_WIDTH,
    canShowRoster: enabled && hasPanelSpace(width),
  };
}
