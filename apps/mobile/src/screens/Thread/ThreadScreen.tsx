import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  CAPABILITY_KEYS,
  isImageAttachmentMimeType,
  supportsFileAttachments,
  type AdapterErrorCode,
  type Capabilities,
  type SessionKind,
} from '@clawket/agent-protocol';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import {
  getConnectionRuntime,
  useConnections,
} from '../../connection';
import type { RootStackParamList, ThreadOrigin } from '../../navigation/root-stack';
import { useChatController } from '../../chat/useChatController';
import {
  buildChildSessionActivityCards,
  COMPLETED_CHILD_ACTIVITY_TTL_MS,
  getChildSessionStatusLabel,
} from '../../chat/childSessionActivity';
import { useMessageFavorites } from '../../chat/useMessageFavorites';
import {
  getCurrentAppUpdateAnnouncement,
  getCurrentAppVersion,
} from '../../services/app-update-announcement';
import { analyticsEvents } from '../../services/analytics/events';
import type { AppUpdateAnnouncement } from '../../features/app-updates/releases';
import type { UiMessage } from '../../types/chat';
import {
  sanitizeDisplayText,
  sanitizeUserMessageText,
  sessionLabel,
} from '../../utils/chat-message';
import { openExternalUrl } from '../../utils/openExternalUrl';
import {
  ThreadView,
  type ThreadCopy,
  type ThreadViewProps,
} from './ThreadView';
import {
  deriveThreadContentState,
  formatThreadLocalTime,
  isThreadErrorCode,
  loadThreadCronRunSeeds,
  resolveThreadErrorCode,
  resolveThreadErrorDetail,
  type ThreadErrorInput,
  type ThreadRunCard,
  type ThreadRunSeed,
} from './model';
import { ThreadOverlays } from './components/ThreadOverlays';

const NO_CAPABILITIES = Object.freeze(Object.fromEntries(
  CAPABILITY_KEYS.map((capability) => [capability, false]),
)) as unknown as Capabilities;

type NavigationProps = NativeStackScreenProps<RootStackParamList, 'Thread'>;

export type ThreadScreenProps = NavigationProps & Readonly<{
  locked?: boolean;
  lockedReason?: 'gatewayConnections' | 'agents';
  onOpenSessionPanel?: () => void;
  onOpenAddMenu?: () => void;
  onOpenRunSession?: (
    sessionKey: string,
    agentId: string | undefined,
    kind: ThreadRunCard['kind'],
  ) => void;
  onOpenRunLogs?: (jobId: string, agentId?: string) => void;
  onOpenAttachments?: ThreadViewProps['onOpenAttachments'];
  onThreadOpened?: (context: {
    connectionId: string;
    agentId: string;
    sessionKey: string;
    from: ThreadOrigin;
  }) => void;
}>;

