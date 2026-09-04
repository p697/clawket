import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { CAPABILITY_KEYS, type Capabilities } from '@clawket/agent-protocol';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppContext } from '../../contexts/AppContext';
import {
  getConnectionRuntime,
  useConnections,
} from '../../connection';
import type { RootStackParamList, ThreadOrigin } from '../../navigation/root-stack';
import { useChatController } from '../ChatScreen/hooks/useChatController';
import {
  ThreadView,
  type ThreadCopy,
  type ThreadViewProps,
} from './ThreadView';
import {
  deriveThreadContentState,
  isThreadErrorCode,
  resolveThreadErrorCode,
  resolveThreadErrorDetail,
  THREAD_ERROR_COPY,
  type ThreadErrorInput,
} from './model';

const NO_CAPABILITIES = Object.freeze(Object.fromEntries(
  CAPABILITY_KEYS.map((capability) => [capability, false]),
)) as unknown as Capabilities;

type NavigationProps = NativeStackScreenProps<RootStackParamList, 'Thread'>;

export type ThreadScreenProps = NavigationProps & Readonly<{
  locked?: boolean;
  onOpenSessionPanel?: () => void;
  onOpenAddMenu?: () => void;
  onOpenRun?: ThreadViewProps['onOpenRun'];
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
  onOpenSessionPanel,
  onOpenAddMenu,
  onOpenRun,
  onOpenAttachments,
  onThreadOpened,
}: ThreadScreenProps): React.JSX.Element {
  const app = useAppContext();
  const connections = useConnections();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['chat', 'common']);
  const [activationFailure, setActivationFailure] = useState<Readonly<{
    error: unknown;
  }> | null>(null);
  const openedKeyRef = useRef<string | null>(null);
  const requestedSessionKeyRef = useRef<string | null>(null);
  const { connectionId, agentId, sessionKey, from } = route.params;
  const routeIsActive = connections.activeConnectionId === connectionId;
  const adapter = routeIsActive ? connections.activeAdapter : null;
  const capabilities = adapter?.capabilities ?? NO_CAPABILITIES;
  const copy = useMemo(() => createThreadCopy(t), [t]);

  useEffect(() => {
    if (!connections.initialized || routeIsActive) return;
    let cancelled = false;
    setActivationFailure(null);
    void getConnectionRuntime().activate(connectionId).catch((error: unknown) => {
      if (cancelled) return;
      setActivationFailure({ error });
    });
    return () => {
      cancelled = true;
    };
  }, [connectionId, connections.initialized, routeIsActive]);

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

  const controller = useChatController({
    adapter,
    gateway: app.gateway,
    config: app.config,
    debugMode: app.debugMode,
    showAgentAvatar: app.showAgentAvatar,
    chatSessionRequest: app.chatSessionRequest,
    clearChatSessionRequest: app.clearChatSessionRequest,
  });
  const currentSession = controller.sessions.find((session) => session.key === sessionKey);
  const agent = app.agents.find((candidate) => candidate.id === agentId);
  const agentName = agent?.identity?.name?.trim()
    || agent?.name?.trim()
    || controller.agentDisplayName?.trim()
    || agentId;
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
    hasMessages: controller.listData.length > 0,
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
  const cancelCurrentRun = adapter && capabilities.abort && controller.sessionKey
    ? () => {
      void adapter.cancel(controller.sessionKey ?? sessionKey).catch((cancelError: unknown) => {
        setActivationFailure({ error: cancelError });
      });
    }
    : undefined;

  return (
    <ThreadView
      agentId={agentId}
      agentName={agentName}
      agentEmoji={agent?.identity?.emoji}
      sessionTitle={currentSession?.title ?? currentSession?.label}
      isMainSession={sessionKey === app.mainSessionKey}
      model={controller.currentModelHeaderLabel}
      activityLabel={controller.activityLabel}
      capabilities={capabilities}
      state={state}
      messages={controller.listData}
      input={controller.input}
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
      onCancel={cancelCurrentRun}
      onOpenAddMenu={onOpenAddMenu ?? (capabilities.attachments ? controller.pickImage : undefined)}
      onVoice={controller.voiceInputSupported ? controller.toggleVoiceInput : undefined}
      onRetry={retry}
      onOpenPaywall={() => navigation.navigate('Paywall', { reason: 'agents' })}
      onErrorAction={() => retry()}
      onLoadMoreHistory={controller.hasMoreHistory ? controller.onLoadMoreHistory : undefined}
      onOpenRun={onOpenRun}
      onOpenAttachments={onOpenAttachments}
      onResolveApproval={controller.resolveApproval}
    />
  );
}

export function createThreadError(t: TFunction, error?: unknown): ThreadErrorInput {
  const code = resolveThreadErrorCode(error);
  const descriptor = THREAD_ERROR_COPY[code];
  const rawCode = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  const useAdapterCopy = isThreadErrorCode(rawCode);
  return {
    code,
    message: useAdapterCopy
      ? t(descriptor.messageKey, { ns: 'chat' })
      : resolveThreadErrorDetail(error) || t(descriptor.messageKey, { ns: 'chat' }),
    actionLabel: descriptor.actionKey ? t(descriptor.actionKey, { ns: 'common' }) : undefined,
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
    formatModelContext: (model, remainingPercent) => t('{{model}} · {{percent}}% left', {
      ns: 'chat',
      model,
      percent: remainingPercent,
    }),
  };
}
