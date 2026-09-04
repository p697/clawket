import React, { forwardRef, useMemo } from 'react';
import {
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
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

type Props = Omit<TextInputProps, 'style'> & {
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
      <TextInput
        ref={ref}
        {...rest}
        multiline={multiline}
        placeholderTextColor={placeholderTextColor ?? theme.colors.textSubtle}
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
    field: { borderRadius: Radius.md, overflow: 'hidden' },
    raised: { ...createSurfaceStyle(colors, scheme, 'raised') },
    sunken: {
      backgroundColor: colors.surfaceMuted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    invalid: { borderColor: colors.error },
    input: {
      color: colors.text,
      fontSize: FontSize.base,
      lineHeight: LineHeight.base,
      paddingHorizontal: Space.md,
    },
    singleLine: { minHeight: ControlSize.field, paddingVertical: 0 },
    multiline: { minHeight: 120, paddingVertical: Space.md },
  });
}
