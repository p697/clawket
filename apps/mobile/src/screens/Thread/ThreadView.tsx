import { useWorkspaceLayout } from '../../navigation/workspace-context';
import { IPAD_CHAT_MAX_WIDTH } from '../../utils/ipad-layout';
import { useReplyEntranceDelay } from '../../chat/useReplyEntranceDelay';
import { SessionPreviewNotice, SessionPreviewFooter } from './components/SessionPreviewNotice';
import { useTranslation } from 'react-i18next';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import remend from 'remend';
import type { Capabilities } from '@clawket/agent-protocol';
import {
  PanelLeft,
  ArrowDown,
  Brain,
  CalendarClock,
  Bot,
  CircleAlert,
  Info,
  MessageCircle,
  Paperclip,
  MessagesSquare,
  Star,
} from 'lucide-react-native';
import { ChevronLeft } from '../../components/ui/DirectionalIcon';
import type { PendingImage, UiMessage } from '../../types/chat';
import type { SlashCommand } from '../../data/slash-commands';
import type { ThinkingLevel } from '../../utils/gateway-settings';
import { useAppTheme } from '../../theme';
import { ChatPresentationProvider, useChatPresentation, useConversationTheme } from '../../components/chat/ChatPresentation';
import { ModelIcon } from '../../components/chat/ModelIcon';
import { ChatMessageIdentity } from '../../components/chat/ChatMessageIdentity';
import { MessageAttachmentAlbum } from '../../components/chat/MessageAttachmentAlbum';
import { MessageEntrance } from '../../components/chat/MessageEntrance';
import { MessageMeta, messageMetaSpacer } from '../../components/chat/MessageMeta';
import { ThinkingIndicator } from '../../components/chat/ThinkingIndicator';
import { ChatBackgroundLayer } from '../../components/chat/ChatBackgroundLayer';
import { ChatWallpaperScrim } from '../../components/chat/ChatWallpaperScrim';
import { isChatWallpaperActive, resolveChatChromeAppearance } from '../../features/chat-appearance/resolver';
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
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
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
import { ConnectionUnavailable, type ConnectionUnavailableProps } from '../../components/ui/ConnectionUnavailable';
import { SystemEventRow } from '../../components/ui/SystemEventRow';
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
  type ThreadRowGap,
  type ThreadRunCard,
  type ThreadTimelineRow,
  withThreadRhythm,
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
import { useThreadRunEntrance } from '../../chat/useThreadRunEntrance';
import { useSmoothedStreamText } from '../../chat/useSmoothedStreamText';

const THREAD_MARKDOWN_FLAVOR = getChatMarkdownFlavor();
// Terminates markdown syntax that is still open while tokens stream in, so a
// half-typed `**bold` or `` `code `` never flickers between literal and styled.
const STREAMING_REMEND_OPTIONS = {
  bold: true,
  italic: true,
  boldItalic: true,
  strikethrough: true,
  links: true,
  linkMode: 'text-only' as const,
  images: true,
  inlineCode: true,
  katex: false,
  setextHeadings: true,
};
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
/** Execution summaries outgrow the screen: the run sheet scrolls inside fixed detents. */
const RUN_RESULT_SNAP_POINTS: string[] = ['68%', '92%'];
const EMPTY_RUN_CARDS: ReadonlyArray<ThreadRunCard> = Object.freeze([]);

function areMessageStatusesEqual(
  left: ReadonlyMap<string, UserMessageStatus>,
  right: ReadonlyMap<string, UserMessageStatus>,
): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [id, status] of left) {
    if (right.get(id) !== status) return false;
  }
  return true;
}
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
  pairApprovalDetail: string;
  device: string;
  node: string;
  allow: string;
  reject: string;
  allowed: string;
  denied: string;
  expired: string;
  logs: string;
  /** Composer placeholder; one plain word, like a messenger. */
  placeholder: string;
  formatEmpty: (name: string) => string;
  formatAttachments: (count: number) => string;
  /** Spoken name of one photo inside a message album, e.g. “Photo 2 of 6”. */
  formatPhotoPosition: (index: number, count: number) => string;
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
  connectionFailure?: Pick<ConnectionUnavailableProps, 'name' | 'lastReadyAt' | 'onManage' | 'message'> & { scope: string };
  connectingLabel?: string;
  chatAppearance?: ChatAppearanceSettings;
  chatFontSize?: number;
  showAgentAvatar?: boolean;
  agentId: string;
  agentName: string;
  sessionKey?: string | null;
  scrollToBottomRequestAt?: number | null;
  messageSubmittedAt?: number | null;
  agentEmoji?: string | null;
  agentAvatarUrl?: string | null;
  sessionTitle?: string | null;
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
  onVoiceStart?: () => void;
  onVoiceStop?: (send: boolean) => void;
  onVoiceCancel?: () => void;
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
  ) => void;
  /** Cron cards open the execution record; the screen owns the sheet. */
  onOpenCronRun?: (run: ThreadRunCard) => void;
  onOpenRunLogs?: (jobId: string, agentId?: string) => void;
  onOpenAttachments?: (message: UiMessage, index?: number) => void;
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

