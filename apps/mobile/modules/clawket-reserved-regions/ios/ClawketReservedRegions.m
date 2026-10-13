#import "ClawketReservedRegions.h"
#import <TargetConditionals.h>

NSArray<NSDictionary<NSString *, NSNumber *> *> *ClawketActiveReservedRegions(UIView *view) {
  NSMutableArray *result = [NSMutableArray array];
#if defined(__IPHONE_27_1) && __IPHONE_OS_VERSION_MAX_ALLOWED >= __IPHONE_27_1 && TARGET_OS_IOS && !TARGET_OS_MACCATALYST
  if (@available(iOS 27.1, *)) {
    // Read synchronously inside layoutSubviews for UIKit's automatic observation.
    // Frames already include margins, and are local to this exact view.
    for (UIViewReservedRegionKind *kind in @[
      UIViewReservedRegionKind.divisionRegionKind, UIViewReservedRegionKind.occlusionRegionKind
    ]) {
      for (UIViewReservedRegion *region in [view reservedRegionsOfKind:kind]) {
        CGRect frame = region.frame;
        if (!region.isActive || CGRectIsEmpty(frame) || CGRectIsInfinite(frame) || CGRectIsNull(frame) ||
            !isfinite(frame.origin.x) || !isfinite(frame.origin.y) ||
            !isfinite(frame.size.width) || !isfinite(frame.size.height)) continue;
        [result addObject:@{ @"x": @(frame.origin.x), @"y": @(frame.origin.y),
                            @"width": @(frame.size.width), @"height": @(frame.size.height) }];
      }
    }
  }
#endif
  return result;
}
