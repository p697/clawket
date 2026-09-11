import React, { forwardRef, useMemo } from 'react';
import {
  type StyleProp,
  Platform,
  StyleSheet,
  type TextInput,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { CircleAlert } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  IconSize,
  LineHeight,
  Radius,
  Space,
  createSurfaceStyle,
} from '../../theme/tokens';
import {
  CompositionSafeTextInput,
  type CompositionSafeTextInputProps,
} from './CompositionSafeTextInput';

type Props = Omit<CompositionSafeTextInputProps, 'style'> & {
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  invalid?: boolean;
  errorMessage?: string;
  minHeight?: number;
  surface?: 'raised' | 'sunken' | 'quiet';
};

export const FormTextInput = forwardRef<TextInput, Props>(function FormTextInput(
  {
    containerStyle,
    inputStyle,
    invalid = false,
    errorMessage,
    minHeight,
    multiline = false,
    placeholderTextColor,
    surface = 'quiet',
    ...rest
  },
  ref,
) {
  const { theme } = useAppTheme();
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );
  const field = (
    <View style={[
      styles.field,
      surface === 'quiet' ? styles.quiet : surface === 'sunken' ? styles.sunken : styles.raised,
      invalid && !errorMessage ? styles.invalid : null,
      containerStyle,
    ]}>
      <CompositionSafeTextInput
        ref={ref}
        {...rest}
        accessibilityHint={errorMessage ?? rest.accessibilityHint}
        multiline={multiline}
        placeholderTextColor={placeholderTextColor ?? theme.colors.inkTertiary}
        textAlignVertical={multiline ? 'top' : undefined}
        style={[
          styles.input,
          multiline ? styles.multiline : styles.singleLine,
          minHeight === undefined ? null : { minHeight },
          inputStyle,
        ]}
      />
    </View>
  );
  if (!errorMessage) return field;
  return <View style={styles.stack}>
    {field}
    <View accessibilityRole="alert" style={styles.error}>
      <CircleAlert size={IconSize.sm} color={theme.colors.bad} />
      <Text style={[styles.errorText, { color: theme.colors.inkSecondary }]}>{errorMessage}</Text>
    </View>
  </View>;
});

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    stack: { gap: Space.sm },
    error: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingHorizontal: Space.xs },
    errorText: { flex: 1, fontSize: FontSize.caption, lineHeight: LineHeight.caption },
    field: { borderRadius: Radius.settingsGroup, overflow: 'hidden' },
    quiet: { backgroundColor: colors.surface },
    raised: { ...createSurfaceStyle(colors, scheme, 'raised') },
    sunken: {
      backgroundColor: colors.canvasGrouped,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
    },
    invalid: { borderColor: colors.bad },
    input: {
      color: colors.ink,
      fontSize: FontSize.secondary,
      paddingHorizontal: Space.md,
    },
    // UITextField centers its natural font metrics; a forced paragraph line height
    // adds baseline slack on iOS. Keep explicit leading only for multiline/Android.
    singleLine: {
      minHeight: ControlSize.floatingButton,
      paddingVertical: 0,
      ...(Platform.OS === 'ios' ? {} : { lineHeight: LineHeight.secondary }),
    },
    multiline: { minHeight: 120, paddingVertical: Space.md, lineHeight: LineHeight.secondary },
  });
}
