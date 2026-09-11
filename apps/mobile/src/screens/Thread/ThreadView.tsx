import { SessionPreviewNotice, SessionPreviewFooter } from './components/SessionPreviewNotice';
import { useTranslation } from 'react-i18next';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Image,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { Capabilities } from '@clawket/agent-protocol';
import {
  ArrowDown,
  Brain,
  CalendarClock,
  Bot,
  ChevronLeft,
  CircleAlert,
  Clock,
  Info,
  MessageCircle,
  Paperclip,
  Pause,
  MessagesSquare,
  Star,
  WifiOff,
} from 'lucide-react-native';
import type { PendingImage, UiMessage } from '../../types/chat';
import type { SlashCommand } from '../../data/slash-commands';
import type { ThinkingLevel } from '../../utils/gateway-settings';
import { useAppTheme } from '../../theme';
import { ChatPresentationProvider, useChatPresentation, useConversationTheme } from '../../components/chat/ChatPresentation';
import { ModelIcon } from '../../components/chat/ModelIcon';
import { ChatMessageIdentity } from '../../components/chat/ChatMessageIdentity';
import { MessageEntrance } from '../../components/chat/MessageEntrance';
import { MessageMeta, messageMetaSpacer } from '../../components/chat/MessageMeta';
import { ThinkingIndicator } from '../../components/chat/ThinkingIndicator';
import { ChatBackgroundLayer } from '../../components/chat/ChatBackgroundLayer';
import { DEFAULT_CHAT_APPEARANCE } from '../../features/chat-appearance/defaults';
import type { ChatAppearanceSettings } from '../../types';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Motion,
  Radius,
  Space,
} from '../../theme/tokens';
import { ApprovalCard } from '../../components/ui/ApprovalCard';
import { Banner } from '../../components/ui/Banner';
import { Bubble, useBubbleTypography } from '../../components/ui/Bubble';
import {
  Composer,
  type ComposerHandle,
  type ComposerProps,
  type ComposerVoiceState,
} from '../../components/ui/Composer';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { HeaderTextAction } from '../../components/ui/HeaderTextAction';
import { HeaderPill } from '../../components/ui/HeaderPill';
import { ToolCallRow, ToolGroupRow } from '../../components/chat/ToolCallRow';
import { Sheet } from '../../components/ui/Sheet';
import { ReplyFailureSheet } from '../../components/chat/ReplyFailureSheet';
import { RunResult } from '../../components/chat/RunResult';
import { RunCard } from '../../components/ui/RunCard';
import { Skeleton } from '../../components/ui/Skeleton';
import { LoadingState } from '../../components/ui/LoadingState';
import { Companion } from '../../components/ui/Companion';
import { SYSTEM_EVENT_ICON_SIZE, SYSTEM_EVENT_STROKE_WIDTH, SystemEventRow } from '../../components/ui/SystemEventRow';
import { triggerLightImpact } from '../../services/haptics';
import { PendingImageBar } from '../../components/chat/PendingImageBar';
import { SlashSuggestions } from '../../components/chat/SlashSuggestions';
import { ThinkingLevelMenu } from '../../components/chat/ThinkingLevelMenu';
import { ToolDetailModal } from '../../components/chat/ToolDetailModal';
import {
  createChatMarkdownStyle,
  getChatMarkdownFlavor,
  openChatMarkdownLink,
} from '../../components/chat/chatMarkdown';
import {
  buildThreadTimelineItems,
  groupThreadTools,
  resolveThreadHeaderName,
  resolveThreadHeaderSubtitle,
  type ThreadContentState,
  type ThreadRunCard,
  type ThreadTimelineItem,
} from './model';
import {
  ThreadMessageActionsOverlay,
  type MessageAnchorRemeasure,
  type MessageFavoriteToggleResult,
  type ThreadMessageSelection,
} from './components/ThreadMessageActionsOverlay';
import { isUsableAnchor, type MessageAnchorFrame } from './components/messageActionsLayout';

import { formatThreadClockTime, localDayNumber } from './timestamps';
import { resolveUserMessageStatuses, type UserMessageStatus } from '../../chat/messageDelivery';
import { useThreadMessageEntrance } from '../../chat/useThreadMessageEntrance';

const THREAD_MARKDOWN_FLAVOR = getChatMarkdownFlavor();
const SESSION_CONTENT_FADE_IN = FadeIn
  .duration(Motion.duration.normal)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System);
const SESSION_CONTENT_FADE_OUT = FadeOut
  .duration(Motion.duration.normal)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System);
/**
 * The reply bubble exists from the moment a turn is sent: it carries the
 * Agent's live activity until the first token, then the text itself. It uses
 * the live stream's id so the row never remounts when streaming begins.
 */
const REPLY_PLACEHOLDER_ID = 'streaming';
const REPLY_PLACEHOLDER: UiMessage = { id: REPLY_PLACEHOLDER_ID, role: 'assistant', text: '', streaming: true };
const REPLY_TEXT_FADE_IN = FadeIn
  .duration(Motion.duration.normal)
  .easing(Easing.out(Easing.cubic))
  .reduceMotion(ReduceMotion.System);
/** Live activity for the reply placeholder only, so other rows stay out of its re-render. */
const ThreadLiveActivityContext = createContext('');

export type ThreadCopy = Readonly<{
  close?: string;
  back: string;
  settings: string;
  chooseModel?: string;
  openSessions: string;
  add: string;
  voice: string;
  stopVoice: string;
  listening: string;
  preparingVoice: string;
  send: string;
  stop: string;
  queueSend?: string;
  queued?: string;
  sending?: string;
  paused?: string;
  sent?: string;
  delivered?: string;
  uncertain?: string;
  reconnect: string;
  offline: string;
  thinking: string;
  loadingHistory: string;
  locked: string;
  viewPro: string;
  retry: string;
  file: string;
  tool: string;
  toolRunning: string;
  toolCompleted: string;
  toolFailed: string;
  approvalTitle: string;
  approvalError: string;
  device: string;
  node: string;
  allow: string;
  reject: string;
  allowed: string;
  denied: string;
  expired: string;
  logs: string;
  formatAsk: (name: string) => string;
  formatEmpty: (name: string) => string;
  formatAttachments: (count: number) => string;
  formatRunDetail: (status: string, time: string) => string;
  formatModelContext: (model: string, remainingPercent: number) => string;
  formatThinkingLevel: (level: string) => string;
}>;

export type ThreadMessageActions = Readonly<{
  onCopy: (message: UiMessage) => void;
  onToggleFavorite: (message: UiMessage) => void | Promise<MessageFavoriteToggleResult | void>;
  onShare: (message: UiMessage) => void;
}>;

/** Actions for a message still waiting in the local queue (`message.delivery`). */
export type ThreadQueuedMessageActions = Readonly<{
  /** True only while the session is idle and the queue is paused. */
  canSendNow: boolean;
  onSendNow: (message: UiMessage) => void;
  onEdit: (message: UiMessage) => void;
  onRemove: (message: UiMessage) => void;
}>;

