import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePreventRemove, type NavigationAction } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react-native';
import type {
  AgentAdapter,
  AgentDescriptor,
  ModelCost,
  ModelDeletionPreview,
} from '@clawket/agent-protocol';
import type { RootStackParamList } from '../../navigation/root-stack';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { SearchInput } from '../../components/ui/SearchInput';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Skeleton } from '../../components/ui/Skeleton';
import { ThemedSwitch } from '../../components/ui/ThemedSwitch';
import { ModelPickerModal, type ModelInfo as PickerModelInfo } from '../../components/chat/ModelPickerModal';
import { ThinkingLevelPickerModal } from '../../components/chat/ThinkingLevelPickerModal';
import { analyticsEvents } from '../../services/analytics/events';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Space,
} from '../../theme/tokens';
import { modelReference } from '../../utils/model-catalog';
import { FallbackModelsSheet } from './FallbackModelsSheet';
import { ModelDetailSheet } from './ModelDetailSheet';
import { ModelProviderSheet, formatProviderTitle } from './ModelProviderSheet';
import {
  addDraftFallback,
  buildAgentModelGroups,
  buildModelsCatalogWrite,
  buildModelSelectionWrite,
  displayModelName,
  findModelRow,
  formatContextWindow,
  isModelsDraftDirty,
  listCatalogModels,
  loadModelsBundle,
  moveDraftFallbackUp,
  removeDraftFallback,
  setDraftPrimary,
  toggleModelEnabled,
  type AgentModelGroup,
  type AgentModelRow,
  type ModelsBundle,
  type ModelsDraft,
} from './models-model';

type Busy = 'save' | 'select' | 'add' | 'delete' | 'cost' | null;
type Confirmation =
  | { kind: 'save' }
  | { kind: 'add'; group: AgentModelGroup; modelId: string; modelName: string }
  | { kind: 'cost'; row: AgentModelRow; cost: ModelCost }
  | { kind: 'delete'; row: AgentModelRow }
  | null;

export type ModelsScreenProps = Readonly<{
  adapter: AgentAdapter;
  agent: AgentDescriptor;
  online: boolean;
  navigation: Pick<NativeStackNavigationProp<RootStackParamList, 'AgentSettingsSection'>, 'goBack' | 'dispatch'>;
  /** Opens the OpenClaw config editor for provider keys and endpoints. */
  onOpenProviderConfig?: () => void;
  isPro?: boolean;
  /** Every write on this page is a Pro feature (owner decision 2026-09-16); the continuation resumes the exact write. */
  onOpenPaywall?: (reason: string, onContinue?: () => void) => void;
}>;

/**
 * Models: the Agent's default model, fallbacks and default thinking level on
 * top; below, the provider catalog with enable switches. OpenClaw edits its
 * Gateway config (one restart per Save); Hermes and local-model only expose a
 * global current model.
 */
