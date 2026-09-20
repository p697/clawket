export const IPAD_MODAL_SHEET_MAX_WIDTH = 640;
export const IPAD_MODAL_SHEET_MIN_MARGIN = 24;
export const IPAD_MODAL_SHEET_MAX_HEIGHT = 720;
export const IPAD_MODAL_SHEET_MIN_HEIGHT = 520;

export function getIpadModalSheetWidth(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) {
    return IPAD_MODAL_SHEET_MAX_WIDTH;
  }

  return Math.max(
    1,
    Math.min(
      IPAD_MODAL_SHEET_MAX_WIDTH,
      windowWidth - IPAD_MODAL_SHEET_MIN_MARGIN * 2,
    ),
  );
}

export function getIpadModalSheetMetrics(params: {
  windowWidth: number;
  windowHeight: number;
  topInset?: number;
  bottomInset?: number;
}): {
  width: number;
  height: number;
  horizontalMargin: number;
  topInset: number;
  bottomInset: number;
} {
  const topSafeInset = Math.max(0, params.topInset ?? 0);
  const bottomSafeInset = Math.max(0, params.bottomInset ?? 0);
  const availableHeight = Math.max(
    1,
    params.windowHeight
      - topSafeInset
      - bottomSafeInset
      - IPAD_MODAL_SHEET_MIN_MARGIN * 2,
  );
  const height = Math.min(
    IPAD_MODAL_SHEET_MAX_HEIGHT,
    Math.max(
      Math.min(IPAD_MODAL_SHEET_MIN_HEIGHT, availableHeight),
      availableHeight,
    ),
  );
  const remainingHeight = Math.max(0, params.windowHeight - height);
  const centeredInset = Math.floor(remainingHeight / 2);
  const topInset = Math.max(
    topSafeInset + IPAD_MODAL_SHEET_MIN_MARGIN,
    centeredInset,
  );
  const bottomInset = Math.max(
    bottomSafeInset + IPAD_MODAL_SHEET_MIN_MARGIN,
    remainingHeight - topInset,
  );
  const width = getIpadModalSheetWidth(params.windowWidth);

  return {
    width,
    height,
    horizontalMargin: Math.max(
      0,
      Math.floor((params.windowWidth - width) / 2),
    ),
    topInset,
    bottomInset,
  };
}


export const IPAD_WORKSPACE_MIN_WIDTH = 900;
export const IPAD_CHAT_MAX_WIDTH = 760;
export const IPAD_SIDEBAR_WIDTH = 300;

/** Layout follows the current window, never physical-screen orientation. */
export function resolveWorkspaceLayout({ width, tablet, fontScale = 1 }: {
  width: number; tablet: boolean; fontScale?: number;
}): { wide: boolean; sidebarWidth: number } {
  return {
    wide: tablet && Number.isFinite(width) && width >= IPAD_WORKSPACE_MIN_WIDTH
      && width / Math.max(1, fontScale) >= 720,
    sidebarWidth: IPAD_SIDEBAR_WIDTH,
  };
}
