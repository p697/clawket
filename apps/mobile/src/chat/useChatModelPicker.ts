import { useCallback, useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { analyticsEvents } from '../services/analytics/events';
import { useAppContext } from '../contexts/AppContext';
import type {
  AgentAdapter,
  ModelProviderInfo,
  ModelSelectionState,
} from '@clawket/agent-protocol';
import { ConnectionState, SessionInfo } from '../types';

export type ModelInfo = {
  id: string;
  name: string;
  provider: string;
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
  setInput: (value: string) => void;
  setSessions: (updater: (prev: SessionInfo[]) => SessionInfo[]) => void;
};

export function useChatModelPicker({
  connectionState,
  adapter,
  sessionKey,
  setInput,
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
  const [currentModelProvider, setCurrentModelProvider] = useState<string | null>(null);
  const requestContextRef = useRef({ adapter, connectionState, sessionKey });
  const modelLoadRequestRef = useRef(0);
  const modelRefreshRequestRef = useRef(0);
  const modelSelectionRequestRef = useRef(0);
  requestContextRef.current = { adapter, connectionState, sessionKey };

  const isCurrentAdapterRequest = useCallback((
    requestAdapter: AgentAdapter,
    connectionId: string,
    requestSessionKey?: string | null,
  ): boolean => {
    const current = requestContextRef.current;
    return current.connectionState === 'ready'
      && current.adapter === requestAdapter
      && current.adapter.connection.id === connectionId
      && (requestSessionKey === undefined || current.sessionKey === requestSessionKey);
  }, []);

  const hydrateModelSelection = useCallback((selection: ModelSelectionState) => {
    setAvailableModels((previous) => selection.models?.length ? selection.models : previous);
    setAvailableProviders(selection.providers ?? []);
    setCurrentModel(selection.currentModel?.trim() || null);
    setCurrentModelProvider(selection.currentProvider?.trim() || null);
  }, []);

  const hydrateModels = useCallback((models: ModelInfo[]) => {
    setAvailableModels(models);
    setAvailableProviders([]);
  }, []);

  const hydrateCurrentModelFromSessions = useCallback((sessions: SessionInfo[]) => {
    const trimmedSessionKey = sessionKey?.trim() || null;
    const selected = trimmedSessionKey
      ? sessions.find((session) => session.key === trimmedSessionKey) ?? null
      : null;
    const fallback = selected ?? sessions[0] ?? null;
    setCurrentModel(fallback?.model?.trim() || null);
    setCurrentModelProvider(fallback?.modelProvider?.trim() || null);
  }, [sessionKey]);

  const loadModelsForPicker = useCallback(async () => {
    const requestId = ++modelLoadRequestRef.current;
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
    const isCurrent = () => (
      requestId === modelLoadRequestRef.current
      && isCurrentAdapterRequest(requestAdapter, connectionId, sessionKey)
    );

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
      const available = await models.list();
      if (!isCurrent()) return;
      hydrateModels(available);
      if (models.getSelection) {
        const selection = await models.getSelection(requestAdapter.capabilities.modelPerSession ? sessionKey : undefined);
        if (!isCurrent()) return;
        hydrateModelSelection(selection);
      }
    } catch (err: unknown) {
      if (!isCurrent()) return;
      const msg = err instanceof Error ? err.message : String(err);
      setModelPickerError(msg || 'Failed to load models.');
      setAvailableModels([]);
      setAvailableProviders([]);
    } finally {
      if (isCurrent()) setModelPickerLoading(false);
    }
  }, [
    adapter,
    connectionState,
    hydrateModelSelection,
    hydrateModels,
    isCurrentAdapterRequest,
    sessionKey,
  ]);

  const refreshCurrentModel = useCallback(async () => {
    const requestId = ++modelRefreshRequestRef.current;
    const requestAdapter = adapter;
    if (connectionState !== 'ready' || !requestAdapter?.capabilities.models) return;
    const connectionId = requestAdapter.connection.id;
    const requestSessionKey = sessionKey;
    const isCurrent = () => (
      requestId === modelRefreshRequestRef.current
      && isCurrentAdapterRequest(requestAdapter, connectionId, requestSessionKey)
    );
    try {
      const getSelection = requestAdapter.management?.models?.getSelection;
      if (getSelection) {
        const currentState = await getSelection(requestAdapter.capabilities.modelPerSession ? requestSessionKey : undefined);
        if (!isCurrent()) return;
        const selectedModel = currentState.currentModel?.trim();
        if (selectedModel) {
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
    } catch {
      // Keep the last visible state; model refresh should be non-disruptive in chat.
    }
  }, [
    adapter,
    connectionState,
    hydrateCurrentModelFromSessions,
    isCurrentAdapterRequest,
    sessionKey,
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
    setModelPickerError(null);
    setConfiguredDefaultModel(undefined);
    setAvailableModels([]);
    setAvailableProviders([]);
  }, [adapter]);

  useEffect(() => {
    if (!isFocused) return;
    void refreshCurrentModel();
  }, [foregroundEpoch, isFocused, refreshCurrentModel]);

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

    // Optimistically update the current session so the thread header responds immediately.
    const slashIdx = providerModel.indexOf('/');
    const model = slashIdx >= 0 ? providerModel.slice(slashIdx + 1) : providerModel;
    const provider = slashIdx >= 0 ? providerModel.slice(0, slashIdx) : undefined;
    const previousModel = currentModel;
    const previousProvider = currentModelProvider;
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
    setModelPickerVisible(false);
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
    hydrateModelSelection,
    isCurrentAdapterRequest,
    refreshCurrentModel,
    sessionKey,
    setInput,
    setSessions,
  ]);

  const currentModelHeaderLabel = currentModel
    ? (currentModelProvider ? `${currentModelProvider}/${currentModel}` : currentModel)
    : null;

  return {
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
