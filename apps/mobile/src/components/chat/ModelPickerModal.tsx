import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type SectionListData,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BottomSheetSectionList } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import { Check, Orbit, Search } from 'lucide-react-native';
import {
  Button,
  CompositionSafeBottomSheetTextInput,
  Sheet,
} from '../ui';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import { triggerLightImpact } from '../../services/haptics';
import {
  buildModelSections,
  isModelSelected,
  type ModelProviderInfo,
  normalizeModelProvider,
  resolveProviderModel,
  shouldShowDefaultRow,
  type ModelSection,
} from './model-picker-data';

export type ModelInfo = {
  id: string;
  name: string;
  provider: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  models: ModelInfo[];
  providers?: ModelProviderInfo[];
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  selectedModelId?: string;
  showDefault?: boolean;
  onSelectModel: (model: ModelInfo) => void;
  defaultModel?: string;
  defaultProvider?: string;
};

const DEFAULT_MODEL: ModelInfo = { id: '', name: 'Default', provider: '' };

export { resolveProviderModel };

export function ModelPickerModal({
  visible,
  onClose,
  title,
  models,
  providers,
  loading,
  error,
  onRetry,
  selectedModelId,
  showDefault = false,
  onSelectModel,
  defaultModel,
  defaultProvider,
}: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const [searchQuery, setSearchQuery] = useState('');

  const snapPoints = useMemo(() => ['58%', '92%'], []);
  const modelSections = useMemo(
    () => buildModelSections(models, searchQuery, providers),
    [models, providers, searchQuery],
  );
  const showDefaultRow = useMemo(
    () => shouldShowDefaultRow(searchQuery, showDefault),
    [searchQuery, showDefault],
  );
  const hasVisibleModels = modelSections.some((section) => section.data.length > 0);
  const hasVisibleProviders = modelSections.length > 0;

  useEffect(() => {
    setSearchQuery('');
  }, [visible]);

  const handleSelectModel = useCallback((model: ModelInfo) => {
    triggerLightImpact();
    onSelectModel(model);
    setSearchQuery('');
    onClose();
  }, [onClose, onSelectModel]);

  const renderModelRow = useCallback(({ item }: { item: ModelInfo }) => {
    const selected = isModelSelected({
      item,
      selectedModelId,
      defaultModel,
      defaultProvider,
    });
    const modelKey = `${normalizeModelProvider(item.provider)}:${item.id || item.name}`;
    return (
      <Pressable
        testID={`model-picker-row-${modelKey}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => handleSelectModel(item)}
        style={({ pressed }) => [styles.modelRow, pressed && styles.modelRowPressed]}
      >
        <View style={styles.modelIconWrap}>
          <Orbit size={16} color={theme.colors.inkSecondary} strokeWidth={2} />
        </View>
        <View style={styles.modelTextWrap}>
          <Text style={styles.modelTitle} numberOfLines={1}>
            {item.name || item.id}
          </Text>
        </View>
        <View style={styles.selectionMarkWrap}>
          {selected ? (
            <Check
              testID={`model-picker-selected-${modelKey}`}
              size={18}
              color={theme.colors.accent}
              strokeWidth={2.6}
            />
          ) : null}
        </View>
      </Pressable>
    );
  }, [
    defaultModel,
    defaultProvider,
    handleSelectModel,
    selectedModelId,
    styles,
    theme.colors.accent,
    theme.colors.inkSecondary,
  ]);

  const renderSectionHeader = useCallback(({
    section,
  }: {
    section: SectionListData<ModelInfo, ModelSection>;
  }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
    </View>
  ), [styles]);

  const renderSectionFooter = useCallback(({
    section,
  }: {
    section: SectionListData<ModelInfo, ModelSection>;
  }) => {
    if (section.data.length > 0) return null;
    return (
      <View style={styles.sectionEmptyWrap}>
        <Text style={styles.sectionEmptyText}>{t('No models available')}</Text>
      </View>
    );
  }, [styles, t]);

  const renderControls = useCallback(() => (
    <View style={styles.listHeader}>
      <View style={styles.searchWrap}>
        <Search size={16} color={theme.colors.inkTertiary} strokeWidth={2} />
        <CompositionSafeBottomSheetTextInput
          testID="model-picker-search"
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('Search models...')}
          placeholderTextColor={theme.colors.inkTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>
      {showDefaultRow ? (
        <Pressable
          testID="model-picker-row-default"
          accessibilityRole="button"
          accessibilityState={{ selected: selectedModelId === '' }}
          onPress={() => handleSelectModel(DEFAULT_MODEL)}
          style={({ pressed }) => [styles.defaultRow, pressed && styles.modelRowPressed]}
        >
          <Text style={styles.defaultRowTitle}>{t('Default')}</Text>
          {selectedModelId === '' ? (
            <Check
              testID="model-picker-selected-default"
              size={18}
              color={theme.colors.accent}
              strokeWidth={2.4}
            />
          ) : null}
        </Pressable>
      ) : null}
    </View>
  ), [
    handleSelectModel,
    searchQuery,
    selectedModelId,
    showDefaultRow,
    styles,
    t,
    theme.colors.accent,
    theme.colors.inkTertiary,
  ]);

  const renderEmptyState = useCallback(() => {
    const label = searchQuery.trim().length > 0
      ? t('No models found')
      : t('No models available');
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.stateText}>{label}</Text>
      </View>
    );
  }, [searchQuery, styles, t]);

  const content = loading ? (
    <View style={styles.stateWrap}>
      <ActivityIndicator size="small" color={theme.colors.accent} />
      <Text style={styles.stateText}>{t('Loading models...')}</Text>
    </View>
  ) : error ? (
    <View style={styles.stateWrap}>
      <Text style={styles.stateText}>{error}</Text>
      {onRetry ? (
        <Button
          label={t('Retry')}
          variant="secondary"
          size="sm"
          onPress={onRetry}
        />
      ) : null}
    </View>
  ) : (
    <BottomSheetSectionList
      sections={modelSections}
      keyExtractor={(item: ModelInfo) => (
        `${normalizeModelProvider(item.provider)}:${item.id || item.name}`
      )}
      renderItem={renderModelRow}
      renderSectionHeader={renderSectionHeader}
      renderSectionFooter={renderSectionFooter}
      ListEmptyComponent={
        !showDefaultRow && !hasVisibleProviders && !hasVisibleModels
          ? renderEmptyState
          : null
      }
      contentContainerStyle={styles.listContent}
      stickySectionHeadersEnabled
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="always"
      initialNumToRender={18}
      maxToRenderPerBatch={24}
      windowSize={10}
      removeClippedSubviews
      showsVerticalScrollIndicator
    />
  );

  return (
    <Sheet
      testID="model-picker"
      visible={visible}
      title={title ?? t('Models')}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      onClose={onClose}
      snapPoints={snapPoints}
      keyboardBehavior="extend"
      keyboardBlurBehavior="none"
      androidKeyboardInputMode="adjustResize"
      style={styles.sheetContent}
    >
      {!loading && !error ? renderControls() : null}
      {content}
    </Sheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    sheetContent: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    listHeader: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xs,
      gap: Space.xs,
      backgroundColor: colors.surface,
    },
    searchWrap: {
      minHeight: ControlSize.floatingButton,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceFloating,
      borderRadius: Radius.full,
      paddingHorizontal: Space.md,
      gap: Space.xs,
    },
    searchInput: {
      flex: 1,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      color: colors.ink,
      paddingVertical: Space.sm,
    },
    defaultRow: {
      minHeight: ControlSize.floatingButton,
      paddingHorizontal: Space.md,
      borderRadius: Radius.full,
      backgroundColor: colors.surfaceFloating,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    defaultRowTitle: {
      color: colors.ink,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    listContent: {
      paddingBottom: Space.xxl,
    },
    sectionHeader: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      paddingBottom: Space.xs,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
    },
    sectionHeaderText: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
    sectionEmptyWrap: {
      marginHorizontal: Space.lg,
      paddingHorizontal: Space.xs,
      paddingBottom: Space.sm,
    },
    sectionEmptyText: {
      color: colors.inkTertiary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
    },
    modelRow: {
      minHeight: ControlSize.settingsRow,
      marginHorizontal: Space.lg,
      paddingHorizontal: Space.xs,
      paddingVertical: Space.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      backgroundColor: colors.surface,
    },
    modelRowPressed: {
      backgroundColor: colors.surfaceFloating,
    },
    modelIconWrap: {
      width: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modelTextWrap: {
      flex: 1,
      minWidth: 0,
    },
    modelTitle: {
      flexShrink: 1,
      color: colors.ink,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.semibold,
    },
    selectionMarkWrap: {
      width: 20,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    stateWrap: {
      minHeight: 220,
      paddingHorizontal: Space.xl,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
    },
    stateText: {
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      textAlign: 'center',
    },
  });
}