/**
 * Header row geometry: the safe-area top, the control gap, the 44-point
 * control row and the gap below it. The timeline scrolls under this band, so
 * its content starts this far down; nothing is measured at runtime.
 */
export function resolveThreadHeaderHeight(topInset: number): number {
  return topInset + Space.sm + ControlSize.floatingButton + Space.sm;
}

/** Fade the timeline out under the header edge (spec: a 24-point canvas → clear gradient). */
const HEADER_FADE_HEIGHT = Space.xl;
/** Wallpaper scrim strength behind the header and the composer dock. */
const WALLPAPER_SCRIM = {
  light: { top: 0.62, bottom: 0.5 },
  dark: { top: 0.66, bottom: 0.56 },
} as const;

export function ThreadView({
  connectionFailure,
  connectingLabel,
  chatAppearance = DEFAULT_CHAT_APPEARANCE,
  chatFontSize = FontSize.body,
  showAgentAvatar = false,
  agentId,
  agentName,
  sessionKey,
  scrollToBottomRequestAt,
  messageSubmittedAt,
  agentEmoji,
  agentAvatarUrl,
  sessionTitle,
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
  runCards = EMPTY_RUN_CARDS,
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
  onVoice, onVoiceStart, onVoiceStop, onVoiceCancel,
  voiceState = 'idle',
  voiceLevel,
  onRetry,
  onOpenPaywall,
  onErrorAction,
  onLoadMoreHistory,
  onOpenRunSession,
  onOpenCronRun,
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
  const workspace = useWorkspaceLayout();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  // Immersive mode: the wallpaper fills the screen and every control floats
  // over it on glass; without a wallpaper the header keeps the canvas and the
  // white floating circles every page header uses.
  const wallpaperActive = isChatWallpaperActive(chatAppearance);
  const headerHeight = resolveThreadHeaderHeight(topInset);
  const scrimOpacity = WALLPAPER_SCRIM[theme.scheme === 'dark' ? 'dark' : 'light'];
  const timeLabelChrome = useMemo(() => (
    wallpaperActive ? { backgroundColor: resolveChatChromeAppearance(theme).backgroundColor } : { backgroundColor: theme.colors.canvas }
  ), [theme, wallpaperActive]);
  const offline = state.kind === 'offline' || state.kind === 'error';
  const [savedScope, setSavedScope] = useState<string | null>(null);
  useEffect(() => {
    if (state.kind === 'ready' || state.kind === 'empty') setSavedScope(null);
  }, [state.kind]);
  const showConnectionFailure = Boolean(connectionFailure && savedScope !== connectionFailure.scope
    && offline);

  const connectionOutage = state.kind === 'error' && ['network', 'timeout', 'server', 'bridge_offline', 'gateway_offline'].includes(state.code);
  const locked = state.kind === 'locked';
  const headerName = resolveThreadHeaderName(agentName, sessionTitle && sessionTitle === sessionKey ? t('New session') : sessionTitle, isMainSession);
  // A scheduled run's transcript is read, not continued: the header names it and the composer stays away.
  const isCronSession = Boolean(sessionKey?.includes(':cron:'));
  const replyEntrance = useReplyEntranceDelay(messages, sessionKey, messageSubmittedAt, reduceMotion);
  const presentedRunning = isRunning && !replyEntrance.holding;
  const headerSubtitle = state.kind === 'reconnecting' ? t('Reconnecting…') : resolveThreadHeaderSubtitle({
    capabilities,
    state,
    isRunning: presentedRunning,
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
  const headerWorking = presentedRunning && state.kind !== 'reconnecting';
  const canOpenSessions = capabilities.sessions && Boolean(onOpenSessionPanel);
  // The screen decides availability from the full capability set (attachments,
  // skills, commands, thinking, cron, tools); the view only needs the handler.
  const canOpenAddMenu = Boolean(onOpenAddMenu);
  const canUseVoice = Boolean(onVoice);
  const composerPlaceholder = !canUseVoice || voiceState === 'idle' ? copy.placeholder
    : voiceState === 'listening' ? copy.listening : copy.preparingVoice;
  const canCancel = capabilities.abort && Boolean(onCancel);
  const timelineClearance = Space.lg;
  const timelineTopClearance = headerHeight + Space.lg;
  const [selectedRun, setSelectedRun] = useState<ThreadRunCard | null>(null);
  const [calendarDay, setCalendarDay] = useState(() => localDayNumber(Date.now()));
  useEffect(() => {
    const timer = setInterval(() => setCalendarDay(localDayNumber(Date.now())), 60_000);
    return () => clearInterval(timer);
  }, []);
  const [expandedTools, setExpandedTools] = useState<ReadonlySet<string>>(new Set());
  const showReplyPlaceholder = presentedRunning && !locked && !sessionPreview
    && !messages.some((message) => message.id === REPLY_PLACEHOLDER_ID);
  const timelineMessages = useMemo(
    () => showReplyPlaceholder ? [REPLY_PLACEHOLDER, ...replyEntrance.messages] : replyEntrance.messages,
    [replyEntrance.messages, showReplyPlaceholder],
  );
  const { entranceIds, claimEntrance } = useThreadMessageEntrance(timelineMessages, sessionKey);
  const runEntranceKeys = useMemo(() => runCards.map((run) => `run:${run.kind}:${run.id}`), [runCards]);
  const runEntrance = useThreadRunEntrance(runEntranceKeys, sessionKey, state.kind === 'ready');
  const nextMessageStatuses = useMemo(() => resolveUserMessageStatuses({
    messages, unconfirmedIds: unconfirmedMessageIds, runAcknowledged,
  }), [messages, unconfirmedMessageIds, runAcknowledged]);
  // Every streamed chunk rebuilds the map; visible rows only re-render when a
  // delivery glyph actually changed.
  const messageStatusesRef = useRef(nextMessageStatuses);
  const messageStatuses = areMessageStatusesEqual(messageStatusesRef.current, nextMessageStatuses)
    ? messageStatusesRef.current
    : nextMessageStatuses;
  messageStatusesRef.current = messageStatuses;
  const liveActivity = activityLabel?.trim() || copy.thinking;
  const timelineItems = useMemo(() => withThreadRhythm(groupThreadTools(buildThreadTimelineItems({
    messages: timelineMessages,
    runs: runCards,
    locale,
    yesterdayLabel: t('Yesterday', { lng: locale }),
  }), expandedTools)).reverse(), [locale, timelineMessages, runCards, expandedTools, calendarDay, t]);
  const followNewMessagesRef = useRef(true);
  const previewWasVisible = useRef(Boolean(sessionPreview));
  if (previewWasVisible.current && !sessionPreview) followNewMessagesRef.current = false;
  previewWasVisible.current = Boolean(sessionPreview);
  const returningToBottomRef = useRef(false);
  const readerScrollingRef = useRef(false);
  const distanceFromBottomRef = useRef(0);
  const scrollMetricsRef = useRef({ height: 0, viewport: 0, offset: 0 });
  const timelineRef = useRef<FlashListRef<ThreadTimelineRow>>(null);
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
    <View style={[stylesStatic.timelineItem, { width }]}>
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
    ({ item, target }: ListRenderItemInfo<ThreadTimelineRow>) => {
      if (item.type === 'tools') {
        return <View style={[stylesStatic.timelineItem, rowGapStyles[item.gapAbove]]}>
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
          <View style={[stylesStatic.timeSeparator, rowGapStyles[item.gapAbove]]}>
            <Text testID={`thread-${item.key}`} style={[stylesStatic.timeLabel, {
              color: theme.colors.inkSecondary,
            }, timeLabelChrome]}>{item.label}</Text>
          </View>
        );
      }
      if (item.type === 'run') {
        return (
          <ThreadRunTimelineItem
            run={item.run}
            gapAbove={item.gapAbove}
            copy={copy}
            animateEntrance={target === 'Cell' && runEntrance.entranceKeys.has(item.key)}
            claimEntrance={runEntrance.claimEntrance}
            onOpenSession={onOpenRunSession}
            onOpenCronRun={onOpenCronRun}
            onOpenResult={setSelectedRun}
            onOpenLogs={onOpenRunLogs}
          />
        );
      }
      return (
        <ThreadMessageTimelineItem
          message={item.message}
          gapAbove={item.gapAbove}
          capabilities={capabilities}
          copy={copy}
          status={messageStatuses.get(item.message.id) ?? null}
          animateEntrance={target === 'Cell' && entranceIds.has(item.message.renderKey ?? item.message.id)}
          claimEntrance={claimEntrance}
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
      timeLabelChrome,
      capabilities,
      expandedTools,
      copy,
      entranceIds,
      claimEntrance,
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
      runEntrance,
    ],
  );

  return (
    <ChatPresentationProvider value={presentation}>
    <ThreadLiveActivityContext.Provider value={liveActivity}>
    <View testID={testID} style={[styles.screen, { backgroundColor: theme.colors.canvas }]}>
    {/* The wallpaper sits under the whole screen and stays put while the keyboard pads the content. */}
    <ChatBackgroundLayer appearance={chatAppearance} />
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      // The keyboard already covers the home-indicator inset; retain only the control gap.
      keyboardVerticalOffset={Platform.OS === 'ios' ? Space.md - Math.max(bottomInset, Space.lg) : 0}
      style={styles.screen}
    >
      <View style={styles.screen}>
      <View style={styles.screen} pointerEvents={composerExpanded ? 'none' : 'auto'}
        accessibilityElementsHidden={composerExpanded} importantForAccessibility={composerExpanded ? 'no-hide-descendants' : 'auto'}>
      <View
        testID={`${testID}-header`}
        // The band owns its touches: rows scrolled under the header stay out of reach.
        pointerEvents="auto"
        style={[styles.header, { paddingTop: topInset + Space.sm }, wallpaperActive ? null : { backgroundColor: theme.colors.canvas }]}
      >
        {/* Over a wallpaper the whole band is a soft canvas scrim; over the canvas only the 24-point tail fades the timeline out. */}
        <ChatWallpaperScrim
          testID={`${testID}-header-scrim`}
          edge="top"
          color={theme.colors.canvas}
          opacity={wallpaperActive ? scrimOpacity.top : 1}
          style={wallpaperActive ? styles.headerScrimImmersive : styles.headerScrimTail}
        />
        <FloatingButton
          testID={`${testID}-back`}
          icon={workspace.toggleRoster ? PanelLeft : ChevronLeft}
          appearance={wallpaperActive ? 'glass' : 'surface'}
          accessibilityLabel={workspace.toggleRoster ? t('Agents', { ns: 'common' }) : copy.back}
          onPress={workspace.toggleRoster ?? onBack}
        />
        <View style={styles.headerPillSlot}>
          <HeaderPill
            testID={`${testID}-header-pill`}
            agentId={agentId}
            name={headerName}
            avatarName={agentName}
            subtitle={headerWorking ? '' : headerSubtitle}
            working={headerWorking}
            icon={isCronSession ? CalendarClock : undefined}
            emoji={agentEmoji}
            avatarUrl={agentAvatarUrl}
            status={avatarStatus}
            material={wallpaperActive ? 'glass' : 'surface'}
            accessibilityLabel={copy.settings}
            onPress={!locked ? onOpenSettings : undefined}
          />
        </View>
        {canOpenSessions ? <FloatingButton
          testID={`${testID}-sessions`}
          icon={MessagesSquare}
          appearance={wallpaperActive ? 'glass' : 'surface'}
          accessibilityLabel={copy.openSessions}
          onPress={() => onOpenSessionPanel?.()}
          disabled={locked}
        /> : <View style={{ width: ControlSize.floatingButton }} pointerEvents="none" />}
      </View>

      <View style={styles.timeline}>
        <Animated.View
          key={`thread-session:${sessionKey ?? 'unscoped'}`}
          testID={`${testID}-session-content`}
          collapsable={false}
          entering={sessionChanged && !reduceMotion ? SESSION_CONTENT_FADE_IN : undefined}
          exiting={reduceMotion ? undefined : SESSION_CONTENT_FADE_OUT}
          style={styles.sessionContent}
        >
          {showConnectionFailure && connectionFailure ? (
            <View style={[styles.sessionContent, { paddingTop: timelineTopClearance }]}>
              <ConnectionUnavailable
                {...connectionFailure}
                testID="thread-connection-unavailable"
                message={connectionFailure.message ?? (state.kind === 'error' && !connectionOutage ? state.message : undefined)}
                actionLabel={state.kind === 'error' && !connectionOutage ? state.actionLabel ?? copy.retry : copy.reconnect}
                onRetry={state.kind === 'error' && !connectionOutage && onErrorAction ? () => onErrorAction(state) : onRetry}
                onViewSaved={messages.length > 0 || runCards.length > 0 ? () => setSavedScope(connectionFailure.scope) : undefined}
              />
            </View>
          ) : (state.kind === 'loading' || (state.kind === 'reconnecting' && messages.length === 0)) ? (
            <View style={[styles.centeredState, { paddingTop: timelineTopClearance }]}><LoadingState testID="thread-history-loading" message={state.kind === 'reconnecting' ? t('Reconnecting…') : connectingLabel ?? copy.loadingHistory} pose={connectingLabel ? 'connecting' : 'loading'} /></View>
          ) : messages.length === 0 && (state.kind === 'error' || state.kind === 'offline') ? (
            <View style={[styles.sessionContent, { paddingTop: timelineTopClearance }]}><ConnectionUnavailable name={agentName} message={state.kind === 'error' ? state.message : undefined} onRetry={onRetry} /></View>
          ) : state.kind === 'locked' ? (
            <View
              testID={`${testID}-locked`}
              style={[styles.centeredState, { paddingTop: timelineTopClearance }]}
            >
              <Banner
                icon={CircleAlert}
                message={copy.locked}
                actionLabel={onOpenPaywall ? copy.viewPro : undefined}
                onAction={onOpenPaywall}
              />
            </View>
          ) : state.kind === 'empty' ? (
            <View
              testID={`${testID}-empty`}
              style={[styles.centeredState, { paddingTop: timelineTopClearance }]}
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
                { paddingTop: timelineTopClearance, paddingBottom: timelineClearance },
              ]}
              onStartReached={onLoadMoreHistory}
              onStartReachedThreshold={0.3}
              ListFooterComponent={compactionNotice ? (
                <View testID={`${testID}-compaction`} style={[stylesStatic.timelineItem, rowGapStyles.turn]}>
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
        {/* The header pill already states offline; the floating capsule only carries the action. */}
        {!showConnectionFailure && state.kind === 'offline' && onRetry ? (
          <ConnectionStatusPill
            testID={`${testID}-offline`}
            status="offline"
            actionLabel={copy.reconnect}
            accessibilityLabel={`${copy.offline}, ${copy.reconnect}`}
            onAction={onRetry}
            style={{ top: headerHeight + Space.sm }}
          />
        ) : null}
        {!showConnectionFailure && state.kind === 'error' ? (
          <ConnectionStatusPill
            testID={`${testID}-error`}
            status="error"
            message={state.message}
            actionLabel={onErrorAction ? (state.actionLabel ?? copy.retry) : undefined}
            onAction={onErrorAction ? () => onErrorAction(state) : undefined}
            style={{ top: headerHeight + Space.sm }}
          />
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

      {sessionPreview ? <View style={wallpaperActive ? null : { backgroundColor: theme.colors.canvas }}>
        {wallpaperActive ? <ChatWallpaperScrim edge="bottom" color={theme.colors.canvas} opacity={scrimOpacity.bottom} /> : null}
        <SessionPreviewFooter onUpgrade={sessionPreview.onUpgrade}
          onMain={sessionPreview.onMain} bottomInset={bottomInset} loading={sessionPreview.loading} />
      </View> : null}
      {!locked && !sessionPreview && capabilities.chat && !isCronSession ? (
        <View
          collapsable={false}
          testID={`${testID}-composer-region`}
          onLayout={({ nativeEvent }) => {
            if (!composerExpanded) compactComposerHeight.current = nativeEvent.layout.height;
          }}
          accessibilityViewIsModal={composerExpanded}
          style={[styles.composerRegion, { paddingBottom: Math.max(bottomInset, Space.lg) },
            wallpaperActive && !composerExpanded ? null : { backgroundColor: theme.colors.canvas },
            composerExpanded ? [styles.expandedComposerRegion, { paddingTop: topInset }] : null]}
        >
          {wallpaperActive && !composerExpanded ? (
            <ChatWallpaperScrim testID={`${testID}-composer-scrim`} edge="bottom"
              color={theme.colors.canvas} opacity={scrimOpacity.bottom} />
          ) : null}
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
            notice={composerExpanded && offline ? (
              <ConnectionStatusPill placement="inline" status="offline" message={copy.offline}
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
            onVoiceStart={onVoiceStart}
            onVoiceStop={onVoiceStop}
            onVoiceCancel={onVoiceCancel}
            voiceDisabled={offline || state.kind === 'reconnecting'}
            voiceState={canUseVoice ? voiceState : 'idle'}
            voiceLevel={voiceLevel}
            onPasteFiles={capabilities.attachments ? onPasteFiles : undefined}
            onPasteFailed={capabilities.attachments ? onPasteFailed : undefined}
            canSend={!offline && state.kind !== 'reconnecting' && canSend}
            hasAttachments={pendingAttachments.length > 0}
            isRunning={isRunning}
            expanded={composerExpanded}
            onExpandedChange={setComposerExpanded}
            appearance={wallpaperActive ? 'glass' : 'surface'}
            editable
            style={[styles.composer, workspace.tablet ? { width: Math.max(0, Math.min(workspace.paneWidth, IPAD_CHAT_MAX_WIDTH) - Space.lg * 2), alignSelf: 'center' } : null]}
          />
        </View>
      ) : null}
      </View>
      <ReplyFailureSheet visible={showFailureDetails && Boolean(sendFailureDetails)}
        summary={sendFailure ?? ''} details={sendFailureDetails ?? ''}
        onClose={() => setShowFailureDetails(false)} onDismiss={() => { setShowFailureDetails(false); onDismissSendFailure?.(); }} />
      <Sheet closeAccessibilityLabel={t('Close')} visible={Boolean(selectedRun)} onClose={() => setSelectedRun(null)}
        title={selectedRun?.title ?? ''} snapPoints={RUN_RESULT_SNAP_POINTS} testID="thread-run-result">
        {selectedRun ? <RunResult presentation="sheet" summary={selectedRun.summary} statusLabel={copy.formatRunDetail(selectedRun.statusLabel, selectedRun.timeLabel)} /> : null}
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
    </View>
    </ThreadLiveActivityContext.Provider>
    </ChatPresentationProvider>
  );
}

function ThreadRunTimelineItem({
  run,
  gapAbove,
  copy,
  animateEntrance,
  claimEntrance,
  onOpenSession,
  onOpenCronRun,
  onOpenResult,
  onOpenLogs,
}: Readonly<{
  run: ThreadRunCard;
  gapAbove: ThreadRowGap;
  copy: ThreadCopy;
  /** A card that arrives while the timeline is visible slides in like a reply. */
  animateEntrance: boolean;
  claimEntrance: (key: string) => boolean;
  onOpenSession?: ThreadViewProps['onOpenRunSession'];
  onOpenCronRun?: ThreadViewProps['onOpenCronRun'];
  onOpenResult: (run: ThreadRunCard) => void;
  onOpenLogs?: ThreadViewProps['onOpenRunLogs'];
}>): React.JSX.Element {
  const sessionKey = run.sessionKey;
  const jobId = run.jobId;
  // Cron cards open the execution record (owner decision 2026-09-19); sub-agent
  // cards open their child session, or the recorded result when there is none.
  const openCronRun = run.kind === 'cron' && onOpenCronRun && run.cronRun
    ? () => onOpenCronRun(run)
    : undefined;
  const openSession = onOpenSession && sessionKey
    ? () => onOpenSession(sessionKey, run.agentId, run.kind)
    : undefined;
  const openLogs = run.canOpenLogs && onOpenLogs && jobId
    ? () => onOpenLogs(jobId, run.agentId)
    : undefined;
  return (
    <View style={[stylesStatic.timelineItem, rowGapStyles[gapAbove]]}>
      <MessageEntrance
        testID={`thread-entrance-${run.kind}-run-${run.id}`}
        animationKey={`run:${run.kind}:${run.id}`}
        animate={animateEntrance}
        claimEntrance={claimEntrance}
        motion="reply"
      >
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
        onPress={openCronRun ?? openSession ?? (() => onOpenResult(run))}
        accessibilityLabel={`${run.title}, ${copy.formatRunDetail(run.statusLabel, run.timeLabel)}`}
        trailing={openLogs ? (
          <View testID={`thread-${run.kind}-logs-${run.id}`}>
            <HeaderTextAction label={copy.logs} onPress={openLogs} />
          </View>
        ) : undefined}
      />
      </MessageEntrance>
    </View>
  );
}

type ThreadMessageTimelineItemProps = Readonly<{
  message: UiMessage;
  /** Rhythm toward the older row above; owned by the timeline model. */
  gapAbove: ThreadRowGap;
  capabilities: Capabilities;
  copy: ThreadCopy;
  /** Delivery glyph for the user's own settled messages. */
  status: UserMessageStatus | null;
  /** Plays the row's entrance once; latched per message id inside the row. */
  animateEntrance: boolean;
  claimEntrance: (key: string) => boolean;
  onOpenTool: (message: UiMessage) => void;
  onOpenAttachments?: (message: UiMessage, index?: number) => void;
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
  if (status === 'queued') return copy.queued ?? '';
  if (status === 'held') return copy.paused ?? '';
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
  gapAbove,
  capabilities,
  copy,
  status,
  animateEntrance,
  claimEntrance,
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
        delayLongPress={MESSAGE_LONG_PRESS_DELAY}
        onPress={queuedTap ? handleLongPress : undefined}
        onLongPress={actionable ? handleLongPress : undefined}
        style={stylesStatic.timelineItem}
      >
        <ThreadMessageRowContent
          message={message}
          copy={copy}
          favorited={favorited}
          status={status}
          onOpenAttachments={onOpenAttachments}
          onLongPress={actionable ? handleLongPress : undefined}
        />
      </Pressable>
    );
  } else {
    return null;
  }

  // The gap lives outside the measured row so the actions overlay clone,
  // which renders the row alone, keeps identical geometry.
  return (
    <View style={rowGapStyles[gapAbove]}>
      <MessageEntrance
        testID={`thread-entrance-${message.id}`}
        animationKey={message.renderKey ?? message.id}
        animate={animateEntrance}
        claimEntrance={claimEntrance}
        motion={message.role === 'user' ? 'sent' : 'reply'}
      >
        {content}
      </MessageEntrance>
    </View>
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
  onLongPress,
}: Readonly<{
  message: UiMessage;
  copy: ThreadCopy;
  favorited: boolean;
  status?: UserMessageStatus | null;
  showIdentity?: boolean;
  onOpenAttachments?: (message: UiMessage, index?: number) => void;
  /** Row long-press forwarded to the album so photos open the same actions. */
  onLongPress?: () => void;
}>): React.JSX.Element | null {
  if (message.role !== 'assistant' && message.role !== 'user') return null;
  const attachmentCount = message.imageUris?.length ?? 0;
  const fileAttachments = message.fileAttachments ?? [];
  // A reply that has produced no text yet still owns its bubble.
  const hasBubble = Boolean(message.text) || (message.role === 'assistant' && message.streaming === true);
  return (
    <View testID={`thread-delivery-${message.id}`} style={stylesStatic.deliveryFrame}>
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
        <ThreadMessageAlbum
          message={message}
          copy={copy}
          onOpenAttachments={onOpenAttachments}
          onLongPress={onLongPress}
        />
      ) : null}
      {!hasBubble && message.role === 'user' ? (
        <UserMessageMeta message={message} status={status} copy={copy} />
      ) : null}
      {favorited ? (
        <FavoriteIndicator messageId={message.id} role={message.role} />
      ) : null}
    </View>
  );
}

/** Local sends reserve their final clock/status geometry from the first frame. */
function useMessageClock(message: UiMessage): string {
  const { locale } = useChatPresentation();
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
            tone="accent"
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
      tone="accent"
      status={status}
      statusLabel={statusCopy(status, copy)}
      style={stylesStatic.metaRowUser}
    />
  );
}

function deliveryLabel(delivery: NonNullable<UiMessage['delivery']>, copy: ThreadCopy): string {
  if (delivery === 'held') return copy.paused ?? '';
  if (delivery === 'sending') return copy.sending ?? '';
  return copy.queued ?? '';
}

/** Album cap relative to the row content: narrower than the widest text bubble so photos read as an inset. */
const MESSAGE_ALBUM_WIDTH_RATIO = 0.76;

/**
 * The album needs a number, not a percentage, to pack rows. The window width
 * is the same for the timeline row and its overlay clone, so both compute an
 * identical frame.
 */
function useMessageAlbumWidth(): number {
  const { width } = useWindowDimensions();
  const workspace = useWorkspaceLayout();
  const availableWidth = workspace.tablet ? workspace.paneWidth : width;
  return Math.round(Math.max(0, Math.min(availableWidth, IPAD_CHAT_MAX_WIDTH) - THREAD_ROW_INSET * 2) * MESSAGE_ALBUM_WIDTH_RATIO);
}

function ThreadMessageAlbum({
  message,
  copy,
  onOpenAttachments,
  onLongPress,
}: Readonly<{
  message: UiMessage;
  copy: ThreadCopy;
  onOpenAttachments?: (message: UiMessage, index?: number) => void;
  onLongPress?: () => void;
}>): React.JSX.Element | null {
  const maxWidth = useMessageAlbumWidth();
  const uris = message.imageUris ?? [];
  if (uris.length === 0) return null;
  return (
    <MessageAttachmentAlbum
      testID={`thread-attachments-${message.id}`}
      uris={uris}
      metas={message.imageMetas}
      maxWidth={maxWidth}
      align={message.role === 'user' ? 'end' : 'start'}
      label={copy.formatAttachments(uris.length)}
      formatTileLabel={copy.formatPhotoPosition}
      onPressImage={onOpenAttachments ? (index) => onOpenAttachments(message, index) : undefined}
      onLongPress={onLongPress}
      longPressDelay={MESSAGE_LONG_PRESS_DELAY}
    />
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
            : copy.pairApprovalDetail;
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
  const liveActivity = useContext(ThreadLiveActivityContext);
  const time = useMessageClock(message);
  const markdownStyle = useMemo(
    () => createChatMarkdownStyle(theme.colors, fontSize),
    [theme.colors, fontSize],
  );
  // Chunks land in socket-sized bursts; the pacer feeds the native markdown
  // view word-sized increments so its tail fade-in reads as a cascade. Once
  // the run ends the pacer drains the remainder, then the settled text shows.
  const pacedText = useSmoothedStreamText(message.text, message.streaming === true);
  // Keep the placeholder until the pacer has visible text, never an empty
  // markdown bubble between the first network chunk and its first shown word.
  const thinking = message.streaming === true && pacedText.trim().length === 0;
  const textAnimating = message.streaming === true || pacedText !== message.text;
  const displayText = useMemo(() => {
    if (!textAnimating) return message.text;
    // No synthetic cursor: the native view animates only truly appended tail
    // content, so a trailing glyph would absorb the fade and hide the effect.
    return remend(pacedText, STREAMING_REMEND_OPTIONS);
  }, [message.text, pacedText, textAnimating]);

  return (
    <View>
    {identity && showIdentity ? <ChatMessageIdentity {...identity} /> : null}
    <Bubble
      testID={`thread-bubble-${message.id}`}
      role="assistant"
      style={stylesStatic.thinkingBubble}
    >
      {thinking ? (
        <ThinkingIndicator testID={`thread-thinking-${message.id}`} label={liveActivity} />
      ) : (
        <View>
          <EnrichedMarkdownText
            testID={`thread-markdown-${message.id}`}
            flavor={THREAD_MARKDOWN_FLAVOR}
            markdown={displayText}
            markdownStyle={markdownStyle}
            onLinkPress={openChatMarkdownLink}
            selectable
            streamingAnimation={textAnimating}
          />
          {time ? (
            <View
              style={textAnimating ? stylesStatic.pendingMeta : undefined}
              accessibilityElementsHidden={textAnimating}
              importantForAccessibility={textAnimating ? 'no-hide-descendants' : 'auto'}
            >
              <MessageMeta testID={`thread-meta-${message.id}`} time={time} style={stylesStatic.metaRowAssistant} />
            </View>
          ) : null}
        </View>
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
// Shared by the row and its photo tiles so the actions gesture feels identical.
const MESSAGE_LONG_PRESS_DELAY = 220;

// Timeline rhythm, one value per relation between a row and the older row
// above it (see `ThreadRowGap`). Rows own no vertical padding of their own,
// so any two neighbours are separated by exactly one of these values; the
// list's own top/bottom insets frame the oldest and newest rows.
const rowGapStyles = StyleSheet.create<Record<ThreadRowGap, ViewStyle>>({
  none: {},
  stack: { paddingTop: Space.sm },
  turn: { paddingTop: Space.lg },
  section: { paddingTop: Space.xl },
});

const stylesStatic = StyleSheet.create({
  pendingMeta: { opacity: 0 },
  // A time label heads the group below it: its gap above comes from the
  // rhythm, and it owns the space down to the first row of the group.
  timeSeparator: { alignItems: 'center', paddingBottom: Space.md },
  timeLabel: {
    fontSize: FontSize.caption, lineHeight: LineHeight.caption,
    paddingHorizontal: Space.sm, paddingVertical: Space.xs, borderRadius: Radius.full,
    overflow: 'hidden', textAlign: 'center',
  },
  timelineItem: {
    width: '100%',
    maxWidth: IPAD_CHAT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: THREAD_ROW_INSET,
    gap: Space.xs,
  },
  fileAttachmentUser: {
    alignSelf: 'flex-end',
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
    fontVariant: ['tabular-nums'],
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
    // The header floats over the timeline; content scrolls underneath it
    // and starts `resolveThreadHeaderHeight` + 16 points down.
    header: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      paddingHorizontal: Space.lg,
      paddingBottom: Space.sm,
    },
    headerScrimImmersive: {
      bottom: -HEADER_FADE_HEIGHT,
    },
    headerScrimTail: {
      top: '100%',
      bottom: -HEADER_FADE_HEIGHT,
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
      zIndex: 1,
    },
    scrollToBottom: {
      position: 'absolute',
      right: Space.lg,
      bottom: Space.md,
    },
    sessionContent: {
      ...StyleSheet.absoluteFill,
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
    },
    expandedComposerRegion: {
      ...StyleSheet.absoluteFill,
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
