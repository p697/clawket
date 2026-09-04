import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, TextInput, View, ViewStyle } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, LineHeight, Radius, Space, createSurfaceStyle } from '../../theme/tokens';
import { ActionButton } from './ActionButton';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  clearAccessibilityLabel?: string;
  onClear?: () => void;
};

export function SearchInput({
  value,
  onChangeText,
  placeholder = 'Search...',
  style,
  clearAccessibilityLabel,
  onClear,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const styles = useMemo(
    () => createStyles(theme.colors, theme.scheme),
    [theme.colors, theme.scheme],
  );

  return (
    <View style={[styles.wrap, style]}>
      <Search size={16} color={theme.colors.textSubtle} strokeWidth={2} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never"
      />
      {value ? (
        <ActionButton
          icon={X}
          onPress={onClear ?? (() => onChangeText(''))}
          accessibilityLabel={clearAccessibilityLabel ?? t('Clear search')}
          appearance="bare"
          size="sm"
          iconSize={16}
          iconColor={theme.colors.textMuted}
          style={styles.clearButton}
        />
      ) : null}
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useAppTheme>['theme']['colors'],
  scheme: ReturnType<typeof useAppTheme>['theme']['scheme'],
) {
  return StyleSheet.create({
    wrap: {
      height: ControlSize.standard,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: Radius.full,
      paddingHorizontal: Space.lg,
      gap: Space.sm,
      ...createSurfaceStyle(colors, scheme, 'raised'),
    },
    input: {
      flex: 1,
      height: ControlSize.standard,
      fontSize: FontSize.base,
      lineHeight: LineHeight.base,
      color: colors.text,
      paddingVertical: 0,
    },
    clearButton: { marginRight: -Space.sm },
  });
}
