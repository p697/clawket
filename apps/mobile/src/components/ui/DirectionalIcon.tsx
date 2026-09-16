import React, { forwardRef } from 'react';
import { I18nManager, StyleSheet } from 'react-native';
import {
  ArrowLeft as LucideArrowLeft,
  ArrowRight as LucideArrowRight,
  ChevronLeft as LucideChevronLeft,
  ChevronRight as LucideChevronRight,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react-native';

const styles = StyleSheet.create({
  mirrored: { transform: [{ scaleX: -1 }] },
});

// Semantic back/forward glyphs flip with the layout direction so "forward"
// keeps pointing along the reading direction under RTL. Media transport,
// charts and other physically oriented icons must import lucide directly.
// Optional chaining tolerates the partial react-native mocks used by screen tests.
const isRtlLayout = (): boolean => I18nManager?.isRTL === true;

function mirrored(Icon: LucideIcon, displayName: string): LucideIcon {
  // Lucide icons expose no ref surface, so the forwarded ref is intentionally unused.
  const Directional = forwardRef<unknown, LucideProps>((props, _ref) => (
    <Icon {...props} style={isRtlLayout() ? [props.style, styles.mirrored] : props.style} />
  ));
  Directional.displayName = displayName;
  return Directional as LucideIcon;
}

export const ArrowLeft = mirrored(LucideArrowLeft, 'DirectionalArrowLeft');
export const ArrowRight = mirrored(LucideArrowRight, 'DirectionalArrowRight');
export const ChevronLeft = mirrored(LucideChevronLeft, 'DirectionalChevronLeft');
export const ChevronRight = mirrored(LucideChevronRight, 'DirectionalChevronRight');
