import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState, LoadingState, ScreenHeader, SearchInput, createCardContentStyle } from '../ui';
import type { ModelInfo } from '../chat/ModelPickerModal';
import { ThinkingLevelMenu } from '../chat/ThinkingLevelMenu';
import { useAppContext } from '../../contexts/AppContext';
import { getGatewayThinkingLevels } from '../../services/gateway-backends';
import {
  loadGatewayHermesThinkingState,
  saveGatewayHermesFastMode,
  saveGatewayHermesThinkingLevel,
  type GatewayHermesThinkingState,
} from '../../services/gateway-hermes-thinking';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import {
  loadGatewayHermesModelSelection,
  saveGatewayHermesModelSelection,
  type GatewayHermesModelSelectionState,
} from '../../services/gateway-hermes-model-selection';
import { resolveHermesModelDisplayState } from '../../services/gateway-hermes-model-display';
import { GatewayClient } from '../../services/gateway';

type Props = {
  gateway: GatewayClient;
  topInset: number;
  onBack: () => void;
  hideHeader?: boolean;
};

type ProviderSection = {
  slug: string;
  title: string;
  source?: string;
  apiUrl?: string;
  totalModels: number;
  models: ModelInfo[];
  isCurrent: boolean;
};

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function buildProviderSections(
  state: GatewayHermesModelSelectionState | null,
  query: string,
): ProviderSection[] {
  if (!state) return [];

  const normalizedQuery = normalize(query);
  const modelsByProvider = new Map<string, ModelInfo[]>();

  for (const model of state.models) {
    const provider = model.provider.trim() || 'unknown';
    const group = modelsByProvider.get(provider);
    if (group) {
      group.push(model);
    } else {
      modelsByProvider.set(provider, [model]);
    }
  }

  return state.providers
    .map((provider) => {
      const slug = provider.slug.trim() || 'unknown';
      const providerModels = [...(modelsByProvider.get(slug) ?? [])];
      providerModels.sort((left, right) => {
        const leftCurrent = normalize(left.id) === normalize(state.currentModel)
          && normalize(left.provider) === normalize(state.currentProvider);
        const rightCurrent = normalize(right.id) === normalize(state.currentModel)
          && normalize(right.provider) === normalize(state.currentProvider);
        if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
        return (left.name || left.id).localeCompare(right.name || right.id);
      });

      const matchesProvider = normalizedQuery.length === 0
        || normalize(provider.name).includes(normalizedQuery)
        || normalize(provider.slug).includes(normalizedQuery);

      const filteredModels = normalizedQuery.length === 0
        ? providerModels
        : providerModels.filter((model) =>
            normalize(model.name).includes(normalizedQuery)
            || normalize(model.id).includes(normalizedQuery)
            || normalize(model.provider).includes(normalizedQuery),
          );

      return {
        slug,
        title: provider.name.trim() || slug,
        source: provider.source,
        apiUrl: provider.apiUrl,
        totalModels: provider.totalModels,
        models: matchesProvider && filteredModels.length === 0 ? providerModels : filteredModels,
        isCurrent: provider.isCurrent === true,
        matchesProvider,
      };
    })
    .filter((section) => {
      if (normalizedQuery.length === 0) return true;
      if (section.models.length > 0) return true;
      return section.matchesProvider;
    })
    .map(({ matchesProvider: _matchesProvider, ...section }) => section);
}

function resolveProviderSourceLabel(source: string | undefined, t: ReturnType<typeof useTranslation>['t']): string | null {
  switch ((source ?? '').trim()) {
    case 'credential-pool':
      return t('Credential pool');
    case 'user-config':
      return t('Saved custom endpoint');
    case 'built-in':
      return t('Built-in provider');
    case 'hermes':
      return t('Hermes provider');
    default:
      return null;
  }
}

function shortenApiUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\//, '')
    .replace(/\/v1\/?$/, '')
    .replace(/\/+$/, '');
}

