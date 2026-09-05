import type { ViewStyle } from 'react-native';
import { Space } from '../../theme/tokens';

type ContentOptions = {
  top?: number;
  bottom?: number;
  horizontal?: number;
  grow?: boolean;
};

type HeaderOptions = {
  top?: number;
  bottom?: number;
  gap?: number;
};

export const ScreenLayout = {
  listTop: Space.md,
  cardTop: Space.md,
  horizontal: Space.lg,
  bottom: Space.xxl - Space.sm,
  emptyBottom: Space.xxl,
} as const;

export function createListContentStyle({
  top = ScreenLayout.listTop,
  bottom = ScreenLayout.bottom,
  horizontal = ScreenLayout.horizontal,
  grow = false,
}: ContentOptions = {}): ViewStyle {
  return {
    paddingHorizontal: horizontal,
    paddingTop: top,
    paddingBottom: bottom,
    ...(grow ? { flexGrow: 1 } : null),
  };
}

export function createCardContentStyle({
  top = ScreenLayout.cardTop,
  bottom = Space.xxl,
  horizontal = ScreenLayout.horizontal,
}: ContentOptions = {}): ViewStyle {
  return {
    paddingHorizontal: horizontal,
    paddingTop: top,
    paddingBottom: bottom,
  };
}

export function createListHeaderSpacing({
  top = ScreenLayout.listTop,
  bottom = Space.sm,
  gap = Space.sm,
}: HeaderOptions = {}): ViewStyle {
  return {
    marginTop: top,
    marginBottom: bottom,
    gap,
  };
}
