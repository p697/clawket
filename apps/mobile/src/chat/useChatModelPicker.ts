import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { analyticsEvents } from '../services/analytics/events';
import { useAppContext } from '../contexts/AppContext';
import { runtimeSettingsStatus } from '../connection/runtime-settings-status';
import { SessionCatalogSupersededError } from '../connection/adapters/session-catalog';
import { SessionPreferencesService } from '../services/session-preferences';
import type {
  AgentAdapter,
  ModelProviderInfo,
  ModelSelectionState,
  SessionPermissionMode,
  ThinkingLevel,
} from '@clawket/agent-protocol';
import { ConnectionState, SessionInfo } from '../types';

export type ModelInfo = {
  id: string;
  name: string;
  provider: string;
  sortOrder?: number;
  resolvedModel?: string;
  input?: Array<'text' | 'image'>;
  reasoningLevels?: import('@clawket/agent-protocol').ThinkingLevel[];
};

function resolveProviderModel(model: ModelInfo): string {
  const modelRef = model.id.trim() || model.name;
  if (modelRef.includes('/')) return modelRef;
  const provider = model.provider.trim() || 'unknown';
  return `${provider}/${modelRef}`;
}

type Props = {
  connectionState: ConnectionState;
  adapter: AgentAdapter | null;
  sessionKey: string | null;
  sessionMetadata?: Pick<SessionInfo, 'key' | 'model' | 'modelProvider'>;
  setInput: (value: string) => void;
  setThinkingLevel?: (value: string | null) => void;
  setSessions: (updater: (prev: SessionInfo[]) => SessionInfo[]) => void;
};

