export const IOS_ROOT_TAB_BAR_CONTENT_HEIGHT = 49;
export const ANDROID_ROOT_TAB_BAR_CONTENT_HEIGHT = 58;
export const ANDROID_ROOT_TAB_BAR_MIN_BOTTOM_PADDING = 6;
export const ANDROID_ROOT_TAB_BAR_TOP_PADDING = 6;

export type RootTabBarMetrics = {
  contentHeight: number;
  height: number;
  paddingBottom: number;
  paddingTop: number;
};

/**
 * React Navigation's JS tab bar includes the device bottom inset in its
 * physical height. Keeping the calculation centralized also lets full-bleed
 * overlays stop exactly above the bar on both platforms.
 */
export function getRootTabBarMetrics(
  platform: string,
  bottomInset: number,
): RootTabBarMetrics {
  const safeBottomInset = Number.isFinite(bottomInset)
    ? Math.max(0, bottomInset)
    : 0;

  if (platform === 'android') {
    const paddingBottom = Math.max(
      safeBottomInset,
      ANDROID_ROOT_TAB_BAR_MIN_BOTTOM_PADDING,
    );
    return {
      contentHeight: ANDROID_ROOT_TAB_BAR_CONTENT_HEIGHT,
      height: ANDROID_ROOT_TAB_BAR_CONTENT_HEIGHT + paddingBottom,
      paddingBottom,
      paddingTop: ANDROID_ROOT_TAB_BAR_TOP_PADDING,
    };
  }

  return {
    contentHeight: IOS_ROOT_TAB_BAR_CONTENT_HEIGHT,
    height: IOS_ROOT_TAB_BAR_CONTENT_HEIGHT + safeBottomInset,
    paddingBottom: safeBottomInset,
    paddingTop: 0,
  };
}
