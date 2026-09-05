import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  minWidth?: number;
};

export function HeaderTextAction({
  label,
  onPress,
  disabled = false,
  minWidth = 56,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      style={({ pressed }) => [
        styles.pressable,
        { minWidth },
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: disabled ? theme.colors.inkTertiary : theme.colors.inkSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.xs,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    textAlign: 'center',
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.semibold,
  },
});