export function useChatModelPicker({
  connectionState,
  adapter,
  sessionKey,
  sessionMetadata,
  setInput,
  setThinkingLevel,
  setSessions,
}: Props) {
  const { foregroundEpoch } = useAppContext();
  const isFocused = useIsFocused();
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [modelPickerLoading, setModelPickerLoading] = useState(false);
  const [modelPickerError, setModelPickerError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [availableProviders, setAvailableProviders] = useState<ModelProviderInfo[]>([]);
  const [configuredDefaultModel, setConfiguredDefaultModel] = useState<string | undefined>();
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [nativeThinkingLevel, setNativeThinkingLevel] = useState<string | null>(null);
  // Levels the backend reports for the current model (OpenClaw 2026.x); null keeps the static list.
  const [nativeThinkingLevels, setNativeThinkingLevels] = useState<ThinkingLevel[] | null>(null);
  const [currentModelProvider, setCurrentModelProvider] = useState<string | null>(null);
  const [runtimeSettingsBusy, setRuntimeSettingsBusy] = useState(false);
  const [runtimeSettingsUnconfirmed, setRuntimeSettingsUnconfirmed] = useState(() => (
    !!adapter && runtimeSettingsStatus.version(adapter.connection.id, sessionKey) !== undefined
  ));
  const runtimeSettingsUnconfirmedRef = useRef(runtimeSettingsUnconfirmed);
  const [fastMode, setFastMode] = useState<ModelSelectionState['fastMode']>();
  const [permissions, setPermissions] = useState<ModelSelectionState['permissions']>();
  const [permissionPickerVisible, setPermissionPickerVisible] = useState(false);
  // Models chosen on this device for this connection, newest first (the model sheet's first rows).
  const [recentModels, setRecentModels] = useState<string[]>([]);
  const runtimeSettingsPendingRef = useRef(false);
  // An interrupted write may have reached the computer. Keep that uncertainty
  // with its conversation, including while another adapter/session is shown.
  const settingsScope = JSON.stringify([adapter?.connection.id, adapter?.capabilities.modelPerSession ? sessionKey : null]);
  const hasRuntimeSettings = Boolean(adapter?.capabilities.fastMode || adapter?.capabilities.sessionPermissions);
  const requestContextRef = useRef({ adapter, connectionState, sessionKey });
  const modelLoadRequestRef = useRef(0);
  const modelRefreshRequestRef = useRef(0);
  const modelSelectionRequestRef = useRef(0);
  const modelValueRevisionRef = useRef(0);
  const runtimeReadRevisionRef = useRef(0);
  const modelMetadataScope = useRef<{ adapter: AgentAdapter | null; sessionKey: string | null } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  requestContextRef.current = { adapter, connectionState, sessionKey };
  const recentScope = adapter?.connection.id ?? null;
  useEffect(() => {
    setRecentModels([]);
    if (!recentScope) return undefined;
    let current = true;
    void SessionPreferencesService.getRecentModels(recentScope).then((refs) => { if (current) setRecentModels(refs); });
    return () => { current = false; };
  }, [recentScope]);

  const isSameAdapterRequest = useCallback((
    requestAdapter: AgentAdapter,
    connectionId: string,
    requestSessionKey?: string | null,
  ): boolean => {
    const current = requestContextRef.current;
    return mounted.current && current.adapter === requestAdapter
      && current.adapter.connection.id === connectionId
      && (requestSessionKey === undefined || current.sessionKey === requestSessionKey);
  }, []);

  const isCurrentAdapterRequest = useCallback((requestAdapter: AgentAdapter, connectionId: string, requestSessionKey?: string | null) => (
    requestContextRef.current.connectionState === 'ready'
    && isSameAdapterRequest(requestAdapter, connectionId, requestSessionKey)
  ), [isSameAdapterRequest]);

  const confirmRuntimeSettings = useCallback((selection: ModelSelectionState, revision?: number) => {
    if (!adapter) return;
    if (adapter.capabilities.sessionPermissions && selection.permissions?.requiresConfirmation === true) {
      runtimeSettingsUnconfirmedRef.current = true;
      setRuntimeSettingsUnconfirmed(true);
      if (sessionKey) runtimeSettingsStatus.requirePermissions(adapter.connection.id, sessionKey);
      return;
    }
    // A read with missing native settings is not proof that an interrupted
    // permission change failed. Keep Send paused until the computer resolves it.
    if (adapter?.capabilities.sessionPermissions && selection.permissions?.mode == null) {
      if (runtimeSettingsStatus.version(adapter.connection.id, sessionKey) !== undefined) {
        setModelPickerError('Codex has not confirmed these settings. Refresh before sending a message.');
        setModelPickerVisible(true);
      }
      return;
    }
    runtimeSettingsStatus.confirm(adapter.connection.id, sessionKey, revision, selection.permissions?.requiresConfirmation === false);
    const unconfirmed = runtimeSettingsStatus.version(adapter.connection.id, sessionKey) !== undefined;
    runtimeSettingsUnconfirmedRef.current = unconfirmed;
    setRuntimeSettingsUnconfirmed(unconfirmed);
  }, [adapter, sessionKey]);

  const hydrateRuntimeSettings = useCallback((selection: ModelSelectionState, revision?: number) => {
    confirmRuntimeSettings(selection, revision);
    setFastMode(selection.fastMode);
    setPermissions(selection.permissions);
  }, [confirmRuntimeSettings]);

  const hydrateModelSelection = useCallback((selection: ModelSelectionState) => {
    modelMetadataScope.current = { adapter, sessionKey };
    setAvailableModels((previous) => selection.models?.length ? selection.models : previous);
    setNativeThinkingLevel(selection.thinkingLevel ?? null);
    setNativeThinkingLevels(selection.thinkingLevels?.length ? selection.thinkingLevels : null);
    if (selection.thinkingLevel) setThinkingLevel?.(selection.thinkingLevel);
    setAvailableProviders(selection.providers ?? []);
    setCurrentModel(selection.currentModel?.trim() || null);
    setCurrentModelProvider(selection.currentProvider?.trim() || null);
  }, [adapter, sessionKey, setThinkingLevel]);

  const hydrateModels = useCallback((models: ModelInfo[]) => {
    setAvailableModels(models);
    setAvailableProviders([]);
  }, []);

  const hydrateCurrentModelFromSessions = useCallback((sessions: SessionInfo[]) => {
    const trimmedSessionKey = sessionKey?.trim() || null;
    const selected = trimmedSessionKey
      ? sessions.find((session) => session.key === trimmedSessionKey) ?? null
      : null;
    // A newly created session may not be in an older list response yet. Never
    // borrow a different conversation's model or clear the current selection.
    if (trimmedSessionKey && !selected) return;
    const fallback = selected ?? sessions[0] ?? null;
    setCurrentModel(fallback?.model?.trim() || null);
    setCurrentModelProvider(fallback?.modelProvider?.trim() || null);
  }, [sessionKey]);

  const selectionSessionKey = adapter?.capabilities.modelPerSession ? sessionKey : null;
  useEffect(() => {
    // An unresolved new conversation must not display the previous one's model.
    // Global selections intentionally survive conversation changes.
    setCurrentModel(null);
    setCurrentModelProvider(null);
    setNativeThinkingLevel(null);
    setNativeThinkingLevels(null);
    setFastMode(undefined);
    setPermissions(undefined);
    setPermissionPickerVisible(false);
    setModelPickerVisible(false);
    setModelPickerLoading(false);
    setRuntimeSettingsBusy(false);
    const unconfirmed = !!adapter && runtimeSettingsStatus.version(adapter.connection.id, sessionKey) !== undefined;
    setRuntimeSettingsUnconfirmed(unconfirmed);
    runtimeSettingsUnconfirmedRef.current = unconfirmed;
    runtimeSettingsPendingRef.current = false;
    modelSelectionRequestRef.current += 1;
    modelLoadRequestRef.current += 1;
    modelMetadataScope.current = null;
  }, [adapter, selectionSessionKey, settingsScope]);

  const metadataKey = sessionMetadata?.key;
  const metadataModel = sessionMetadata?.model;
  const metadataProvider = sessionMetadata?.modelProvider;
  useEffect(() => {
    // Native initialization can resolve a model after the initial catalog read.
    // Hermes selections are global: an older session cannot replace them.
    if (!adapter?.capabilities.modelPerSession || metadataKey !== sessionKey || !metadataModel?.trim()) return;
    // An event received after a read began is newer than that read's snapshot.
    modelValueRevisionRef.current += 1;
    setCurrentModel(metadataModel.trim());
    setCurrentModelProvider(metadataProvider?.trim() || null);
  }, [adapter, sessionKey, metadataKey, metadataModel, metadataProvider]);

  const loadModelsForPicker = useCallback(async () => {
    const requestId = ++modelLoadRequestRef.current;
    const valueRevision = modelValueRevisionRef.current;
    const runtimeRevision = ++runtimeReadRevisionRef.current;
    const selectionRevision = modelSelectionRequestRef.current;
    const requestAdapter = adapter;
    const models = requestAdapter?.management?.models;
    if (connectionState !== 'ready' || !requestAdapter?.capabilities.models || !models?.list) {
      setModelPickerError('Gateway is not connected.');
      setAvailableModels([]);
      setAvailableProviders([]);
      setModelPickerLoading(false);
      return;
    }
    const connectionId = requestAdapter.connection.id;
    const settingsRevision = runtimeSettingsStatus.version(connectionId, sessionKey);
    const isSameScope = () => (
      requestId === modelLoadRequestRef.current
      && isSameAdapterRequest(requestAdapter, connectionId, sessionKey)
    );
    const isCurrent = () => isSameScope() && requestContextRef.current.connectionState === 'ready';

    setModelPickerLoading(true);
    setModelPickerError(null);
    setConfiguredDefaultModel(undefined);
    // Configuration is additive: failure must never block free model switching.
    if (requestAdapter.capabilities.modelManage && models.getCatalog) {
      void models.getCatalog().then((catalog) => {
        if (isCurrent()) setConfiguredDefaultModel(catalog.defaults.primary || undefined);
      }).catch(() => {});
    }
    try {
      // Native model/settings replies already contain the ordered catalog.
      // One scoped read avoids an extra process round trip and a stale global read.
      if (hasRuntimeSettings && models.getSelection) {
        const selection = await models.getSelection(sessionKey);
        if (!isCurrent()) return;
        hydrateModels(selection.models);
        // Session metadata carries model/provider only. It cannot invalidate a
        // native permission or speed read; newer reads and explicit writes can.
        if (runtimeRevision === runtimeReadRevisionRef.current && selectionRevision === modelSelectionRequestRef.current) {
          hydrateRuntimeSettings(selection, settingsRevision);
        }
        if (valueRevision === modelValueRevisionRef.current) hydrateModelSelection(selection);
        return;
      }
      const available = await models.list();
      if (!isCurrent()) return;
      hydrateModels(available);
      if (models.getSelection) {
        const selection = await models.getSelection(requestAdapter.capabilities.modelPerSession ? sessionKey : undefined);
        if (!isCurrent()) return;
        if (valueRevision === modelValueRevisionRef.current) hydrateModelSelection(selection);
      }
    } catch (err: unknown) {
      if (!isSameScope()) return;
      const msg = err instanceof Error ? err.message : String(err);
      setModelPickerError(msg || 'Failed to load models.');
      setAvailableModels([]);
      setAvailableProviders([]);
    } finally {
      if (isSameScope()) setModelPickerLoading(false);
    }
  }, [
    adapter,
    connectionState,
    hydrateModelSelection,
    hydrateRuntimeSettings,
    hydrateModels,
    hasRuntimeSettings,
    isSameAdapterRequest,
    sessionKey,
  ]);

  const refreshCurrentModel = useCallback(async () => {
    const requestId = ++modelRefreshRequestRef.current;
    const valueRevision = modelValueRevisionRef.current;
    const runtimeRevision = ++runtimeReadRevisionRef.current;
    const selectionRevision = modelSelectionRequestRef.current;
    const requestAdapter = adapter;
    if (connectionState !== 'ready' || !requestAdapter?.capabilities.models) return;
    const connectionId = requestAdapter.connection.id;
    const requestSessionKey = sessionKey;
    const settingsRevision = runtimeSettingsStatus.version(connectionId, requestSessionKey);
    const isCurrentScope = () => (
      requestId === modelRefreshRequestRef.current
      && isCurrentAdapterRequest(requestAdapter, connectionId, requestSessionKey)
    );
    const isCurrent = () => isCurrentScope() && valueRevision === modelValueRevisionRef.current;
    try {
      const getSelection = requestAdapter.management?.models?.getSelection;
      if (getSelection) {
        const currentState = await getSelection(requestAdapter.capabilities.modelPerSession ? requestSessionKey : undefined);
        if (!isCurrentScope()) return;
        // Newer session metadata supersedes this selection, not its catalog.
        if (currentState.models?.length) setAvailableModels(currentState.models);
        if (runtimeRevision === runtimeReadRevisionRef.current && selectionRevision === modelSelectionRequestRef.current) {
          hydrateRuntimeSettings(currentState, settingsRevision);
        }
        if (!isCurrent()) return;
        setNativeThinkingLevel(currentState.thinkingLevel ?? null);
        setNativeThinkingLevels(currentState.thinkingLevels?.length ? currentState.thinkingLevels : null);
        const selectedModel = currentState.currentModel?.trim();
        if (selectedModel) {
          modelMetadataScope.current = { adapter: requestAdapter, sessionKey: requestSessionKey };
          if (currentState.thinkingLevel) setThinkingLevel?.(currentState.thinkingLevel);
          setCurrentModel(selectedModel);
          setCurrentModelProvider(currentState.currentProvider?.trim() || null);
          return;
        }
      }
      if (!isCurrent()) return;
      const sessions = (await requestAdapter.listSessions()).map((session): SessionInfo => ({
        key: session.key,
        model: session.model,
        modelProvider: session.modelProvider,
      }));
      if (!isCurrent()) return;
      hydrateCurrentModelFromSessions(sessions);
    } catch (error) {
      if (error instanceof SessionCatalogSupersededError) return;
      if (isCurrent() && runtimeSettingsStatus.version(connectionId, requestSessionKey) !== undefined) {
        setModelPickerError(error instanceof Error ? error.message : String(error));
        setModelPickerVisible(true);
      }
      // Keep the last visible state; model refresh should be non-disruptive in chat.
    }
  }, [
    adapter,
    connectionState,
    hydrateCurrentModelFromSessions,
    setThinkingLevel,
    isCurrentAdapterRequest,
    sessionKey,
    hydrateRuntimeSettings,
  ]);

  const openModelPicker = useCallback((): boolean => {
    if (
      connectionState !== 'ready'
      || !adapter?.capabilities.models
      || !adapter.management?.models?.list
    ) {
      return false;
    }
    setModelPickerVisible(true);
    void loadModelsForPicker();
    return true;
  }, [adapter, connectionState, loadModelsForPicker]);

  const retryModelPickerLoad = useCallback(() => {
    void loadModelsForPicker();
  }, [loadModelsForPicker]);

  useEffect(() => {
    setModelPickerLoading(false);
    setNativeThinkingLevel(null);
    setNativeThinkingLevels(null);
    setModelPickerError(null);
    setConfiguredDefaultModel(undefined);
    setAvailableModels([]);
    setAvailableProviders([]);
  }, [adapter]);

  useEffect(() => {
    if (!isFocused) return;
    void refreshCurrentModel();
  }, [foregroundEpoch, isFocused, refreshCurrentModel]);

  // Runtime controls publish only native-confirmed values. A queued owner ACK is
  // not an applied setting; Bridge waits for that confirmation before replying.
  const applyRuntimeSetting = useCallback((operation: () => Promise<ModelSelectionState>): boolean => {
    if (!adapter || !sessionKey || connectionState !== 'ready' || runtimeSettingsPendingRef.current) return false;
    const requestAdapter = adapter, key = sessionKey;
    let settingsRevision: number;
    try { settingsRevision = runtimeSettingsStatus.begin(adapter.connection.id, sessionKey); }
    catch (error) {
      setModelPickerError(error instanceof Error ? error.message : String(error));
      setModelPickerVisible(true);
      return false;
    }
    const requestId = ++modelSelectionRequestRef.current;
    modelValueRevisionRef.current += 1;
    runtimeSettingsPendingRef.current = true;
    runtimeSettingsUnconfirmedRef.current = true;
    setRuntimeSettingsUnconfirmed(true);
    setRuntimeSettingsBusy(true);
    setModelPickerError(null);
    const isSameScope = () => requestId === modelSelectionRequestRef.current
      && isSameAdapterRequest(requestAdapter, requestAdapter.connection.id, key);
    const isCurrent = () => isSameScope() && requestContextRef.current.connectionState === 'ready';
    void operation().then(selection => {
      if (!isCurrent()) return;
      runtimeReadRevisionRef.current += 1;
      hydrateRuntimeSettings(selection, settingsRevision);
      hydrateModelSelection(selection);
      setSessions(previous => previous.map(session => session.key === key
        ? { ...session, model: selection.currentModel || undefined, modelProvider: selection.currentProvider || undefined }
        : session));
    }).catch(error => {
      if (!isSameScope()) return;
      runtimeSettingsUnconfirmedRef.current = true;
      setRuntimeSettingsUnconfirmed(true);
      setModelPickerError(error instanceof Error ? error.message : String(error));
      if (requestContextRef.current.connectionState === 'ready') void refreshCurrentModel();
      // Keep the setting and draft intact; a failed write must stay reviewable.
      setModelPickerVisible(true);
    }).finally(() => {
      if (!isSameScope()) return;
      runtimeSettingsPendingRef.current = false;
      setRuntimeSettingsBusy(false);
    });
    return true;
  }, [adapter, connectionState, hydrateModelSelection, hydrateRuntimeSettings, isSameAdapterRequest, sessionKey, setSessions, refreshCurrentModel]);

  const onSelectFastMode = useCallback((enabled: boolean) => {
    const operation = adapter?.management?.models?.setFastMode;
    if (!operation || !sessionKey || !fastMode?.available) return;
    applyRuntimeSetting(() => operation(sessionKey, enabled));
  }, [adapter, applyRuntimeSetting, fastMode?.available, sessionKey]);

  const onSelectPermissions = useCallback((mode: SessionPermissionMode) => {
    const operation = adapter?.management?.models?.setPermissions;
    if (!operation || !sessionKey || !permissions?.available) return;
    if (permissions.availableModes && !permissions.availableModes.includes(mode)) return;
    applyRuntimeSetting(() => operation(mode, sessionKey));
  }, [adapter, applyRuntimeSetting, permissions, sessionKey]);

  const openPermissionPicker = useCallback(() => {
    if (!adapter?.capabilities.sessionPermissions || connectionState !== 'ready' || !sessionKey) return;
    setPermissionPickerVisible(true);
    void loadModelsForPicker();
  }, [adapter, connectionState, loadModelsForPicker, sessionKey]);

  const requirePermissionsConfirmation = useCallback((sourceAdapter: AgentAdapter, key: string) => {
    if (!sourceAdapter.capabilities.sessionPermissions) return;
    let errorMessage: string | null = null;
    try { runtimeSettingsStatus.requirePermissions(sourceAdapter.connection.id, key); }
    catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    if (!isSameAdapterRequest(sourceAdapter, sourceAdapter.connection.id, key)) return;
    runtimeReadRevisionRef.current += 1;
    runtimeSettingsUnconfirmedRef.current = true;
    setRuntimeSettingsUnconfirmed(true);
    setPermissions(previous => ({ ...(previous ?? { mode: null, available: false, scope: 'session' }), requiresConfirmation: true }));
    if (errorMessage) setModelPickerError(errorMessage);
  }, [isSameAdapterRequest]);

  const onSelectModel = useCallback((selected: ModelInfo) => {
    const providerModel = resolveProviderModel(selected);
    if (!providerModel.trim()) return;
    const modelId = selected.id.trim() || selected.name.trim();
    const providerId = selected.provider.trim() || undefined;

    analyticsEvents.chatModelSelected({
      provider_model: providerModel,
      model_id: modelId,
      model_name: selected.name || selected.id,
      provider: providerId || 'unknown',
      source: 'chat_model_picker',
      session_key_present: Boolean(sessionKey),
    });
    if (adapter) {
      const recentConnection = adapter.connection.id;
      void SessionPreferencesService.recordRecentModel(recentConnection, providerModel).then((refs) => {
        if (mounted.current && requestContextRef.current.adapter?.connection.id === recentConnection) setRecentModels(refs);
      }).catch(() => {});
    }

    if (hasRuntimeSettings) {
      const operation = adapter?.management?.models?.setSelection;
      if (operation && sessionKey) applyRuntimeSetting(() => operation({ model: modelId,
        ...(providerId ? { provider: providerId } : {}), scope: 'session', sessionKey }));
      return;
    }

    // Optimistically update the current session so the thread header responds immediately.
    const slashIdx = providerModel.indexOf('/');
    const model = slashIdx >= 0 ? providerModel.slice(slashIdx + 1) : providerModel;
    const provider = slashIdx >= 0 ? providerModel.slice(0, slashIdx) : undefined;
    const previousModel = currentModel;
    const previousProvider = currentModelProvider;
    modelValueRevisionRef.current += 1;
    setCurrentModel(model || null);
    setCurrentModelProvider(provider ?? null);
    setSessions((prev) =>
      prev.map((session) =>
        session.key === sessionKey
          ? { ...session, model, modelProvider: provider }
          : session,
      ),
    );

    const requestAdapter = adapter;
    const setSelection = requestAdapter?.management?.models?.setSelection;
    const selectionScope = requestAdapter?.capabilities.modelPerSession ? 'session' : 'global';
    if (
      connectionState !== 'ready'
      || !requestAdapter
      || !setSelection
      || (selectionScope === 'session' && !sessionKey)
    ) {
      setModelPickerVisible(false);
      setInput(`/model ${providerModel}`);
      return;
    }

    const requestId = ++modelSelectionRequestRef.current;
    const connectionId = requestAdapter.connection.id;
    const requestSessionKey = sessionKey;
    const isCurrent = () => (
      requestId === modelSelectionRequestRef.current
      && isCurrentAdapterRequest(requestAdapter, connectionId, requestSessionKey)
    );
    // The sheet stays open (A+ model sheet, owner-approved 2026-10-01): the
    // check moves at once, thinking and the other settings sit beside it.
    void setSelection({
      model: modelId,
      ...(providerId ? { provider: providerId } : {}),
      scope: selectionScope,
      ...(selectionScope === 'session' ? { sessionKey } : {}),
    }).then((selection) => {
      if (!isCurrent()) return;
      hydrateModelSelection(selection);
    }).catch((err: unknown) => {
      if (!isCurrent()) return;
      const msg = err instanceof Error ? err.message : String(err);
      setCurrentModel(previousModel);
      setCurrentModelProvider(previousProvider);
      setSessions((prev) => prev.map((session) => (
        session.key === requestSessionKey
          ? {
            ...session,
            model: previousModel ?? undefined,
            modelProvider: previousProvider ?? undefined,
          }
          : session
      )));
      setModelPickerError(msg || 'Failed to switch model.');
      setModelPickerVisible(true);
      void refreshCurrentModel();
    });
  }, [
    adapter,
    connectionState,
    currentModel,
    currentModelProvider,
    hasRuntimeSettings,
    applyRuntimeSetting,
    hydrateModelSelection,
    isCurrentAdapterRequest,
    refreshCurrentModel,
    sessionKey,
    setInput,
    setSessions,
  ]);

  const selectNativeThinkingLevel = useCallback((level: string): boolean => {
    const operation = adapter?.management?.models?.setThinkingLevel;
    if (!operation) return false;
    if (connectionState !== 'ready' || !sessionKey || !adapter) return true;
    if (hasRuntimeSettings) {
      applyRuntimeSetting(() => operation(sessionKey, level as import('@clawket/agent-protocol').ThinkingLevel));
      return true;
    }
    const currentAdapter = adapter, key = sessionKey;
    void operation(key, level as import('@clawket/agent-protocol').ThinkingLevel).then(selection => {
      if (isCurrentAdapterRequest(currentAdapter, currentAdapter.connection.id, key)) hydrateModelSelection(selection);
    }).catch(error => {
      if (!isCurrentAdapterRequest(currentAdapter, currentAdapter.connection.id, key)) return;
      setModelPickerError(error instanceof Error ? error.message : String(error));
      setModelPickerVisible(true);
    });
    return true;
  }, [adapter, connectionState, sessionKey, hydrateModelSelection, isCurrentAdapterRequest, hasRuntimeSettings, applyRuntimeSetting]);

  const matchingCatalogModels = availableModels.filter((item) =>
    (item.id === currentModel || item.resolvedModel === currentModel || `${item.provider}/${item.id}` === currentModel)
    && (!currentModelProvider || item.provider === currentModelProvider));
  const selectedCatalogModel = matchingCatalogModels[0];
  // Session metadata may omit a provider for native aliases such as "haiku".
  // A unique catalog match can restore its icon, never its write identity.
  const matchingProviders = new Set(matchingCatalogModels.map(model => model.provider.trim()).filter(Boolean));
  const displayProvider = currentModelProvider || (!currentModel?.includes('/') && matchingProviders.size === 1
    ? [...matchingProviders][0] : null);
  const currentModelHeaderLabel = currentModel
    ? (displayProvider ? `${displayProvider}/${currentModel}` : currentModel)
    : null;
  const catalogDisplayName = selectedCatalogModel?.id === 'default'
    ? selectedCatalogModel.resolvedModel || selectedCatalogModel.name
    : selectedCatalogModel?.name || selectedCatalogModel?.resolvedModel;
  const currentModelDisplayName = (catalogDisplayName || currentModel)?.split('/').pop() || null;
  const visiblePermissions: ModelSelectionState['permissions'] = adapter?.capabilities.sessionPermissions
    && runtimeSettingsStatus.requiresPermissions(adapter.connection.id, sessionKey)
    ? { ...(permissions ?? { mode: null, available: false, scope: 'session' }), requiresConfirmation: true }
    : permissions;

  return {
    recentModels,
    modelScope: (adapter?.capabilities.modelPerSession ? 'session' : 'global') as 'session' | 'global',
    hasRuntimeSettings, runtimeSettingsBusy, runtimeSettingsPendingRef, runtimeSettingsUnconfirmed, runtimeSettingsUnconfirmedRef,
    fastMode, permissions: visiblePermissions, permissionPickerVisible, setPermissionPickerVisible,
    onSelectFastMode, onSelectPermissions, openPermissionPicker, requirePermissionsConfirmation,
    currentModelSupportsImages: modelMetadataScope.current?.adapter === adapter
      && modelMetadataScope.current?.sessionKey === sessionKey && selectedCatalogModel?.input?.length
      ? selectedCatalogModel.input.includes('image') : undefined,
    currentModelDisplayName,
    selectNativeThinkingLevel,
    nativeThinkingLevel,
    nativeThinkingLevels,
    configuredDefaultModel,
    availableModels,
    availableProviders,
    currentModel,
    currentModelHeaderLabel,
    currentModelProvider,
    modelPickerError,
    modelPickerLoading,
    modelPickerVisible,
    onSelectModel,
    openModelPicker,
    refreshCurrentModel,
    retryModelPickerLoad,
    setModelPickerVisible,
  };
}
