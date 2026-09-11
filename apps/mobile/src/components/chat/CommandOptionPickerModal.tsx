import React, { useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../ui';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';

export type CommandPickerItem = {
  value: string;
  isCurrent?: boolean;
};

type Props = {
  visible: boolean;
  title: string;
  loading: boolean;
  error: string | null;
  options: CommandPickerItem[];
  isSending: boolean;
  onClose: () => void;
  onRetry: () => void;
  onSelectOption: (value: string) => void;
};

export function CommandOptionPickerModal({
  visible,
  title,
  loading,
  error,
  options,
  isSending,
  onClose,
  onRetry,
  onSelectOption,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  if (!visible) return null;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      title={title}
      maxHeight="50%"
      testID="command-option-sheet"
    >
      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator size="small" color={theme.colors.accent} />
          <Text style={styles.stateText}>{t('Loading options...')}</Text>
        </View>
      ) : error ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
            <Text style={styles.retryText}>{t('Retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : options.length === 0 ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateText}>{t('No options available')}</Text>
        </View>
      ) : (
        <FlatList
          data={options}
          keyExtractor={(item) => item.value}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onSelectOption(item.value); }}
              disabled={isSending}
              style={({ pressed }) => [
                styles.row,
                pressed && !isSending && styles.rowPressed,
                isSending && styles.rowDisabled,
              ]}
            >
              <Text style={[styles.rowTitle, item.isCurrent && styles.rowTitleActive]}>{item.value}</Text>
              {item.isCurrent && (
                <Check size={18} color={theme.colors.accent} strokeWidth={2.5} />
              )}
            </Pressable>
          )}
        />
      )}
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
    stateWrap: {
      minHeight: 160,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Space.xl,
    },
    stateText: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      textAlign: 'center',
      lineHeight: 20,
    },
    retryBtn: {
      marginTop: Space.md,
      paddingHorizontal: 14,
      paddingVertical: Space.sm,
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      backgroundColor: colors.surface,
    },
    retryText: {
      color: colors.ink,
      fontSize: FontSize.caption,
      fontWeight: FontWeight.semibold,
    },
  });
}
