import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { ChevronDown, ChevronRight, Plus, RefreshCw, Trash2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmptyState, IconButton, LoadingState, ScreenHeader, SearchInput, SegmentedTabs } from '../ui';
import { AddModelModal, type AddModelDraft } from './AddModelModal';
import { ModelConfigSection } from './ModelConfigSection';
import { ModelCostEditorModal, type ModelCostDraft } from './ModelCostEditorModal';
import {
  ModelPickerModal,
  resolveProviderModel,
} from '../chat/ModelPickerModal';
import type { ModelInfo } from '../chat/ModelPickerModal';
import { useTranslation } from 'react-i18next';
import { useAppContext } from '../../contexts/AppContext';
import { useGatewayOverlay } from '../../contexts/GatewayOverlayContext';
import { GatewayClient } from '../../services/gateway';
import { useGatewayPatch } from '../../hooks/useGatewayPatch';
import { analyticsEvents } from '../../services/analytics/events';
import { scheduleAutomaticAppReview } from '../../services/auto-app-review';
import { loadGatewayModelsConfigBundle } from '../../services/gateway-models';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Shadow, Space } from '../../theme/tokens';
import { addFallbackModel, moveFallbackModel, removeFallbackModelAt, sanitizeFallbackModels } from '../../utils/fallback-models';
import {
  areModelCostsEqual,
  buildAddModelPatch,
  buildBatchModelAllowlistPatch,
  buildModelCostPatch,
  hasExplicitModelAllowlist,
  hasConfiguredModel,
  listConfiguredModelAllowlistRefs,
  listExplicitConfiguredModels,
  listExplicitProviders,
  resolveModelCostEditorState,
  type ModelCostValue,
} from '../../utils/model-cost-config';
import {
  analyzeModelDeletion,
  buildDeleteModelConfig,
} from '../../utils/model-config-delete';

type Model = {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  cost?: ModelCostValue;
};

type ProviderSection = {
  provider: string;
  models: Model[];
  canAddModel: boolean;
};

type ListRow =
  | { type: 'provider-header'; provider: string; count: number; expanded: boolean; canAddModel: boolean }
  | { type: 'provider-empty'; provider: string }
  | { type: 'model'; model: Model };

type ModelPickerTarget = 'primary' | 'fallback';

type ModelsTab = 'settings' | 'list';

type ModelConfigProps = {
  defaultModel: string;
  setDefaultModel: (value: string) => void;
  fallbackModels: string[];
  setFallbackModels: (value: React.SetStateAction<string[]>) => void;
  thinkingDefault: string;
  setThinkingDefault: (value: string) => void;
  availableModels: string[];
  loadingSettings: boolean;
  savingSettings: boolean;
  settingsError: string | null;
  hasActiveGateway: boolean;
  supportsRuntimeSettings?: boolean;
  supportsModelSelection?: boolean;
  onLoadSettings: () => Promise<void>;
  onSaveSettings: () => Promise<void>;
  overlayMessage?: string | null;
};

type Props = {
  gateway: GatewayClient;
  topInset: number;
  onBack: () => void;
  modelConfig?: ModelConfigProps;
  hideHeader?: boolean;
};

