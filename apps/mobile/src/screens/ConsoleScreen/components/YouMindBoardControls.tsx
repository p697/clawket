import React, { useMemo } from 'react';
import * as Haptics from 'expo-haptics';
import { MenuAction, MenuView } from '@react-native-menu/menu';
import { ChevronDown, LayoutGrid, List as ListIcon, ListFilter } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../../theme/tokens';

export type YouMindBoardViewMode = 'list' | 'waterfall';

type Props = {
  viewMode: YouMindBoardViewMode;
  onSelectViewMode: (value: YouMindBoardViewMode) => void;
  filterValueLabel: string;
  onPressFilter: () => void;
  borderless?: boolean;
};

export function YouMindBoardControls({
  viewMode,
  onSelectViewMode,
  filterValueLabel,
  onPressFilter,
  borderless = false,
}: Props): React.JSX.Element {
  const { t } = useTranslation('console');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const viewModeActions = useMemo<MenuAction[]>(() => ([
    {
      id: 'list',
      title: t('List'),
      state: viewMode === 'list' ? 'on' : 'off',
    },
    {
      id: 'waterfall',
      title: t('Waterfall'),
      state: viewMode === 'waterfall' ? 'on' : 'off',
    },
  ]), [t, viewMode]);

  const currentViewLabel = viewMode === 'list' ? t('List') : t('Waterfall');
  const ViewIcon = viewMode === 'list' ? ListIcon : LayoutGrid;

  return (
    <View style={styles.row}>
      <View style={styles.controlWrap}>
        <Pressable
          onPress={() => {
            void Haptics.selectionAsync();
            onPressFilter();
          }}
          style={({ pressed }) => [
            styles.control,
            borderless ? styles.controlBorderless : null,
            pressed ? { backgroundColor: theme.colors.surfaceMuted } : null,
          ]}
        >
          <View style={styles.leading}>
            <View style={styles.iconBadge}>
              <ListFilter size={16} color={theme.colors.textMuted} strokeWidth={2.1} />
            </View>
            <View style={styles.labelBlock}>
              <Text style={styles.label}>{t('Filter')}</Text>
              <Text style={styles.value} numberOfLines={1}>{filterValueLabel}</Text>
            </View>
          </View>
          <ChevronDown size={16} color={theme.colors.textSubtle} strokeWidth={2.1} />
        </Pressable>
      </View>

      <MenuView
        actions={viewModeActions}
        shouldOpenOnLongPress={false}
        onPressAction={({ nativeEvent }) => {
          const nextValue = nativeEvent.event === 'waterfall' ? 'waterfall' : 'list';
          void Haptics.selectionAsync();
          onSelectViewMode(nextValue);
        }}
        title={t('View')}
        themeVariant={theme.scheme}
        style={styles.menuWrap}
      >
        <View style={[styles.control, borderless ? styles.controlBorderless : null]}>
          <View style={styles.leading}>
            <View style={styles.iconBadge}>
              <ViewIcon size={16} color={theme.colors.textMuted} strokeWidth={2.1} />
            </View>
            <View style={styles.labelBlock}>
              <Text style={styles.label}>{t('View')}</Text>
              <Text style={styles.value} numberOfLines={1}>{currentViewLabel}</Text>
            </View>
          </View>
          <ChevronDown size={16} color={theme.colors.textSubtle} strokeWidth={2.1} />
        </View>
      </MenuView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: Space.sm,
      marginTop: Space.sm,
      marginBottom: Space.md,
    },
    controlWrap: {
      flex: 1,
    },
    menuWrap: {
      flex: 1,
    },
    control: {
      minHeight: 56,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    controlBorderless: {
      borderWidth: 0,
    },
    leading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      flex: 1,
      minWidth: 0,
    },
    iconBadge: {
      width: 28,
      height: 28,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    labelBlock: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    label: {
      color: colors.textSubtle,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.medium,
    },
    value: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
  });
}
