import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react-native';
import { Sheet } from '../ui';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Space } from '../../theme/tokens';
import { THINKING_LEVELS } from '../../utils/gateway-settings';
import type { ThinkingLevel } from '../../utils/gateway-settings';

type Props = {
  visible: boolean;
  onClose: () => void;
  current: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
  options?: ThinkingLevel[];
};

export function ThinkingLevelPickerModal({
  visible,
  onClose,
  current,
  onSelect,
  disabled = false,
  options = [...THINKING_LEVELS],
}: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const staticOptions = useMemo(() => options.map((level) => ({ value: level })), [options]);
  const normalizedCurrent = current || 'off';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      title={t('Thinking Level')}
      maxHeight="50%"
      testID="thinking-level-sheet"
    >
      <FlatList
        data={staticOptions}
        keyExtractor={(item) => item.value}
        renderItem={({ item }) => {
          const isActive = item.value === normalizedCurrent;
          return (
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onSelect(item.value);
              }}
              disabled={disabled}
              style={({ pressed }) => [
                styles.row,
                pressed && !disabled && styles.rowPressed,
                disabled && styles.rowDisabled,
              ]}
            >
              <Text style={[styles.rowTitle, isActive && styles.rowTitleActive]}>{t(`thinking_${item.value}`)}</Text>
              {isActive && (
                <Check size={18} color={theme.colors.accent} strokeWidth={2.5} />
              )}
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    row: {
      height: 48,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
      paddingHorizontal: Space.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    rowPressed: {
      backgroundColor: colors.surface,
    },
    rowDisabled: {
      opacity: 0.55,
    },
    rowTitle: {
      color: colors.ink,
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
      flexShrink: 1,
    },
    rowTitleActive: {
      color: colors.accent,
      fontWeight: FontWeight.semibold,
    },
  });
}