export function HermesModelSelectionView({
  gateway,
  topInset,
  onBack,
  hideHeader = false,
}: Props): React.JSX.Element {
  const { t } = useTranslation('console');
  const { t: tCommon } = useTranslation('common');
  const { t: tChat } = useTranslation('chat');
  const { theme } = useAppTheme();
  const { gatewayEpoch, foregroundEpoch } = useAppContext();
  const isFocused = useIsFocused();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const [state, setState] = useState<GatewayHermesModelSelectionState | null>(null);
  const [thinkingState, setThinkingState] = useState<GatewayHermesThinkingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingRef, setSavingRef] = useState<string | null>(null);
  const [savingThinkingLevel, setSavingThinkingLevel] = useState(false);
  const [savingFastMode, setSavingFastMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const lastForegroundEpochRef = useRef<number | null>(null);
  const lastForegroundRefreshRef = useRef(0);
  const thinkingLevelOptions = useMemo(() => getGatewayThinkingLevels('hermes'), []);

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const [nextModelState, nextThinkingState] = await Promise.all([
        loadGatewayHermesModelSelection(gateway),
        loadGatewayHermesThinkingState(gateway),
      ]);
      setState(nextModelState);
      setThinkingState(nextThinkingState);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('Unavailable'));
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [gateway, t]);

  useEffect(() => {
    void load('initial');
  }, [gatewayEpoch, load]);

  useFocusEffect(useCallback(() => {
    void load('silent');
  }, [load]));

  useEffect(() => {
    if (!isFocused) return;
    if (lastForegroundEpochRef.current === foregroundEpoch) return;
    lastForegroundEpochRef.current = foregroundEpoch;
    const now = Date.now();
    if (now - lastForegroundRefreshRef.current < 2000) return;
    lastForegroundRefreshRef.current = now;
    void load('silent');
  }, [foregroundEpoch, isFocused, load]);

  const modelDisplay = resolveHermesModelDisplayState({
    currentModel: state?.currentModel,
    currentProvider: state?.currentProvider,
    loading: loading && !state?.currentModel,
    error: Boolean(error),
  });

  const sections = useMemo(
    () => buildProviderSections(state, query),
    [query, state],
  );

  const totalModels = state?.models.length ?? 0;
  const totalProviders = state?.providers.length ?? 0;

  const handleSelectModel = useCallback(async (selected: ModelInfo) => {
    const selectedRef = `${selected.provider}:${selected.id}`;
    setSavingRef(selectedRef);
    try {
      const nextState = await saveGatewayHermesModelSelection(gateway, {
        model: selected.id,
        provider: selected.provider,
      });
      setState(nextState);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('Unavailable'));
    } finally {
      setSavingRef(null);
    }
  }, [gateway, t]);

  const handleSelectThinkingLevel = useCallback(async (level: string) => {
    if (!thinkingLevelOptions.includes(level as typeof thinkingLevelOptions[number])) return;
    setSavingThinkingLevel(true);
    try {
      const nextState = await saveGatewayHermesThinkingLevel(
        gateway,
        level as typeof thinkingLevelOptions[number],
      );
      setThinkingState(nextState);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('Unavailable'));
    } finally {
      setSavingThinkingLevel(false);
    }
  }, [gateway, t, thinkingLevelOptions]);

  const handleSelectFastMode = useCallback(async (enabled: boolean) => {
    setSavingFastMode(true);
    try {
      const nextState = await saveGatewayHermesFastMode(gateway, enabled);
      setThinkingState(nextState);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('Unavailable'));
    } finally {
      setSavingFastMode(false);
    }
  }, [gateway, t]);

  if (loading && !state) {
    return <LoadingState message={t('Loading Hermes models...')} />;
  }

  return (
    <View style={styles.root}>
      {!hideHeader ? (
        <ScreenHeader title={t('Models')} topInset={topInset} onBack={onBack} />
      ) : null}
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void load('refresh'); }}
            tintColor={theme.colors.primary}
          />
        }
      >
        <Card style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>{t('Current default')}</Text>
          <Text style={styles.heroModelValue}>
            {modelDisplay.status === 'loading'
              ? tCommon('Loading...')
              : modelDisplay.model || t('Unavailable')}
          </Text>
          <View style={styles.heroMetaRow}>
            <Text style={styles.heroMetaLabel}>{t('Provider')}</Text>
            <Text style={styles.heroMetaValue}>
              {modelDisplay.status === 'loading'
                ? tCommon('Loading...')
                : modelDisplay.provider || t('Unavailable')}
            </Text>
          </View>
          <Text style={styles.note}>{t('Hermes model changes apply globally to future runs.')}</Text>
          <Text style={styles.summaryText}>
            {t('{{count}} providers · {{models}} models', {
              count: totalProviders,
              models: totalModels,
            })}
          </Text>
        </Card>

        {thinkingState ? (
          <Card style={styles.runtimeCard}>
            <Text style={styles.runtimeTitle}>{t('Default Settings')}</Text>

            <Text style={styles.fieldLabel}>{t('Default Thinking Level')}</Text>
            <ThinkingLevelMenu
              current={thinkingState.thinkingLevel}
              onSelect={handleSelectThinkingLevel}
              options={thinkingLevelOptions}
              disabled={savingThinkingLevel || savingFastMode || Boolean(savingRef)}
              title={t('Default Thinking Level')}
              style={styles.fullWidthMenuTrigger}
            >
              <View style={styles.fieldRow}>
                <Text style={styles.fieldRowText} numberOfLines={1}>
                  {savingThinkingLevel
                    ? t('Switching...')
                    : tChat(`thinking_${thinkingState.thinkingLevel}`)}
                </Text>
                <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
              </View>
            </ThinkingLevelMenu>

            <Text style={styles.fieldLabel}>{tChat('Fast')}</Text>
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[
                  styles.toggleChip,
                  thinkingState.fastModeEnabled && styles.toggleChipActive,
                  (!thinkingState.fastModeSupported || savingThinkingLevel || savingFastMode) && styles.toggleChipDisabled,
                ]}
                activeOpacity={0.72}
                disabled={!thinkingState.fastModeSupported || savingThinkingLevel || savingFastMode}
                onPress={() => { void handleSelectFastMode(true); }}
              >
                <Text style={[
                  styles.toggleChipText,
                  thinkingState.fastModeEnabled && styles.toggleChipTextActive,
                ]}>
                  {savingFastMode && thinkingState.fastModeEnabled ? t('Switching...') : t('Enabled')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.toggleChip,
                  !thinkingState.fastModeEnabled && styles.toggleChipActive,
                  savingThinkingLevel || savingFastMode ? styles.toggleChipDisabled : null,
                ]}
                activeOpacity={0.72}
                disabled={savingThinkingLevel || savingFastMode}
                onPress={() => { void handleSelectFastMode(false); }}
              >
                <Text style={[
                  styles.toggleChipText,
                  !thinkingState.fastModeEnabled && styles.toggleChipTextActive,
                ]}>
                  {savingFastMode && !thinkingState.fastModeEnabled ? t('Switching...') : t('Off')}
                </Text>
              </TouchableOpacity>
            </View>

            {!thinkingState.fastModeSupported ? (
              <Text style={styles.runtimeNote}>{t('Fast mode is unavailable for the current Hermes model.')}</Text>
            ) : null}
          </Card>
        ) : null}

        {totalModels > 0 || totalProviders > 0 ? (
          <SearchInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('Search Hermes models...')}
            style={styles.searchWrap}
          />
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t('Failed to load models')}</Text>
            <Text style={styles.errorBody}>{error}</Text>
          </View>
        ) : null}

        {sections.length === 0 ? (
          query.trim()
            ? <EmptyState icon="🔍" title={t('No Hermes models found')} subtitle={t('Try a different search term.')} />
            : <EmptyState icon="🪐" title={t('No models available')} />
        ) : (
          <View style={styles.sectionsWrap}>
            {sections.map((section) => {
              const sourceLabel = resolveProviderSourceLabel(section.source, t);
              const apiLabel = shortenApiUrl(section.apiUrl);
              return (
                <Card key={section.slug} style={styles.providerCard}>
                  <View style={styles.providerHeader}>
                    <View style={styles.providerHeaderCopy}>
                      <View style={styles.providerTitleRow}>
                        <Text style={styles.providerTitle}>{section.title}</Text>
                        {section.isCurrent ? (
                          <View style={styles.currentBadge}>
                            <Text style={styles.currentBadgeText}>{t('Current')}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.providerSlug}>{section.slug}</Text>
                    </View>
                    <View style={styles.providerCountWrap}>
                      <Text style={styles.providerCount}>{section.totalModels}</Text>
                    </View>
                  </View>

                  {sourceLabel || apiLabel ? (
                    <View style={styles.providerMetaWrap}>
                      {sourceLabel ? (
                        <View style={styles.metaChip}>
                          <Text style={styles.metaChipText}>{sourceLabel}</Text>
                        </View>
                      ) : null}
                      {apiLabel ? (
                        <View style={styles.metaChip}>
                          <Text style={styles.metaChipText}>{apiLabel}</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}

                  {section.models.length === 0 ? (
                    <View style={styles.providerEmptyState}>
                      <Text style={styles.providerEmptyText}>{t('No models discovered for this provider yet.')}</Text>
                    </View>
                  ) : (
                    <View style={styles.modelsWrap}>
                      {section.models.map((model, index) => {
                        const isCurrent = normalize(model.id) === normalize(state?.currentModel)
                          && normalize(model.provider) === normalize(state?.currentProvider);
                        const modelRef = `${model.provider}:${model.id}`;
                        const isSaving = savingRef === modelRef;
                        return (
                          <TouchableOpacity
                            key={`${model.provider}:${model.id}:${index}`}
                            style={[
                              styles.modelRow,
                              isCurrent && styles.modelRowCurrent,
                            ]}
                            activeOpacity={0.72}
                            disabled={Boolean(savingRef)}
                            onPress={() => { void handleSelectModel(model); }}
                          >
                            <View style={styles.modelCopy}>
                              <Text style={styles.modelName} numberOfLines={1}>{model.name || model.id}</Text>
                              <Text style={styles.modelId} numberOfLines={1}>{model.id}</Text>
                            </View>
                            <View style={styles.modelActionWrap}>
                              {isSaving ? (
                                <Text style={styles.switchingText}>{t('Switching...')}</Text>
                              ) : isCurrent ? (
                                <Check size={18} color={theme.colors.primary} strokeWidth={2.5} />
                              ) : (
                                <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
                              )}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      ...createCardContentStyle({ top: Space.lg, bottom: Space.xxxl }),
      gap: Space.md,
    },
    heroCard: {
      gap: Space.sm,
      borderRadius: Radius.lg,
    },
    runtimeCard: {
      gap: Space.xs,
      borderRadius: Radius.lg,
    },
    runtimeTitle: {
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      color: colors.text,
      marginBottom: Space.xs,
    },
    heroEyebrow: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    heroModelValue: {
      fontSize: FontSize.xl,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    heroMetaRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: Space.md,
    },
    heroMetaLabel: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    heroMetaValue: {
      flex: 1,
      textAlign: 'right',
      fontSize: FontSize.sm,
      color: colors.text,
      fontWeight: FontWeight.medium,
    },
    note: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      lineHeight: 20,
    },
    runtimeNote: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      lineHeight: 20,
      marginTop: Space.xs,
    },
    summaryText: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
    },
    fieldLabel: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
      color: colors.textMuted,
      marginTop: Space.sm,
      marginBottom: Space.xs,
    },
    fullWidthMenuTrigger: {
      width: '100%',
    },
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.inputBackground,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: Radius.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm + 4,
    },
    fieldRowText: {
      flex: 1,
      fontSize: FontSize.base,
      color: colors.text,
    },
    toggleRow: {
      flexDirection: 'row',
      gap: Space.sm,
      marginTop: Space.xs,
    },
    toggleChip: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.inputBackground,
      paddingHorizontal: Space.md,
      paddingVertical: Space.sm,
    },
    toggleChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primarySoft,
    },
    toggleChipDisabled: {
      opacity: 0.5,
    },
    toggleChipText: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
      color: colors.textMuted,
    },
    toggleChipTextActive: {
      color: colors.primary,
    },
    searchWrap: {
      marginTop: -2,
    },
    errorCard: {
      borderWidth: 1,
      borderColor: colors.error,
      borderRadius: Radius.lg,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
      gap: Space.xs,
    },
    errorTitle: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
      color: colors.error,
    },
    errorBody: {
      fontSize: FontSize.sm,
      color: colors.textMuted,
      lineHeight: 20,
    },
    sectionsWrap: {
      gap: Space.md,
    },
    providerCard: {
      gap: Space.sm,
      borderRadius: Radius.lg,
    },
    providerHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: Space.md,
    },
    providerHeaderCopy: {
      flex: 1,
      minWidth: 0,
    },
    providerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      minWidth: 0,
    },
    providerTitle: {
      flexShrink: 1,
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    providerSlug: {
      marginTop: 2,
      fontSize: FontSize.xs,
      color: colors.textSubtle,
      fontFamily: 'monospace',
    },
    providerCountWrap: {
      minWidth: 32,
      alignItems: 'flex-end',
    },
    providerCount: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: colors.textMuted,
    },
    currentBadge: {
      borderRadius: Radius.full,
      backgroundColor: colors.primarySoft,
      paddingHorizontal: Space.sm,
      paddingVertical: 3,
    },
    currentBadgeText: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
      color: colors.primary,
    },
    providerMetaWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.xs,
    },
    metaChip: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.full,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.sm,
      paddingVertical: 4,
    },
    metaChipText: {
      fontSize: FontSize.xs,
      color: colors.textMuted,
      fontWeight: FontWeight.medium,
    },
    providerEmptyState: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
    },
    providerEmptyText: {
      fontSize: FontSize.sm,
      color: colors.textSubtle,
      lineHeight: 20,
    },
    modelsWrap: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      overflow: 'hidden',
    },
    modelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
      backgroundColor: colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modelRowCurrent: {
      backgroundColor: colors.primarySoft,
    },
    modelCopy: {
      flex: 1,
      minWidth: 0,
    },
    modelName: {
      fontSize: FontSize.md,
      fontWeight: FontWeight.medium,
      color: colors.text,
    },
    modelId: {
      marginTop: 2,
      fontSize: FontSize.xs,
      color: colors.textSubtle,
      fontFamily: 'monospace',
    },
    modelActionWrap: {
      minWidth: 52,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    switchingText: {
      fontSize: FontSize.xs,
      color: colors.primary,
      fontWeight: FontWeight.semibold,
    },
  });
}
