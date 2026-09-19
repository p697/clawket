import React from 'react';
import type { LucideIcon } from 'lucide-react-native';
import { FloatingButton, type FloatingButtonBadge } from './FloatingButton';

export type SheetHeaderButtonProps = Readonly<{
  icon: LucideIcon;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  badge?: FloatingButtonBadge;
  testID?: string;
}>;

/**
 * The one icon-button chrome for a sheet header: the close action and any
 * trailing action share it so both corners read as the same control. Pass it
 * through `Sheet`'s `headerRight`; do not hand-roll a `FloatingButton` there.
 */
export function SheetHeaderButton({
  icon,
  onPress,
  accessibilityLabel,
  disabled,
  badge,
  testID,
}: SheetHeaderButtonProps): React.JSX.Element {
  return (
    <FloatingButton
      icon={icon}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      appearance="quiet"
      disabled={disabled}
      badge={badge}
      testID={testID}
    />
  );
}
