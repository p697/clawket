import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ModalSheet } from '../../../components/ui';
import { useAppTheme } from '../../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../../theme/tokens';
import type { YouMindBoardEntryFilterType } from '../../../services/youmind';
import type { YouMindBoardFilterOption } from './youmindBoardFilters';

type Props = {
  visible: boolean;
  onClose: () => void;
  options: YouMindBoardFilterOption[];
  selectedValues: YouMindBoardEntryFilterType[];
  onToggleValue: (value: YouMindBoardEntryFilterType) => void;
  onClear: () => void;
};

export function YouMindBoardFilterModal({
  visible,
  onClose,
  options,
  selectedValues,
  onToggleValue,
  onClear,
}: Props): React.JSX.Element {
  const { t } = useTranslation('console');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  return (
    <ModalSheet visible={visible} onClose={onClose} title={t('Filter')} maxHeight="62%">
      <ScrollView contentContainerStyle={styles.content}>
        {options.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.chipWrap}>
              {options.map((option) => {
                const selected = selectedSet.has(option.value);
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => onToggleValue(option.value)}
                    style={({ pressed }) => [
                      styles.chip,
                      selected
                        ? {
                            backgroundColor: theme.colors.primary,
                            borderColor: theme.colors.primary,
                          }
                        : {
                            backgroundColor: theme.colors.surface,
                            borderColor: theme.colors.border,
                          },
                      pressed && !selected ? { backgroundColor: theme.colors.surfaceMuted } : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        selected ? { color: theme.colors.primaryText } : { color: theme.colors.text },
                      ]}
                    >
                      {t(option.labelKey)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {selectedValues.length > 0 ? (
              <Pressable
                onPress={onClear}
                style={({ pressed }) => [
                  styles.clearButton,
                  { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface },
                  pressed ? { backgroundColor: theme.colors.surfaceMuted } : null,
                ]}
              >
                <Text style={[styles.clearButtonText, { color: theme.colors.text }]}>{t('Clear Filters')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>{t('No filters available')}</Text>
          </View>
        )}
      </ScrollView>
    </ModalSheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    content: {
      padding: Space.lg,
      paddingTop: 0,
      gap: Space.lg,
    },
    section: {
      gap: Space.lg,
    },
    clearButton: {
      minHeight: 48,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Space.md,
    },
    clearButtonText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.sm,
    },
    chip: {
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: Radius.full,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
    },
    chipText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    emptyState: {
      paddingVertical: Space.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyStateText: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
    },
  });
}
