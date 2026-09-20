import { StyleSheet } from 'react-native';
import { ControlSize, FontSize, FontWeight, LineHeight, Radius, Space } from '../../theme/tokens';

/** One geometry for tool activity and the pending reply status. */
export const activityCardStyles = StyleSheet.create({
  surface: {
    minHeight: ControlSize.floatingButton,
    borderRadius: Radius.card,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    justifyContent: 'center',
  },
  label: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
});
