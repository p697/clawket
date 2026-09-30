import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { ControlSize, FontSize, FontWeight, LineHeight, Motion, Radius, Space } from '../../theme/tokens';
import { useChatSurfaces } from './ChatPresentation';

const DISABLED_OPACITY = 0.55;

export type InlineKeyboardButton = Readonly<{
  key: string;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  /** `primary` is the solid accent for the action the message is asking for. */
  tone?: 'default' | 'primary';
  disabled?: boolean;
  /** The action is in flight: the button spins in place of its label. */
  busy?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}>;

export type InlineKeyboardProps = Readonly<{
  buttons: ReadonlyArray<InlineKeyboardButton>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

/**
 * Buttons hanging under a message, Telegram's inline keyboard (A+ chat
 * design, owner decision 2026-09-30): what the message asks you to do sits
 * right under it on the same translucent tint as the service pills, and the
 * action it is asking for wears the solid accent. The row takes the width of
 * its message.
 */
export function InlineKeyboard({ buttons, style, testID }: InlineKeyboardProps): React.JSX.Element {
  const { service, outgoing } = useChatSurfaces();
  return (
    <View testID={testID} style={[styles.row, style]}>
      {buttons.map((button) => {
        const primary = button.tone === 'primary';
        const textColor = primary ? outgoing.textColor : service.textColor;
        const inactive = button.disabled === true || button.busy === true;
        return (
          <Pressable
            key={button.key}
            testID={button.testID}
            accessibilityRole="button"
            accessibilityLabel={button.accessibilityLabel ?? button.label}
            accessibilityHint={button.accessibilityHint}
            accessibilityState={{ disabled: inactive, busy: button.busy === true }}
            disabled={inactive}
            onPress={button.onPress}
            onLongPress={button.onLongPress}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: primary ? outgoing.backgroundColor : service.backgroundColor },
              pressed && !inactive ? styles.pressed : null,
              button.disabled === true ? styles.disabled : null,
            ]}
          >
            {button.busy ? (
              <ActivityIndicator size="small" color={textColor} testID={button.testID ? `${button.testID}-busy` : undefined} />
            ) : (
              <Text style={[styles.label, { color: textColor }]} numberOfLines={1}>{button.label}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Space.xs,
  },
  button: {
    flex: 1,
    minHeight: ControlSize.floatingButton,
    borderRadius: Radius.settingsGroup,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.md,
  },
  label: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.semibold,
  },
  pressed: {
    opacity: Motion.pressedOpacity,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
});
