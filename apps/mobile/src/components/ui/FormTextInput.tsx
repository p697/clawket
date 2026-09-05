import React, { forwardRef, useMemo } from 'react';
import {
  type StyleProp,
  StyleSheet,
  type TextInput,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
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
  minHeight?: number;
  surface?: 'raised' | 'sunken';
};

export const FormTextInput = forwardRef<TextInput, Props>(function FormTextInput(
  {
    containerStyle,
    inputStyle,
    invalid = false,
    minHeight,
    multiline = false,
    placeholderTextColor,
    surface = 'raised',
    ...rest
  },
  ref,
) {
  const { theme } = useAppTheme();
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );
  return (
    <View style={[
      styles.field,
      surface === 'sunken' ? styles.sunken : styles.raised,
      invalid ? styles.invalid : null,
      containerStyle,
    ]}>
      <CompositionSafeTextInput
        ref={ref}
        {...rest}
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
});

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    field: { borderRadius: Radius.settingsGroup, overflow: 'hidden' },
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
      lineHeight: LineHeight.secondary,
      paddingHorizontal: Space.md,
    },
    singleLine: { minHeight: ControlSize.floatingButton, paddingVertical: 0 },
    multiline: { minHeight: 120, paddingVertical: Space.md },
  });
}