export function ModelsScreen({
  adapter,
  agent,
  online,
  navigation,
  onOpenProviderConfig,
  isPro = false,
  onOpenPaywall,
}: ModelsScreenProps): React.JSX.Element {
  const { t } = useTranslation(['common', 'settings', 'config', 'chat']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const operations = adapter.management?.models;
  const [bundle, setBundle] = useState<ModelsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [query, setQuery] = useState('');
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [providerSlug, setProviderSlug] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<ModelDeletionPreview | null>(null);
  const [fallbacksVisible, setFallbacksVisible] = useState(false);
  const [picker, setPicker] = useState<'primary' | 'fallback' | 'current' | null>(null);
  const [thinkingVisible, setThinkingVisible] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [pendingLeave, setPendingLeave] = useState<NavigationAction | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leaveAction = useRef<NavigationAction | null>(null);
  const scope = useMemo(() => ({}), [adapter, agent.agentId]);
  const activeScope = useRef<object | null>(scope);
  activeScope.current = scope;

  const manage = bundle?.mode === 'manage';
  const dirty = bundle ? isModelsDraftDirty(bundle) : false;
  const saving = busy !== null;
  const groups = useMemo(() => buildAgentModelGroups(bundle, query), [bundle, query]);
  const allGroups = useMemo(() => buildAgentModelGroups(bundle), [bundle]);
  const detailRow = useMemo(() => findModelRow(allGroups, detailKey), [allGroups, detailKey]);
  const detailGroup = useMemo(
    () => allGroups.find((group) => group.provider === detailRow?.provider) ?? null,
    [allGroups, detailRow],
  );
  const providerGroup = useMemo(
    () => allGroups.find((group) => group.provider === providerSlug) ?? null,
    [allGroups, providerSlug],
  );
  const pickerModels = useMemo<PickerModelInfo[]>(() => allGroups.flatMap((group) => (
    group.rows.map((row) => ({ id: row.id, name: row.name, provider: row.provider }))
  )), [allGroups]);
  const pickerProviders = useMemo(() => allGroups.map((group) => ({
    slug: group.provider,
    name: formatProviderTitle(group.provider, t('Other', { ns: 'settings' })),
  })), [allGroups, t]);
  const thinkingLevels = useMemo(
    () => (adapter.capabilities.thinkingLevels ? operations?.listThinkingLevels?.() ?? [] : []),
    [adapter.capabilities.thinkingLevels, operations],
  );

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const next = await loadModelsBundle(operations, adapter.capabilities);
      if (activeScope.current !== scope) return;
      setBundle(next);
      setLoadError(null);
    } catch (failure: unknown) {
      if (activeScope.current !== scope || silent) return;
      setLoadError(failure ?? new Error());
    } finally {
      if (activeScope.current === scope && !silent) setLoading(false);
    }
  }, [adapter.capabilities, operations, scope]);

  useEffect(() => {
    setBundle(null);
    setError(null);
    void load();
  }, [load]);

  usePreventRemove((dirty || saving) && !leaving, ({ data: removal }) => {
    if (!saving) setPendingLeave(removal.action);
  });
  useEffect(() => {
    if (!leaving) return;
    if (leaveAction.current) navigation.dispatch(leaveAction.current);
    else navigation.goBack();
  }, [leaving, navigation]);

  const back = useCallback(() => {
    if (saving) return;
    if (dirty) setPendingLeave({ type: 'GO_BACK' });
    else navigation.goBack();
  }, [dirty, navigation, saving]);

  const updateDraft = useCallback((update: (draft: ModelsDraft, current: ModelsBundle) => ModelsDraft) => {
    setBundle((current) => (current ? { ...current, draft: update(current.draft, current) } : current));
  }, []);

  // Last-step gate: the page previews real data and every control looks live; the
  // paywall opens on the write itself and resumes it after purchase or restore.
  const requirePro = useCallback((write: () => void) => {
    if (isPro || !onOpenPaywall) {
      write();
      return;
    }
    onOpenPaywall('modelManage', write);
  }, [isPro, onOpenPaywall]);

  useEffect(() => {
    if (!detailRow || !manage || !operations?.inspectDeletion) {
      setDeletion(null);
      return;
    }
    let active = true;
    setDeletion(null);
    void operations.inspectDeletion({ provider: detailRow.provider, modelId: detailRow.id })
      .then((preview) => { if (active) setDeletion(preview); })
      .catch(() => { if (active) setDeletion({ canDelete: false, blocks: [], cleanupCount: 0 }); });
    return () => { active = false; };
  }, [detailRow?.key, manage, operations]);

  const runWrite = useCallback(async (
    kind: Exclude<Busy, null>,
    write: () => Promise<void>,
    onError: (message: string) => void,
    fallback: string,
  ): Promise<boolean> => {
    setBusy(kind);
    setError(null);
    setSheetError(null);
    try {
      await write();
      return true;
    } catch (failure: unknown) {
      if (activeScope.current === scope) onError(errorMessage(failure, fallback));
      return false;
    } finally {
      if (activeScope.current === scope) setBusy(null);
    }
  }, [scope]);

  const save = useCallback(async () => {
    if (!bundle || !bundle.catalog || !operations?.saveCatalog || !online || saving || !dirty) return;
    const write = buildModelsCatalogWrite(bundle);
    analyticsEvents.modelsSaveTapped({
      fallback_count: bundle.draft.fallbacks.length,
      has_primary_model: bundle.draft.primary.length > 0,
      has_thinking_default: bundle.draft.thinkingDefault.length > 0,
    });
    const saved = await runWrite('save', () => operations.saveCatalog!(write), setError, t('Save failed', { ns: 'settings' }));
    if (!saved || activeScope.current !== scope) return;
    setBundle((current) => (current?.catalog ? {
      ...current,
      catalog: {
        ...current.catalog,
        defaults: {
          primary: current.draft.primary,
          fallbacks: [...current.draft.fallbacks],
          thinkingDefault: current.draft.thinkingDefault,
        },
        allowlist: current.draft.allowlist ? [...current.draft.allowlist] : null,
      },
    } : current));
    void load(true);
  }, [bundle, dirty, load, online, operations, runWrite, saving, scope, t]);

  const selectCurrent = useCallback(async (row: Pick<AgentModelRow, 'id' | 'provider'>) => {
    if (!operations?.setSelection || !online || saving) return;
    const done = await runWrite(
      'select',
      async () => { await operations.setSelection!(buildModelSelectionWrite(row, { modelPerSession: false }, agent)); },
      setSheetError,
      t('Save failed', { ns: 'settings' }),
    );
    if (!done || activeScope.current !== scope) return;
    setBundle((current) => (current?.selection ? {
      ...current,
      selection: { ...current.selection, currentModel: row.id, currentProvider: row.provider },
    } : current));
    setDetailKey(null);
  }, [agent, online, operations, runWrite, saving, scope, t]);

  const addModel = useCallback(async (group: AgentModelGroup, modelId: string, modelName: string) => {
    if (!operations?.addModel) return;
    analyticsEvents.modelAddTapped({ provider: group.provider, has_custom_name: modelName !== modelId, source: 'provider_sheet' });
    const done = await runWrite(
      'add',
      () => operations.addModel!({ provider: group.provider, modelId, modelName }),
      setSheetError,
      t('Save failed', { ns: 'settings' }),
    );
    if (!done || activeScope.current !== scope) return;
    setProviderSlug(null);
    void load(true);
  }, [load, operations, runWrite, scope, t]);

  const saveCost = useCallback(async (row: AgentModelRow, cost: ModelCost) => {
    if (!operations?.setCost) return;
    const previous = row.model.cost;
    analyticsEvents.modelCostSaveTapped({
      provider: row.provider,
      has_existing_override: 'costOverridden' in row.model && row.model.costOverridden,
      changed_field_count: (['input', 'output', 'cacheRead', 'cacheWrite'] as const)
        .filter((field) => (previous?.[field] ?? 0) !== cost[field]).length,
      source: 'model_sheet',
    });
    const done = await runWrite(
      'cost',
      () => operations.setCost!({ provider: row.provider, modelId: row.id, modelName: row.name, cost }),
      setSheetError,
      t('Save failed', { ns: 'settings' }),
    );
    if (!done || activeScope.current !== scope) return;
    setDetailKey(null);
    void load(true);
  }, [load, operations, runWrite, scope, t]);

  const deleteModel = useCallback(async (row: AgentModelRow) => {
    if (!operations?.deleteModel) return;
    analyticsEvents.modelDeleteTapped({
      provider: row.provider,
      blocked_reference_count: deletion?.blocks.length ?? 0,
      source: 'model_sheet',
    });
    const done = await runWrite(
      'delete',
      () => operations.deleteModel!({ provider: row.provider, modelId: row.id }),
      setSheetError,
      t('Save failed', { ns: 'settings' }),
    );
    if (!done || activeScope.current !== scope) return;
    setDetailKey(null);
    void load(true);
  }, [deletion, load, operations, runWrite, scope, t]);

  const confirm = useCallback(() => {
    const request = confirmation;
    setConfirmation(null);
    if (!request) return;
    if (request.kind === 'save') void save();
    else if (request.kind === 'add') void addModel(request.group, request.modelId, request.modelName);
    else if (request.kind === 'cost') void saveCost(request.row, request.cost);
    else void deleteModel(request.row);
  }, [addModel, confirmation, deleteModel, save, saveCost]);

  const toggleEnabled = useCallback((row: AgentModelRow, enabled: boolean) => {
    requirePro(() => {
      analyticsEvents.modelAllowlistToggled({ provider: row.provider, enabled, source: 'models_list' });
      updateDraft((draft, current) => toggleModelEnabled(draft, current.catalog, row.reference, enabled));
    });
  }, [requirePro, updateDraft]);

  const fallbackRows = useMemo(() => (bundle?.draft.fallbacks ?? []).map((reference) => ({
    reference,
    name: displayModelName(reference, allGroups),
  })), [allGroups, bundle?.draft.fallbacks]);
  const primaryName = bundle?.draft.primary ? displayModelName(bundle.draft.primary, allGroups) : '';
  const currentName = bundle?.selection
    ? displayModelName(modelReference(bundle.selection.currentProvider, bundle.selection.currentModel), allGroups)
    : '';
  const canSave = manage && Boolean(operations?.saveCatalog);
  const canAdd = manage && Boolean(operations?.addModel);
  const canDelete = manage && Boolean(operations?.deleteModel);
  const canEditCost = manage && Boolean(operations?.setCost);
  const confirmationDestructive = confirmation?.kind === 'delete';

  return (
    <View testID="agent-models-screen" style={styles.screen}>
      <ScreenHeader
        title={t('Models', { ns: 'settings' })}
        topInset={insets.top}
        onBack={back}
        rightContent={canSave && bundle ? (
          <Button
            testID="agent-models-save"
            label={t('Save', { ns: 'common' })}
            variant="ghost"
            loading={busy === 'save'}
            disabled={!dirty || !online || saving}
            onPress={() => setConfirmation({ kind: 'save' })}
          />
        ) : undefined}
      />
      <ScrollView
        testID="agent-models-scroll"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space.xl }]}
      >
        {!online ? <Banner message={t('Offline · reconnecting', { ns: 'common' })} /> : null}
        {error ? <Banner testID="agent-models-error" tone="bad" message={error} /> : null}
        {loading && !bundle ? (
          <ModelsLoading />
        ) : !bundle ? (
          <Banner
            testID="agent-models-load-error"
            tone="bad"
            message={errorMessage(loadError, t('Failed to load models', { ns: 'settings' }))}
            actionLabel={t('Retry', { ns: 'common' })}
            onAction={() => { void load(); }}
          />
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('Defaults', { ns: 'settings' })}</Text>
              <SettingsGroup>
                {manage ? (
                  <>
                    <SettingsRow
                      testID="agent-models-default"
                      title={t('Default model', { ns: 'config' })}
                      value={primaryName || t('None', { ns: 'settings' })}
                      showChevron
                      disabled={!online || saving}
                      onPress={() => setPicker('primary')}
                    />
                    <SettingsDivider inset="content" />
                    <SettingsRow
                      testID="agent-models-fallbacks"
                      title={t('Fallback models', { ns: 'settings' })}
                      value={fallbackRows.length > 0 ? String(fallbackRows.length) : t('None', { ns: 'settings' })}
                      showChevron
                      onPress={() => setFallbacksVisible(true)}
                    />
                    {thinkingLevels.length > 0 ? (
                      <>
                        <SettingsDivider inset="content" />
                        <SettingsRow
                          testID="agent-models-thinking"
                          title={t('Thinking level', { ns: 'config' })}
                          value={bundle.draft.thinkingDefault
                            ? t(`thinking_${bundle.draft.thinkingDefault}`, { ns: 'chat' })
                            : t('Default', { ns: 'settings' })}
                          showChevron
                          disabled={!online || saving}
                          onPress={() => setThinkingVisible(true)}
                        />
                      </>
                    ) : null}
                  </>
                ) : (
                  <SettingsRow
                    testID="agent-models-current"
                    title={t('Current model', { ns: 'settings' })}
                    subtitle={t('Applies to all sessions', { ns: 'settings' })}
                    value={busy === 'select' ? t('Loading...', { ns: 'common' }) : currentName || t('None', { ns: 'settings' })}
                    showChevron
                    disabled={!online || saving || !operations?.setSelection}
                    onPress={() => setPicker('current')}
                  />
                )}
              </SettingsGroup>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('Catalog', { ns: 'settings' })}</Text>
              <SearchInput
                testID="agent-models-search"
                value={query}
                onChangeText={setQuery}
                placeholder={t('Search models...', { ns: 'settings' })}
              />
              {manage ? (
                <Text style={styles.hint}>{t('Switches control which models this Agent may use.', { ns: 'settings' })}</Text>
              ) : null}
              {groups.length === 0 ? (
                <Text testID="agent-models-empty" style={styles.emptyText}>
                  {t(query.trim() ? 'No models found' : 'No models available', { ns: 'settings' })}
                </Text>
              ) : groups.map((group) => (
                <View key={group.provider || '_'} style={styles.groupWrap}>
                  <SettingsRow
                    testID={`agent-models-provider-${group.provider}`}
                    title={formatProviderTitle(group.provider, t('Other', { ns: 'settings' }))}
                    value={String(group.rows.length)}
                    showChevron
                    style={styles.groupHeader}
                    onPress={() => { setSheetError(null); setProviderSlug(group.provider); }}
                  />
                  {group.rows.length > 0 ? (
                    <SettingsGroup>
                      {group.rows.map((row, index) => (
                        <React.Fragment key={row.key}>
                          {index ? <SettingsDivider inset="content" /> : null}
                          <SettingsRow
                            testID={`agent-model-row-${row.key}`}
                            title={row.name}
                            subtitle={rowSubtitle(row, t)}
                            trailing={manage ? (
                              <ThemedSwitch
                                testID={`agent-model-enabled-${row.key}`}
                                accessibilityLabel={row.name}
                                value={row.enabled === true}
                                disabled={!online || saving || row.current}
                                onValueChange={(enabled) => toggleEnabled(row, enabled)}
                              />
                            ) : row.current ? (
                              <Check
                                testID={`agent-model-current-${row.key}`}
                                size={IconSize.sm}
                                color={theme.colors.accent}
                                strokeWidth={2}
                              />
                            ) : undefined}
                            onPress={() => { setSheetError(null); setDetailKey(row.key); }}
                          />
                        </React.Fragment>
                      ))}
                    </SettingsGroup>
                  ) : null}
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <ModelDetailSheet
        visible={detailRow !== null}
        row={detailRow}
        group={detailGroup}
        mode={bundle?.mode ?? 'select'}
        online={online}
        dirty={dirty}
        busy={saving}
        deletion={deletion}
        error={sheetError}
        canDelete={canDelete}
        canEditCost={canEditCost}
        onClose={() => setDetailKey(null)}
        onSetDefault={(row) => requirePro(() => {
          if (manage) {
            updateDraft((draft) => setDraftPrimary(draft, row.reference));
            setDetailKey(null);
          } else {
            void selectCurrent(row);
          }
        })}
        onToggleFallback={(row) => requirePro(() => {
          updateDraft((draft) => (row.fallbackIndex >= 0
            ? removeDraftFallback(draft, row.fallbackIndex)
            : addDraftFallback(draft, row.reference)));
          setDetailKey(null);
        })}
        onSaveCost={(row, cost) => requirePro(() => setConfirmation({ kind: 'cost', row, cost }))}
        onDelete={(row) => requirePro(() => setConfirmation({ kind: 'delete', row }))}
      />

      <ModelProviderSheet
        visible={providerGroup !== null}
        group={providerGroup}
        online={online}
        dirty={dirty}
        busy={saving}
        error={sheetError}
        canAdd={canAdd}
        onClose={() => setProviderSlug(null)}
        onAdd={(group, modelId, modelName) => requirePro(() => setConfirmation({ kind: 'add', group, modelId, modelName }))}
        onOpenConfig={manage && adapter.capabilities.configManage && onOpenProviderConfig ? () => {
          setProviderSlug(null);
          onOpenProviderConfig();
        } : undefined}
      />

      <FallbackModelsSheet
        visible={fallbacksVisible}
        fallbacks={fallbackRows}
        editable={online && !saving}
        onClose={() => setFallbacksVisible(false)}
        onMoveUp={(index) => requirePro(() => updateDraft((draft) => moveDraftFallbackUp(draft, index)))}
        onRemove={(index) => requirePro(() => updateDraft((draft) => removeDraftFallback(draft, index)))}
        onAdd={() => { setFallbacksVisible(false); setPicker('fallback'); }}
      />

      <ModelPickerModal
        visible={picker !== null}
        title={picker === 'fallback'
          ? t('Add fallback', { ns: 'settings' })
          : picker === 'current' ? t('Current model', { ns: 'settings' }) : t('Default model', { ns: 'config' })}
        models={pickerModels}
        providers={pickerProviders}
        loading={false}
        selectedModelId={picker === 'primary' ? bundle?.draft.primary ?? '' : undefined}
        onClose={() => setPicker(null)}
        onSelectModel={(model) => {
          const reference = modelReference(model.provider, model.id);
          const unchanged = picker === 'primary'
            ? reference.toLowerCase() === (bundle?.draft.primary ?? '').toLowerCase()
            : picker === 'current' && bundle?.selection !== null && bundle?.selection !== undefined
              && reference.toLowerCase() === modelReference(bundle.selection.currentProvider, bundle.selection.currentModel).toLowerCase();
          if (unchanged) return;
          requirePro(() => {
            if (picker === 'primary') updateDraft((draft) => setDraftPrimary(draft, reference));
            else if (picker === 'fallback') updateDraft((draft) => addDraftFallback(draft, reference));
            else void selectCurrent({ id: model.id, provider: model.provider });
          });
        }}
      />

      <ThinkingLevelPickerModal
        visible={thinkingVisible}
        current={bundle?.draft.thinkingDefault ?? ''}
        options={thinkingLevels}
        onClose={() => setThinkingVisible(false)}
        onSelect={(value) => {
          setThinkingVisible(false);
          if (value === (bundle?.draft.thinkingDefault || 'off')) return;
          requirePro(() => updateDraft((draft) => ({ ...draft, thinkingDefault: value })));
        }}
      />

      <ConfirmationModal
        testID="agent-models-confirm"
        visible={confirmation !== null}
        title={confirmation?.kind === 'delete'
          ? t('Delete {{name}}?', { ns: 'settings', name: confirmation.row.name })
          : confirmation?.kind === 'add'
            ? t('Add model', { ns: 'settings' })
            : t('Save', { ns: 'common' })}
        message={confirmation?.kind === 'delete'
          ? t('This removes the model from Gateway config and fallback lists, then restarts Gateway.', { ns: 'settings' })
          : t('This will restart Gateway. Continue?', { ns: 'common' })}
        confirmLabel={confirmationDestructive ? t('Delete', { ns: 'common' }) : t('Continue', { ns: 'common' })}
        cancelLabel={t('Cancel', { ns: 'common' })}
        destructive={confirmationDestructive}
        onClose={() => setConfirmation(null)}
        onConfirm={confirm}
      />

      <ConfirmationModal
        testID="agent-models-discard"
        visible={pendingLeave !== null}
        title={t('Discard changes?', { ns: 'settings' })}
        message={t('Unsaved changes will be lost.', { ns: 'settings' })}
        confirmLabel={t('Discard', { ns: 'settings' })}
        cancelLabel={t('Keep editing', { ns: 'settings' })}
        destructive
        onClose={() => setPendingLeave(null)}
        onConfirm={() => {
          leaveAction.current = pendingLeave && pendingLeave.type !== 'GO_BACK' ? pendingLeave : null;
          setPendingLeave(null);
          setLeaving(true);
        }}
      />
    </View>
  );
}

function rowSubtitle(
  row: AgentModelRow,
  t: (key: string, options: { ns: string }) => string,
): string | undefined {
  const parts = [
    formatContextWindow(row.model.contextWindow),
    row.model.reasoning ? t('Reasoning', { ns: 'chat' }) : undefined,
    row.model.input?.includes('image') ? t('Image', { ns: 'settings' }) : undefined,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  return row.id !== row.name ? row.id : undefined;
}

function ModelsLoading(): React.JSX.Element {
  return (
    <View testID="agent-models-loading" style={stylesStatic.loading}>
      {[0, 1, 2, 3].map((row) => (
        <View key={row} style={stylesStatic.skeletonRow}>
          <Skeleton style={stylesStatic.skeletonTitle} />
          <Skeleton style={stylesStatic.skeletonValue} />
        </View>
      ))}
    </View>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

const stylesStatic = StyleSheet.create({
  loading: { gap: Space.sm },
  skeletonRow: {
    minHeight: ControlSize.settingsRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
  },
  skeletonTitle: { flex: 1, height: LineHeight.body },
  skeletonValue: { width: '20%', height: LineHeight.secondary },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.canvasGrouped },
    content: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      gap: Space.xl,
    },
    section: { gap: Space.sm },
    sectionTitle: {
      paddingHorizontal: Space.xs,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    hint: {
      paddingHorizontal: Space.xs,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
    },
    groupWrap: { gap: Space.xs, paddingTop: Space.sm },
    groupHeader: { backgroundColor: 'transparent' },
    emptyText: {
      paddingVertical: Space.xxl,
      color: colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
      fontWeight: FontWeight.regular,
      textAlign: 'center',
    },
  });
}