export type ThreadViewProps = Readonly<{
  connectingLabel?: string;
  chatAppearance?: ChatAppearanceSettings;
  chatFontSize?: number;
  showAgentAvatar?: boolean;
  agentId: string;
  agentName: string;
  sessionKey?: string | null;
  scrollToBottomRequestAt?: number | null;
  agentEmoji?: string | null;
  agentAvatarUrl?: string | null;
  sessionTitle?: string | null;
  runContext?: Pick<ThreadRunCard, 'title' | 'kind' | 'statusLabel' | 'summary'>;
  isMainSession?: boolean;
  model?: string | null;
  contextUsed?: number;
  contextWindow?: number;
  activityLabel?: string | null;
  capabilities: Capabilities;
  state: ThreadContentState;
  messages: ReadonlyArray<UiMessage>;
  sessionPreview?: { loading?: boolean; hasHiddenHistory: boolean; onUpgrade: () => void; onMain: () => void };
  compactionNotice?: string | null;
  sendFailure?: string | null;
  sendFailureDetails?: string | null;
  onDismissSendFailure?: () => void;
  runCards?: ReadonlyArray<ThreadRunCard>;
  locale?: string;
  input: string;
  isRunning: boolean;
  canSend: boolean;
  loadingMoreHistory?: boolean;
  topInset?: number;
  bottomInset?: number;
  copy: ThreadCopy;
  onBack: () => void;
  onOpenSessionPanel?: () => void;
  onOpenSettings: () => void;
  onOpenModelPicker?: () => void;
  onChangeInput: (value: string) => void;
  onSend: () => void;
  composerRef?: React.Ref<ComposerHandle>;
  onCancel?: () => void;
  onOpenAddMenu?: () => void;
  onVoice?: () => void;
  voiceState?: ComposerVoiceState;
  voiceLevel?: SharedValue<number>;
  onRetry?: () => void;
  onOpenPaywall?: () => void;
  onErrorAction?: (state: Extract<ThreadContentState, { kind: 'error' }>) => void;
  onLoadMoreHistory?: () => void;
  onOpenRunSession?: (
    sessionKey: string,
    agentId: string | undefined,
    kind: ThreadRunCard['kind'],
    context?: Pick<ThreadRunCard, 'title' | 'kind' | 'statusLabel' | 'summary'>,
  ) => void;
  onOpenRunLogs?: (jobId: string, agentId?: string) => void;
  onOpenAttachments?: (message: UiMessage) => void;
  /** Long-press message actions; omitting this disables the gesture. */
  messageActions?: ThreadMessageActions;
  /** Tap/long-press actions for queued messages; requires `messageActions`. */
  queuedMessageActions?: ThreadQueuedMessageActions;
  favoriteMessageIds?: ReadonlySet<string>;
  /** Optimistic user message ids the backend has not acknowledged yet. */
  unconfirmedMessageIds?: ReadonlySet<string>;
  /** True once the backend reported the run answering the newest turn. */
  runAcknowledged?: boolean;
  pendingAttachments?: PendingImage[];
  canAddMoreAttachments?: boolean;
  onOpenPendingAttachment?: (index: number) => void;
  onRemovePendingAttachment?: (index: number) => void;
  onPickImage?: () => void;
  onTakePhoto?: () => void;
  onChooseFile?: () => void;
  onPasteFiles?: ComposerProps['onPasteFiles'];
  onPasteFailed?: ComposerProps['onPasteFailed'];
  slashSuggestions?: SlashCommand[];
  showSlashSuggestions?: boolean;
  onSelectSlashCommand?: (command: SlashCommand) => void;
  onDismissSlashSuggestions?: () => void;
  thinkingLevel?: string | null;
  thinkingLevelOptions?: ThinkingLevel[];
  onSelectThinkingLevel?: (level: string) => void;
  onResolveApproval?: (
    approvalId: string,
    decision: 'allow-once' | 'allow-always' | 'deny' | 'approve' | 'reject',
    target?: 'device' | 'node',
  ) => void;
  testID?: string;
}>;

