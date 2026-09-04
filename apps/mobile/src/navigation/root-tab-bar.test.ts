import {
  ANDROID_ROOT_TAB_BAR_CONTENT_HEIGHT,
  ANDROID_ROOT_TAB_BAR_MIN_BOTTOM_PADDING,
  IOS_ROOT_TAB_BAR_CONTENT_HEIGHT,
  getRootTabBarMetrics,
} from './root-tab-bar';

describe('getRootTabBarMetrics', () => {
  it('includes the iOS safe-area inset in the physical bar height', () => {
    expect(getRootTabBarMetrics('ios', 34)).toEqual({
      contentHeight: IOS_ROOT_TAB_BAR_CONTENT_HEIGHT,
      height: IOS_ROOT_TAB_BAR_CONTENT_HEIGHT + 34,
      paddingBottom: 34,
      paddingTop: 0,
    });
  });

  it('keeps Android controls clear of gesture navigation', () => {
    expect(getRootTabBarMetrics('android', 24)).toMatchObject({
      contentHeight: ANDROID_ROOT_TAB_BAR_CONTENT_HEIGHT,
      height: ANDROID_ROOT_TAB_BAR_CONTENT_HEIGHT + 24,
      paddingBottom: 24,
    });
  });

  it('uses a minimum Android bottom padding and sanitizes invalid insets', () => {
    expect(getRootTabBarMetrics('android', Number.NaN).paddingBottom)
      .toBe(ANDROID_ROOT_TAB_BAR_MIN_BOTTOM_PADDING);
    expect(getRootTabBarMetrics('ios', -8).height)
      .toBe(IOS_ROOT_TAB_BAR_CONTENT_HEIGHT);
  });
});