export function ThreadScreen({
  navigation,
  route,
  locked = false,
  lockedReason = 'agents',
  onOpenSessionPanel,
  onOpenAddMenu,
  onOpenRunSession,
  onOpenRunLogs,
  onOpenAttachments,
  onThreadOpened,
}: ThreadScreenProps): React.JSX.Element {
  const app = useAppContext();
  const { isPro } = useProPaywall();
  const connections = useConnections();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation(['chat', 'common', 'settings']);
  const [activationFailure, setActivationFailure] = useState<Readonly<{
    error: unknown;
  }> | null>(null);
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [promptPickerVisible, setPromptPickerVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<UiMessage | null>(null);
  const [shareMessage, setShareMessage] = useState<UiMessage | null>(null);
  const [announcement, setAnnouncement] = useState<AppUpdateAnnouncement | null>(null);
  const [announcementVisible, setAnnouncementVisible] = useState(false);
  const [stopConfirmationVisible, setStopConfirmationVisible] = useState(false);
  const [cronRunSeeds, setCronRunSeeds] = useState<ThreadRunSeed[]>([]);
  const currentVersion = useMemo(() => getCurrentAppVersion(), []);
  const openedKeyRef = useRef<string | null>(null);
  const analyticsOpenedKeyRef = useRef<string | null>(null);
  const requestedSessionKeyRef = useRef<string | null>(null);
  const { connectionId, agentId, sessionKey, from } = route.params;
  const routeIsActive = connections.activeConnectionId === connectionId;
  const adapter = routeIsActive && !locked ? connections.activeAdapter : null;
  const capabilities = adapter?.capabilities ?? NO_CAPABILITIES;
  const fileAttachmentsEnabled = supportsFileAttachments(capabilities);
  const copy = useMemo(() => createThreadCopy(t), [t]);

  useEffect(() => {
    setAnnouncementVisible(false);
    if (!app.debugMode) {
      setAnnouncement(null);
      return;
    }
    setAnnouncement(getCurrentAppUpdateAnnouncement(currentVersion));
  }, [app.debugMode, currentVersion]);

  useEffect(() => {
    if (!connections.initialized || routeIsActive || locked) return;
    let cancelled = false;
    setActivationFailure(null);
    void getConnectionRuntime().activate(connectionId).catch((error: unknown) => {
      if (cancelled) return;
      setActivationFailure({ error });
    });
    return () => {
      cancelled = true;
    };
  }, [connectionId, connections.initialized, locked, routeIsActive]);

  useEffect(() => {
    if (app.currentAgentId !== agentId) app.setCurrentAgentId(agentId);
  }, [agentId, app.currentAgentId, app.setCurrentAgentId]);

  useEffect(() => {
    const requestKey = `${connectionId}:${agentId}:${sessionKey}:${from}`;
    if (requestedSessionKeyRef.current === requestKey) return;
    requestedSessionKeyRef.current = requestKey;
    app.requestChatSession(sessionKey, from);
  }, [agentId, app.requestChatSession, connectionId, from, sessionKey]);

  useEffect(() => {
    const openedKey = `${connectionId}:${sessionKey}:${from}`;
    if (openedKeyRef.current === openedKey) return;
    openedKeyRef.current = openedKey;
    onThreadOpened?.({ connectionId, agentId, sessionKey, from });
  }, [agentId, connectionId, from, onThreadOpened, sessionKey]);

  useEffect(() => {
    setSelectedMessage(null);
    setShareMessage(null);
    setAddSheetVisible(false);
    setPromptPickerVisible(false);
    setStopConfirmationVisible(false);
  }, [connectionId, sessionKey]);

  const controller = useChatController({
    adapter,
    debugMode: app.debugMode,
    showAgentAvatar: app.showAgentAvatar,
    chatSessionRequest: app.chatSessionRequest,
    clearChatSessionRequest: app.clearChatSessionRequest,
  });
  const currentSession = controller.sessions.find((session) => session.key === sessionKey);
  const analyticsBackend = adapter?.connection.backendKind
    ?? connections.connections.find((connection) => connection.id === connectionId)?.backendKind;
  useEffect(() => {
    if (!analyticsBackend) return;
    const kind = normalizeAnalyticsSessionKind(currentSession?.kind, sessionKey);
    const openedKey = `${connectionId}:${sessionKey}:${from}:${analyticsBackend}:${kind}`;
    if (analyticsOpenedKeyRef.current === openedKey) return;
    analyticsOpenedKeyRef.current = openedKey;
    analyticsEvents.threadOpened({ backend: analyticsBackend, kind, from });
  }, [analyticsBackend, connectionId, currentSession?.kind, from, sessionKey]);
  const agent = app.agents.find((candidate) => candidate.id === agentId);
  const agentName = agent?.identity?.name?.trim()
    || agent?.name?.trim()
    || controller.agentDisplayName?.trim()
    || agentId;
  const locale = i18n.resolvedLanguage || i18n.language;
  const currentRosterAgent = connections.roster
    .find((group) => group.connection.id === connectionId)
    ?.agents.find((candidate) => candidate.agent.agentId === agentId)
    ?.agent;
  const isMainThread = currentSession?.kind === 'main'
    || sessionKey === app.mainSessionKey
    || sessionKey === 'main'
    || /^agent:[^:]+:main$/.test(sessionKey);
  const cronFallbackTitle = t('Cron', { ns: 'common' });
  const childSessionCards = useMemo(() => buildChildSessionActivityCards({
    currentSessionKey: controller.sessionKey,
    currentAgentId: agentId,
    currentAgentName: agentName,
    sessions: controller.sessions,
    activityMap: controller.childSessionActivityRef.current,
    resolveSessionTitle: (session, options) => sessionLabel(session, {
      currentAgentName: options?.currentAgentName,
    }),
  }), [
    agentId,
    agentName,
    controller.childSessionActivityRef,
    controller.childSessionActivityVersion,
    controller.sessionKey,
    controller.sessions,
  ]);
  useEffect(() => {
    const operations = adapter?.management?.cron;
    if (
      !routeIsActive
      || controller.connectionState !== 'ready'
      || controller.sessionKey !== sessionKey
      || !isMainThread
      || !capabilities.cron
      || !operations?.list
      || !operations.runs
    ) {
      setCronRunSeeds([]);
      return undefined;
    }
    setCronRunSeeds([]);
    let cancelled = false;
    void loadThreadCronRunSeeds({
      operations,
      currentSessionKey: sessionKey,
      currentAgentId: agentId,
      isMainAgent: currentRosterAgent?.isMain ?? agentId === 'main',
      fallbackTitle: cronFallbackTitle,
    }).then((runs) => {
      if (!cancelled) setCronRunSeeds(runs);
    }).catch(() => {
      if (!cancelled) setCronRunSeeds([]);
    });
    return () => {
      cancelled = true;
    };
  }, [
    adapter,
    agentId,
    app.foregroundEpoch,
    capabilities.cron,
    controller.connectionState,
    controller.sessionKey,
    controller.sessions,
    cronFallbackTitle,
    currentRosterAgent?.isMain,
    isMainThread,
    routeIsActive,
    sessionKey,
  ]);
  const runCards = useMemo<ThreadRunCard[]>(() => [
    ...childSessionCards.map((card) => ({
      id: card.sessionKey,
      kind: 'subagent' as const,
      sessionKey: card.sessionKey,
      ...(card.agentId ? { agentId: card.agentId } : {}),
      title: card.title === 'Subagent' ? t('Subagent', { ns: 'chat' }) : card.title,
      status: card.status,
      statusLabel: getChildSessionStatusLabel(
        card.status,
        card.previewText,
        card.toolName,
        t,
      ),
      timeLabel: formatThreadLocalTime(card.updatedAt, locale),
      updatedAt: card.updatedAt,
    })),
    ...cronRunSeeds.map((run) => ({
      ...run,
      statusLabel: run.status === 'failed'
        ? t('Failed', { ns: 'chat' })
        : run.status === 'skipped'
          ? t('Skipped', { ns: 'settings' })
          : run.status === 'succeeded'
            ? t('Succeeded', { ns: 'settings' })
            : t('Completed', { ns: 'chat' }),
      timeLabel: formatThreadLocalTime(run.updatedAt, locale),
      canOpenLogs: run.status === 'failed'
        && capabilities.logs
        && isPro
        && Boolean(onOpenRunLogs),
    })),
  ].sort((left, right) => (
    right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
  )), [capabilities.logs, childSessionCards, cronRunSeeds, isPro, locale, onOpenRunLogs, t]);

  useEffect(() => {
    const completed = childSessionCards.filter((card) => card.status === 'completed');
    if (completed.length === 0) return undefined;
    const latestCompletedAt = Math.max(...completed.map((card) => card.updatedAt));
    const delay = Math.max(
      0,
      latestCompletedAt + COMPLETED_CHILD_ACTIVITY_TTL_MS - Date.now(),
    );
    const timer = setTimeout(() => {
      controller.clearChildSessionActivities(completed.map((card) => card.sessionKey));
    }, delay);
    return () => clearTimeout(timer);
  }, [childSessionCards, controller.clearChildSessionActivities]);
  const gatewayConfigId = adapter?.connection.id ?? null;
  const favorites = useMessageFavorites({
    agentEmoji: agent?.identity?.emoji,
    agentId,
    agentName,
    gatewayConfigId,
    listData: controller.listData,
    sessionKey: controller.sessionKey,
    sessionLabel: currentSession?.title ?? currentSession?.label,
  });
  const selectedMessageFavorited = selectedMessage
    ? favorites.isFavoritedMessage(selectedMessage)
    : false;
  const connectionError = connections.error
    && (!connections.error.connectionId || connections.error.connectionId === connectionId)
    ? connections.error.message
    : null;
  const error = activationFailure
    ? createThreadError(t, activationFailure.error)
    : connectionError
      ? createThreadError(t, connectionError)
      : null;
  const state = deriveThreadContentState({
    locked,
    switching: connections.switching || !routeIsActive,
    targetSessionReady: controller.sessionKey === sessionKey,
    historyLoaded: controller.historyLoaded,
    hasMessages: controller.listData.length > 0 || runCards.length > 0,
    connectionState: controller.connectionState,
    error,
  });

  const retry = () => {
    setActivationFailure(null);
    void (async () => {
      if (getConnectionRuntime().getSnapshot().activeConnectionId !== connectionId) {
        await getConnectionRuntime().activate(connectionId);
        return;
      }
      await getConnectionRuntime().probeActive();
    })().catch((retryError: unknown) => {
      setActivationFailure({ error: retryError });
    });
  };
  const requestCancelCurrentRun = controller.canAbortCurrentRun && controller.sessionKey
    ? () => setStopConfirmationVisible(true)
    : undefined;
  const confirmCancelCurrentRun = useCallback(() => {
    setStopConfirmationVisible(false);
    if (analyticsBackend) analyticsEvents.chatAbortTapped({ backend: analyticsBackend });
    controller.abortCurrentRun();
  }, [analyticsBackend, controller]);
  const openRunSession = useCallback((
    targetSessionKey: string,
    targetAgentId: string | undefined,
    kind: ThreadRunCard['kind'],
  ) => {
    analyticsEvents.runCardOpened({ kind });
    onOpenRunSession?.(targetSessionKey, targetAgentId, kind);
  }, [onOpenRunSession]);

  const closeAnnouncement = useCallback(() => {
    setAnnouncementVisible(false);
  }, []);

  const handleAnnouncementEntryPress = useCallback((entry: AppUpdateAnnouncement['entries'][number]) => {
    closeAnnouncement();
    if (entry.action.type === 'none') return;
    if (entry.action.type === 'open_url') {
      void openExternalUrl(entry.action.url, () => undefined);
      return;
    }
    if (entry.action.type === 'open_paywall') {
      navigation.navigate('Paywall', { reason: entry.action.feature });
      return;
    }
    if (entry.action.type === 'navigate_config_add_connection') {
      navigation.navigate('Onboarding', {
        presentation: 'modal',
        initialBackend: entry.action.flow === 'youmind' ? 'youmind' : undefined,
      });
      return;
    }
    if (entry.action.type === 'navigate_config') {
      if (entry.action.screen === 'ChatAppearance') {
        navigation.navigate('AccountSettingsSection', { section: 'appearance' });
      } else {
        navigation.navigate('AgentSettingsSection', {
          connectionId,
          agentId,
          section: 'openclaw',
        });
      }
      return;
    }
  }, [agentId, closeAnnouncement, connectionId, navigation]);

  const handleCopyMessage = useCallback((message: UiMessage) => {
    const text = message.role === 'assistant'
      ? sanitizeDisplayText(message.text)
      : message.role === 'user'
        ? sanitizeUserMessageText(message.text)
        : message.text;
    if (text.trim()) void Clipboard.setStringAsync(text.trim());
  }, []);

  const handleToggleFavorite = useCallback((message: UiMessage) => {
    void favorites.toggleFavorite(message).catch(() => undefined);
  }, [favorites]);

  const handleShareMessage = useCallback((message: UiMessage) => {
    setSelectedMessage(null);
    setShareMessage(message);
  }, []);

  const handleOpenMessageAttachments = useCallback((message: UiMessage) => {
    if (onOpenAttachments) {
      onOpenAttachments(message);
      return;
    }
    const uris = message.imageUris ?? [];
    if (uris.length > 0) controller.preview.openPreview(uris, 0);
  }, [controller.preview, onOpenAttachments]);

  const handleOpenPendingAttachment = useCallback((index: number) => {
    const selected = controller.pendingImages[index];
    if (!selected || !isImageAttachmentMimeType(selected.mimeType)) return;
    const images = controller.pendingImages.filter((item) => (
      isImageAttachmentMimeType(item.mimeType)
    ));
    const selectedIndex = images.findIndex((item) => item.uri === selected.uri);
    if (selectedIndex >= 0) {
      controller.preview.openPreview(images.map((item) => item.uri), selectedIndex);
    }
  }, [controller.pendingImages, controller.preview]);

  const handleSelectPrompt = useCallback((text: string) => {
    controller.setInput((previous: string) => previous.trim()
      ? `${previous}\n\n${text}`
      : text);
    setPromptPickerVisible(false);
  }, [controller]);

  const handleOpenAddMenu = useCallback(() => {
    if (onOpenAddMenu) {
      onOpenAddMenu();
      return;
    }
    setAddSheetVisible(true);
  }, [onOpenAddMenu]);

  const shareProductLabel = connections.connections.find((connection) => (
    connection.id === connectionId
  ))?.label;

  return (
    <>
      <ThreadView
        agentId={agentId}
        agentName={agentName}
        agentEmoji={agent?.identity?.emoji}
        sessionTitle={currentSession?.title ?? currentSession?.label}
        isMainSession={sessionKey === app.mainSessionKey}
        model={controller.currentModelHeaderLabel}
        contextUsed={currentSession?.totalTokensFresh === false
          ? undefined
          : currentSession?.totalTokens}
        contextWindow={currentSession?.contextTokens}
        activityLabel={controller.activityLabel}
        capabilities={capabilities}
        state={state}
        messages={controller.listData}
        runCards={runCards}
        locale={locale}
        input={controller.input}
        composerRef={controller.composerRef}
        isRunning={controller.isSending}
        canSend={controller.canSend}
        loadingMoreHistory={controller.loadingMoreHistory}
        topInset={insets.top}
        bottomInset={insets.bottom}
        copy={copy}
        onBack={() => navigation.goBack()}
        onOpenSessionPanel={onOpenSessionPanel}
        onOpenSettings={() => navigation.navigate('AgentSettings', { connectionId, agentId })}
        onChangeInput={controller.setInput}
        onSend={controller.onSend}
        onCancel={requestCancelCurrentRun}
        onOpenAddMenu={capabilities.attachments || capabilities.skills ? handleOpenAddMenu : undefined}
        onVoice={controller.voiceInputSupported ? controller.toggleVoiceInput : undefined}
        onRetry={retry}
        onOpenPaywall={() => navigation.navigate('Paywall', { reason: lockedReason })}
        onErrorAction={() => retry()}
        onLoadMoreHistory={controller.hasMoreHistory ? controller.onLoadMoreHistory : undefined}
        onOpenRunSession={onOpenRunSession ? openRunSession : undefined}
        onOpenRunLogs={onOpenRunLogs}
        onOpenAttachments={handleOpenMessageAttachments}
        onMessageLongPress={setSelectedMessage}
        favoriteMessageIds={favorites.favoriteMessageIdSet}
        pendingAttachments={controller.pendingImages}
        canAddMoreAttachments={controller.canAddMoreImages}
        onOpenPendingAttachment={handleOpenPendingAttachment}
        onRemovePendingAttachment={controller.removePendingImage}
        onPickImage={controller.pickImage}
        onTakePhoto={controller.takePhoto}
        onChooseFile={fileAttachmentsEnabled ? controller.pickFile : undefined}
        onPasteFiles={controller.onPasteFiles}
        onPasteFailed={controller.onPasteFailed}
        slashSuggestions={controller.slashSuggestions}
        showSlashSuggestions={controller.showSlashSuggestions}
        onSelectSlashCommand={controller.onSelectSlashCommand}
        onDismissSlashSuggestions={controller.dismissSlashSuggestions}
        thinkingLevel={controller.thinkingLevel}
        thinkingLevelOptions={controller.thinkingLevelOptions}
        onSelectThinkingLevel={controller.onSelectStaticThinkLevel}
        onResolveApproval={controller.resolveApproval}
      />
      <ThreadOverlays
        addVisible={addSheetVisible}
        attachmentsEnabled={capabilities.attachments}
        skillsEnabled={capabilities.skills}
        onCloseAdd={() => setAddSheetVisible(false)}
        onPickImage={controller.pickImage}
        onTakePhoto={controller.takePhoto}
        onChooseFile={fileAttachmentsEnabled ? controller.pickFile : undefined}
        onOpenSkills={capabilities.skills ? () => navigation.navigate('AgentSettingsSection', {
          connectionId,
          agentId,
          section: 'skills',
        }) : undefined}
        onOpenPrompts={() => setPromptPickerVisible(true)}
        selectedMessage={selectedMessage}
        selectedMessageFavorited={selectedMessageFavorited}
        onCloseMessageActions={() => setSelectedMessage(null)}
        onCopyMessage={handleCopyMessage}
        onToggleFavorite={handleToggleFavorite}
        onShareMessage={handleShareMessage}
        shareMessage={shareMessage}
        agentName={agentName}
        agentEmoji={agent?.identity?.emoji}
        agentAvatarUri={controller.agentAvatarUri ?? undefined}
        shareProductLabel={shareProductLabel}
        onCloseShare={() => setShareMessage(null)}
        preview={{
          visible: controller.preview.previewVisible,
          uris: controller.preview.previewUris,
          index: controller.preview.previewIndex,
          width: controller.preview.screenWidth,
          height: controller.preview.screenHeight,
          topInset: insets.top,
          bottomInset: insets.bottom,
          onClose: controller.preview.closePreview,
          onIndexChange: controller.preview.setPreviewIndex,
        }}
        modelPicker={{
          visible: controller.modelPickerVisible,
          loading: controller.modelPickerLoading,
          error: controller.modelPickerError,
          models: controller.availableModels,
          providers: controller.availableProviders,
          defaultModel: controller.currentModel ?? undefined,
          defaultProvider: controller.currentModelProvider ?? undefined,
          onClose: () => controller.setModelPickerVisible(false),
          onRetry: controller.retryModelPickerLoad,
          onSelect: controller.onSelectModel,
        }}
        commandPicker={{
          visible: controller.commandPickerVisible,
          title: controller.commandPickerTitle,
          loading: controller.commandPickerLoading,
          error: controller.commandPickerError,
          options: controller.commandPickerOptions,
          isSending: controller.isSending,
          onClose: controller.closeCommandPicker,
          onRetry: controller.retryCommandPickerLoad,
          onSelect: controller.onSelectCommandOption,
        }}
        promptPicker={{
          visible: promptPickerVisible,
          onClose: () => setPromptPickerVisible(false),
          onSelect: handleSelectPrompt,
        }}
        thinkingPicker={{
          visible: controller.staticThinkPickerVisible,
          current: controller.thinkingLevel ?? '',
          options: controller.thinkingLevelOptions,
          onClose: controller.closeStaticThinkPicker,
          onSelect: controller.onSelectStaticThinkLevel,
        }}
        announcement={{
          visible: announcementVisible,
          value: announcement,
          debugMode: app.debugMode,
          currentVersion,
          onClose: closeAnnouncement,
          onEntryPress: handleAnnouncementEntryPress,
        }}
        stopConfirmation={{
          visible: stopConfirmationVisible,
          title: t('Stop Agent', { ns: 'chat' }),
          message: t(
            'Are you sure you want to stop the agent? This will interrupt the current task.',
            { ns: 'chat' },
          ),
          cancelLabel: t('Cancel', { ns: 'common' }),
          confirmLabel: t('Stop', { ns: 'chat' }),
          onClose: () => setStopConfirmationVisible(false),
          onConfirm: confirmCancelCurrentRun,
        }}
      />
    </>
  );
}

function inferAnalyticsSessionKind(sessionKey: string): SessionKind {
  if (sessionKey === 'main' || /^agent:[^:]+:main$/.test(sessionKey)) return 'main';
  if (sessionKey.includes(':subagent:')) return 'subagent';
  if (sessionKey.includes(':cron:')) return 'cron';
  return 'other';
}

function normalizeAnalyticsSessionKind(
  kind: SessionKind | 'global' | 'unknown' | undefined,
  sessionKey: string,
): SessionKind {
  if (kind === 'global' || kind === 'unknown') return 'other';
  return kind ?? inferAnalyticsSessionKind(sessionKey);
}

function translateThreadErrorMessage(t: TFunction, code: AdapterErrorCode): string {
  if (code === 'bridge_offline') return t('Bridge is not running on your computer', { ns: 'chat' });
  if (code === 'pairing_required') return t('Pairing required', { ns: 'chat' });
  if (code === 'gateway_offline') return t('Agent is not responding', { ns: 'chat' });
  if (code === 'pairing_expired') return t('Pairing expired, pair again', { ns: 'chat' });
  if (code === 'unauthorized') return t('Sign-in expired', { ns: 'chat' });
  if (code === 'timeout') return t('Connection timed out', { ns: 'chat' });
  if (code === 'rate_limited') return t('Too many requests, try again later', { ns: 'chat' });
  if (code === 'frame_too_large') return t('Message too large to send', { ns: 'chat' });
  if (code === 'unsupported') return t('Not supported by this backend', { ns: 'chat' });
  if (code === 'server') return t('Server error', { ns: 'chat' });
  return t('No network', { ns: 'chat' });
}

function translateThreadErrorAction(t: TFunction, code: AdapterErrorCode): string | undefined {
  if (code === 'bridge_offline') return t('Help', { ns: 'common' });
  if (code === 'pairing_required' || code === 'pairing_expired') {
    return t('Pair again', { ns: 'common' });
  }
  if (code === 'unauthorized') return t('Sign in', { ns: 'common' });
  if (code === 'gateway_offline' || code === 'network' || code === 'timeout' || code === 'server') {
    return t('Retry', { ns: 'common' });
  }
  return undefined;
}

export function createThreadError(t: TFunction, error?: unknown): ThreadErrorInput {
  const code = resolveThreadErrorCode(error);
  const rawCode = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  const useAdapterCopy = isThreadErrorCode(rawCode);
  return {
    code,
    message: useAdapterCopy
      ? translateThreadErrorMessage(t, code)
      : resolveThreadErrorDetail(error) || translateThreadErrorMessage(t, code),
    actionLabel: translateThreadErrorAction(t, code),
  };
}

export function createThreadCopy(t: TFunction): ThreadCopy {
  return {
    back: t('Back', { ns: 'common' }),
    settings: t('Agent settings', { ns: 'chat' }),
    openSessions: t('Open sessions', { ns: 'chat' }),
    add: t('Add', { ns: 'common' }),
    voice: t('Voice input', { ns: 'chat' }),
    send: t('Send', { ns: 'chat' }),
    stop: t('Stop', { ns: 'chat' }),
    reconnect: t('Reconnect', { ns: 'chat' }),
    offline: t('Offline · reconnecting', { ns: 'chat' }),
    thinking: t('Thinking…', { ns: 'chat' }),
    loadingHistory: t('Loading history', { ns: 'chat' }),
    locked: t('Multiple agents require Pro', { ns: 'chat' }),
    viewPro: t('View Pro', { ns: 'chat' }),
    retry: t('Retry', { ns: 'common' }),
    file: t('File', { ns: 'chat' }),
    tool: t('Tool', { ns: 'chat' }),
    toolRunning: t('Running', { ns: 'chat' }),
    toolCompleted: t('Completed', { ns: 'chat' }),
    toolFailed: t('Failed', { ns: 'chat' }),
    approvalTitle: t('Allow exec?', { ns: 'chat' }),
    allow: t('Allow', { ns: 'chat' }),
    reject: t('Reject', { ns: 'chat' }),
    allowed: t('Allowed', { ns: 'chat' }),
    denied: t('Denied', { ns: 'chat' }),
    expired: t('Expired', { ns: 'chat' }),
    formatAsk: (name) => t('Ask {{name}}', { ns: 'chat', name }),
    formatEmpty: (name) => t('Start a conversation with {{name}}', { ns: 'chat', name }),
    formatAttachments: (count) => t('{{count}} attachments', { ns: 'chat', count }),
    formatRunDetail: (status, time) => time
      ? t('{{status}} · {{time}}', { ns: 'chat', status, time })
      : status,
    logs: t('Logs', { ns: 'common' }),
    formatModelContext: (model, remainingPercent) => t('{{model}} · {{percent}}% left', {
      ns: 'chat',
      model,
      percent: remainingPercent,
    }),
    formatThinkingLevel: (level) => t(`thinking_${level}`, { ns: 'chat' }),
  };
}