export function ThreadView({
  connectingLabel,
  chatAppearance = DEFAULT_CHAT_APPEARANCE,
  chatFontSize = FontSize.body,
  showAgentAvatar = false,
  agentId,
  agentName,
  sessionKey,
  scrollToBottomRequestAt,
  agentEmoji,
  agentAvatarUrl,
  sessionTitle,
  runContext,
  isMainSession = true,
  model,
  contextUsed,
  contextWindow,
  activityLabel,
  capabilities,
  state,
  messages,
  sessionPreview,
  compactionNotice,
  sendFailure,
  sendFailureDetails,
  onDismissSendFailure,
  runCards = [],
  locale,
  input,
  isRunning,
  canSend,
  loadingMoreHistory = false,
  topInset = 0,
  bottomInset = 0,
  copy,
  onBack,
  onOpenSessionPanel,
  onOpenSettings,
  onOpenModelPicker,
  onChangeInput,
  onSend,
  composerRef,
  onCancel,
  onOpenAddMenu,
  onVoice,
  voiceState = 'idle',
  voiceLevel,
  onRetry,
  onOpenPaywall,
  onErrorAction,
  onLoadMoreHistory,
  onOpenRunSession,
  onOpenRunLogs,
  onOpenAttachments,
  messageActions,
  queuedMessageActions,
  favoriteMessageIds,
  unconfirmedMessageIds,
  runAcknowledged = false,
  pendingAttachments = [],
  canAddMoreAttachments = false,
  onOpenPendingAttachment,
  onRemovePendingAttachment,
  onPickImage,
  onTakePhoto,
  onChooseFile,
  onPasteFiles,
  onPasteFailed,
  slashSuggestions = [],
  showSlashSuggestions = false,
  onSelectSlashCommand,
  onDismissSlashSuggestions,
  thinkingLevel,
  thinkingLevelOptions,
  onSelectThinkingLevel,
  onResolveApproval,
  testID = 'thread-screen',
}: ThreadViewProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('common');
  const presentation = useMemo(() => ({
    appearance: chatAppearance, fontSize: chatFontSize, locale,
    identity: { agentId, name: agentName, emoji: agentEmoji, avatarUrl: agentAvatarUrl, showAvatar: showAgentAvatar },
  }), [chatAppearance, chatFontSize, locale, agentId, agentName, agentEmoji, agentAvatarUrl, showAgentAvatar]);
  const reduceMotion = useReducedMotion();
  const [composerExpanded, setComposerExpanded] = useState(false);
  const compactComposerHeight = useRef(0);
  useEffect(() => { setComposerExpanded(false); }, [sessionKey]);
  useEffect(() => {
    if (!composerExpanded) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setComposerExpanded(false);
      return true;
    });
    return () => subscription.remove();
  }, [composerExpanded]);
  const previousSessionKeyRef = useRef(sessionKey);
  const sessionChanged = Boolean(
    previousSessionKeyRef.current
      && sessionKey
      && previousSessionKeyRef.current !== sessionKey,
  );
  const [showFailureDetails, setShowFailureDetails] = useState(false);
  useEffect(() => { setShowFailureDetails(false); }, [sendFailureDetails, sessionKey]);
  const [selectedToolMessageId, setSelectedToolMessageId] = useState<string | null>(null);
  const selectedToolMessage = selectedToolMessageId
    ? messages.find((message) => message.id === selectedToolMessageId) ?? null
    : null;
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const offline = state.kind === 'offline';
  const locked = state.kind === 'locked';
  const headerName = runContext?.title ?? resolveThreadHeaderName(agentName, sessionTitle && sessionTitle === sessionKey ? t('New session') : sessionTitle, isMainSession);
  const headerSubtitle = state.kind === 'reconnecting' ? t('Reconnecting…') : resolveThreadHeaderSubtitle({
    capabilities,
    state,
    isRunning,
    activityLabel,
    model,
    contextUsed,
    contextWindow,
    offlineLabel: copy.offline,
    thinkingLabel: copy.thinking,
    formatModelContext: (_model, percent) => t('Context remaining: {{percent}}%', { ns: 'chat', percent }),
  });
  // The header never wears the working badge: while a run is active the pill
  // shows lifting dots where the subtitle sits, and the reply bubble carries
  // the actual activity.
  const avatarStatus = locked ? 'locked' : offline ? 'offline' : 'idle';
  const headerWorking = isRunning && state.kind !== 'reconnecting';
  const canOpenSessions = capabilities.sessions && Boolean(onOpenSessionPanel);
  const canOpenAddMenu = (capabilities.attachments || capabilities.skills)
    && Boolean(onOpenAddMenu);
  const canUseVoice = Boolean(onVoice);
  const composerPlaceholder = !canUseVoice || voiceState === 'idle' ? copy.formatAsk(agentName)
    : voiceState === 'listening' ? copy.listening : copy.preparingVoice;
  const canCancel = capabilities.abort && Boolean(onCancel);
  const timelineClearance = Space.lg;
  const [selectedRun, setSelectedRun] = useState<ThreadRunCard | null>(null);
  const [calendarDay, setCalendarDay] = useState(() => localDayNumber(Date.now()));
  useEffect(() => {
    const timer = setInterval(() => setCalendarDay(localDayNumber(Date.now())), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [expandedTools, setExpandedTools] = useState<ReadonlySet<string>>(new Set());
  const showReplyPlaceholder = isRunning && !locked && !sessionPreview
    && !messages.some((message) => message.id === REPLY_PLACEHOLDER_ID);
  const timelineMessages = useMemo(
    () => showReplyPlaceholder ? [REPLY_PLACEHOLDER, ...messages] : messages,
    [messages, showReplyPlaceholder],
  );
  const entranceIds = useThreadMessageEntrance(timelineMessages, sessionKey);
  const messageStatuses = useMemo(() => resolveUserMessageStatuses({
    messages, unconfirmedIds: unconfirmedMessageIds, runAcknowledged,
  }), [messages, unconfirmedMessageIds, runAcknowledged]);
  const liveActivity = activityLabel?.trim() || copy.thinking;
  const timelineItems = useMemo(() => groupThreadTools(buildThreadTimelineItems({
    messages: timelineMessages,
    runs: runCards,
    locale,
    yesterdayLabel: t('Yesterday', { lng: locale }),
  }), expandedTools).reverse(), [locale, timelineMessages, runCards, expandedTools, calendarDay, t]);
  const followNewMessagesRef = useRef(true);
  const previewWasVisible = useRef(Boolean(sessionPreview));
  if (previewWasVisible.current && !sessionPreview) followNewMessagesRef.current = false;
  previewWasVisible.current = Boolean(sessionPreview);
  const returningToBottomRef = useRef(false);
  const readerScrollingRef = useRef(false);
  const distanceFromBottomRef = useRef(0);
  const scrollMetricsRef = useRef({ height: 0, viewport: 0, offset: 0 });
  const timelineRef = useRef<FlashListRef<ThreadTimelineItem>>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const scrollButtonProgress = useSharedValue(0);
  useEffect(() => {
    scrollButtonProgress.value = withTiming(showScrollToBottom ? 1 : 0, {
      duration: Motion.duration.normal,
      easing: Easing.out(Easing.cubic),
    });
  }, [scrollButtonProgress, showScrollToBottom]);
  const scrollButtonStyle = useAnimatedStyle(() => ({
    opacity: scrollButtonProgress.value,
    transform: [{ translateY: reduceMotion ? 0 : Space.sm * (1 - scrollButtonProgress.value) }],
  }));
  const scrollToBottom = useCallback(() => {
    // Let the native scroll finish before streaming/layout can issue another scroll.
    const animated = !reduceMotion && distanceFromBottomRef.current > Space.lg;
    returningToBottomRef.current = animated;
    readerScrollingRef.current = false;
    followNewMessagesRef.current = !animated;
    setShowScrollToBottom(false);
    timelineRef.current?.scrollToEnd({ animated });
  }, [reduceMotion]);
  const refreshScrollButton = useCallback(() => {
    const { height, viewport, offset } = scrollMetricsRef.current;
    if (viewport <= 0) return;
    const remaining = Math.max(0, height - viewport - offset);
    distanceFromBottomRef.current = remaining;
    if (returningToBottomRef.current) return;
    // Separate reveal/dismiss thresholds avoid flicker near the bottom edge.
    setShowScrollToBottom((visible) => visible ? remaining > Space.lg : remaining > ControlSize.rosterRow);
  }, []);
  const updateScrollPosition = useCallback(({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollMetricsRef.current = {
      height: nativeEvent.contentSize.height,
      viewport: nativeEvent.layoutMeasurement.height,
      offset: nativeEvent.contentOffset.y,
    };
    refreshScrollButton();
    if (!returningToBottomRef.current && readerScrollingRef.current) {
      followNewMessagesRef.current = distanceFromBottomRef.current <= Space.lg;
    }
  }, [refreshScrollButton]);
  const finishScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (returningToBottomRef.current) {
      returningToBottomRef.current = false;
      followNewMessagesRef.current = true;
      // Include text appended while the native scroll was in flight.
      timelineRef.current?.scrollToEnd({ animated: false });
      return;
    }
    updateScrollPosition(event);
    readerScrollingRef.current = false;
  }, [updateScrollPosition]);
  useEffect(() => {
    followNewMessagesRef.current = true;
    returningToBottomRef.current = false;
    distanceFromBottomRef.current = 0;
    scrollMetricsRef.current = { height: 0, viewport: 0, offset: 0 };
    readerScrollingRef.current = false;
    setShowScrollToBottom(false);
  }, [sessionKey]);
  useEffect(() => {
    if (scrollToBottomRequestAt != null) scrollToBottom();
  }, [scrollToBottomRequestAt, scrollToBottom]);

  useEffect(() => {
    if (selectedToolMessageId && !selectedToolMessage) {
      setSelectedToolMessageId(null);
    }
  }, [selectedToolMessage, selectedToolMessageId]);

  const [messageSelection, setMessageSelection] = useState<ThreadMessageSelection | null>(null);
  const selectedActionMessage = useMemo(() => (
    messageSelection
      ? messages.find((message) => message.id === messageSelection.messageId) ?? null
      : null
  ), [messages, messageSelection]);
  useEffect(() => { setMessageSelection(null); }, [sessionKey]);
  const handleMessageLongPress = useCallback((
    message: UiMessage,
    anchor: MessageAnchorFrame | null,
    remeasure: MessageAnchorRemeasure,
  ) => {
    if (message.role !== 'assistant' && message.role !== 'user') return;
    // The overlay is a separate window; a live keyboard would cover its menu.
    Keyboard.dismiss();
    setMessageSelection({ messageId: message.id, role: message.role, anchor, remeasure });
  }, []);
  const clearMessageSelection = useCallback(() => setMessageSelection(null), []);
  const renderSelectedMessage = useCallback((message: UiMessage, width: number) => (
    <View style={[stylesStatic.timelineItem, stylesStatic.chatMessageSpacing, { width }]}>
      <ThreadMessageRowContent
        message={message}
        copy={copy}
        favorited={favoriteMessageIds?.has(message.id) ?? false}
        status={messageStatuses.get(message.id) ?? null}
        showIdentity={false}
      />
    </View>
  ), [copy, favoriteMessageIds, messageStatuses]);

  useEffect(() => {
    previousSessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  const openTool = useCallback((message: UiMessage) => setSelectedToolMessageId(message.id), []);
  const renderMessage = useCallback(
    ({ item, index }: ListRenderItemInfo<ThreadTimelineItem>) => {
      if (item.type === 'tools') {
        return <View style={stylesStatic.timelineItem}>
          <ToolGroupRow testID={item.key} count={item.messages.length}
            expanded={expandedTools.has(item.key)} running={item.messages.some((message) => message.toolStatus === 'running')}
            incomplete={item.messages.some((message) => message.toolStatus === 'unknown')}
            onPress={() => {
              followNewMessagesRef.current = false;
              readerScrollingRef.current = false;
              returningToBottomRef.current = false;
              setExpandedTools((previous) => {
              const next = new Set(previous);
              if (next.has(item.key)) next.delete(item.key); else next.add(item.key);
              return next;
            });
            }} />
        </View>;
      }
      if (item.type === 'date') {
        return (
          <View style={[stylesStatic.timeSeparator, index > 0 && stylesStatic.timeSeparatorBreak]}>
            <Text testID={`thread-${item.key}`} style={[stylesStatic.timeLabel, {
              color: theme.colors.inkSecondary,
              backgroundColor: theme.colors.canvas,
            }]}>{item.label}</Text>
          </View>
        );
      }
      if (item.type === 'run') {
        return (
          <ThreadRunTimelineItem
            run={item.run}
            copy={copy}
            onOpenSession={onOpenRunSession}
            onOpenResult={setSelectedRun}
            onOpenLogs={onOpenRunLogs}
          />
        );
      }
      return (
        <ThreadMessageTimelineItem
          message={item.message}
          capabilities={capabilities}
          copy={copy}
          status={messageStatuses.get(item.message.id) ?? null}
          animateEntrance={entranceIds.has(item.message.id)}
          onOpenTool={openTool}
          onOpenAttachments={onOpenAttachments}
          onLongPress={messageActions ? handleMessageLongPress : undefined}
          queuedTapOpensActions={Boolean(messageActions && queuedMessageActions)}
          favorited={favoriteMessageIds?.has(item.message.id) ?? false}
          onResolveApproval={onResolveApproval}
        />
      );
    },
    [
      theme.colors,
      capabilities,
      expandedTools,
      copy,
      entranceIds,
      favoriteMessageIds,
      handleMessageLongPress,
      messageActions,
      messageStatuses,
      openTool,
      queuedMessageActions,
      onOpenAttachments,
      onOpenRunLogs,
      onOpenRunSession,
      onResolveApproval,
    ],
  );

  return (
    <ChatPresentationProvider value={presentation}>
    <ThreadLiveActivityContext.Provider value={liveActivity}>
    <KeyboardAvoidingView
      testID={testID}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // The keyboard already covers the home-indicator inset; retain only the control gap.
      keyboardVerticalOffset={Platform.OS === 'ios' ? Space.md - Math.max(bottomInset, Space.lg) : 0}
      style={[styles.screen, { backgroundColor: theme.colors.canvas }]}
    >
      <View style={styles.screen}>
      <View style={styles.screen} pointerEvents={composerExpanded ? 'none' : 'auto'}
        accessibilityElementsHidden={composerExpanded} importantForAccessibility={composerExpanded ? 'no-hide-descendants' : 'auto'}>
      <View
        pointerEvents="box-none"
        style={[styles.header, { paddingTop: topInset + Space.sm }]}
      >
        <FloatingButton
          testID={`${testID}-back`}
          icon={ChevronLeft}
          accessibilityLabel={copy.back}
          onPress={onBack}
        />
        <View style={styles.headerPillSlot}>
          <HeaderPill
            testID={`${testID}-header-pill`}
            agentId={agentId}
            name={headerName}
            avatarName={agentName}
            subtitle={headerWorking ? '' : runContext ? `${agentName} · ${runContext.statusLabel}` : headerSubtitle}
            working={headerWorking}
            icon={runContext ? runContext.kind === 'cron' ? CalendarClock : Bot : undefined}
            emoji={agentEmoji}
            avatarUrl={agentAvatarUrl}
            status={avatarStatus}
            accessibilityLabel={copy.settings}
            onPress={!locked ? onOpenSettings : undefined}
          />
        </View>
        {canOpenSessions ? <FloatingButton
          testID={`${testID}-sessions`}
          icon={MessagesSquare}
          appearance="plain"
          accessibilityLabel={copy.openSessions}
          onPress={() => onOpenSessionPanel?.()}
          disabled={locked}
        /> : <View style={{ width: ControlSize.floatingButton }} pointerEvents="none" />}
      </View>

      {state.kind === 'offline' ? (
        <Banner
          testID={`${testID}-offline`}
          icon={WifiOff}
          message={copy.offline}
          actionLabel={onRetry ? copy.reconnect : undefined}
          onAction={onRetry}
          style={styles.banner}
        />
      ) : null}

      {state.kind === 'error' ? (
        <Banner
          testID={`${testID}-error`}
          icon={CircleAlert}
          tone="bad"
          message={state.message}
          actionLabel={onErrorAction ? (state.actionLabel ?? copy.retry) : undefined}
          onAction={onErrorAction ? () => onErrorAction(state) : undefined}
          style={styles.banner}
        />
      ) : null}

      <View style={styles.timeline}>
        <ChatBackgroundLayer appearance={chatAppearance} />
        <Animated.View
          key={`thread-session:${sessionKey ?? 'unscoped'}`}
          testID={`${testID}-session-content`}
          collapsable={false}
          entering={sessionChanged && !reduceMotion ? SESSION_CONTENT_FADE_IN : undefined}
          exiting={reduceMotion ? undefined : SESSION_CONTENT_FADE_OUT}
          style={styles.sessionContent}
        >
          {(state.kind === 'loading' || (state.kind === 'reconnecting' && messages.length === 0)) ? (
            <View style={[styles.centeredState, { paddingTop: timelineClearance }]}><LoadingState testID="thread-history-loading" message={state.kind === 'reconnecting' ? t('Reconnecting…') : connectingLabel ?? copy.loadingHistory} pose={connectingLabel ? 'connecting' : 'loading'} /></View>
          ) : messages.length === 0 && (state.kind === 'error' || state.kind === 'offline') ? (
            <View testID="thread-connection-unavailable" style={[styles.centeredState, { paddingTop: timelineClearance }]}><View style={{ alignSelf: 'center' }}><Companion pose="error" /></View></View>
          ) : state.kind === 'locked' ? (
            <View
              testID={`${testID}-locked`}
              style={[styles.centeredState, { paddingTop: timelineClearance }]}
            >
              <Banner
                icon={CircleAlert}
                message={copy.locked}
                actionLabel={onOpenPaywall ? copy.viewPro : undefined}
                onAction={onOpenPaywall}
              />
            </View>
          ) : state.kind === 'empty' && runContext ? (
            <RunResult summary={runContext.summary} statusLabel={runContext.statusLabel} />
          ) : state.kind === 'empty' ? (
            <View
              testID={`${testID}-empty`}
              style={[styles.centeredState, { paddingTop: timelineClearance }]}
            >
              <SystemEventRow
                icon={MessageCircle}
                label={copy.formatEmpty(agentName)}
              />
            </View>
          ) : (
            <FlashList
              ref={timelineRef}
              testID={`${testID}-timeline`}
              data={timelineItems}
              maintainVisibleContentPosition={{
                startRenderingFromBottom: true,
              }}
              onScrollBeginDrag={() => {
                returningToBottomRef.current = false;
                readerScrollingRef.current = true;
                followNewMessagesRef.current = false;
              }}
              onScroll={updateScrollPosition}
              scrollEventThrottle={16}
              onMomentumScrollEnd={finishScroll}
              onContentSizeChange={(_width, height) => {
                scrollMetricsRef.current.height = height;
                if (followNewMessagesRef.current) timelineRef.current?.scrollToEnd({ animated: false });
                else refreshScrollButton();
              }}
              onLayout={(event) => {
                scrollMetricsRef.current.viewport = event.nativeEvent.layout.height;
                if (!composerExpanded && followNewMessagesRef.current) timelineRef.current?.scrollToEnd({ animated: false });
                else refreshScrollButton();
              }}
              onScrollEndDrag={updateScrollPosition}
              getItemType={(item) => item.type}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              keyExtractor={(item) => item.key}
              renderItem={renderMessage}
              contentContainerStyle={[
                styles.timelineContent,
                { paddingBottom: timelineClearance },
              ]}
              onStartReached={onLoadMoreHistory}
              onStartReachedThreshold={0.3}
              ListFooterComponent={compactionNotice ? (
                <View testID={`${testID}-compaction`} style={stylesStatic.timelineItem}>
                  <SystemEventRow icon={Info} label={compactionNotice} />
                </View>
              ) : null}
              ListHeaderComponent={sessionPreview?.hasHiddenHistory ? <SessionPreviewNotice onUpgrade={sessionPreview.onUpgrade} /> : loadingMoreHistory ? (
                <Skeleton
                  testID={`${testID}-history-more`}
                  accessibilityLabel={copy.loadingHistory}
                  style={styles.historyMore}
                />
              ) : null}
            />
          )}
        </Animated.View>
        {timelineItems.length > 0 && !locked ? (
          <Animated.View
            testID={`${testID}-scroll-to-bottom-container`}
            pointerEvents={showScrollToBottom ? 'auto' : 'none'}
            accessibilityElementsHidden={!showScrollToBottom}
            importantForAccessibility={showScrollToBottom ? 'auto' : 'no-hide-descendants'}
            style={[styles.scrollToBottom, scrollButtonStyle]}
          >
            <FloatingButton
              testID={`${testID}-scroll-to-bottom`}
              icon={ArrowDown}
              appearance="surface"
              accessibilityLabel={t('Scroll to bottom', { ns: 'chat' })}
              onPress={scrollToBottom}
            />
          </Animated.View>
        ) : null}
      </View>

      {sendFailure ? <Banner
        testID={`${testID}-send-error`}
        icon={CircleAlert}
        tone="bad"
        message={sendFailure}
        actionLabel={sendFailureDetails ? t('Details', { ns: 'chat' }) : copy.close}
        onAction={sendFailureDetails ? () => setShowFailureDetails(true) : onDismissSendFailure}
        style={styles.banner}
      /> : null}

      </View>
      <View testID={`${testID}-composer-placeholder`} collapsable={false}
        style={{ height: composerExpanded ? compactComposerHeight.current : 0 }} />

      {sessionPreview ? <SessionPreviewFooter onUpgrade={sessionPreview.onUpgrade}
        onMain={sessionPreview.onMain} bottomInset={bottomInset} loading={sessionPreview.loading} /> : null}
      {!locked && !sessionPreview && capabilities.chat && runContext?.kind !== 'cron' ? (
        <View
          collapsable={false}
          testID={`${testID}-composer-region`}
          onLayout={({ nativeEvent }) => {
            if (!composerExpanded) compactComposerHeight.current = nativeEvent.layout.height;
          }}
          accessibilityViewIsModal={composerExpanded}
          style={[styles.composerRegion, { paddingBottom: Math.max(bottomInset, Space.lg) },
            composerExpanded ? [styles.expandedComposerRegion, { paddingTop: topInset }] : null]}
        >
          {showSlashSuggestions && onSelectSlashCommand ? (
            <View style={styles.slashSuggestions}>
              <Pressable
                testID={`${testID}-dismiss-slash-suggestions`}
                accessible={false}
                onPress={onDismissSlashSuggestions}
                style={StyleSheet.absoluteFill}
              />
              <SlashSuggestions
                visible
                inputValue={input}
                suggestions={slashSuggestions}
                maxHeight={ControlSize.rosterRow * 3}
                onSelect={onSelectSlashCommand}
              />
            </View>
          ) : null}
          <Composer
            ref={composerRef}
            attachments={pendingAttachments.length > 0
            && onOpenPendingAttachment
            && onRemovePendingAttachment
            && onPickImage
            && onTakePhoto ? (
              <PendingImageBar
                images={pendingAttachments}
                canAddMore={canAddMoreAttachments}
                attachDisabled={offline}
                onOpenPreview={onOpenPendingAttachment}
                onRemove={onRemovePendingAttachment}
                onPickImage={onPickImage}
                onTakePhoto={onTakePhoto}
                onChooseFile={onChooseFile}
              />
            ) : null}
            notice={composerExpanded && (offline || state.kind === 'error') ? (
              <Banner tone="neutral" icon={WifiOff} message={copy.offline}
                actionLabel={onRetry ? copy.reconnect : undefined} onAction={onRetry} />
            ) : undefined}
            testID={`${testID}-composer`}
            accessory={capabilities.models ? (
              <View style={styles.composerOptions}>
                {onOpenModelPicker ? <Pressable testID="thread-model-picker" accessibilityRole="button"
                  onPress={onOpenModelPicker} style={styles.modelOption}>
                  <ModelIcon compact id={model} testID="thread-model-icon" />
                  <Text numberOfLines={1} style={styles.thinkingText}>{model?.replace(/^[^/]+\//, '') || copy.chooseModel}</Text>
                </Pressable> : null}
                {thinkingLevel && onSelectThinkingLevel ? <ThinkingLevelMenu current={thinkingLevel}
                  onSelect={onSelectThinkingLevel} options={thinkingLevelOptions} style={styles.thinkingMenu}>
                  <View testID={`${testID}-thinking-level`} style={styles.thinkingChip}>
                    <Brain size={16} color={theme.colors.inkSecondary} strokeWidth={1.75} />
                    <Text style={styles.thinkingText}>{copy.formatThinkingLevel(thinkingLevel)}</Text>
                  </View>
                </ThinkingLevelMenu> : null}
              </View>
            ) : undefined}
            value={input}
            placeholder={composerPlaceholder}
            accessibilityLabels={{
              add: copy.add,
              voice: copy.voice,
              stopVoice: copy.stopVoice,
              send: copy.send,
              stop: copy.stop,
              queue: copy.queueSend,
            }}
            onChangeText={onChangeInput}
            onSend={() => { onSend(); setComposerExpanded(false); }}
            onStop={canCancel ? onCancel : undefined}
            onAddPress={canOpenAddMenu ? onOpenAddMenu : undefined}
            onVoicePress={canUseVoice ? onVoice : undefined}
            voiceState={canUseVoice ? voiceState : 'idle'}
            voiceLevel={voiceLevel}
            onPasteFiles={capabilities.attachments ? onPasteFiles : undefined}
            onPasteFailed={capabilities.attachments ? onPasteFailed : undefined}
            canSend={!offline && state.kind !== 'reconnecting' && canSend}
            hasAttachments={pendingAttachments.length > 0}
            isRunning={isRunning}
            expanded={composerExpanded}
            onExpandedChange={setComposerExpanded}
            editable
            style={styles.composer}
          />
        </View>
      ) : null}
      </View>
      <ReplyFailureSheet visible={showFailureDetails && Boolean(sendFailureDetails)}
        summary={sendFailure ?? ''} details={sendFailureDetails ?? ''}
        onClose={() => setShowFailureDetails(false)} onDismiss={() => { setShowFailureDetails(false); onDismissSendFailure?.(); }} />
      <Sheet closeAccessibilityLabel={t('Close')} visible={Boolean(selectedRun)} onClose={() => setSelectedRun(null)}
        title={selectedRun?.title ?? ''} maxHeight="70%" testID="thread-run-result">
        {selectedRun ? <RunResult summary={selectedRun.summary} statusLabel={copy.formatRunDetail(selectedRun.statusLabel, selectedRun.timeLabel)} /> : null}
      </Sheet>
      <ToolDetailModal
        visible={Boolean(selectedToolMessage)}
        onClose={() => setSelectedToolMessageId(null)}
        name={selectedToolMessage?.toolName?.trim() || copy.tool}
        status={selectedToolMessage?.toolStatus ?? 'success'}
        args={selectedToolMessage?.toolArgs}
        detail={selectedToolMessage?.toolDetail}
        durationMs={selectedToolMessage?.toolDurationMs}
        startedAtMs={selectedToolMessage?.toolStartedAt}
        finishedAtMs={selectedToolMessage?.toolFinishedAt}
        usage={selectedToolMessage?.usage}
      />
      {messageActions ? (
        <ThreadMessageActionsOverlay
          selection={messageSelection}
          message={selectedActionMessage}
          favorited={selectedActionMessage ? favoriteMessageIds?.has(selectedActionMessage.id) ?? false : false}
          topInset={topInset}
          bottomInset={bottomInset}
          contentInset={THREAD_ROW_INSET}
          renderMessage={renderSelectedMessage}
          onCopy={messageActions.onCopy}
          onToggleFavorite={messageActions.onToggleFavorite}
          onShare={messageActions.onShare}
          queuedActions={selectedActionMessage?.delivery && queuedMessageActions ? {
            canSendNow: queuedMessageActions.canSendNow && selectedActionMessage.delivery !== 'sending',
            editable: selectedActionMessage.delivery !== 'sending',
            onSendNow: queuedMessageActions.onSendNow,
            onEdit: queuedMessageActions.onEdit,
            onRemove: queuedMessageActions.onRemove,
          } : undefined}
          onClosed={clearMessageSelection}
        />
      ) : null}
    </KeyboardAvoidingView>
    </ThreadLiveActivityContext.Provider>
    </ChatPresentationProvider>
  );
}

function ThreadRunTimelineItem({
  run,
  copy,
  onOpenSession,
  onOpenResult,
  onOpenLogs,
}: Readonly<{
  run: ThreadRunCard;
  copy: ThreadCopy;
  onOpenSession?: ThreadViewProps['onOpenRunSession'];
  onOpenResult: (run: ThreadRunCard) => void;
  onOpenLogs?: ThreadViewProps['onOpenRunLogs'];
}>): React.JSX.Element {
  const sessionKey = run.sessionKey;
  const jobId = run.jobId;
  const openSession = onOpenSession && sessionKey
    ? () => onOpenSession(sessionKey, run.agentId, run.kind, { title: run.title, kind: run.kind, statusLabel: run.statusLabel, summary: run.summary })
    : undefined;
  const openLogs = run.canOpenLogs && onOpenLogs && jobId
    ? () => onOpenLogs(jobId, run.agentId)
    : undefined;
  return (
    <View style={stylesStatic.timelineItem}>
      <RunCard
        testID={`thread-${run.kind}-run-${run.id}`}
        title={run.title}
        icon={run.kind === 'cron' ? CalendarClock : Bot}
        statusLabel={run.statusLabel}
        statusTone={run.status === 'failed' ? 'bad' : undefined}
        detail={run.timeLabel}
        tone={run.status === 'failed'
          ? 'bad'
          : run.status === 'tool_calling'
            || run.status === 'streaming'
            || run.status === 'skipped'
            ? 'warn'
            : 'accent'}
        onPress={openSession ?? (() => onOpenResult(run))}
        accessibilityLabel={`${run.title}, ${copy.formatRunDetail(run.statusLabel, run.timeLabel)}`}
        trailing={openLogs ? (
          <View testID={`thread-${run.kind}-logs-${run.id}`}>
            <HeaderTextAction label={copy.logs} onPress={openLogs} />
          </View>
        ) : undefined}
      />
    </View>
  );
}

type ThreadMessageTimelineItemProps = Readonly<{
  message: UiMessage;
  capabilities: Capabilities;
  copy: ThreadCopy;
  /** Delivery glyph for the user's own settled messages. */
  status: UserMessageStatus | null;
  /** Plays the row's entrance once; latched per message id inside the row. */
  animateEntrance: boolean;
  onOpenTool: (message: UiMessage) => void;
  onOpenAttachments?: (message: UiMessage) => void;
  onLongPress?: (
    message: UiMessage,
    anchor: MessageAnchorFrame | null,
    remeasure: MessageAnchorRemeasure,
  ) => void;
  favorited: boolean;
  /** A queued bubble opens its actions on a plain tap as well. */
  queuedTapOpensActions?: boolean;
  onResolveApproval?: ThreadViewProps['onResolveApproval'];
}>;

function statusCopy(status: UserMessageStatus | null, copy: ThreadCopy): string {
  if (status === 'uncertain') return copy.uncertain ?? '';
  if (status === 'sending') return copy.sending ?? '';
  if (status === 'sent') return copy.sent ?? '';
  if (status === 'delivered') return copy.delivered ?? '';
  return '';
}

/**
 * Memoized so streaming re-renders touch only the rows whose message object
 * changed; history rows keep their identity across chunks.
 */
const ThreadMessageTimelineItem = React.memo(function ThreadMessageTimelineItem({
  message,
  capabilities,
  copy,
  status,
  animateEntrance,
  onOpenTool,
  onOpenAttachments,
  onLongPress,
  favorited,
  queuedTapOpensActions = false,
  onResolveApproval,
}: ThreadMessageTimelineItemProps): React.JSX.Element | null {
  const rowRef = useRef<View>(null);
  // FlashList may reuse this row for another message; a stale measurement
  // closure must notice and report nothing rather than the wrong frame.
  const messageIdRef = useRef(message.id);
  messageIdRef.current = message.id;
  const measureRow = useCallback((
    expectedId: string,
    callback: (frame: MessageAnchorFrame | null) => void,
  ) => {
    const node = rowRef.current;
    if (!node || messageIdRef.current !== expectedId) {
      callback(null);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      const frame = { x, y, width, height };
      callback(isUsableAnchor(frame) ? frame : null);
    });
  }, []);
  const handleLongPress = useCallback(() => {
    if (!onLongPress) return;
    const expectedId = message.id;
    triggerLightImpact();
    const remeasure: MessageAnchorRemeasure = (callback) => measureRow(expectedId, callback);
    remeasure((anchor) => onLongPress(message, anchor, remeasure));
  }, [measureRow, message, onLongPress]);

  let content: React.ReactNode;
  if (message.approval) {
    const supported = message.approval.kind === 'pair'
      ? capabilities.pairRequests
      : capabilities.execApproval;
    if (!supported) return null;
    content = (
      <ThreadApprovalTimelineItem
        messageId={message.id}
        approval={message.approval}
        copy={copy}
        onResolveApproval={onResolveApproval}
      />
    );
  } else if (message.role === 'tool') {
    content = (
      <View style={stylesStatic.timelineItem}>
        <ToolCallRow message={message} onPress={() => onOpenTool(message)} />
      </View>
    );
  } else if (message.role === 'system') {
    content = (
      <View style={stylesStatic.timelineItem}>
        <SystemEventRow icon={Info} label={message.text} />
      </View>
    );
  } else if (message.role === 'assistant' || message.role === 'user') {
    // A reply that has no text yet offers nothing to copy, favorite or share.
    const actionable = Boolean(onLongPress)
      && !(message.role === 'assistant' && message.streaming === true && message.text.trim().length === 0);
    const queuedTap = Boolean(message.delivery) && queuedTapOpensActions && actionable;
    const spokenState = message.delivery ? deliveryLabel(message.delivery, copy) : statusCopy(status, copy);
    content = (
      <Pressable
        ref={rowRef}
        testID={`thread-message-${message.id}`}
        accessibilityRole={actionable ? 'button' : undefined}
        accessibilityLabel={[message.text, spokenState].filter(Boolean).join(' · ') || undefined}
        accessibilityActions={actionable ? MESSAGE_ROW_ACCESSIBILITY_ACTIONS : undefined}
        onAccessibilityAction={actionable ? (event) => {
          if (event.nativeEvent.actionName === 'longpress') handleLongPress();
        } : undefined}
        delayLongPress={220}
        onPress={queuedTap ? handleLongPress : undefined}
        onLongPress={actionable ? handleLongPress : undefined}
        style={[stylesStatic.timelineItem, stylesStatic.chatMessageSpacing]}
      >
        <ThreadMessageRowContent
          message={message}
          copy={copy}
          favorited={favorited}
          status={status}
          onOpenAttachments={onOpenAttachments}
        />
      </Pressable>
    );
  } else {
    return null;
  }

  return (
    <MessageEntrance
      testID={`thread-entrance-${message.id}`}
      animationKey={message.id}
      animate={animateEntrance}
      motion={message.role === 'user' ? 'sent' : 'reply'}
    >
      {content}
    </MessageEntrance>
  );
});

/**
 * Message block shared by the timeline row and the long-press overlay clone.
 * The clone drops identity chrome so only the message itself is lifted; the
 * overlay bottom-aligns it to the measured row, so geometry must stay identical.
 */
function ThreadMessageRowContent({
  message,
  copy,
  favorited,
  status = null,
  showIdentity = true,
  onOpenAttachments,
}: Readonly<{
  message: UiMessage;
  copy: ThreadCopy;
  favorited: boolean;
  status?: UserMessageStatus | null;
  showIdentity?: boolean;
  onOpenAttachments?: (message: UiMessage) => void;
}>): React.JSX.Element | null {
  if (message.role !== 'assistant' && message.role !== 'user') return null;
  const attachmentCount = message.imageUris?.length ?? 0;
  const fileAttachments = message.fileAttachments ?? [];
  // A reply that has produced no text yet still owns its bubble.
  const hasBubble = Boolean(message.text) || (message.role === 'assistant' && message.streaming === true);
  return (
    <QueuedDeliveryFrame delivery={message.delivery} messageId={message.id}>
      {hasBubble ? (
        message.role === 'assistant' ? (
          <AssistantBubble message={message} showIdentity={showIdentity} />
        ) : (
          <UserBubble message={message} status={status} copy={copy} />
        )
      ) : null}
      {fileAttachments.map((file, index) => (
        <SystemEventRow
          key={`${file.uri ?? file.fileName ?? file.mimeType}:${index}`}
          testID={`thread-file-${message.id}-${index}`}
          icon={Paperclip}
          label={file.fileName?.trim() || copy.file}
          style={message.role === 'user' ? stylesStatic.fileAttachmentUser : undefined}
        />
      ))}
      {attachmentCount > 0 ? (
        <ThreadAttachmentGallery
          message={message}
          label={copy.formatAttachments(attachmentCount)}
          onPress={onOpenAttachments ? () => onOpenAttachments(message) : undefined}
        />
      ) : null}
      {!hasBubble && message.role === 'user' && !message.delivery ? (
        <UserMessageMeta message={message} status={status} copy={copy} />
      ) : null}
      {favorited ? (
        <FavoriteIndicator messageId={message.id} role={message.role} />
      ) : null}
      {message.delivery ? (
        <QueuedDeliveryCaption delivery={message.delivery} messageId={message.id} copy={copy} />
      ) : null}
    </QueuedDeliveryFrame>
  );
}

/** Clock label for a settled message; queued and streaming rows are untimed. */
function useMessageClock(message: UiMessage): string {
  const { locale } = useChatPresentation();
  if (message.streaming || message.delivery) return '';
  return formatThreadClockTime(message.timestampMs, locale);
}

/**
 * The user's bubble carries its time and delivery glyph inside the bubble,
 * Telegram style: an invisible tail on the last line reserves the space and
 * the meta is overlaid on it, so it wraps to its own line only when needed.
 */
function UserBubble({
  message,
  status,
  copy,
}: Readonly<{ message: UiMessage; status: UserMessageStatus | null; copy: ThreadCopy }>): React.JSX.Element {
  const typography = useBubbleTypography();
  const time = useMessageClock(message);
  const hasMeta = Boolean(time) || Boolean(status);
  return (
    <Bubble testID={`thread-bubble-${message.id}`} role="user">
      <View style={stylesStatic.userBody}>
        <Text selectable style={typography}>
          {message.text}
          {hasMeta ? <Text style={stylesStatic.metaSpacer}>{messageMetaSpacer(time, Boolean(status))}</Text> : null}
        </Text>
        {hasMeta ? (
          <MessageMeta
            testID={`thread-meta-${message.id}`}
            time={time}
            status={status}
            statusLabel={statusCopy(status, copy)}
            style={stylesStatic.metaOverlay}
          />
        ) : null}
      </View>
    </Bubble>
  );
}

/** Meta row under an attachment-only user message, which has no bubble to hold it. */
function UserMessageMeta({
  message,
  status,
  copy,
}: Readonly<{ message: UiMessage; status: UserMessageStatus | null; copy: ThreadCopy }>): React.JSX.Element | null {
  const time = useMessageClock(message);
  if (!time && !status) return null;
  return (
    <MessageMeta
      testID={`thread-meta-${message.id}`}
      time={time}
      status={status}
      statusLabel={statusCopy(status, copy)}
      style={stylesStatic.metaRowUser}
    />
  );
}

const QUEUED_BUBBLE_OPACITY = 0.72;

/**
 * Wraps a user message that is still in the local queue. The dim settles to
 * full opacity in place once the same bubble is adopted by history, so a
 * delivered message never jumps or remounts.
 */
function QueuedDeliveryFrame({
  delivery,
  messageId,
  children,
}: Readonly<{
  delivery: UiMessage['delivery'];
  messageId: string;
  children: React.ReactNode;
}>): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const target = delivery ? QUEUED_BUBBLE_OPACITY : 1;
  const opacity = useSharedValue(target);
  useEffect(() => {
    opacity.value = reduceMotion ? target : withTiming(target, { duration: Motion.duration.normal });
  }, [opacity, reduceMotion, target]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View testID={`thread-delivery-${messageId}`} style={[stylesStatic.deliveryFrame, style]}>
      {children}
    </Animated.View>
  );
}

function deliveryLabel(delivery: NonNullable<UiMessage['delivery']>, copy: ThreadCopy): string {
  if (delivery === 'held') return copy.paused ?? '';
  if (delivery === 'sending') return copy.sending ?? '';
  return copy.queued ?? '';
}

function QueuedDeliveryCaption({
  delivery,
  messageId,
  copy,
}: Readonly<{
  delivery: NonNullable<UiMessage['delivery']>;
  messageId: string;
  copy: ThreadCopy;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const Icon = delivery === 'held' ? Pause : Clock;
  const label = deliveryLabel(delivery, copy);
  return (
    <View testID={`thread-delivery-caption-${messageId}`} style={stylesStatic.deliveryCaption}>
      <Icon size={SYSTEM_EVENT_ICON_SIZE} color={theme.colors.inkTertiary} strokeWidth={SYSTEM_EVENT_STROKE_WIDTH} />
      <Text style={[stylesStatic.deliveryCaptionText, { color: theme.colors.inkTertiary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function ThreadAttachmentGallery({
  message,
  label,
  onPress,
}: Readonly<{
  message: UiMessage;
  label: string;
  onPress?: () => void;
}>): React.JSX.Element | null {
  const uris = message.imageUris ?? [];
  if (uris.length === 0) return null;
  return (
    <Pressable
      testID={`thread-attachments-${message.id}`}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        stylesStatic.attachmentGallery,
        message.role === 'user' ? stylesStatic.attachmentGalleryUser : null,
      ]}
    >
      {uris.slice(0, 3).map((uri, index) => (
        <Image
          key={`${uri}:${index}`}
          source={{ uri }}
          resizeMode="cover"
          style={stylesStatic.attachmentImage}
        />
      ))}
      {uris.length > 3 ? <SystemEventRow icon={Paperclip} label={label} /> : null}
    </Pressable>
  );
}

function FavoriteIndicator({
  messageId,
  role,
}: Readonly<{
  messageId: string;
  role: UiMessage['role'];
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  return (
    <View
      style={[
        stylesStatic.favoriteIndicator,
        role === 'user' ? stylesStatic.favoriteIndicatorUser : null,
      ]}
    >
      <Star
        testID={`thread-favorite-${messageId}`}
        size={FontSize.caption}
        color={theme.colors.accent}
        fill={theme.colors.accent}
        strokeWidth={2}
      />
    </View>
  );
}

function ThreadApprovalTimelineItem({
  messageId,
  approval,
  copy,
  onResolveApproval,
}: Readonly<{
  messageId: string;
  approval: NonNullable<UiMessage['approval']>;
  copy: ThreadCopy;
  onResolveApproval?: ThreadViewProps['onResolveApproval'];
}>): React.JSX.Element {
  if (approval.kind === 'pair') {
    const title = approval.displayName?.trim()
      || approval.platform?.trim()
      || (approval.target === 'node' ? copy.node : copy.device);
    const resolved = approval.status !== 'pending';
    const detail = approval.status === 'allowed'
      ? copy.allowed
      : approval.status === 'denied'
        ? copy.denied
        : approval.status === 'expired'
          ? copy.expired
          : approval.resolutionError
            ? copy.approvalError
            : undefined;
    return (
      <View style={stylesStatic.timelineItem}>
        <ApprovalCard
          testID={`thread-approval-${messageId}`}
          title={title}
          detail={detail}
          tone={approval.resolutionError ? 'bad' : undefined}
          expired={resolved}
          primaryAction={{
            label: copy.allow,
            onPress: () => onResolveApproval?.(approval.id, 'approve', approval.target),
            disabled: !onResolveApproval || approval.resolving === true,
            accessibilityLabel: copy.allow,
          }}
          secondaryAction={{
            label: copy.reject,
            onPress: () => onResolveApproval?.(approval.id, 'reject', approval.target),
            disabled: !onResolveApproval || approval.resolving === true,
            accessibilityLabel: copy.reject,
          }}
        />
      </View>
    );
  }

  return (
    <ThreadExecApprovalTimelineItem
      messageId={messageId}
      approval={approval}
      copy={copy}
      onResolveApproval={onResolveApproval}
    />
  );
}

function ThreadExecApprovalTimelineItem({
  messageId,
  approval,
  copy,
  onResolveApproval,
}: Readonly<{
  messageId: string;
  approval: Exclude<NonNullable<UiMessage['approval']>, { kind: 'pair' }>;
  copy: ThreadCopy;
  onResolveApproval?: ThreadViewProps['onResolveApproval'];
}>): React.JSX.Element {
  const [deadlineExpired, setDeadlineExpired] = useState(
    () => approval.status === 'pending' && approval.expiresAtMs <= Date.now(),
  );

  useEffect(() => {
    if (approval.status !== 'pending') {
      setDeadlineExpired(false);
      return;
    }
    const remaining = approval.expiresAtMs - Date.now();
    if (remaining <= 0) {
      setDeadlineExpired(true);
      return;
    }
    setDeadlineExpired(false);
    const timer = setTimeout(() => setDeadlineExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [approval.expiresAtMs, approval.status]);

  const resolved = approval.status !== 'pending' || deadlineExpired;
  const detail = approval.status === 'allowed'
    ? copy.allowed
    : approval.status === 'denied'
      ? copy.denied
      : resolved
        ? copy.expired
        : undefined;

  return (
    <View style={stylesStatic.timelineItem}>
      <ApprovalCard
        testID={`thread-approval-${messageId}`}
        title={copy.approvalTitle}
        command={approval.command}
        detail={detail}
        expired={resolved}
        primaryAction={{
          label: copy.allow,
          onPress: () => onResolveApproval?.(approval.id, 'allow-once'),
          onLongPress: () => onResolveApproval?.(approval.id, 'allow-always'),
          disabled: !onResolveApproval,
          accessibilityLabel: copy.allow,
        }}
        secondaryAction={{
          label: copy.reject,
          onPress: () => onResolveApproval?.(approval.id, 'deny'),
          disabled: !onResolveApproval,
          accessibilityLabel: copy.reject,
        }}
      />
    </View>
  );
}

function AssistantBubble({
  message,
  showIdentity = true,
}: {
  message: UiMessage;
  showIdentity?: boolean;
}): React.JSX.Element {
  const theme = useConversationTheme();
  const { fontSize, identity } = useChatPresentation();
  const reduceMotion = useReducedMotion();
  const liveActivity = useContext(ThreadLiveActivityContext);
  const time = useMessageClock(message);
  const thinking = message.streaming === true && message.text.trim().length === 0;
  // The reply text fades in only when it replaces the thinking state in this
  // very row; rows that mount with text (history, recycled cells) stay still.
  const revealRef = useRef({ id: message.id, thinking, reveal: false });
  if (revealRef.current.id !== message.id) {
    revealRef.current = { id: message.id, thinking, reveal: false };
  } else if (revealRef.current.thinking && !thinking) {
    revealRef.current = { id: message.id, thinking, reveal: true };
  } else {
    revealRef.current.thinking = thinking;
  }
  const cursorOpacity = useSharedValue(1);
  const cursorStyle = useAnimatedStyle(() => ({ opacity: cursorOpacity.value }));
  const markdownStyle = useMemo(
    () => createChatMarkdownStyle(theme.colors, fontSize),
    [theme.colors, fontSize],
  );

  useEffect(() => {
    cancelAnimation(cursorOpacity);
    if (!message.streaming || reduceMotion) {
      cursorOpacity.value = 1;
      return () => cancelAnimation(cursorOpacity);
    }
    cursorOpacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: Motion.duration.slow }),
        withTiming(1, { duration: Motion.duration.slow }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(cursorOpacity);
  }, [cursorOpacity, message.streaming, reduceMotion]);

  return (
    <View>
    {identity && showIdentity ? <ChatMessageIdentity {...identity} /> : null}
    <Bubble
      testID={`thread-bubble-${message.id}`}
      role="assistant"
      style={thinking ? stylesStatic.thinkingBubble : undefined}
    >
      {thinking ? (
        <ThinkingIndicator testID={`thread-thinking-${message.id}`} label={liveActivity} />
      ) : (
        <Animated.View entering={revealRef.current.reveal && !reduceMotion ? REPLY_TEXT_FADE_IN : undefined}>
          <EnrichedMarkdownText
            testID={`thread-markdown-${message.id}`}
            flavor={THREAD_MARKDOWN_FLAVOR}
            markdown={message.text}
            markdownStyle={markdownStyle}
            onLinkPress={openChatMarkdownLink}
            selectable
            streamingAnimation={message.streaming === true}
          />
          {message.streaming ? (
            <Animated.Text
              testID={`thread-stream-cursor-${message.id}`}
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={[
                stylesStatic.streamingCursor,
                { color: theme.colors.ink },
                cursorStyle,
              ]}
            >
              {'▍'}
            </Animated.Text>
          ) : time ? (
            <MessageMeta testID={`thread-meta-${message.id}`} time={time} style={stylesStatic.metaRowAssistant} />
          ) : null}
        </Animated.View>
      )}
    </Bubble>
    </View>
  );
}

// Horizontal padding of every timeline row; the message actions overlay uses
// it to align the menu with the bubble edge.
const THREAD_ROW_INSET = Space.lg;
// Lets assistive technology reach the message actions without a physical long press.
const MESSAGE_ROW_ACCESSIBILITY_ACTIONS = [{ name: 'longpress' as const }];

const stylesStatic = StyleSheet.create({
  timeSeparator: { alignItems: 'center', paddingVertical: Space.md },
  timeSeparatorBreak: { paddingTop: Space.xxl, marginTop: Space.sm },
  chatMessageSpacing: { paddingTop: Space.lg, paddingBottom: Space.md },
  timeLabel: {
    fontSize: FontSize.caption, lineHeight: LineHeight.caption,
    paddingHorizontal: Space.sm, paddingVertical: Space.xs, borderRadius: Radius.full,
    overflow: 'hidden', textAlign: 'center',
  },
  streamingCursor: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.regular,
  },
  timelineItem: {
    paddingHorizontal: THREAD_ROW_INSET,
    paddingVertical: Space.xs,
    gap: Space.xs,
  },
  attachmentGallery: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: Space.xs,
  },
  attachmentGalleryUser: {
    alignSelf: 'flex-end',
  },
  fileAttachmentUser: {
    alignSelf: 'flex-end',
  },
  attachmentImage: {
    width: ControlSize.rosterRow,
    height: ControlSize.rosterRow,
    borderRadius: Radius.card,
  },
  favoriteIndicator: {
    alignSelf: 'flex-start',
  },
  favoriteIndicatorUser: {
    alignSelf: 'flex-end',
  },
  deliveryFrame: {
    gap: Space.xs,
  },
  deliveryCaption: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.xs,
  },
  deliveryCaptionText: {
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
  },
  thinkingBubble: {
    minWidth: ControlSize.rosterRow,
  },
  userBody: {
    position: 'relative',
  },
  // Same glyphs as the visible meta, painted invisibly, so the last text line
  // leaves exactly enough room for the overlay.
  metaSpacer: {
    color: 'transparent',
    fontSize: FontSize.caption,
  },
  metaOverlay: {
    position: 'absolute',
    right: 0,
    bottom: 0,
  },
  metaRowAssistant: {
    alignSelf: 'flex-end',
    marginTop: Space.xs,
  },
  metaRowUser: {
    alignSelf: 'flex-end',
    paddingHorizontal: Space.xs,
  },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: {
      flex: 1,
    },
    header: {
      backgroundColor: colors.canvas,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      paddingHorizontal: Space.xs,
      paddingBottom: Space.sm,
    },
    headerPillSlot: {
      flex: 1,
      alignItems: 'center',
      minWidth: 0,
    },
    banner: {
      marginHorizontal: Space.lg,
      marginBottom: Space.sm,
    },
    timeline: {
      flex: 1,
      minHeight: 0,
    },
    scrollToBottom: {
      position: 'absolute',
      right: Space.lg,
      bottom: Space.md,
    },
    sessionContent: {
      ...StyleSheet.absoluteFillObject,
    },
    timelineContent: {
      paddingTop: Space.lg,
      paddingBottom: Space.md,
    },
    centeredState: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: Space.lg,
    },
    historyMore: {
      alignSelf: 'center',
      width: '24%',
      marginVertical: Space.md,
    },
    composer: {
      marginHorizontal: Space.lg,
    },
    composerRegion: {
      gap: Space.sm,
      paddingTop: Space.sm,
      backgroundColor: colors.canvas,
    },
    expandedComposerRegion: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 3,
    },
    slashSuggestions: {
      paddingHorizontal: Space.lg,
      zIndex: 2,
    },
    thinkingMenu: {
      flexShrink: 1,
    },
    thinkingChip: {
      minHeight: ControlSize.floatingButton,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      borderRadius: Radius.full,
      paddingHorizontal: Space.md,
    },
    composerOptions: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, maxWidth: '70%' },
    modelOption: { minHeight: ControlSize.floatingButton, flexDirection: 'row', alignItems: 'center', gap: Space.xs, justifyContent: 'center', paddingHorizontal: Space.xs, maxWidth: 180, flexShrink: 1 },
    thinkingText: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
  });
}
