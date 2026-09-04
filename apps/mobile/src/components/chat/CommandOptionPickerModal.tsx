import React, { useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ModalSheet } from '../ui';
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
    <ModalSheet visible={visible} onClose={onClose} title={title} maxHeight="50%">
      {loading ? (
        <View style={styles.stateWrap}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
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
                <Check size={18} color={theme.colors.primary} strokeWidth={2.5} />
              )}
            </Pressable>
          )}
        />
      )}
    </ModalSheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    row: {
      height: 48,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingHorizontal: Space.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    rowPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    rowDisabled: {
      opacity: 0.55,
    },
    rowTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
      flexShrink: 1,
    },
    rowTitleActive: {
      color: colors.primary,
      fontWeight: FontWeight.semibold,
    },
    stateWrap: {
      minHeight: 160,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Space.xl,
    },
    stateText: {
      color: colors.textMuted,
      fontSize: FontSize.bodySm,
      textAlign: 'center',
      lineHeight: 20,
    },
    retryBtn: {
      marginTop: Space.md,
      paddingHorizontal: 14,
      paddingVertical: Space.sm,
      borderRadius: Radius.sm + 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.borderStrong,
      backgroundColor: colors.surfaceMuted,
    },
    retryText: {
      color: colors.text,
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
    },
  });
}
