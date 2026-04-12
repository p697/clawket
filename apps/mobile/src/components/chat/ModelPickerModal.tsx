import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SectionListData,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetSectionList,
  BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Check, Orbit, Search, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { IconButton } from '../ui';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
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

function ModalContainer({ children }: React.PropsWithChildren): React.JSX.Element {
  if (Platform.OS !== 'ios') {
    return <>{children}</>;
  }

  return (
    <FullWindowOverlay>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {children}
      </View>
    </FullWindowOverlay>
  );
}

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
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
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
    if (visible) {
      setSearchQuery('');
      requestAnimationFrame(() => {
        bottomSheetRef.current?.present();
      });
      return;
    }

    bottomSheetRef.current?.dismiss();
  }, [visible]);

  const handleClose = useCallback(() => {
    setSearchQuery('');
    onClose();
  }, [onClose]);

  const handleSelectModel = useCallback((model: ModelInfo) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelectModel(model);
    setSearchQuery('');
    bottomSheetRef.current?.dismiss();
  }, [onSelectModel]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={theme.scheme === 'dark' ? 0.58 : 0.34}
        pressBehavior="close"
      />
    ),
    [theme.scheme],
  );

  const renderModelRow = useCallback(({ item }: { item: ModelInfo }) => {
    const selected = isModelSelected({
      item,
      selectedModelId,
      defaultModel,
      defaultProvider,
    });
    const subtitle = item.id.trim() || item.name.trim();
    return (
      <Pressable
        onPress={() => handleSelectModel(item)}
        style={({ pressed }) => [styles.modelRow, pressed && styles.modelRowPressed]}
      >
        <View style={styles.modelIconWrap}>
          <Orbit size={16} color={theme.colors.badgeModel} strokeWidth={2} />
        </View>
        <View style={styles.modelTextWrap}>
          <View style={styles.modelTitleRow}>
            <Text style={styles.modelTitle} numberOfLines={1}>
              {item.name || item.id}
            </Text>
            {selected ? (
              <View style={styles.currentBadge}>
                <Text style={styles.currentBadgeText}>{t('Current')}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.modelSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <View style={styles.selectionMarkWrap}>
          {selected ? (
            <Check size={18} color={theme.colors.primary} strokeWidth={2.6} />
          ) : null}
        </View>
      </Pressable>
    );
  }, [defaultModel, defaultProvider, handleSelectModel, selectedModelId, styles, t, theme.colors.primary]);

  const renderSectionHeader = useCallback(({ section }: { section: SectionListData<ModelInfo, ModelSection> }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
      <Text style={styles.sectionHeaderCount}>{section.totalModels}</Text>
    </View>
  ), [styles]);

  const renderSectionFooter = useCallback(({ section }: { section: SectionListData<ModelInfo, ModelSection> }) => {
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
        <Search size={16} color={theme.colors.textSubtle} strokeWidth={2} />
        <BottomSheetTextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('Search models...')}
          placeholderTextColor={theme.colors.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>
      {showDefaultRow ? (
        <Pressable
          onPress={() => handleSelectModel(DEFAULT_MODEL)}
          style={({ pressed }) => [styles.defaultRow, pressed && styles.modelRowPressed]}
        >
          <Text style={styles.defaultRowTitle}>{t('Default')}</Text>
          {selectedModelId === '' ? (
            <Check size={18} color={theme.colors.primary} strokeWidth={2.4} />
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
    theme.colors.primary,
    theme.colors.textSubtle,
  ]);

  const renderEmptyState = useCallback(() => {
    const label = searchQuery.trim().length > 0 ? t('No models found') : t('No models available');
    return (
      <View style={styles.stateWrap}>
        <Text style={styles.stateText}>{label}</Text>
      </View>
    );
  }, [searchQuery, styles, t]);

  const content = loading ? (
    <View style={styles.stateWrap}>
      <ActivityIndicator size="small" color={theme.colors.primary} />
      <Text style={styles.stateText}>{t('Loading models...')}</Text>
    </View>
  ) : error ? (
    <View style={styles.stateWrap}>
      <Text style={styles.stateText}>{error}</Text>
      {onRetry ? (
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
          <Text style={styles.retryText}>{t('Retry')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  ) : (
      <BottomSheetSectionList
        sections={modelSections}
        keyExtractor={(item: ModelInfo) => `${normalizeModelProvider(item.provider)}:${item.id || item.name}`}
        renderItem={renderModelRow}
        renderSectionHeader={renderSectionHeader}
        renderSectionFooter={renderSectionFooter}
        ListEmptyComponent={!showDefaultRow && !hasVisibleProviders && !hasVisibleModels ? renderEmptyState : null}
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
    <BottomSheetModal
      ref={bottomSheetRef}
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
      containerComponent={ModalContainer}
      onDismiss={handleClose}
      topInset={Math.max(insets.top, Space.sm)}
      keyboardBehavior="extend"
      keyboardBlurBehavior="none"
      android_keyboardInputMode="adjustResize"
    >
      <View style={styles.sheetContent}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title ?? t('Models')}
          </Text>
          <IconButton
            icon={<X size={20} color={theme.colors.textMuted} strokeWidth={2} />}
            onPress={() => bottomSheetRef.current?.dismiss()}
            size={32}
          />
        </View>
        {!loading && !error ? renderControls() : null}
        {content}
      </View>
    </BottomSheetModal>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
    },
    handleIndicator: {
      width: 44,
      backgroundColor: colors.borderStrong,
    },
    sheetContent: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    header: {
      height: 48,
      paddingHorizontal: Space.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerSpacer: {
      width: 32,
      height: 32,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    listHeader: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xs,
      gap: Space.xs,
      backgroundColor: colors.surface,
    },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.lg,
      paddingHorizontal: Space.md,
      gap: Space.xs,
    },
    searchInput: {
      flex: 1,
      fontSize: FontSize.md,
      color: colors.text,
      paddingVertical: 10,
    },
    defaultRow: {
      minHeight: 42,
      paddingHorizontal: Space.md,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    defaultRowTitle: {
      color: colors.text,
      fontSize: FontSize.md,
      fontWeight: FontWeight.medium,
    },
    listContent: {
      paddingBottom: Space.xxxl,
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
      color: colors.textMuted,
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
    },
    sectionHeaderCount: {
      minWidth: 22,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: Radius.full,
      backgroundColor: colors.surfaceMuted,
      color: colors.textSubtle,
      fontSize: FontSize.xs,
      textAlign: 'center',
      overflow: 'hidden',
    },
    sectionEmptyWrap: {
      marginHorizontal: Space.lg,
      paddingHorizontal: Space.xs,
      paddingBottom: Space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    sectionEmptyText: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      lineHeight: 20,
    },
    modelRow: {
      minHeight: 56,
      marginHorizontal: Space.lg,
      paddingHorizontal: Space.xs,
      paddingVertical: Space.sm + 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      backgroundColor: colors.surface,
    },
    modelRowPressed: {
      backgroundColor: colors.surfaceMuted,
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
    modelTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    modelTitle: {
      flexShrink: 1,
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    currentBadge: {
      borderRadius: Radius.full,
      paddingHorizontal: 6,
      paddingVertical: 2,
      backgroundColor: colors.primarySoft,
    },
    currentBadgeText: {
      color: colors.primary,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.medium,
    },
    modelSubtitle: {
      marginTop: 1,
      color: colors.textMuted,
      fontSize: FontSize.sm,
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
    },
    stateText: {
      marginTop: Space.sm,
      color: colors.textMuted,
      fontSize: FontSize.base,
      textAlign: 'center',
      lineHeight: 21,
    },
    retryBtn: {
      marginTop: Space.md,
      paddingHorizontal: 14,
      paddingVertical: Space.sm,
      borderRadius: Radius.md,
      borderWidth: 1,
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
