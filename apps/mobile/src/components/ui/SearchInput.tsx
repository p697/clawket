import React, { useMemo } from 'react';
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { Search, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  HitSize,
  IconSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import { createFloatingSurfaceStyle } from './FloatingButton';
import { CompositionSafeBottomSheetTextInput } from './CompositionSafeBottomSheetTextInput';
import { CompositionSafeTextInput } from './CompositionSafeTextInput';

export type SearchInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  clearAccessibilityLabel?: string;
  onClear?: () => void;
  autoFocus?: boolean;
  inSheet?: boolean;
  testID?: string;
};

export function SearchInput({
  value,
  onChangeText,
  placeholder = 'Search...',
  style,
  clearAccessibilityLabel,
  onClear,
  autoFocus = false,
  inSheet = false,
  testID,
}: SearchInputProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const Input = inSheet ? CompositionSafeBottomSheetTextInput : CompositionSafeTextInput;
  const chrome = inSheet
    ? { backgroundColor: theme.colors.surface }
    : createFloatingSurfaceStyle(theme.colors, theme.scheme);

  return (
    <View testID={testID} style={[styles.wrap, chrome, style]}>
      <Search size={IconSize.sm} color={theme.colors.inkTertiary} strokeWidth={2} />
      <Input
        testID={testID ? `${testID}-input` : undefined}
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.inkTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        clearButtonMode="never"
        returnKeyType="search"
      />
      {value ? (
        <Pressable
          testID={testID ? `${testID}-clear` : undefined}
          accessibilityRole="button"
          accessibilityLabel={clearAccessibilityLabel ?? t('Clear search')}
          hitSlop={Space.sm}
          onPress={onClear ?? (() => onChangeText(''))}
          style={({ pressed }) => [styles.clearButton, pressed ? styles.pressed : null]}
        >
          <X size={IconSize.sm} color={theme.colors.inkSecondary} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    wrap: {
      height: ControlSize.floatingButton,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: Radius.full,
      paddingLeft: Space.lg,
      paddingRight: Space.xs,
      gap: Space.sm,
    },
    input: {
      flex: 1,
      height: ControlSize.floatingButton,
      paddingVertical: 0,
      color: colors.ink,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
    },
    clearButton: {
      width: HitSize.sm,
      height: HitSize.sm,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: {
      backgroundColor: colors.surface,
    },
  });
}