function formatContextWindow(ctx?: number): string | null {
  if (!ctx) return null;
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(1)}M ctx`;
  if (ctx >= 1000) return `${Math.round(ctx / 1000)}K ctx`;
  return `${ctx} ctx`;
}

function capitalizeProvider(provider: string): string {
  if (!provider) return provider;
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

function formatCostValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '0';
  if (value >= 1) return value.toFixed(2);
  if (value >= 0.01) return value.toFixed(2);
  return value.toFixed(4);
}

function toCostDraft(cost: ModelCostValue): ModelCostDraft {
  return {
    input: String(cost.input),
    output: String(cost.output),
    cacheRead: String(cost.cacheRead),
    cacheWrite: String(cost.cacheWrite),
  };
}

function parseDraftCost(draft: ModelCostDraft): ModelCostValue | null {
  const input = Number(draft.input.trim());
  const output = Number(draft.output.trim());
  const cacheRead = Number(draft.cacheRead.trim());
  const cacheWrite = Number(draft.cacheWrite.trim());
  if ([input, output, cacheRead, cacheWrite].some((value) => !Number.isFinite(value) || value < 0)) {
    return null;
  }
  return { input, output, cacheRead, cacheWrite };
}

export function ModelsView({
  gateway,
  topInset,
  onBack,
  modelConfig,
  hideHeader = false,
}: Props): React.JSX.Element {
  const { gatewayEpoch } = useAppContext();
  const { t } = useTranslation('console');
  const { theme } = useAppTheme();
  const { isExpectedRestartActive } = useGatewayOverlay();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const allowlistBarAnimation = useRef(new Animated.Value(0)).current;

  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [configHash, setConfigHash] = useState<string | null>(null);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set());
  const [copiedRef, setCopiedRef] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [modelPickerTarget, setModelPickerTarget] = useState<ModelPickerTarget>('primary');
  const [activeTab, setActiveTab] = useState<ModelsTab>('list');
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [costDraft, setCostDraft] = useState<ModelCostDraft | null>(null);
  const [draftAllowlistRefs, setDraftAllowlistRefs] = useState<string[]>([]);
  const [allowlistDraftTouched, setAllowlistDraftTouched] = useState(false);
  const [savingAllowlistChanges, setSavingAllowlistChanges] = useState(false);
  const [savingCost, setSavingCost] = useState(false);
  const [deletingModel, setDeletingModel] = useState(false);
  const [inlineDeletingRef, setInlineDeletingRef] = useState<string | null>(null);
  const [addModelProvider, setAddModelProvider] = useState<string | null>(null);
  const [addModelDraft, setAddModelDraft] = useState<AddModelDraft | null>(null);
  const [savingModel, setSavingModel] = useState(false);
  const { patchWithRestart, setWithRestart } = useGatewayPatch(gateway);

  // Track "clean" snapshot to determine dirty state for Save button
  const [cleanDefaultModel, setCleanDefaultModel] = useState('');
  const [cleanFallbackModels, setCleanFallbackModels] = useState<string[]>([]);
  const [cleanThinkingDefault, setCleanThinkingDefault] = useState('');
  const modelsTabs = useMemo<{ key: ModelsTab; label: string }[]>(() => [
    { key: 'list', label: t('All Models') },
    { key: 'settings', label: t('Default Settings') },
  ], [t]);

  // Snapshot clean values when loading/saving finishes
  useEffect(() => {
    if (modelConfig && !modelConfig.loadingSettings && !modelConfig.savingSettings) {
      setCleanDefaultModel(modelConfig.defaultModel);
      setCleanFallbackModels(modelConfig.fallbackModels);
      setCleanThinkingDefault(modelConfig.thinkingDefault);
    }
  }, [modelConfig?.loadingSettings, modelConfig?.savingSettings]);

  const isDirty = useMemo(() => {
    if (!modelConfig) return false;
    if (modelConfig.defaultModel !== cleanDefaultModel) return true;
    if (modelConfig.thinkingDefault !== cleanThinkingDefault) return true;
    const current = modelConfig.fallbackModels;
    if (current.length !== cleanFallbackModels.length) return true;
    return current.some((m, i) => m !== cleanFallbackModels[i]);
  }, [modelConfig?.defaultModel, modelConfig?.fallbackModels, modelConfig?.thinkingDefault, cleanDefaultModel, cleanFallbackModels, cleanThinkingDefault]);

  const allowlistRefs = useMemo(() => listConfiguredModelAllowlistRefs(config), [config]);

  useEffect(() => {
    if (!allowlistDraftTouched) {
      setDraftAllowlistRefs(allowlistRefs);
    }
  }, [allowlistDraftTouched, allowlistRefs]);

  const pendingAllowlistChanges = useMemo(() => {
    const nextRefSet = new Set(draftAllowlistRefs);
    const currentRefSet = new Set(allowlistRefs);
    const refs = Array.from(new Set([...draftAllowlistRefs, ...allowlistRefs])).sort((a, b) => a.localeCompare(b));

    return refs
      .filter((ref) => nextRefSet.has(ref) !== currentRefSet.has(ref))
      .map((ref) => {
        const slashIndex = ref.indexOf('/');
        return {
          ref,
          provider: slashIndex > 0 ? ref.slice(0, slashIndex) : '',
          modelId: slashIndex > 0 ? ref.slice(slashIndex + 1) : ref,
          enabled: nextRefSet.has(ref),
        };
      });
  }, [allowlistRefs, draftAllowlistRefs]);

  const hasPendingAllowlistChanges = pendingAllowlistChanges.length > 0;

  useEffect(() => {
    if (allowlistDraftTouched && !hasPendingAllowlistChanges) {
      setAllowlistDraftTouched(false);
    }
  }, [allowlistDraftTouched, hasPendingAllowlistChanges]);

  useEffect(() => {
    Animated.timing(allowlistBarAnimation, {
      toValue: hasPendingAllowlistChanges ? 1 : 0,
      duration: hasPendingAllowlistChanges ? 260 : 180,
      easing: hasPendingAllowlistChanges ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [allowlistBarAnimation, hasPendingAllowlistChanges]);

  const dismissAllowlistChanges = useCallback(() => {
    setDraftAllowlistRefs(allowlistRefs);
    setAllowlistDraftTouched(false);
  }, [allowlistRefs]);

  const confirmDiscardAllowlistChanges = useCallback((onDiscard: () => void) => {
    Alert.alert(t('Discard changes?'), t('You have unsaved changes.'), [
      { text: t('Keep Editing'), style: 'cancel' },
      {
        text: t('common:Cancel'),
        style: 'destructive',
        onPress: onDiscard,
      },
    ]);
  }, [t]);

  usePreventRemove(hasPendingAllowlistChanges, ({ data }) => {
    confirmDiscardAllowlistChanges(() => {
      dismissAllowlistChanges();
      navigation.dispatch(data.action);
    });
  });

  const loadModels = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    try {
      const bundle = await loadGatewayModelsConfigBundle(gateway);
      setModels(bundle.models);
      setConfig(bundle.config);
      setConfigHash(bundle.configHash);
      setError(null);
      return {
        models: bundle.models,
        config: bundle.config,
        configHash: bundle.configHash,
      };
    } catch (err: unknown) {
      if (isExpectedRestartActive) {
        setError(null);
        return null;
      }
      const message = err instanceof Error ? err.message : t('Failed to load models');
      setError(message);
      return null;
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [gateway, gatewayEpoch, isExpectedRestartActive, t]);

  useEffect(() => {
    loadModels('initial').catch(() => {
      // Error state handled in loadModels.
    });
  }, [loadModels]);

  const sections = useMemo<ProviderSection[]>(() => {
    const q = search.trim().toLowerCase();
    const mergedModels = new Map<string, Model>();
    for (const model of models) {
      mergedModels.set(`${model.provider}/${model.id}`, model);
    }
    for (const configuredModel of listExplicitConfiguredModels(config)) {
      const key = `${configuredModel.provider}/${configuredModel.modelId}`;
      if (mergedModels.has(key)) {
        continue;
      }
      mergedModels.set(key, {
        id: configuredModel.modelId,
        name: configuredModel.modelName,
        provider: configuredModel.provider,
      });
    }

    const mergedModelList = Array.from(mergedModels.values());
    const filtered = q
      ? mergedModelList.filter((m) =>
          m.name.toLowerCase().includes(q)
          || m.provider.toLowerCase().includes(q)
          || m.id.toLowerCase().includes(q),
        )
      : mergedModelList;

    const grouped = new Map<string, Model[]>();
    for (const model of filtered) {
      const existing = grouped.get(model.provider);
      if (existing) {
        existing.push(model);
      } else {
        grouped.set(model.provider, [model]);
      }
    }

    const sectionList = Array.from(grouped.entries())
      .map(([provider, providerModels]) => ({
        provider,
        models: [...providerModels].sort((a, b) => a.name.localeCompare(b.name)),
        canAddModel: true,
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider));

    const explicitProviders = listExplicitProviders(config);
    const sectionByProvider = new Map(sectionList.map((section) => [section.provider, section] as const));
    for (const provider of explicitProviders) {
      if (sectionByProvider.has(provider)) continue;
      if (q && !provider.toLowerCase().includes(q)) continue;
      sectionList.push({
        provider,
        models: [],
        canAddModel: true,
      });
    }

    return sectionList.sort((a, b) => a.provider.localeCompare(b.provider));
  }, [config, models, search]);

  const toggleProvider = useCallback((provider: string) => {
    setCollapsedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  }, []);

  const handleLongPress = useCallback(async (model: Model) => {
    const ref = `${model.provider}/${model.id}`;
    await Clipboard.setStringAsync(ref);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopiedRef(ref);
    setTimeout(() => setCopiedRef(null), 2000);
  }, []);

  // --- Model config picker logic ---
  const modelPickerModels = useMemo<ModelInfo[]>(() => {
    if (!modelConfig) return [];
    const items = modelConfig.availableModels.map((value) => {
      const trimmed = value.trim();
      const splitIndex = trimmed.indexOf('/');
      if (splitIndex <= 0) {
        return { id: trimmed, name: trimmed, provider: '' };
      }
      const provider = trimmed.slice(0, splitIndex).trim();
      const id = trimmed.slice(splitIndex + 1).trim();
      return { id: id || trimmed, name: id || trimmed, provider };
    });
    if (modelPickerTarget === 'fallback') {
      return items.filter((item) => {
        const resolved = resolveProviderModel(item);
        return (
          resolved !== modelConfig.defaultModel &&
          !modelConfig.fallbackModels.includes(resolved)
        );
      });
    }
    return items;
  }, [modelConfig?.availableModels, modelConfig?.defaultModel, modelConfig?.fallbackModels, modelPickerTarget]);

  const handleSelectModel = useCallback(
    (selected: ModelInfo) => {
      if (!modelConfig) return;
      const resolved = selected.id ? resolveProviderModel(selected) : '';
      if (modelPickerTarget === 'primary') {
        modelConfig.setDefaultModel(resolved);
        modelConfig.setFallbackModels((prev) => sanitizeFallbackModels(prev, { primaryModel: resolved }));
      } else {
        modelConfig.setFallbackModels((prev) => addFallbackModel(prev, resolved, { primaryModel: modelConfig.defaultModel }));
      }
      setModelPickerVisible(false);
    },
    [modelConfig, modelPickerTarget],
  );

  const removeFallbackModel = useCallback(
    (index: number) => {
      if (!modelConfig) return;
      modelConfig.setFallbackModels((prev) => removeFallbackModelAt(prev, index));
    },
    [modelConfig],
  );

  const moveFallbackInSettings = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!modelConfig) return;
      modelConfig.setFallbackModels((prev) => moveFallbackModel(prev, fromIndex, toIndex));
    },
    [modelConfig],
  );

  const listData = useMemo<ListRow[]>(() => {
    const rows: ListRow[] = [];

    for (const section of sections) {
      const expanded = !collapsedProviders.has(section.provider);
      rows.push({
        type: 'provider-header',
        provider: section.provider,
        count: section.models.length,
        expanded,
        canAddModel: section.canAddModel,
      });
      if (expanded) {
        if (section.models.length === 0) {
          rows.push({ type: 'provider-empty', provider: section.provider });
        } else {
          for (const model of section.models) {
            rows.push({ type: 'model', model });
          }
        }
      }
    }

    return rows;
  }, [sections, collapsedProviders]);

  const keyExtractor = useCallback((item: ListRow, index: number): string => {
    if (item.type === 'provider-header') return `provider-${item.provider}`;
    if (item.type === 'provider-empty') return `provider-empty-${item.provider}`;
    return `model-${item.model.provider}-${item.model.id}-${index}`;
  }, []);

  const selectedModelState = useMemo(() => {
    if (!selectedModel) return null;
    return resolveModelCostEditorState({
      config,
      provider: selectedModel.provider,
      modelId: selectedModel.id,
      catalogCost: selectedModel.cost ?? null,
    });
  }, [config, selectedModel]);

  const selectedCostValue = useMemo(() => parseDraftCost(costDraft ?? {
    input: '',
    output: '',
    cacheRead: '',
    cacheWrite: '',
  }), [costDraft]);

  const selectedCostChanged = useMemo(() => (
    !!selectedModelState
    && !!selectedCostValue
    && !areModelCostsEqual(selectedModelState.cost, selectedCostValue)
  ), [selectedModelState, selectedCostValue]);

  const selectedModelDeleteState = useMemo(() => {
    if (!selectedModel) return null;
    return analyzeModelDeletion({
      config,
      provider: selectedModel.provider,
      modelId: selectedModel.id,
    });
  }, [config, selectedModel]);

  const openCostEditor = useCallback((model: Model) => {
    const state = resolveModelCostEditorState({
      config,
      provider: model.provider,
      modelId: model.id,
      catalogCost: model.cost ?? null,
    });
    setSelectedModel(model);
    setCostDraft(toCostDraft(state.cost));
  }, [config]);

  const closeCostEditor = useCallback(() => {
    if (savingCost || deletingModel) return;
    setSelectedModel(null);
    setCostDraft(null);
  }, [deletingModel, savingCost]);

  const openAddModel = useCallback((provider: string) => {
    setAddModelProvider(provider);
    setAddModelDraft({
      modelId: '',
      modelName: '',
    });
  }, []);

  const closeAddModel = useCallback(() => {
    if (savingModel) return;
    setAddModelProvider(null);
    setAddModelDraft(null);
  }, [savingModel]);

  const handleCostDraftChange = useCallback((field: keyof ModelCostDraft, value: string) => {
    const sanitized = value.replace(/[^0-9.]/g, '');
    setCostDraft((current) => current ? { ...current, [field]: sanitized } : current);
  }, []);

  const handleAddModelDraftChange = useCallback((field: keyof AddModelDraft, value: string) => {
    setAddModelDraft((current) => {
      if (!current) return current;
      const nextValue = field === 'modelId' ? value.trimStart() : value;
      if (field === 'modelId') {
        const shouldMirrorName = current.modelName.trim().length === 0
          || current.modelName.trim() === current.modelId.trim();
        return {
          ...current,
          modelId: nextValue,
          modelName: shouldMirrorName ? nextValue.trim() : current.modelName,
        };
      }
      return {
        ...current,
        [field]: nextValue,
      };
    });
  }, []);

  const handleSaveCost = useCallback(async () => {
    if (!selectedModel || !selectedModelState) return;
    if (!selectedModelState.editable) return;
    if (!configHash) {
      Alert.alert(t('common:Error'), t('Model cost settings are unavailable. Please refresh and try again.'));
      return;
    }
    if (!selectedCostValue) {
      Alert.alert(t('common:Error'), t('Enter valid non-negative numbers for all cost fields.'));
      return;
    }
    const patch = buildModelCostPatch({
      config,
      provider: selectedModel.provider,
      modelId: selectedModel.id,
      modelName: selectedModel.name,
      cost: selectedCostValue,
    });
    if (!patch) {
      Alert.alert(t('common:Error'), t('Unable to prepare model cost patch.'));
      return;
    }

    const changedFieldCount = [
      selectedModelState.cost.input !== selectedCostValue.input,
      selectedModelState.cost.output !== selectedCostValue.output,
      selectedModelState.cost.cacheRead !== selectedCostValue.cacheRead,
      selectedModelState.cost.cacheWrite !== selectedCostValue.cacheWrite,
    ].filter(Boolean).length;

    analyticsEvents.modelCostSaveTapped({
      provider: selectedModel.provider,
      has_existing_override: selectedModelState.hasExistingOverride,
      changed_field_count: changedFieldCount,
      source: 'models_list',
    });

    setSavingCost(true);
    const success = await patchWithRestart({
      patch,
      configHash,
      confirmation: {
        title: t('Save Cost Override'),
        message: t('This will update the selected model cost override and restart Gateway. Continue?'),
      },
      savingMessage: t('Saving model cost...'),
      restartingMessage: t('Restarting Gateway to apply model cost...'),
      onSuccess: async () => {
        await loadModels('refresh');
      },
      onError: async () => {
        await loadModels('refresh');
      },
    });
    setSavingCost(false);
    if (success) {
      setSelectedModel(null);
      setCostDraft(null);
    }
  }, [config, configHash, loadModels, patchWithRestart, selectedCostValue, selectedModel, selectedModelState, t]);

  const describeDeleteBlock = useCallback((path: string, detail?: string) => {
    switch (path) {
      case 'agents.defaults.model.primary':
        return t('This model is the default primary model.');
      case 'agents.defaults.imageModel.primary':
        return t('This model is the default image model.');
      case 'agents.defaults.pdfModel.primary':
        return t('This model is the default PDF model.');
      case 'agents.defaults.heartbeat.model':
        return t('This model is configured for default heartbeat runs.');
      case 'agents.defaults.compaction.model':
        return t('This model is configured as the default compaction model.');
      case 'agents.defaults.memorySearch.model':
        return t('This model is configured for default memory search embeddings.');
      case 'agents.defaults.subagents.model.primary':
        return t('This model is configured as the default subagent primary model.');
      case 'hooks.gmail.model':
        return t('This model is configured for Gmail hooks.');
      default:
        if (path.includes('.model.primary')) {
          return t('This model is the primary model for agent {{agent}}.', {
            agent: detail ?? t('Unknown'),
          });
        }
        if (path.includes('.subagents.model.primary')) {
          return t('This model is the subagent primary model for agent {{agent}}.', {
            agent: detail ?? t('Unknown'),
          });
        }
        if (path.includes('.heartbeat.model')) {
          return t('This model is configured for heartbeat runs on agent {{agent}}.', {
            agent: detail ?? t('Unknown'),
          });
        }
        if (path.startsWith('channels.modelByChannel.')) {
          return t('This model is used by a channel model override ({{target}}).', {
            target: detail ?? path,
          });
        }
        if (path.startsWith('hooks.mappings.')) {
          return t('This model is used by hook mapping {{target}}.', {
            target: detail ?? path,
          });
        }
        return t('This model is still referenced by {{path}}.', { path });
    }
  }, [t]);

  const handleDeleteModel = useCallback(async () => {
    if (!selectedModel) return;
    const fullRef = `${selectedModel.provider}/${selectedModel.id}`;
    const deleteState = analyzeModelDeletion({
      config,
      provider: selectedModel.provider,
      modelId: selectedModel.id,
    });
    if (!configHash || !config) {
      Alert.alert(t('common:Error'), t('Model cost settings are unavailable. Please refresh and try again.'));
      return;
    }
    if (!deleteState.canDelete) {
      Alert.alert(
        t('Delete blocked'),
        deleteState.blocks
          .map((block) => describeDeleteBlock(block.path, block.detail))
          .join('\n'),
      );
      return;
    }

    const result = buildDeleteModelConfig({
      config,
      provider: selectedModel.provider,
      modelId: selectedModel.id,
    });
    if (!result.nextConfig) {
      Alert.alert(t('common:Error'), t('Unable to prepare model deletion.'));
      return;
    }

    analyticsEvents.modelDeleteTapped({
      provider: selectedModel.provider,
      blocked_reference_count: result.analysis.blocks.length,
      source: 'models_list',
    });

    setDeletingModel(true);
    const success = await setWithRestart({
      config: result.nextConfig,
      configHash,
      confirmation: {
        title: t('Delete Model'),
        message: deleteState.hasConfiguredModel
          ? t('This will remove the explicit configuration for {{model}}, clean safe fallback references, and restart Gateway. Continue?', {
              model: fullRef,
            })
          : t('This will remove the selected model from agents.defaults.models and restart Gateway. Continue?'),
        confirmText: t('common:Remove'),
      },
      savingMessage: t('Deleting model...'),
      restartingMessage: t('Restarting Gateway to delete model...'),
      onSuccess: async () => {
        await loadModels('refresh');
      },
      onError: async () => {
        await loadModels('refresh');
      },
    });
    setDeletingModel(false);
    if (success) {
      setSelectedModel(null);
      setCostDraft(null);
    }
  }, [config, configHash, describeDeleteBlock, loadModels, selectedModel, setWithRestart, t]);

  const handleInlineAllowlistOnlyDelete = useCallback(async (model: Model) => {
    if (!configHash || !config) {
      Alert.alert(t('common:Error'), t('Model cost settings are unavailable. Please refresh and try again.'));
      return;
    }

    const deleteState = analyzeModelDeletion({
      config,
      provider: model.provider,
      modelId: model.id,
    });
    if (!deleteState.hasAllowlistEntry || deleteState.hasConfiguredModel) {
      return;
    }
    if (!deleteState.canDelete) {
      Alert.alert(
        t('Delete blocked'),
        deleteState.blocks
          .map((block) => describeDeleteBlock(block.path, block.detail))
          .join('\n'),
      );
      return;
    }

    const result = buildDeleteModelConfig({
      config,
      provider: model.provider,
      modelId: model.id,
    });
    if (!result.nextConfig) {
      Alert.alert(t('common:Error'), t('Unable to prepare model deletion.'));
      return;
    }

    const fullRef = `${model.provider}/${model.id}`;
    analyticsEvents.modelDeleteTapped({
      provider: model.provider,
      blocked_reference_count: result.analysis.blocks.length,
      source: 'models_list_inline',
    });

    setDeletingModel(true);
    setInlineDeletingRef(fullRef);
    const success = await setWithRestart({
      config: result.nextConfig,
      configHash,
      confirmation: {
        title: t('Delete Model'),
        message: t('This will remove the selected model from agents.defaults.models and restart Gateway. Continue?'),
        confirmText: t('common:Remove'),
      },
      savingMessage: t('Deleting model...'),
      restartingMessage: t('Restarting Gateway to delete model...'),
      onSuccess: async () => {
        await loadModels('refresh');
      },
      onError: async () => {
        await loadModels('refresh');
      },
    });
    setDeletingModel(false);
    setInlineDeletingRef(null);

    if (!success) {
      return;
    }

    if (selectedModel?.provider === model.provider && selectedModel.id === model.id) {
      setSelectedModel(null);
      setCostDraft(null);
    }
  }, [config, configHash, describeDeleteBlock, loadModels, selectedModel, setWithRestart, t]);

  const handleSaveModel = useCallback(async () => {
    if (!addModelProvider || !addModelDraft) return;
    if (!configHash) {
      Alert.alert(t('common:Error'), t('Model cost settings are unavailable. Please refresh and try again.'));
      return;
    }

    const modelId = addModelDraft.modelId.trim();
    const modelName = addModelDraft.modelName.trim();
    if (!modelId || !modelName) {
      Alert.alert(t('common:Error'), t('Model ID and name are required.'));
      return;
    }
    if (hasConfiguredModel(config, addModelProvider, modelId)) {
      Alert.alert(t('common:Error'), t('This model already exists for {{provider}}.', { provider: addModelProvider }));
      return;
    }

    const patch = buildAddModelPatch({
      config,
      provider: addModelProvider,
      modelId,
      modelName,
    });
    if (!patch) {
      Alert.alert(t('common:Error'), t('Unable to prepare model patch.'));
      return;
    }

    analyticsEvents.modelAddTapped({
      provider: addModelProvider,
      has_custom_name: modelName !== modelId,
      source: 'models_list',
    });

    setSavingModel(true);
    let shouldShowAllowlistHint = false;
    const success = await patchWithRestart({
      patch,
      configHash,
      confirmation: {
        title: t('Add Model'),
        message: t('This will add a model under {{provider}} and restart Gateway. Continue?', {
          provider: addModelProvider,
        }),
      },
      savingMessage: t('Saving model...'),
      restartingMessage: t('Restarting Gateway to add model...'),
      onSuccess: async () => {
        const refreshed = await loadModels('refresh');
        shouldShowAllowlistHint = Boolean(
          refreshed
          && !refreshed.models.some(
            (model) => model.provider === addModelProvider && model.id === modelId,
          )
        );
      },
      onError: async () => {
        await loadModels('refresh');
      },
    });
    setSavingModel(false);

    if (success) {
      setAddModelProvider(null);
      setAddModelDraft(null);
      if (shouldShowAllowlistHint) {
        Alert.alert(
          t('common:Saved'),
          t('Model was added, but it is not visible in this list. Current allowlist settings may be filtering it out.'),
          [
            {
              text: t('common:Close'),
              onPress: () => {
                scheduleAutomaticAppReview('model_added');
              },
            },
          ],
        );
        return;
      }
      scheduleAutomaticAppReview('model_added');
    }
  }, [addModelDraft, addModelProvider, config, configHash, loadModels, patchWithRestart, t]);

  const handleAllowlistToggle = useCallback((model: Model, nextValue: boolean) => {
    const ref = `${model.provider}/${model.id}`;

    analyticsEvents.modelAllowlistToggled({
      provider: model.provider,
      enabled: nextValue,
      source: 'models_list',
    });

    setDraftAllowlistRefs((prev) => {
      const next = new Set(prev);
      if (nextValue) {
        next.add(ref);
      } else {
        next.delete(ref);
      }
      return Array.from(next).sort((a, b) => a.localeCompare(b));
    });
    setAllowlistDraftTouched(true);
  }, []);

  const handleSaveAllowlistChanges = useCallback(async () => {
    if (!configHash) {
      Alert.alert(t('common:Error'), t('Model cost settings are unavailable. Please refresh and try again.'));
      return;
    }

    const patch = buildBatchModelAllowlistPatch({
      config,
      changes: pendingAllowlistChanges,
    });
    if (!patch) {
      dismissAllowlistChanges();
      return;
    }

    const willInitializeAllowlist = pendingAllowlistChanges.some((change) => change.enabled) && !hasExplicitModelAllowlist(config);

    setSavingAllowlistChanges(true);
    const success = await patchWithRestart({
      patch,
      configHash,
      confirmation: {
        title: t('Save Changes'),
        message: willInitializeAllowlist
          ? t('This will create a new model allowlist from your pending selections and restart Gateway once. Models left off may disappear until you enable them again. Continue?')
          : t('This will apply your pending model changes and restart Gateway once. Continue?'),
      },
      savingMessage: t('common:Saving settings...'),
      restartingMessage: t('common:Restarting Gateway to apply changes...'),
      onSuccess: async () => {
        setAllowlistDraftTouched(false);
        await loadModels('refresh');
      },
      onError: async () => {
        await loadModels('refresh');
      },
    });
    setSavingAllowlistChanges(false);

    if (!success) {
      return;
    }
  }, [config, configHash, dismissAllowlistChanges, loadModels, patchWithRestart, pendingAllowlistChanges, t]);

  const renderItem = useCallback(({ item }: { item: ListRow }) => {
    if (item.type === 'provider-header') {
      return (
        <View style={styles.providerHeader}>
          <TouchableOpacity
            style={styles.providerHeaderToggle}
            onPress={() => toggleProvider(item.provider)}
            activeOpacity={0.6}
          >
            {item.expanded
              ? <ChevronDown size={16} color={theme.colors.textMuted} strokeWidth={2.5} />
              : <ChevronRight size={16} color={theme.colors.textMuted} strokeWidth={2.5} />
            }
            <Text style={styles.providerName}>{capitalizeProvider(item.provider)}</Text>
            <Text style={styles.providerCount}>{item.count}</Text>
          </TouchableOpacity>
          {item.canAddModel ? (
            <IconButton
              icon={<Plus size={16} color={theme.colors.textMuted} strokeWidth={2} />}
              onPress={() => openAddModel(item.provider)}
              style={styles.providerAddButton}
            />
          ) : null}
        </View>
      );
    }

    if (item.type === 'provider-empty') {
      return (
        <View style={styles.emptyProviderCard}>
          <Text style={styles.emptyProviderTitle}>{t('No models configured yet.')}</Text>
          <Text style={styles.emptyProviderBody}>
            {t('Tap + to add the first model for this provider.')}
          </Text>
        </View>
      );
    }

    // type === 'model'
    const { model } = item;
    const fullRef = `${model.provider}/${model.id}`;
    const isCopied = copiedRef === fullRef;
    const ctxLabel = formatContextWindow(model.contextWindow);
    const inAllowlist = draftAllowlistRefs.includes(fullRef);
    const configuredModel = hasConfiguredModel(config, model.provider, model.id);
    const costState = resolveModelCostEditorState({
      config,
      provider: model.provider,
      modelId: model.id,
      catalogCost: model.cost ?? null,
    });
    const allowlistOnlyDelete = (
      inAllowlist
      && !configuredModel
      && costState.blockReason === 'provider_missing'
    );
    const inlineDeleting = inlineDeletingRef === fullRef;
    return (
      <TouchableOpacity
        style={styles.modelCard}
        onPress={() => openCostEditor(model)}
        onLongPress={() => { handleLongPress(model).catch(() => {}); }}
        activeOpacity={0.75}
        delayLongPress={400}
      >
        <View style={styles.modelTitleRow}>
          <View style={styles.modelTitleCopy}>
            <Text style={styles.modelName} numberOfLines={1}>{model.name}</Text>
            {isCopied ? (
              <View style={styles.copiedBadge}>
                <Text style={styles.copiedBadgeText}>{t('common:Copied!')}</Text>
              </View>
            ) : null}
          </View>
          {allowlistOnlyDelete ? (
            <Pressable
              onPress={(event) => {
                event.stopPropagation();
                void handleInlineAllowlistOnlyDelete(model);
              }}
              style={({ pressed }) => [
                styles.inlineDeleteButton,
                pressed && styles.inlineDeleteButtonPressed,
                (inlineDeleting || deletingModel) && styles.inlineDeleteButtonDisabled,
              ]}
              disabled={inlineDeleting || deletingModel}
            >
              <Trash2 size={14} color={theme.colors.error} strokeWidth={2} />
              <Text style={styles.inlineDeleteButtonText}>
                {inlineDeleting ? t('common:Deleting...') : t('common:Delete')}
              </Text>
            </Pressable>
          ) : (
            <Switch
              value={inAllowlist}
              onValueChange={(value) => { handleAllowlistToggle(model, value); }}
              disabled={savingAllowlistChanges}
              trackColor={{
                false: theme.colors.surfaceMuted,
                true: theme.colors.primary,
              }}
              thumbColor={theme.colors.surface}
              ios_backgroundColor={theme.colors.surfaceMuted}
              style={styles.modelSwitch}
            />
          )}
        </View>

        {model.name !== model.id ? (
          <Text style={styles.modelIdSubtitle} numberOfLines={1}>{model.id}</Text>
        ) : null}

        <View style={styles.chipRow}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>
              {t('In ${{input}}', { input: formatCostValue(costState.cost.input) })}
            </Text>
          </View>
          <View style={styles.chip}>
            <Text style={styles.chipText}>
              {t('Out ${{output}}', { output: formatCostValue(costState.cost.output) })}
            </Text>
          </View>
          {ctxLabel ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{ctxLabel}</Text>
            </View>
          ) : null}

          {model.reasoning ? (
            <View style={[styles.chip, styles.chipReasoning]}>
              <Text style={[styles.chipText, styles.chipReasoningText]}>Reasoning</Text>
            </View>
          ) : null}

          {(model.input ?? []).map((modality) => (
            <View key={modality} style={[styles.chip, modality === 'image' && styles.chipImage]}>
              <Text style={[styles.chipText, modality === 'image' && styles.chipImageText]}>{modality}</Text>
            </View>
          ))}
        </View>
      </TouchableOpacity>
    );
  }, [
    styles,
    theme.colors.textMuted,
    toggleProvider,
    handleLongPress,
    copiedRef,
    config,
    deletingModel,
    draftAllowlistRefs,
    inlineDeletingRef,
    handleAllowlistToggle,
    handleInlineAllowlistOnlyDelete,
    openCostEditor,
    openAddModel,
    savingAllowlistChanges,
    t,
  ]);

  const settingsContent = useMemo(() => {
    if (!modelConfig) return null;
    const disabled =
      !modelConfig.hasActiveGateway ||
      modelConfig.loadingSettings ||
      modelConfig.savingSettings;
    return (
      <ScrollView
        contentContainerStyle={[
          styles.settingsContent,
          hasPendingAllowlistChanges && {
            paddingBottom: Space.xxxl + 112 + Math.max(insets.bottom, Space.md),
          },
        ]}
      >
        <ModelConfigSection
          model={modelConfig.defaultModel}
          fallbacks={modelConfig.fallbackModels}
          thinkingDefault={modelConfig.thinkingDefault}
          onSelectThinkingLevel={(level) => {
            modelConfig.setThinkingDefault(level === 'off' ? '' : level);
          }}
          models={modelPickerModels}
          onPickPrimary={() => {
            setModelPickerTarget('primary');
            setModelPickerVisible(true);
          }}
          onPickFallback={() => {
            setModelPickerTarget('fallback');
            setModelPickerVisible(true);
          }}
          onRemoveFallback={removeFallbackModel}
          onMoveFallback={moveFallbackInSettings}
          reorderEnabled
          disabled={disabled}
        />

        {modelConfig.settingsError ? (
          <Text style={styles.configErrorText}>
            {modelConfig.settingsError}
          </Text>
        ) : null}

        <Pressable
          onPress={() => { void modelConfig.onSaveSettings(); }}
          style={({ pressed }) => [
            styles.configPrimaryButton,
            styles.configSaveButton,
            pressed && styles.configPrimaryButtonPressed,
            (disabled || !isDirty) && styles.configButtonDisabled,
          ]}
          disabled={disabled || !isDirty}
        >
          <Text style={styles.configPrimaryButtonText}>
            {modelConfig.savingSettings ? t('common:Saving...') : t('common:Save')}
          </Text>
        </Pressable>
      </ScrollView>
    );
  }, [hasPendingAllowlistChanges, insets.bottom, isDirty, modelConfig, modelPickerModels, removeFallbackModel, styles, theme.colors]);

  const modelListContent = (
    <>
      {!loading && !error && sections.length > 0 && (
        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('Search models...')}
          style={styles.searchWrap}
        />
      )}

      {loading ? (
        <LoadingState message={t('Loading models...')} />
      ) : error ? (
        <View style={styles.errorWrap}>
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t('Failed to load models')}</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => loadModels('initial')}>
              <Text style={styles.retryText}>{t('Retry')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : sections.length === 0 ? (
        <EmptyState
          icon="🧩"
          title={t('No models available')}
          subtitle={t('Check your Gateway configuration.')}
        />
      ) : (
        <FlatList<ListRow>
          data={listData}
          keyExtractor={keyExtractor}
          contentContainerStyle={[
            styles.content,
            hasPendingAllowlistChanges && {
              paddingBottom: Space.xxxl + 112 + Math.max(insets.bottom, Space.md),
            },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadModels('refresh')}
              tintColor={theme.colors.primary}
            />
          }
          renderItem={renderItem}
          ListFooterComponent={<HintCard styles={styles} />}
          ListEmptyComponent={
            search.trim() ? (
              <EmptyState icon="🔍" title={t('No models found')} subtitle={t('Try a different search term.')} />
            ) : null
          }
        />
      )}
    </>
  );

  return (
    <View style={styles.root}>
      {!hideHeader ? (
        <ScreenHeader
          title={t('Models')}
          topInset={topInset}
          onBack={onBack}
          rightContent={
            modelConfig ? (
              <IconButton
                icon={<RefreshCw size={18} color={theme.colors.textMuted} strokeWidth={2} />}
                onPress={() => { void modelConfig.onLoadSettings(); }}
                disabled={modelConfig.loadingSettings || modelConfig.savingSettings}
              />
            ) : undefined
          }
        />
      ) : null}

      {modelConfig ? (
        <>
          <SegmentedTabs tabs={modelsTabs} active={activeTab} onSwitch={setActiveTab} />
          {activeTab === 'settings' ? settingsContent : modelListContent}
        </>
      ) : (
        modelListContent
      )}

      <Animated.View
        pointerEvents={hasPendingAllowlistChanges ? 'auto' : 'none'}
        style={[
          styles.pendingBarWrap,
          {
            paddingBottom: Math.max(insets.bottom, Space.md),
            opacity: allowlistBarAnimation,
            transform: [
              {
                translateY: allowlistBarAnimation.interpolate({
                  inputRange: [0, 1],
                  outputRange: [24, 0],
                }),
              },
            ],
          },
        ]}
      >
        <View style={styles.pendingBar}>
          <View style={styles.pendingBarTextWrap}>
            <Text style={styles.pendingBarTitle}>{t('You have unsaved changes.')}</Text>
            <Text style={styles.pendingBarSubtitle}>{t('Save ({{count}})', { count: pendingAllowlistChanges.length })}</Text>
          </View>
          <View style={styles.pendingBarActions}>
            <TouchableOpacity
              style={styles.pendingCancelButton}
              onPress={() => {
                if (!hasPendingAllowlistChanges || savingAllowlistChanges) {
                  return;
                }
                confirmDiscardAllowlistChanges(dismissAllowlistChanges);
              }}
              activeOpacity={0.7}
              disabled={savingAllowlistChanges}
            >
              <Text style={styles.pendingCancelLabel}>{t('common:Cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pendingSaveButton, savingAllowlistChanges && styles.pendingSaveButtonDisabled]}
              onPress={() => { void handleSaveAllowlistChanges(); }}
              activeOpacity={0.7}
              disabled={savingAllowlistChanges}
            >
              <Text style={styles.pendingSaveLabel}>
                {savingAllowlistChanges ? t('common:Saving...') : t('Save ({{count}})', { count: pendingAllowlistChanges.length })}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      {modelConfig ? (
        <>
          <ModelPickerModal
            visible={modelPickerVisible}
            onClose={() => setModelPickerVisible(false)}
            title={modelPickerTarget === 'primary' ? t('Default Model') : t('common:Add')}
            models={modelPickerModels}
            loading={modelConfig.loadingSettings}
            error={modelConfig.settingsError}
            onRetry={() => { void modelConfig.onLoadSettings(); }}
            selectedModelId={
              modelPickerTarget === 'primary' ? modelConfig.defaultModel : undefined
            }
            showDefault={modelPickerTarget === 'primary'}
            onSelectModel={handleSelectModel}
          />
        </>
      ) : null}

      {selectedModel && selectedModelState && costDraft ? (
        <ModelCostEditorModal
          visible
          title={selectedModel.name}
          provider={selectedModel.provider}
          modelId={selectedModel.id}
          editable={selectedModelState.editable}
          draft={costDraft}
          saving={savingCost}
          saveDisabled={!selectedModelState.editable || !selectedCostChanged || !selectedCostValue || savingCost}
          initialCost={selectedModelState.cost}
          deleteVisible={!!selectedModelDeleteState && (
            selectedModelDeleteState.hasConfiguredModel || selectedModelDeleteState.hasAllowlistEntry
          )}
          deleteDisabled={!selectedModelDeleteState?.canDelete || deletingModel || savingCost}
          deleting={deletingModel}
          deleteBlockedReasons={
            selectedModelDeleteState?.blocks.map((block) => describeDeleteBlock(block.path, block.detail)) ?? []
          }
          onChangeField={handleCostDraftChange}
          onClose={closeCostEditor}
          onSave={() => { void handleSaveCost(); }}
          onDelete={() => { void handleDeleteModel(); }}
        />
      ) : null}

      {addModelProvider && addModelDraft ? (
        <AddModelModal
          visible
          provider={addModelProvider}
          draft={addModelDraft}
          saving={savingModel}
          saveDisabled={
            savingModel
            || addModelDraft.modelId.trim().length === 0
            || addModelDraft.modelName.trim().length === 0
          }
          onChangeField={handleAddModelDraftChange}
          onClose={closeAddModel}
          onSave={() => { void handleSaveModel(); }}
        />
      ) : null}

    </View>
  );
}

type HintCardProps = {
  styles: ReturnType<typeof createStyles>;
};

function HintCard({ styles }: HintCardProps): React.JSX.Element {
  const { t } = useTranslation('console');
  return (
    <View style={styles.hintCard}>
      <Text style={styles.hintTitle}>{t('Adding or changing models')}</Text>
      <Text style={styles.hintBody}>
        {t('You can add models to explicitly configured providers here. Add new providers in openclaw.json or ask your agent to do it for you.')}
      </Text>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    searchWrap: {
      marginHorizontal: Space.md,
      marginTop: Space.sm,
      marginBottom: Space.xs,
    },
    content: {
      paddingHorizontal: Space.md,
      paddingTop: Space.sm,
      paddingBottom: Space.xxxl - Space.sm,
    },
    providerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Space.xs,
      marginTop: Space.xs,
      marginBottom: -4,
    },
    providerHeaderToggle: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      minHeight: 44,
    },
    providerName: {
      flex: 1,
      color: colors.textMuted,
      fontSize: FontSize.md,
      fontWeight: FontWeight.bold,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    providerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    providerAddButton: {
      marginLeft: Space.xs,
    },
    providerCount: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.medium,
    },
    emptyProviderCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      marginBottom: Space.sm,
      marginHorizontal: Space.xs,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
    },
    emptyProviderTitle: {
      color: colors.text,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    emptyProviderBody: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      lineHeight: FontSize.sm * 1.5,
      marginTop: Space.xs,
    },
    modelCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      marginBottom: Space.sm,
      marginHorizontal: Space.xs,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md - 2,
    },
    modelName: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      flexShrink: 1,
    },
    modelTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    modelTitleCopy: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      minWidth: 0,
    },
    modelSwitch: {
      transform: [{ scale: 0.85 }],
    },
    inlineDeleteButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      borderWidth: 1,
      borderColor: colors.error,
      borderRadius: Radius.full,
      backgroundColor: colors.surface,
      paddingHorizontal: Space.sm,
      paddingVertical: 6,
    },
    inlineDeleteButtonPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    inlineDeleteButtonDisabled: {
      opacity: 0.55,
    },
    inlineDeleteButtonText: {
      color: colors.error,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    modelIdSubtitle: {
      color: colors.textMuted,
      fontSize: FontSize.xs,
      fontFamily: 'monospace',
      marginTop: 2,
    },
    copiedBadge: {
      borderRadius: Radius.full,
      backgroundColor: colors.primarySoft,
      paddingHorizontal: Space.sm,
      paddingVertical: 3,
    },
    copiedBadgeText: {
      color: colors.primary,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.xs,
      marginTop: Space.sm,
    },
    chip: {
      backgroundColor: colors.surfaceMuted,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.sm + 2,
      paddingHorizontal: Space.sm,
      paddingVertical: 2,
    },
    chipText: {
      color: colors.textMuted,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.medium,
    },
    chipReasoning: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    chipReasoningText: {
      color: colors.primary,
    },
    chipImage: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
    },
    chipImageText: {
      color: colors.textMuted,
    },
    errorWrap: {
      flex: 1,
      padding: Space.lg,
    },
    errorCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.error,
      padding: Space.md,
    },
    errorTitle: {
      color: colors.error,
      fontSize: FontSize.md + 1,
      fontWeight: FontWeight.bold,
    },
    errorMessage: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      marginTop: Space.xs,
    },
    retryButton: {
      alignSelf: 'flex-start',
      marginTop: Space.md - 2,
      backgroundColor: colors.primary,
      borderRadius: Radius.sm,
      paddingHorizontal: Space.md,
      paddingVertical: 6,
    },
    retryText: {
      color: colors.primaryText,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    hintCard: {
      marginBottom: Space.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md - 2,
    },
    hintTitle: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      marginBottom: Space.xs,
    },
    hintBody: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      lineHeight: FontSize.sm * 1.6,
    },
    hintCode: {
      color: colors.textMuted,
      fontFamily: 'monospace',
    },
    // --- Model config styles ---
    settingsContent: {
      padding: Space.md,
      paddingBottom: Space.xxxl,
    },
    configErrorText: {
      color: colors.error,
      fontSize: FontSize.sm,
      marginTop: Space.sm,
    },
    configSaveButton: {
      marginTop: Space.md,
    },
    configPrimaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Radius.md,
      paddingVertical: 11,
      ...Shadow.md,
    },
    configPrimaryButtonPressed: {
      opacity: 0.88,
    },
    configPrimaryButtonText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    configButtonDisabled: {
      opacity: 0.55,
    },
    pendingBarWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: Space.md,
      paddingTop: Space.sm,
    },
    pendingBar: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.lg,
      paddingHorizontal: Space.md,
      paddingTop: Space.md,
      paddingBottom: Space.md,
      ...Shadow.md,
    },
    pendingBarTextWrap: {
      marginBottom: Space.md,
      gap: 3,
    },
    pendingBarTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    pendingBarSubtitle: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
    },
    pendingBarActions: {
      flexDirection: 'row',
      gap: Space.sm,
    },
    pendingCancelButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 46,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
    },
    pendingCancelLabel: {
      color: colors.textMuted,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    pendingSaveButton: {
      flex: 1.35,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 46,
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
      paddingHorizontal: Space.md,
    },
    pendingSaveButtonDisabled: {
      opacity: 0.6,
    },
    pendingSaveLabel: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
  });
}
