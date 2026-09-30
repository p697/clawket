import React, { useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../ui';
import { Button } from '../ui/Button';
import { ListSkeleton } from '../ui/ListSkeleton';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Space } from '../../theme/tokens';

export type CommandPickerItem = {
  value: string;
  isCurrent?: boolean;
};

// Option lists scroll inside fixed detents through the Gorhom-integrated list;
// a stock FlatList in a dynamic sheet hands its drags to the sheet instead.
const SNAP_POINTS: string[] = ['50%', '92%'];

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
}: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  // Closing clears the picker at once. The sheet slides away showing what it showed, instead of
  // unmounting mid-frame (no dismiss animation) or flashing "No options available" on the way out.
  const shown = useRef({ title, loading, error, options });
  if (visible) shown.current = { title, loading, error, options };
  const view = shown.current;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      title={view.title}
      snapPoints={SNAP_POINTS}
      testID="command-option-sheet"
    >
      {view.loading ? (
        <ListSkeleton testID="command-option-loading" accessibilityLabel={t('Loading options...')} trailing="none" rows={4} style={styles.skeleton} />
      ) : view.error ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateText}>{view.error}</Text>
          <Button testID="command-option-retry" label={t('Retry')} variant="secondary" size="sm" onPress={onRetry} style={styles.retry} />
        </View>
      ) : view.options.length === 0 ? (
        <View style={styles.stateWrap}>
          <Text style={styles.stateText}>{t('No options available')}</Text>
        </View>
      ) : (
        <BottomSheetFlatList
          testID="command-option-list"
          data={view.options}
          keyExtractor={(item: CommandPickerItem) => item.value}
          renderItem={({ item }: { item: CommandPickerItem }) => (
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
    skeleton: {
      paddingHorizontal: Space.lg,
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
    retry: { marginTop: Space.md },
  });
}
