import { useBottomTabBarHeight as useJsTabBarHeight } from '@react-navigation/bottom-tabs';

/**
 * Reads the physical height of the shared JS bottom tab bar.
 *
 * JS bottom tabs already occupy layout space. Screens should not add this
 * value as a general content inset; it is for overlays, drawers, and keyboard
 * policies that need to know the bar's measured height.
 * Falls back to 0 when rendered outside a bottom-tab navigator, such as
 * root-level modal flows opened above tabs.
 */
export function useTabBarHeight(): number {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useJsTabBarHeight();
  } catch {
    return 0;
  }
}
