import { ArtifactProvider, ArtifactAttachments } from '../../components/chat/ArtifactAttachments';
import { AndroidChatKeyboardAvoider } from '../../components/chat/AndroidChatKeyboardAvoider';
import { isIncomingParticipant, messageSenderLabel } from '../../chat/messageAttribution';
import { localizeAgentSystemNotice } from '../../chat/agentSystemNotice';
import { ParticipantIdentity } from '../../components/chat/ParticipantIdentity';
import { useWorkspaceLayout } from '../../navigation/workspace-context';
import { IPAD_CHAT_MAX_WIDTH } from '../../utils/ipad-layout';
import { useReplyEntranceDelay } from '../../chat/useReplyEntranceDelay';
import { SessionPreviewNotice, SessionPreviewFooter } from './components/SessionPreviewNotice';
import { useTranslation } from 'react-i18next';
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Keyboard,
  KeyboardAvoidingView as NativeKeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { FlashList, type FlashListProps, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import remend from 'remend';
import type { Capabilities, SessionDescriptor } from '@clawket/agent-protocol';
import {
  PanelLeft,
  ArrowDown,
  CalendarClock,
  Bot,
  CircleAlert,
  FilePenLine,
  Globe,
  MonitorSmartphone,
  Paperclip,
  MessagesSquare,
  Server,
  Star,
  Shield,
  Terminal,
} from 'lucide-react-native';
import { ChevronLeft } from '../../components/ui/DirectionalIcon';
import type { PendingImage, UiApprovalStatus, UiMessage } from '../../types/chat';
import type { SlashCommand } from '../../data/slash-commands';
import { useAppTheme } from '../../theme';
import { ChatPresentationProvider, useChatPresentation, useChatSurfaces, useConversationTheme } from '../../components/chat/ChatPresentation';
import { ModelIcon } from '../../components/chat/ModelIcon';
import { ChatMessageIdentity } from '../../components/chat/ChatMessageIdentity';
import { MessageAttachmentAlbum } from '../../components/chat/MessageAttachmentAlbum';
import { MessageEntrance } from '../../components/chat/MessageEntrance';
import { MessageMeta, messageMetaSpacer } from '../../components/chat/MessageMeta';
import { ChatBackgroundLayer } from '../../components/chat/ChatBackgroundLayer';
import { ChatWallpaperScrim } from '../../components/chat/ChatWallpaperScrim';
import { chatWallpaperDriftPosition, chatWallpaperDriftScrims } from '../../theme/chat-wallpaper';
import { isChatWallpaperActive, resolveChatSurfaces } from '../../features/chat-appearance/resolver';
import { DEFAULT_CHAT_APPEARANCE } from '../../features/chat-appearance/defaults';
import type { ChatAppearanceSettings } from '../../types';
import {
  ControlSize,
  FontSize,
  FontWeight,
  HitSize,
  LineHeight,
  Motion,
  Radius,
  Space,
} from '../../theme/tokens';
import { withAlpha } from '../../theme/color';
import { ApprovalCard, type ApprovalCardOutcome } from '../../components/ui/ApprovalCard';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { Banner } from '../../components/ui/Banner';
import { ConnectionStatusPill } from '../../components/ui/ConnectionStatusPill';
import { Bubble, useBubbleTypography } from '../../components/ui/Bubble';
import {
  Composer,
  type ComposerAccessorySpace,
  type ComposerHandle,
  type ComposerProps,
  type ComposerVoiceState,
} from '../../components/ui/Composer';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { HeaderTextAction } from '../../components/ui/HeaderTextAction';
import { HeaderPill } from '../../components/ui/HeaderPill';
import type { PlatformKind } from '../../components/ui/PlatformMark';
import { ToolActivityPill, useElapsed } from '../../components/chat/ToolActivityPill';
import { ServicePill } from '../../components/chat/ServicePill';
import { WorkRecordSheet } from '../../components/chat/WorkRecordSheet';
import { CronDigest } from '../../components/chat/CronDigest';
import { collectTurnToolSteps, formatActivityDuration } from '../../components/chat/tool-activity-model';
import { Sheet } from '../../components/ui/Sheet';
import { ReplyFailureSheet } from '../../components/chat/ReplyFailureSheet';
import { RunResult } from '../../components/chat/RunResult';
import { RunCard } from '../../components/ui/RunCard';
import { Skeleton } from '../../components/ui/Skeleton';
import { LoadingState, useLoadingHandoff } from '../../components/ui/LoadingState';
import { ConnectionUnavailable, type ConnectionUnavailableProps } from '../../components/ui/ConnectionUnavailable';
import { SystemEventRow } from '../../components/ui/SystemEventRow';
import { triggerLightImpact } from '../../services/haptics';
import { PendingImageBar } from '../../components/chat/PendingImageBar';
import { SlashSuggestions } from '../../components/chat/SlashSuggestions';
import { shortModelLabel } from '../../components/chat/model-label';
import { ToolDetailModal } from '../../components/chat/ToolDetailModal';
import { cronSessionName } from '../../utils/chat-message';
import { unwrapToolCall } from '../../utils/tool-display';
import {
  CHAT_MARKDOWN_BREAK_STRATEGY,
  createChatMarkdownStyle,
  getChatMarkdownFlavor,
  openChatMarkdownLink,
} from '../../components/chat/chatMarkdown';
import { useMarkdownSelectionMenu } from '../../components/chat/useMarkdownSelectionMenu';
import {
  buildThreadTimelineItems,
  groupThreadRuns,
  groupThreadTools,
  resolveThreadHeaderName,
  resolveThreadHeaderSubtitle,
  resolveThreadWorkingStatus,
  isToolRunningInTurn,
  stabilizeThreadRows,
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
import { useStreamingSettleHold } from '../../chat/useStreamingSettleHold';

const THREAD_MARKDOWN_FLAVOR = getChatMarkdownFlavor();
// Terminates markdown syntax that is still open while tokens stream in, so a
// half-typed `**bold` or `` `code `` never flickers between literal and styled.
// Escapes that rewrite already complete text stay off: they would render the
// streamed reply differently from the settled one (`- > 25` as text, then as
// a quote) and make it change style and height the moment it ends.
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
  comparisonOperators: false,
  singleTilde: false,
};
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
const EMPTY_TOOL_STEPS: ReadonlyArray<UiMessage> = Object.freeze([]);
const EMPTY_TIMELINE_ROWS: ReadonlyArray<ThreadTimelineRow> = Object.freeze([]);
/** The last committed list geometry, owned by one list instance. */
type CommittedTimelineLayout = Readonly<{
  list: FlashListRef<ThreadTimelineRow> | null;
  content: number;
  viewport: number;
  /** Key and count of the rows that geometry was measured for. */
  tailKey: string | null;
  rows: number;
}>;
const UNMEASURED_TIMELINE_LAYOUT: CommittedTimelineLayout = { list: null, content: -1, viewport: -1, tailKey: null, rows: 0 };
/**
 * A new row that lands while the reader follows glides into view like a
 * messenger instead of jumping the whole list; larger bursts (a restored page)
 * and viewport changes still snap.
 */
const FOLLOW_GLIDE_MAX_VIEWPORT_RATIO = 0.6;
/** Longer than the native animated scroll (about 300 ms on iOS, 250 ms on Android). */
const FOLLOW_GLIDE_SETTLE_MS = 420;
/** A send whose row never lands in a measured list still lets the composer shrink. */
const COMPOSER_HOLD_FALLBACK_MS = 320;
/**
 * The list opens on its newest row. FlashList scrolls to that row's top plus
 * this offset and the native scroll view clamps it to the real end, so a
 * newest reply taller than the screen still opens at its bottom.
 */
const INITIAL_SCROLL_TO_END = { viewOffset: 1_000_000 } as const;
/** Reveals a list that opened on saved rows even if its load never reports. */
const TIMELINE_PLACEMENT_TIMEOUT_MS = 320;
const EMPTY_HINT_EXIT = FadeOut.duration(Motion.duration.fast);
const getTimelineRowKey = (row: ThreadTimelineRow): string => row.key;
const getTimelineRowType = (row: ThreadTimelineRow): string => row.type;

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
/** What the Agent is doing now, and since when (the user's newest prompt), for the thinking pill. */
type ThreadLiveActivity = Readonly<{ label: string; startedAt?: number }>;
const ThreadLiveActivityContext = createContext<ThreadLiveActivity>({ label: '' });

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
  send: string;
  stop: string;
  queueSend?: string;
  queued?: string;
  sending?: string;
  paused?: string;
  heldHint?: string;
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
}>;

export type ThreadMessageActions = Readonly<{
  onCopy: (message: UiMessage) => void;
  onToggleFavorite: (message: UiMessage) => void | Promise<MessageFavoriteToggleResult | void>;
  onShare: (message: UiMessage) => void;
  onBranch?: (message: UiMessage) => void;
  canBranch?: (message: UiMessage) => boolean;
  onSchedule?: (message: UiMessage) => void;
  canSchedule?: (message: UiMessage) => boolean;
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
  artifactOperations?: import('@clawket/agent-protocol').ArtifactOperations;
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
  /** The Agent's backend, so a product Agent wears its official mark in the header and signatures. */
  agentPlatform?: PlatformKind | null;
  sessionTitle?: string | null;
  isMainSession?: boolean;
  model?: string | null;
  modelDisplayName?: string | null;
  activityLabel?: string | null;
  interactionAttention?: SessionDescriptor['attention'];
  capabilities: Capabilities;
  state: ThreadContentState;
  messages: ReadonlyArray<UiMessage>;
  sessionPreview?: { loading?: boolean; hasHiddenHistory: boolean; onUpgrade: () => void; onMain: () => void; mainLabel?: string };
  compactionNotice?: string | null;
  sendFailure?: string | null;
  sendFailureDetails?: string | null;
  onDismissSendFailure?: () => void;
  runCards?: ReadonlyArray<ThreadRunCard>;
  locale?: string;
  input: string;
  selectedSkill?: React.ReactNode;
  pendingQuestions?: React.ReactNode;
  readOnlyFooter?: React.ReactNode;
  isRunning: boolean;
  /** A local send is leaving the device; the composer already shows Stop (A+ motion: send turns into stop). */
  sendInFlight?: boolean;
  /** Identity of the live reply row the controller will add for the current run. */
  pendingReplyRenderKey?: string | null;
  canSend: boolean;
  loadingMoreHistory?: boolean;
  historyLoadMoreError?: boolean;
  onRetryHistory?: () => void;
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
  onVoiceRecover?: () => void;
  voiceRecoveryCount?: number;
  voiceRecordingSaved?: boolean;
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
  /** Runs a failed scheduled task again from its digest (the backend's cron `run`). */
  onRerunCron?: (run: ThreadRunCard) => Promise<unknown>;
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
  onReviewRuntimeSettings?: () => void;
  /** The conversation's confirmed permission mode; full access marks the header (A+ model sheet, 2026-10-01). */
  permissionMode?: string | null;
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
/**
 * Over the built-in wallpaper the scrim is the wallpaper's own color, so it can
 * be nearly opaque at the edge without reading as a band: rows scrolling under
 * the status bar and the floating controls disappear, as in the A+ design
 * (device review 2026-10-01: at the photo strength they stayed legible there).
 */
const PATTERN_SCRIM = { top: 0.94, bottom: 0.95 } as const;
/** Where the pattern scrim still holds most of its strength, and how much. */
const PATTERN_SCRIM_HOLD = { stop: 0.62, ratio: 0.8 } as const;

export function ThreadView({
  connectionFailure,
  connectingLabel,
  chatAppearance = DEFAULT_CHAT_APPEARANCE,
  chatFontSize = FontSize.body,
  showAgentAvatar = false,
  agentId,
  agentName,
  sessionKey,
  artifactOperations,
  scrollToBottomRequestAt,
  messageSubmittedAt,
  agentEmoji,
  agentAvatarUrl,
  agentPlatform,
  sessionTitle,
  isMainSession = true,
  model,
  modelDisplayName,
  activityLabel,
  interactionAttention,
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
  selectedSkill,
  pendingQuestions,
  readOnlyFooter,
  isRunning,
  sendInFlight = false,
  pendingReplyRenderKey,
  canSend,
  loadingMoreHistory = false,
  historyLoadMoreError = false,
  onRetryHistory,
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
  onVoice, onVoiceStart, onVoiceStop, onVoiceCancel, onVoiceRecover, voiceRecoveryCount = 0, voiceRecordingSaved = false,
  voiceState = 'idle',
  voiceLevel,
  onRetry,
  onOpenPaywall,
  onErrorAction,
  onLoadMoreHistory,
  onOpenRunSession,
  onOpenCronRun,
  onOpenRunLogs,
  onRerunCron,
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
  onReviewRuntimeSettings,
  permissionMode,
  onResolveApproval,
  testID = 'thread-screen',
}: ThreadViewProps): React.JSX.Element {
  // Keep both component identities stable across message/keyboard commits.
  // Android follows native frames; iOS retains its verified React padding path.
  const KeyboardAvoidingView = Platform.OS === 'ios'
    ? NativeKeyboardAvoidingView : AndroidChatKeyboardAvoider;
  const { theme, accentId } = useAppTheme();
  const { t } = useTranslation('common');
  const hasParticipants = messages.some(isIncomingParticipant);
  const presentation = useMemo(() => ({
    appearance: chatAppearance, fontSize: chatFontSize, locale,
    identity: { agentId, name: agentName, emoji: agentEmoji, avatarUrl: agentAvatarUrl, platform: agentPlatform, showAvatar: showAgentAvatar || hasParticipants, showRoleLabel: hasParticipants },
  }), [chatAppearance, chatFontSize, locale, agentId, agentName, agentEmoji, agentAvatarUrl, agentPlatform, showAgentAvatar, hasParticipants]);
  const reduceMotion = useReducedMotion();
  const [composerExpanded, setComposerExpanded] = useState(false);
  const compactComposerHeight = useRef(0);
  useEffect(() => { setComposerExpanded(false); }, [sessionKey]);
  // The older-page placeholder is for a reader scrolling up. A short conversation reaches its top on
  // open and pages once by itself; a placeholder there pushed the whole timeline down and back up
  // (device review 2026-09-27), so it waits for the reader's first drag in this session.
  const [historyBrowsed, setHistoryBrowsed] = useState(false);
  useEffect(() => { setHistoryBrowsed(false); }, [sessionKey]);
  useEffect(() => {
    if (!composerExpanded) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setComposerExpanded(false);
      return true;
    });
    return () => subscription.remove();
  }, [composerExpanded]);
  const [showFailureDetails, setShowFailureDetails] = useState(false);
  useEffect(() => { setShowFailureDetails(false); }, [sendFailureDetails, sessionKey]);
  const [selectedToolMessageId, setSelectedToolMessageId] = useState<string | null>(null);
  const selectedToolMessage = selectedToolMessageId
    ? messages.find((message) => message.id === selectedToolMessageId) ?? null
    : null;
  // The work record follows the turn of the pill that opened it, by render
  // identity, so history replacing live call ids keeps it open.
  const [workRecordAnchor, setWorkRecordAnchor] = useState<string | null>(null);
  useEffect(() => { setWorkRecordAnchor(null); }, [sessionKey]);
  const workRecordSteps = useMemo(
    () => (workRecordAnchor ? collectTurnToolSteps(messages, workRecordAnchor) : EMPTY_TOOL_STEPS),
    [messages, workRecordAnchor],
  );
  useEffect(() => {
    if (workRecordAnchor && workRecordSteps.length === 0) setWorkRecordAnchor(null);
  }, [workRecordAnchor, workRecordSteps.length]);
  const workspace = useWorkspaceLayout();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  // Immersive mode: the wallpaper fills the screen and every control floats
  // over it on glass; without a wallpaper the header keeps the canvas and the
  // white floating circles every page header uses.
  const wallpaperActive = isChatWallpaperActive(chatAppearance);
  const headerHeight = resolveThreadHeaderHeight(topInset);
  const patternWallpaper = chatAppearance.background.kind === 'pattern';
  const scrimOpacity = patternWallpaper ? PATTERN_SCRIM : WALLPAPER_SCRIM[theme.scheme === 'dark' ? 'dark' : 'light'];
  const scrimHold = patternWallpaper ? PATTERN_SCRIM_HOLD : undefined;
  // The scrims fade from the wallpaper's own top and bottom colors so the
  // floating chrome melts into it; the timeline reads the same surfaces
  // through the presentation context.
  const surfaces = useMemo(() => resolveChatSurfaces(theme, chatAppearance, accentId), [accentId, chatAppearance, theme]);
  // The built-in wallpaper drifts one step per send (A+ motion prototype); the
  // scrims fade from the colors it shows at the screen's top and bottom.
  const [wallpaperDrift, setWallpaperDrift] = useState(0);
  const windowSize = useWindowDimensions();
  const [screenSize, setScreenSize] = useState<{ width: number; height: number } | null>(null);
  const screenAspect = (screenSize?.height ?? windowSize.height) / Math.max(1, screenSize?.width ?? windowSize.width);
  const scrim = useMemo(() => (surfaces.wallpaper === 'pattern'
    ? chatWallpaperDriftScrims(surfaces.palette, chatWallpaperDriftPosition(reduceMotion ? 0 : wallpaperDrift), screenAspect)
    : surfaces.scrim), [reduceMotion, screenAspect, surfaces, wallpaperDrift]);
  const offline = state.kind === 'offline' || state.kind === 'error';
  const [savedScope, setSavedScope] = useState<string | null>(null);
  const readableScope = `${connectionFailure?.scope ?? ''}\u0000${sessionKey ?? ''}`;
  const hasReadableContent = messages.length > 0 || runCards.length > 0;
  const [lastReadyScope, setLastReadyScope] = useState<string | null>(null);
  useEffect(() => {
    if (state.kind === 'ready' || state.kind === 'empty') setSavedScope(null);
  }, [state.kind]);
  useEffect(() => {
    if (state.kind === 'ready' && hasReadableContent) setLastReadyScope(readableScope);
    else setLastReadyScope((previous) => previous === readableScope ? previous : null);
  }, [state.kind, readableScope, hasReadableContent]);
  const connectionOutage = state.kind === 'error' && ['network', 'timeout', 'server', 'bridge_offline', 'gateway_offline'].includes(state.code);
  const retainReadableConversation = lastReadyScope === readableScope && hasReadableContent
    && !connectionFailure?.message && (state.kind === 'offline' || connectionOutage);
  const showConnectionFailure = Boolean(connectionFailure && savedScope !== connectionFailure.scope
    && offline && !retainReadableConversation);
  // The Companion covers the timeline while it waits, then fades away at once over the arriving content.
  const loaderActive = !(showConnectionFailure && connectionFailure)
    && (state.kind === 'loading' || (state.kind === 'reconnecting' && messages.length === 0));
  const loaderPhase = useLoadingHandoff(loaderActive, state.kind === 'ready' || state.kind === 'empty');
  const loaderMessage = useRef('');
  if (loaderActive) loaderMessage.current = state.kind === 'reconnecting' ? t('Reconnecting…') : connectingLabel ?? copy.loadingHistory;

  const locked = state.kind === 'locked';
  // A scheduled run's transcript is read, not continued: the header names it and the composer stays away.
  const isCronSession = Boolean(sessionKey?.includes(':cron:'));
  const untitledSession = sessionTitle === sessionKey;
  const cronName = isCronSession && !untitledSession ? cronSessionName(sessionTitle) : '';
  const cronTitle = cronName ? t('Scheduled task: {{name}}', { name: cronName }) : t('Scheduled task');
  const headerName = resolveThreadHeaderName(
    agentName,
    sessionTitle && (isCronSession ? cronTitle : untitledSession ? t('New session') : sessionTitle),
    isMainSession,
  );
  const replyEntrance = useReplyEntranceDelay(messages, sessionKey, messageSubmittedAt, reduceMotion);
  const presentedRunning = isRunning && !replyEntrance.holding;
  const awaitingInput = interactionAttention === 'input' || interactionAttention === 'approval';
  // The Agent's presence in the header (A+ chat design, owner decision
  // 2026-09-30): an accent arc turns around the avatar and the subtitle says
  // what it is doing while it works; an amber ring breathes and the subtitle
  // asks for you while an approval or an answer waits.
  const waitingForYou = state.kind !== 'reconnecting'
    && (awaitingInput || hasPendingApproval(messages, capabilities, Date.now()));
  const headerWorking = presentedRunning && !waitingForYou && state.kind !== 'reconnecting';
  const headerPresence = waitingForYou ? 'attention' as const : headerWorking ? 'working' as const : null;
  const headerSubtitle = state.kind === 'reconnecting' ? t('Reconnecting…')
    : waitingForYou ? interactionAttention === 'input' ? t('Agent needs your input', { ns: 'chat' }) : t('Waiting for your approval', { ns: 'chat' })
    : headerWorking ? resolveThreadWorkingStatus({ messages, activityLabel, thinkingLabel: copy.thinking, t })
    : resolveThreadHeaderSubtitle({
    state,
    isRunning: presentedRunning,
    activityLabel,
    offlineLabel: copy.offline,
    thinkingLabel: copy.thinking,
    onlineLabel: t('Online', { ns: 'common' }),
  });
  const headerOnline = !headerPresence && !presentedRunning && (state.kind === 'ready' || state.kind === 'empty');
  const modelChipLabel = shortModelLabel(modelDisplayName || model) || copy.chooseModel || t('Models', { ns: 'settings' });
  const avatarStatus = locked ? 'locked' : offline ? 'offline' : 'idle';
  const canOpenSessions = capabilities.sessions && Boolean(onOpenSessionPanel);
  // The screen decides availability from the full capability set (attachments,
  // skills, commands, thinking, cron, tools); the view only needs the handler.
  const canOpenAddMenu = Boolean(onOpenAddMenu);
  const canUseVoice = Boolean(onVoice);
  const composerPlaceholder = canUseVoice && voiceState === 'listening' ? copy.listening : copy.placeholder;
  const canCancel = capabilities.abort && Boolean(onCancel);
  const timelineClearance = Space.lg;
  const timelineTopClearance = headerHeight + Space.lg;
  const [selectedRun, setSelectedRun] = useState<ThreadRunCard | null>(null);
  const [calendarDay, setCalendarDay] = useState(() => localDayNumber(Date.now()));
  useEffect(() => {
    const timer = setInterval(() => setCalendarDay(localDayNumber(Date.now())), 60_000);
    return () => clearInterval(timer);
  }, []);
  // A running step already has its own live pill; a second "Thinking" spinner
  // beside it would contradict it, so the empty reply waits for the step.
  const toolRunning = isToolRunningInTurn(messages);
  const showReplyPlaceholder = presentedRunning && !awaitingInput && !locked && !sessionPreview && !toolRunning
    && !messages.some((message) => message.id === REPLY_PLACEHOLDER_ID
      || (message.role === 'assistant' && message.streaming === true));
  // Carries the controller's identity for this run's reply, so the first
  // streamed row takes over this placeholder's cell instead of replacing it.
  const replyPlaceholder = useMemo(() => (pendingReplyRenderKey
    ? { ...REPLY_PLACEHOLDER, renderKey: pendingReplyRenderKey } : REPLY_PLACEHOLDER), [pendingReplyRenderKey]);
  const timelineMessages = useMemo(
    () => awaitingInput || toolRunning
      ? replyEntrance.messages.filter(message => !(message.role === 'assistant' && message.streaming && !message.text.trim()))
      : showReplyPlaceholder ? [replyPlaceholder, ...replyEntrance.messages] : replyEntrance.messages,
    [awaitingInput, replyEntrance.messages, replyPlaceholder, showReplyPlaceholder, toolRunning],
  );
  // Whether the previous render showed this session as an authoritative empty
  // conversation: its first message then enters like any later one.
  const emptyConversationRef = useRef(false);
  const { claimEntrance, isEntrancePending } = useThreadMessageEntrance(timelineMessages, sessionKey, emptyConversationRef.current);
  emptyConversationRef.current = state.kind === 'empty';
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
  const newestUserIndex = messages.findIndex(message => message.role === 'user'
    && !message.delivery && !isIncomingParticipant(message));
  // A locally accepted prompt can still be waiting in the socket's send queue.
  // Real run/tool evidence takes precedence over that transport acknowledgement.
  const awaitingSendAcknowledgement = !runAcknowledged && !activityLabel?.trim()
    && newestUserIndex >= 0 && unconfirmedMessageIds?.has(messages[newestUserIndex]!.id)
    && !messages.slice(0, newestUserIndex).some(message => message.role === 'tool'
      || (message.role === 'assistant' && message.text.trim().length > 0));
  const liveActivityLabel = awaitingSendAcknowledgement ? copy.sending ?? t('Sending…', { ns: 'chat' }) : activityLabel?.trim() || copy.thinking;
  // The pill's clock keeps the turn's start as first seen. An exact history
  // echo keeps the prompt's row identity but takes the computer's clock, and
  // the pill counts with the phone's (device check 2026-10-01: 10 s jumped
  // to 20 s mid-run).
  const newestUser = newestUserIndex >= 0 ? messages[newestUserIndex]! : undefined;
  const newestUserKey = newestUser ? newestUser.renderKey ?? newestUser.id : null;
  const runStartRef = useRef<{ key: string; startedAt: number | undefined } | null>(null);
  if (newestUserKey === null) runStartRef.current = null;
  else if (runStartRef.current?.key !== newestUserKey || runStartRef.current.startedAt === undefined) {
    runStartRef.current = { key: newestUserKey, startedAt: newestUser!.timestampMs };
  }
  const runStartedAt = runStartRef.current?.startedAt;
  const liveActivity = useMemo<ThreadLiveActivity>(
    () => ({ label: liveActivityLabel, startedAt: runStartedAt }),
    [liveActivityLabel, runStartedAt],
  );
  const rhythmRows = useMemo(() => withThreadRhythm(groupThreadRuns(groupThreadTools(buildThreadTimelineItems({
    messages: timelineMessages,
    runs: runCards,
    locale,
    yesterdayLabel: t('Yesterday', { lng: locale }),
  })))).reverse(), [locale, timelineMessages, runCards, calendarDay, t]);
  // Unchanged rows keep their objects: a streamed chunk re-renders the reply
  // that grew, not every visible cell.
  const stableRowsRef = useRef<ReadonlyArray<ThreadTimelineRow>>(EMPTY_TIMELINE_ROWS);
  const timelineItems = stabilizeThreadRows(stableRowsRef.current, rhythmRows);
  stableRowsRef.current = timelineItems;
  // Read in the list's commit phase, which follows this render's commit.
  const committedRowsRef = useRef({ tailKey: null as string | null, rows: 0 });
  committedRowsRef.current = { tailKey: timelineItems.at(-1)?.key ?? null, rows: timelineItems.length };
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;
  const followNewMessagesRef = useRef(true);
  const previewWasVisible = useRef(Boolean(sessionPreview));
  if (previewWasVisible.current && !sessionPreview) followNewMessagesRef.current = false;
  previewWasVisible.current = Boolean(sessionPreview);
  const returningToBottomRef = useRef(false);
  const readerScrollingRef = useRef(false);
  const readerSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelReaderSettle = useCallback(() => {
    if (readerSettleTimerRef.current !== null) clearTimeout(readerSettleTimerRef.current);
    readerSettleTimerRef.current = null;
  }, []);
  const distanceFromBottomRef = useRef(0);
  const scrollMetricsRef = useRef({ height: 0, viewport: 0, offset: 0 });
  const timelineRef = useRef<FlashListRef<ThreadTimelineRow>>(null);
  // Placement state belongs to one list instance: another session mounts a new
  // list whose layout commits run before this view's effects, and they must
  // never act on the previous list's measurements.
  const loadedTimelineRef = useRef<FlashListRef<ThreadTimelineRow> | null>(null);
  const timelineLoaded = useCallback(() => (
    loadedTimelineRef.current !== null && loadedTimelineRef.current === timelineRef.current
  ), []);
  const committedLayoutRef = useRef<CommittedTimelineLayout>(UNMEASURED_TIMELINE_LAYOUT);
  // A send keeps the composer at the draft's height until the list lays out the
  // row it sent, so both changes reach the screen in the same frame (Composer
  // `holdHeight`).
  const [holdComposerHeight, setHoldComposerHeight] = useState(false);
  const holdComposerHeightRef = useRef(holdComposerHeight);
  holdComposerHeightRef.current = holdComposerHeight;
  const composerHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseComposerHold = useCallback(() => {
    if (composerHoldTimerRef.current !== null) clearTimeout(composerHoldTimerRef.current);
    composerHoldTimerRef.current = null;
    setHoldComposerHeight(false);
  }, []);
  useEffect(() => () => {
    if (composerHoldTimerRef.current !== null) clearTimeout(composerHoldTimerRef.current);
  }, []);
  const holdComposerForSend = useCallback(() => {
    if (composerHoldTimerRef.current !== null) clearTimeout(composerHoldTimerRef.current);
    composerHoldTimerRef.current = setTimeout(releaseComposerHold, COMPOSER_HOLD_FALLBACK_MS);
    setHoldComposerHeight(true);
  }, [releaseComposerHold]);
  const composerExpandedRef = useRef(composerExpanded);
  composerExpandedRef.current = composerExpanded;
  const bottomFollowFrameRef = useRef<number | null>(null);
  const cancelBottomFollow = useCallback(() => {
    if (bottomFollowFrameRef.current === null) return;
    cancelAnimationFrame(bottomFollowFrameRef.current);
    bottomFollowFrameRef.current = null;
  }, []);
  // A follow glide in flight: its scroll events are not the reader's, and the
  // corrections that land during it re-target the glide instead of cutting it.
  const followGlideRef = useRef(false);
  const followGlideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endFollowGlide = useCallback(() => {
    if (followGlideTimerRef.current !== null) clearTimeout(followGlideTimerRef.current);
    followGlideTimerRef.current = null;
    followGlideRef.current = false;
  }, []);
  useEffect(() => endFollowGlide, [endFollowGlide]);
  // Follow corrections go straight to the native scroll view: FlashList's own
  // scrollToEnd waits a macrotask, leaving grown content clipped under the
  // composer for a frame or two before it jumps into view.
  const followToEnd = useCallback((glide: boolean) => {
    const list = timelineRef.current;
    const animated = glide && !reduceMotionRef.current;
    if (animated) {
      if (followGlideTimerRef.current !== null) clearTimeout(followGlideTimerRef.current);
      followGlideRef.current = true;
      followGlideTimerRef.current = setTimeout(() => {
        followGlideTimerRef.current = null;
        followGlideRef.current = false;
      }, FOLLOW_GLIDE_SETTLE_MS);
    } else {
      endFollowGlide();
    }
    const native = list?.getNativeScrollRef?.();
    if (native) native.scrollToEnd({ animated });
    else list?.scrollToEnd({ animated });
  }, [endFollowGlide]);
  const snapToEnd = useCallback(() => followToEnd(false), [followToEnd]);
  const scheduleBottomFollow = useCallback(() => {
    // FlashList owns initial placement. Size reports from native views
    // (tables, images, the keyboard) arrive after their frame; coalesce them
    // into one correction and recheck reader intent when it runs.
    if (!timelineLoaded() || !followNewMessagesRef.current || composerExpandedRef.current
      || bottomFollowFrameRef.current !== null) return;
    bottomFollowFrameRef.current = requestAnimationFrame(() => {
      bottomFollowFrameRef.current = null;
      if (followNewMessagesRef.current && !returningToBottomRef.current && !composerExpandedRef.current) {
        snapToEnd();
      }
    });
  }, [snapToEnd, timelineLoaded]);
  useLayoutEffect(() => cancelBottomFollow, [cancelBottomFollow, composerExpanded]);
  // FlashList calls this in its layout-commit phase, in the same JS task as the
  // render that changed the rows, so a bottom correction reaches the native
  // view together with the new layout instead of a frame later.
  const handleCommittedLayout = useCallback(() => {
    const list = timelineRef.current;
    if (!list) return;
    let content: number;
    let viewport: number;
    try {
      content = list.getChildContainerDimensions().height;
      viewport = list.getWindowSize().height;
    } catch {
      return;
    }
    const previous = committedLayoutRef.current.list === list ? committedLayoutRef.current : null;
    if (previous?.content === content && previous.viewport === viewport) return;
    const { tailKey, rows } = committedRowsRef.current;
    committedLayoutRef.current = { list, content, viewport, tailKey, rows };
    // The sent row is laid out: the held composer shrinks in this same commit.
    if (holdComposerHeightRef.current && previous && rows > previous.rows && tailKey !== previous.tailKey) {
      releaseComposerHold();
    }
    if (!previous || !timelineLoaded() || composerExpandedRef.current || returningToBottomRef.current) return;
    // Virtualized history replaces estimated row heights while scrolling.
    // A smaller total is not evidence that the reader is beyond the end:
    // FlashList moves the visible anchor as those estimates settle.
    if (readerScrollingRef.current || !followNewMessagesRef.current) return;
    cancelBottomFollow();
    // A new row at the end glides in; a growing reply, a keyboard or composer
    // that moves the viewport, and anything that shrinks keep the exact end.
    // While a glide is in flight, changes within budget re-target it rather
    // than cut it short with a jump.
    const growth = content - previous.content;
    const appended = rows > previous.rows && tailKey !== previous.tailKey;
    const withinBudget = Math.abs(growth) <= viewport * FOLLOW_GLIDE_MAX_VIEWPORT_RATIO;
    const glide = withinBudget && (followGlideRef.current
      || (appended && growth > 0 && viewport === previous.viewport));
    followToEnd(glide);
  }, [cancelBottomFollow, followToEnd, releaseComposerHold, timelineLoaded]);
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
    const far = distanceFromBottomRef.current > Space.lg;
    cancelReaderSettle();
    readerScrollingRef.current = false;
    setShowScrollToBottom(false);
    // A reader already at the end is pinned by the commit that adds the new
    // row; another scroll here would cut that row's glide short.
    if (!far && followNewMessagesRef.current && timelineLoaded()) return;
    cancelBottomFollow();
    // Let the native scroll finish before streaming/layout can issue another scroll.
    const animated = !reduceMotion && far;
    endFollowGlide();
    returningToBottomRef.current = animated;
    followNewMessagesRef.current = !animated;
    timelineRef.current?.scrollToEnd({ animated });
  }, [cancelBottomFollow, cancelReaderSettle, endFollowGlide, reduceMotion, timelineLoaded]);
  const refreshScrollButton = useCallback(() => {
    const { height, viewport, offset } = scrollMetricsRef.current;
    if (viewport <= 0) return;
    const remaining = Math.max(0, height - viewport - offset);
    distanceFromBottomRef.current = remaining;
    // Neither an explicit return nor a follow glide is the reader leaving the end.
    if (returningToBottomRef.current || followGlideRef.current) return;
    // Separate reveal/dismiss thresholds avoid flicker near the bottom edge.
    setShowScrollToBottom((visible) => visible ? remaining > Space.lg : remaining > ControlSize.rosterRow);
  }, []);
  const updateScrollPosition = useCallback(({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const metrics = {
      height: nativeEvent.contentSize.height,
      viewport: nativeEvent.layoutMeasurement.height,
      offset: nativeEvent.contentOffset.y,
    };
    scrollMetricsRef.current = metrics;
    refreshScrollButton();
    // Rows inserted above a short top-anchored list (older history, a preview
    // unlocked) make the anchor correction push the offset past the end; iOS
    // keeps it there as blank space until the next touch. A reader's own
    // bounce is left to the native view.
    const overscroll = metrics.offset - Math.max(0, metrics.height - metrics.viewport);
    if (overscroll > 1 && metrics.viewport > 0 && !readerScrollingRef.current
      && !returningToBottomRef.current && !followGlideRef.current) {
      snapToEnd();
    }
  }, [refreshScrollButton, snapToEnd]);
  const settleReaderScroll = useCallback(() => {
    cancelReaderSettle();
    if (!readerScrollingRef.current) return;
    readerScrollingRef.current = false;
    followNewMessagesRef.current = distanceFromBottomRef.current <= Space.lg;
  }, [cancelReaderSettle]);
  const finishScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    cancelReaderSettle();
    if (returningToBottomRef.current) {
      returningToBottomRef.current = false;
      followNewMessagesRef.current = true;
      // Include text appended while the native scroll was in flight.
      snapToEnd();
      return;
    }
    updateScrollPosition(event);
    settleReaderScroll();
  }, [cancelReaderSettle, settleReaderScroll, snapToEnd, updateScrollPosition]);
  const handleScrollEndDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    updateScrollPosition(event);
    // A slow drag may produce no momentum events. Give native momentum a
    // chance to start before deciding that the reader has stopped.
    cancelReaderSettle();
    readerSettleTimerRef.current = setTimeout(settleReaderScroll, 150);
  }, [cancelReaderSettle, settleReaderScroll, updateScrollPosition]);
  const handleTimelineLoad = useCallback(() => { loadedTimelineRef.current = timelineRef.current; }, []);
  const handleScrollBeginDrag = useCallback(() => {
    // The reader's finger takes over any glide in flight.
    cancelReaderSettle();
    cancelBottomFollow();
    endFollowGlide();
    returningToBottomRef.current = false;
    readerScrollingRef.current = true;
    followNewMessagesRef.current = false;
    setHistoryBrowsed(true);
  }, [cancelBottomFollow, cancelReaderSettle, endFollowGlide]);
  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    const changed = scrollMetricsRef.current.height !== height;
    scrollMetricsRef.current.height = height;
    if (followNewMessagesRef.current) {
      if (changed) scheduleBottomFollow();
    } else refreshScrollButton();
  }, [refreshScrollButton, scheduleBottomFollow]);
  const handleTimelineLayout = useCallback((event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    const changed = scrollMetricsRef.current.viewport !== height;
    scrollMetricsRef.current.viewport = height;
    if (followNewMessagesRef.current) {
      if (changed) scheduleBottomFollow();
    } else refreshScrollButton();
  }, [refreshScrollButton, scheduleBottomFollow]);
  useLayoutEffect(() => {
    cancelReaderSettle();
    cancelBottomFollow();
    endFollowGlide();
    followNewMessagesRef.current = true;
    returningToBottomRef.current = false;
    distanceFromBottomRef.current = 0;
    scrollMetricsRef.current = { height: 0, viewport: 0, offset: 0 };
    readerScrollingRef.current = false;
    setShowScrollToBottom(false);
    return () => { cancelBottomFollow(); cancelReaderSettle(); };
  }, [cancelBottomFollow, cancelReaderSettle, endFollowGlide, sessionKey]);
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
  // The lifted clone keeps the row's corners and tail so it covers the original exactly.
  const timelineItemsRef = useRef(timelineItems);
  timelineItemsRef.current = timelineItems;
  const renderSelectedMessage = useCallback((message: UiMessage, width: number) => {
    const row = timelineItemsRef.current.find((candidate) => candidate.type === 'message' && candidate.message.id === message.id);
    return (
      <View style={[stylesStatic.timelineItem, { width }]}>
        <ThreadMessageRowContent
          message={message}
          copy={copy}
          favorited={favoriteMessageIds?.has(message.id) ?? false}
          status={messageStatuses.get(message.id) ?? null}
          showIdentity={false}
          joinsOlder={row?.joinsOlder ?? false}
          joinsNewer={row?.joinsNewer ?? false}
          selectable
        />
      </View>
    );
  }, [copy, favoriteMessageIds, messageStatuses]);


  const openWorkRecord = useCallback((calls: ReadonlyArray<UiMessage>) => {
    const oldest = calls[calls.length - 1];
    if (oldest) setWorkRecordAnchor(oldest.renderKey ?? oldest.id);
  }, []);
  // The row renderer reads only stable values, so a streamed chunk that changes
  // one row does not hand every visible cell a new renderer.
  const hasMessageActions = Boolean(messageActions);
  const queuedTapOpensActions = Boolean(messageActions && queuedMessageActions);
  // Rows ask whether their entrance is still to play without claiming it, so
  // a row that will move starts from its first frame and a played row never hides.
  const { claimEntrance: claimRunEntrance, isEntrancePending: isRunEntrancePending } = runEntrance;
  const renderMessage = useCallback(
    ({ item, target }: ListRenderItemInfo<ThreadTimelineRow>) => {
      if (item.type === 'tools') {
        return <View style={[stylesStatic.timelineItem, rowGapStyles[item.gapAbove]]}>
          <ToolActivityPill testID={item.key} messages={item.messages} onPress={() => openWorkRecord(item.messages)} />
        </View>;
      }
      if (item.type === 'date') {
        return (
          <View style={[stylesStatic.timeSeparator, rowGapStyles[item.gapAbove]]}>
            <ServicePill testID={`thread-${item.key}`} emphasis label={item.label} />
          </View>
        );
      }
      if (item.type === 'cron') {
        // The digest slides in when it first appears while reading; a later
        // result joins it as one more line.
        const oldest = item.runs[item.runs.length - 1]!;
        return (
          <View style={[stylesStatic.timelineItem, rowGapStyles[item.gapAbove]]}>
            <MessageEntrance
              testID={`thread-entrance-${item.key}`}
              animationKey={`run:cron:${oldest.id}`}
              animate={target === 'Cell' && isRunEntrancePending(`run:cron:${oldest.id}`)}
              claimEntrance={claimRunEntrance}
              motion="reply"
            >
              <CronDigest
                testID={`thread-${item.key}`}
                runs={item.runs}
                onOpenRun={(run) => {
                  // Cron results open their execution record (owner decision
                  // 2026-09-19); without one, the session or the recorded result.
                  if (onOpenCronRun && run.cronRun) onOpenCronRun(run);
                  else if (onOpenRunSession && run.sessionKey && run.sessionAvailable !== false) onOpenRunSession(run.sessionKey, run.agentId, run.kind);
                  else setSelectedRun(run);
                }}
                onOpenLogs={onOpenRunLogs ? (run) => { if (run.jobId) onOpenRunLogs(run.jobId, run.agentId); } : undefined}
                onRerun={onRerunCron}
              />
            </MessageEntrance>
          </View>
        );
      }
      if (item.type === 'run') {
        return (
          <ThreadRunTimelineItem
            run={item.run}
            gapAbove={item.gapAbove}
            copy={copy}
            animateEntrance={target === 'Cell' && isRunEntrancePending(item.key)}
            claimEntrance={claimRunEntrance}
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
          joinsOlder={item.joinsOlder}
          joinsNewer={item.joinsNewer}
          capabilities={capabilities}
          copy={copy}
          status={messageStatuses.get(item.message.id) ?? null}
          animateEntrance={target === 'Cell' && isEntrancePending(item.message.renderKey ?? item.message.id)}
          claimEntrance={claimEntrance}
          onOpenAttachments={onOpenAttachments}
          onLongPress={hasMessageActions ? handleMessageLongPress : undefined}
          queuedTapOpensActions={queuedTapOpensActions}
          favorited={favoriteMessageIds?.has(item.message.id) ?? false}
          onResolveApproval={onResolveApproval}
        />
      );
    },
    [
      capabilities,
      copy,
      claimEntrance,
      isEntrancePending,
      favoriteMessageIds,
      handleMessageLongPress,
      hasMessageActions,
      messageStatuses,
      openWorkRecord,
      queuedTapOpensActions,
      onOpenAttachments,
      onOpenCronRun,
      onOpenRunLogs,
      onOpenRunSession,
      onRerunCron,
      onResolveApproval,
      claimRunEntrance,
      isRunEntrancePending,
    ],
  );
  const timelineContentStyle = useMemo(() => [
    styles.timelineContent,
    { paddingTop: timelineTopClearance, paddingBottom: timelineClearance },
  ], [styles.timelineContent, timelineClearance, timelineTopClearance]);
  const timelineFooter = useMemo(() => (compactionNotice ? (
    <View testID={`${testID}-compaction`} style={[stylesStatic.timelineItem, rowGapStyles.turn]}>
      <ServicePill label={compactionNotice} numberOfLines={3} />
    </View>
  ) : null), [compactionNotice, testID]);
  const previewUpgrade = sessionPreview?.hasHiddenHistory ? sessionPreview.onUpgrade : undefined;
  const timelineHeader = useMemo(() => (previewUpgrade ? <SessionPreviewNotice onUpgrade={previewUpgrade} /> : historyLoadMoreError ? (
    <Banner testID={`${testID}-history-error`} message={t('Could not load older messages', { ns: 'chat' })}
      actionLabel={copy.retry} onAction={onRetryHistory} style={styles.historyRetry} />
  ) : loadingMoreHistory && historyBrowsed ? (
    <Skeleton
      testID={`${testID}-history-more`}
      accessibilityLabel={copy.loadingHistory}
      style={styles.historyMore}
    />
  ) : null), [copy.loadingHistory, copy.retry, historyBrowsed, historyLoadMoreError, loadingMoreHistory, onRetryHistory, previewUpgrade, styles.historyMore, styles.historyRetry, t, testID]);

  return (
    <ChatPresentationProvider value={presentation}>
    <ArtifactProvider operations={artifactOperations} sessionKey={sessionKey}>
    <ThreadLiveActivityContext.Provider value={liveActivity}>
    <View testID={testID} style={[styles.screen, { backgroundColor: theme.colors.canvas }]}
      onLayout={({ nativeEvent }) => {
        const { width, height } = nativeEvent.layout;
        setScreenSize((previous) => (previous?.width === width && previous.height === height ? previous : { width, height }));
      }}>
    {/* The wallpaper sits under the whole screen and stays put while the keyboard pads the content. */}
    <ChatBackgroundLayer appearance={chatAppearance} driftStep={wallpaperDrift} />
    <KeyboardAvoidingView
      behavior="padding"
      // The keyboard already covers the home-indicator inset; retain only the control gap.
      keyboardVerticalOffset={Space.md - Math.max(bottomInset, Space.lg)}
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
          color={scrim.top}
          opacity={wallpaperActive ? scrimOpacity.top : 1}
          hold={wallpaperActive ? scrimHold : undefined}
          style={wallpaperActive ? styles.headerScrimImmersive : styles.headerScrimTail}
        />
        <FloatingButton
          testID={`${testID}-back`}
          icon={workspace.toggleRoster ? PanelLeft : ChevronLeft}
          appearance={wallpaperActive ? 'glass' : 'plain'}
          accessibilityLabel={workspace.toggleRoster ? t('Agents', { ns: 'common' }) : copy.back}
          onPress={workspace.toggleRoster ?? onBack}
        />
        <View style={styles.headerPillSlot}>
          <HeaderPill
            testID={`${testID}-header-pill`}
            agentId={agentId}
            name={headerName}
            avatarName={agentName}
            subtitle={headerSubtitle}
            presence={headerPresence}
            online={headerOnline}
            icon={isCronSession ? CalendarClock : undefined}
            emoji={agentEmoji}
            avatarUrl={agentAvatarUrl}
            platform={agentPlatform}
            status={avatarStatus}
            material={wallpaperActive ? 'glass' : 'surface'}
            warning={capabilities.sessionPermissions && permissionMode === 'full-access' ? t('Full access', { ns: 'chat' }) : undefined}
            accessibilityLabel={copy.settings}
            onPress={!locked ? onOpenSettings : undefined}
          />
        </View>
        {canOpenSessions ? <FloatingButton
          testID={`${testID}-sessions`}
          icon={MessagesSquare}
          appearance={wallpaperActive ? 'glass' : 'plain'}
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
          ) : loaderActive ? null : messages.length === 0 && (state.kind === 'error' || state.kind === 'offline') ? (
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
          ) : (
            // One list serves the empty conversation and every later message,
            // so the first send never remounts it (a fresh list paints a blank
            // frame before its first layout).
            <>
              <ThreadTimelineList
                ref={timelineRef}
                testID={`${testID}-timeline`}
                data={timelineItems}
                onLoad={handleTimelineLoad}
                onCommitLayoutEffect={handleCommittedLayout}
                onScrollBeginDrag={handleScrollBeginDrag}
                onScroll={updateScrollPosition}
                scrollEventThrottle={16}
                onMomentumScrollBegin={cancelReaderSettle}
                onMomentumScrollEnd={finishScroll}
                onContentSizeChange={handleContentSizeChange}
                onLayout={handleTimelineLayout}
                onScrollEndDrag={handleScrollEndDrag}
                getItemType={getTimelineRowType}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                keyExtractor={getTimelineRowKey}
                renderItem={renderMessage}
                contentContainerStyle={timelineContentStyle}
                onStartReached={historyLoadMoreError ? undefined : onLoadMoreHistory}
                onStartReachedThreshold={0.3}
                ListFooterComponent={timelineFooter}
                ListHeaderComponent={timelineHeader}
              />
              {state.kind === 'empty' && timelineItems.length === 0 ? (
                <Animated.View
                  testID={`${testID}-empty`}
                  pointerEvents="none"
                  exiting={reduceMotion ? undefined : EMPTY_HINT_EXIT}
                  style={[styles.emptyHint, { paddingTop: timelineTopClearance }]}
                >
                  <ServicePill label={copy.formatEmpty(agentName)} numberOfLines={3} />
                </Animated.View>
              ) : null}
            </>
          )}
          {/* One mounted loader for the wait and its exit, so the scene that waited is the one that fades away. */}
          {loaderPhase ? (
            <View
              pointerEvents={loaderPhase === 'ready' ? 'none' : 'box-none'}
              style={[StyleSheet.absoluteFill, styles.centeredState, { paddingTop: timelineTopClearance }]}
            >
              <LoadingState testID="thread-history-loading" phase={loaderPhase} message={loaderMessage.current}
                pose={connectingLabel ? 'connecting' : 'loading'}
                slowAction={connectionFailure?.onManage ? { label: t('Manage connection', { ns: 'config' }), onPress: connectionFailure.onManage } : undefined} />
            </View>
          ) : null}
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
        {wallpaperActive ? <ChatWallpaperScrim edge="bottom" color={scrim.bottom} opacity={scrimOpacity.bottom} hold={scrimHold} /> : null}
        <SessionPreviewFooter onUpgrade={sessionPreview.onUpgrade}
          onMain={sessionPreview.onMain} mainLabel={sessionPreview.mainLabel} bottomInset={bottomInset} loading={sessionPreview.loading} />
      </View> : null}
      {!locked && !sessionPreview ? readOnlyFooter : null}
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
              color={scrim.bottom} opacity={scrimOpacity.bottom} hold={scrimHold} />
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
          {pendingQuestions}
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
            notice={onReviewRuntimeSettings ? <>{selectedSkill}<Banner
              testID="thread-settings-unconfirmed"
              message={t('Confirm settings before sending.', { ns: 'chat' })}
              actionLabel={t('Review settings', { ns: 'chat' })}
              onAction={onReviewRuntimeSettings}
            /></> : selectedSkill || (composerExpanded && offline ? (
              <ConnectionStatusPill placement="inline" status="offline" message={copy.offline}
                actionLabel={onRetry ? copy.reconnect : undefined} onAction={onRetry} />
            ) : undefined)}
            testID={`${testID}-composer`}
            accessory={capabilities.models ? ({ drafting, room }: ComposerAccessorySpace) => {
              // The capsule holds the model only: permissions live in the model sheet,
              // and full access marks the header (A+ model sheet, owner decision 2026-10-01).
              const chipRoom = room == null ? null : room - Space.sm;
              return (
                <View style={styles.composerOptions}>
                  {onOpenModelPicker ? <ComposerModelChip model={model} label={modelChipLabel}
                    iconOnly={drafting || (chipRoom != null && chipRoom < COMPOSER_CHIP_NAMED_MIN_WIDTH)}
                    maxWidth={chipRoom == null ? undefined : chipRoom} onPress={onOpenModelPicker}
                    accessibilityLabel={`${t('Model settings', { ns: 'chat' })}: ${modelChipLabel}`} /> : null}
                </View>
              );
            } : undefined}
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
            onSend={() => { holdComposerForSend(); setWallpaperDrift((step) => step + 1); onSend(); setComposerExpanded(false); }}
            holdHeight={holdComposerHeight}
            // While the message is still leaving there is no run to stop yet; Stop shows, dimmed.
            onStop={canCancel && (isRunning || !sendInFlight) ? onCancel : undefined}
            onAddPress={canOpenAddMenu ? onOpenAddMenu : undefined}
            onVoicePress={canUseVoice ? onVoice : undefined}
            onVoiceStart={onVoiceStart}
            onVoiceStop={onVoiceStop}
            onVoiceCancel={onVoiceCancel}
            onVoiceRecover={onVoiceRecover}
            voiceRecoveryCount={voiceRecoveryCount}
            voiceRecordingSaved={voiceRecordingSaved}
            voiceDisabled={false}
            voiceState={canUseVoice ? voiceState : 'idle'}
            voiceLevel={voiceLevel}
            onPasteFiles={capabilities.attachments ? onPasteFiles : undefined}
            onPasteFailed={capabilities.attachments ? onPasteFailed : undefined}
            canSend={!offline && state.kind !== 'reconnecting' && canSend}
            hasAttachments={pendingAttachments.length > 0}
            isRunning={isRunning || sendInFlight}
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
      <WorkRecordSheet
        visible={workRecordSteps.length > 0}
        steps={workRecordSteps}
        onClose={() => setWorkRecordAnchor(null)}
        onOpenStep={(message) => setSelectedToolMessageId(message.id)}
      />
      <ToolDetailModal
        visible={Boolean(selectedToolMessage)}
        onClose={() => setSelectedToolMessageId(null)}
        stackBehavior="push"
        name={(selectedToolMessage ? unwrapToolCall(selectedToolMessage.toolName?.trim() ?? '', selectedToolMessage.toolArgs).name : '') || copy.tool}
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
          onBranch={messageActions.onBranch}
          canBranch={messageActions.canBranch}
          onSchedule={messageActions.onSchedule}
          canSchedule={messageActions.canSchedule}
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
    </ArtifactProvider>
    </ChatPresentationProvider>
  );
}

type ThreadTimelineListProps = Omit<
  FlashListProps<ThreadTimelineRow>,
  'data' | 'initialScrollIndex' | 'initialScrollIndexParams' | 'maintainVisibleContentPosition'
> & Readonly<{ data: ReadonlyArray<ThreadTimelineRow> }>;

/**
 * The timeline list: chronological and top-anchored, so a short conversation
 * reads down from the header like a messenger, and a conversation that fills
 * the screen opens on its newest row. FlashList's first pass renders only the
 * rows from the newest row's top down and fills in the rows above a frame or
 * two later, so a list that opens on saved rows stays invisible until its
 * first load settles: entry paints once, complete. A list that opens empty is
 * never hidden, so a first message shows the moment it is sent.
 */
const ThreadTimelineList = React.forwardRef(function ThreadTimelineList(
  { data, onLoad, ...props }: ThreadTimelineListProps,
  ref: React.ForwardedRef<FlashListRef<ThreadTimelineRow>>,
): React.JSX.Element {
  const [initialScrollIndex] = useState(() => (data.length > 0 ? data.length - 1 : undefined));
  const [placing, setPlacing] = useState(() => data.length > 0);
  const revealFrameRef = useRef<number | null>(null);
  useEffect(() => {
    if (!placing) return undefined;
    const timer = setTimeout(() => setPlacing(false), TIMELINE_PLACEMENT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [placing]);
  useEffect(() => () => {
    if (revealFrameRef.current !== null) cancelAnimationFrame(revealFrameRef.current);
  }, []);
  const handleLoad = useCallback((info: { elapsedTimeInMs: number }) => {
    onLoad?.(info);
    if (revealFrameRef.current !== null) return;
    // One more frame lets the rows above the newest one commit.
    revealFrameRef.current = requestAnimationFrame(() => {
      revealFrameRef.current = null;
      setPlacing(false);
    });
  }, [onLoad]);
  return (
    <View testID={props.testID ? `${props.testID}-frame` : undefined}
      style={[stylesStatic.timelineFill, placing ? stylesStatic.timelinePlacing : null]}>
      <FlashList
        ref={ref}
        data={data}
        initialScrollIndex={initialScrollIndex}
        initialScrollIndexParams={initialScrollIndex === undefined ? undefined : INITIAL_SCROLL_TO_END}
        onLoad={handleLoad}
        {...props}
      />
    </View>
  );
});

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
  const surfaces = useChatSurfaces();
  const sessionKey = run.sessionKey;
  const jobId = run.jobId;
  // Cron cards open the execution record (owner decision 2026-09-19); sub-agent
  // cards open their child session, or the recorded result when there is none.
  const openCronRun = run.kind === 'cron' && onOpenCronRun && run.cronRun
    ? () => onOpenCronRun(run)
    : undefined;
  const openSession = onOpenSession && sessionKey && run.sessionAvailable !== false
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
        style={{ backgroundColor: surfaces.card }}
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
  /** Bubble grouping with the same speaker's neighbours; owned by the timeline model. */
  joinsOlder: boolean;
  joinsNewer: boolean;
  capabilities: Capabilities;
  copy: ThreadCopy;
  /** Delivery glyph for the user's own settled messages. */
  status: UserMessageStatus | null;
  /** Plays the row's entrance once; latched per message id inside the row. */
  animateEntrance: boolean;
  claimEntrance: (key: string) => boolean;
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
  joinsOlder,
  joinsNewer,
  capabilities,
  copy,
  status,
  animateEntrance,
  claimEntrance,
  onOpenAttachments,
  onLongPress,
  favorited,
  queuedTapOpensActions = false,
  onResolveApproval,
}: ThreadMessageTimelineItemProps): React.JSX.Element | null {
  const { t } = useTranslation('chat');
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
  } else if (message.role === 'system') {
    content = (
      <View style={stylesStatic.timelineItem}>
        <ServicePill label={localizeAgentSystemNotice(message.text, t)} numberOfLines={3} />
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
        accessibilityLabel={[isIncomingParticipant(message) && message.attribution ? messageSenderLabel(message.attribution) : '', message.text, spokenState].filter(Boolean).join(' · ') || undefined}
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
          showIdentity={!joinsOlder}
          joinsOlder={joinsOlder}
          joinsNewer={joinsNewer}
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
        motion={message.role === 'user' && !isIncomingParticipant(message) ? 'sent' : 'reply'}
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
  joinsOlder = false,
  joinsNewer = false,
  selectable = false,
  onOpenAttachments,
  onLongPress,
}: Readonly<{
  message: UiMessage;
  copy: ThreadCopy;
  favorited: boolean;
  status?: UserMessageStatus | null;
  showIdentity?: boolean;
  /** Bubble grouping with the same speaker's neighbours (see `ThreadTimelineRow`). */
  joinsOlder?: boolean;
  joinsNewer?: boolean;
  /**
   * Text selection lives on the lifted clone only, Telegram style: in the list
   * a long press belongs to the message actions, and a selectable text view
   * there opened the system menu on top of them on iOS (owner decision 2026-09-27).
   */
  selectable?: boolean;
  onOpenAttachments?: (message: UiMessage, index?: number) => void;
  /** Row long-press forwarded to the album so photos open the same actions. */
  onLongPress?: () => void;
}>): React.JSX.Element | null {
  const { colors } = useConversationTheme();
  const surfaces = useChatSurfaces();
  const artifactWidth = useMessageAlbumWidth();
  if (message.role !== 'assistant' && message.role !== 'user') return null;
  const attachmentCount = message.imageUris?.length ?? 0;
  const fileAttachments = (message.fileAttachments ?? []).filter(file => (
    message.role !== 'user' || !file.fileName
      || !message.text.split('\n').some(line => line.trim() === `📎 ${file.fileName}`)
  ));
  // A reply that has produced no text yet still owns its bubble.
  const hasBubble = Boolean(message.text) || (message.role === 'assistant' && message.streaming === true);
  // The message's own files and photos follow its bubble: the bubble joins
  // them and leaves the tail to the group's last bubble.
  const followedBySelf = fileAttachments.length > 0 || Boolean(message.artifactAttachments?.length) || attachmentCount > 0;
  const bubbleJoinsNewer = joinsNewer || followedBySelf;
  return (
    <View testID={`thread-delivery-${message.id}`} style={stylesStatic.deliveryFrame}>
      {showIdentity && isIncomingParticipant(message) && message.attribution ? (
        <ParticipantIdentity attribution={message.attribution} testID={`thread-sender-${message.id}`} />
      ) : null}
      {hasBubble ? (
        message.role === 'assistant' ? (
          <AssistantBubble message={message} showIdentity={showIdentity} selectable={selectable}
            joinsOlder={joinsOlder} joinsNewer={bubbleJoinsNewer} />
        ) : (
          <UserBubble message={message} status={status} copy={copy} selectable={selectable}
            joinsOlder={joinsOlder} joinsNewer={bubbleJoinsNewer} />
        )
      ) : null}
      {fileAttachments.map((file, index) => (
        <SystemEventRow
          key={`${file.uri ?? file.fileName ?? file.mimeType}:${index}`}
          testID={`thread-file-${message.id}-${index}`}
          icon={Paperclip}
          label={file.fileName?.trim() || copy.file}
          style={[stylesStatic.fileAttachment, { backgroundColor: surfaces.card },
            message.role === 'user' && !isIncomingParticipant(message) ? stylesStatic.fileAttachmentUser : null]}
        />
      ))}
      {message.artifactAttachments?.length ? <ArtifactAttachments attachments={message.artifactAttachments} maxWidth={artifactWidth}
        onOpenImage={uri => onOpenAttachments?.({ ...message, imageUris: [uri] }, 0)} /> : null}
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
      {message.role === 'user' && message.delivery === 'held' && copy.heldHint ? (
        <Text testID={`thread-held-${message.id}`} style={{ alignSelf: 'flex-end', color: colors.inkSecondary, fontSize: FontSize.caption, lineHeight: LineHeight.caption, paddingTop: Space.xs }}>{copy.heldHint}</Text>
      ) : null}
      {favorited ? (
        <FavoriteIndicator messageId={message.id} role={isIncomingParticipant(message) ? 'assistant' : message.role} />
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
  selectable = false,
  joinsOlder = false,
  joinsNewer = false,
}: Readonly<{
  message: UiMessage;
  status: UserMessageStatus | null;
  copy: ThreadCopy;
  selectable?: boolean;
  joinsOlder?: boolean;
  joinsNewer?: boolean;
}>): React.JSX.Element {
  const incoming = isIncomingParticipant(message);
  const typography = useBubbleTypography(incoming ? 'assistant' : 'user');
  const time = useMessageClock(message);
  if (incoming) status = null;
  const hasMeta = Boolean(time) || Boolean(status);
  return (
    <Bubble testID={`thread-bubble-${message.id}`} role={incoming ? "assistant" : "user"} joinsOlder={joinsOlder} joinsNewer={joinsNewer}>
      <View style={stylesStatic.userBody}>
        <Text selectable={selectable} style={typography}>
          {message.text}
          {hasMeta ? <Text style={stylesStatic.metaSpacer}>{messageMetaSpacer(time, Boolean(status))}</Text> : null}
        </Text>
        {hasMeta ? (
          <MessageMeta
            testID={`thread-meta-${message.id}`}
            time={time}
            tone={incoming ? "neutral" : "accent"}
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
  const incoming = isIncomingParticipant(message);
  if (incoming) status = null;
  if (!time && !status) return null;
  return (
    <MessageMeta
      testID={`thread-meta-${message.id}`}
      time={time}
      tone={incoming ? "neutral" : "accent"}
      status={status}
      statusLabel={statusCopy(status, copy)}
      style={incoming ? undefined : stylesStatic.metaRowUser}
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
      align={message.role === 'user' && !isIncomingParticipant(message) ? 'end' : 'start'}
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

/** Approval glyphs reuse the tool-row vocabulary so a request reads as the tool it will run. */
function approvalCategoryIcon(
  category: Exclude<NonNullable<UiMessage['approval']>, { kind: 'pair' }>['category'],
): typeof Terminal {
  if (category === 'file') return FilePenLine;
  if (category === 'network') return Globe;
  if (category === 'permissions') return Shield;
  return Terminal;
}

/** An approval the person can still answer is on screen (supported kind, not yet expired). */
function hasPendingApproval(messages: ReadonlyArray<UiMessage>, capabilities: Capabilities, nowMs: number): boolean {
  return messages.some(({ approval }) => approval?.status === 'pending'
    && (approval.kind === 'pair' ? capabilities.pairRequests : capabilities.execApproval)
    && (approval.kind === 'pair' || approval.expiresAtMs === null || approval.expiresAtMs > nowMs));
}

function approvalOutcome(
  status: Exclude<UiApprovalStatus, 'pending'>,
  copy: ThreadCopy,
): ApprovalCardOutcome {
  return {
    kind: status,
    label: status === 'allowed' ? copy.allowed : status === 'denied' ? copy.denied : copy.expired,
  };
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
    return (
      <View style={stylesStatic.timelineItem}>
        <ApprovalCard
          testID={`thread-approval-${messageId}`}
          icon={approval.target === 'node' ? Server : MonitorSmartphone}
          title={title}
          detail={copy.pairApprovalDetail}
          error={approval.resolutionError ? copy.approvalError : undefined}
          busy={approval.resolving === true}
          outcome={approval.status === 'pending' ? undefined : approvalOutcome(approval.status, copy)}
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
  const { t } = useTranslation(['chat', 'common']);
  const [confirmAlwaysId, setConfirmAlwaysId] = useState<string | null>(null);
  const [deadlineExpired, setDeadlineExpired] = useState(
    () => approval.status === 'pending' && approval.expiresAtMs !== null && approval.expiresAtMs <= Date.now(),
  );

  useEffect(() => {
    if (approval.status !== 'pending' || approval.expiresAtMs === null) {
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
  const canAllowAlways = !resolved && !approval.resolving && Boolean(onResolveApproval)
    && (!approval.decisions || approval.decisions.includes('allow-always'));

  return (
    <View style={stylesStatic.timelineItem}>
      <ApprovalCard
        testID={`thread-approval-${messageId}`}
        icon={approvalCategoryIcon(approval.category)}
        title={approval.category && approval.category !== 'command' ? t('Allow this action?', { ns: 'chat' }) : copy.approvalTitle}
        command={approval.command}
        detail={approval.reason}
        error={approval.resolutionError ? copy.approvalError : undefined}
        busy={approval.resolving === true}
        outcome={resolved ? approvalOutcome(approval.status === 'pending' ? 'expired' : approval.status, copy) : undefined}
        primaryAction={{
          label: copy.allow,
          onPress: () => onResolveApproval?.(approval.id, 'allow-once'),
          onLongPress: canAllowAlways ? () => {
            Keyboard.dismiss();
            setConfirmAlwaysId(approval.id);
          } : undefined,
          disabled: !onResolveApproval || approval.resolving === true || Boolean(approval.decisions && !approval.decisions.includes('allow-once')),
          accessibilityLabel: copy.allow,
        }}
        secondaryAction={{
          label: copy.reject,
          onPress: () => onResolveApproval?.(approval.id, 'deny'),
          disabled: !onResolveApproval || approval.resolving === true,
          accessibilityLabel: copy.reject,
        }}
      />
      <ConfirmationModal
        testID="approval-always"
        visible={confirmAlwaysId === approval.id && canAllowAlways}
        title={t('Always allow?')}
        message={t('Future matching commands will not ask again.')}
        cancelLabel={t('Cancel', { ns: 'common' })}
        confirmLabel={copy.allow}
        onClose={() => setConfirmAlwaysId(null)}
        onConfirm={() => {
          if (confirmAlwaysId !== approval.id || !canAllowAlways) return;
          setConfirmAlwaysId(null);
          onResolveApproval?.(approval.id, 'allow-always');
        }}
      />
    </View>
  );
}

function AssistantBubble({
  message,
  showIdentity = true,
  selectable = false,
  joinsOlder = false,
  joinsNewer = false,
}: {
  message: UiMessage;
  showIdentity?: boolean;
  selectable?: boolean;
  joinsOlder?: boolean;
  joinsNewer?: boolean;
}): React.JSX.Element {
  const theme = useConversationTheme();
  const { fontSize, identity } = useChatPresentation();
  const time = useMessageClock(message);
  const selectionMenu = useMarkdownSelectionMenu();
  const markdownStyle = useMemo(
    () => createChatMarkdownStyle(theme.colors, fontSize),
    [theme.colors, fontSize],
  );
  // Chunks land in socket-sized bursts; the pacer feeds the native markdown
  // view word-sized increments so its tail fade-in reads as a cascade. Once
  // the run ends the pacer drains the remainder, then the settled text shows.
  const pacedText = useSmoothedStreamText(message.text, message.streaming === true);
  const textAnimating = message.streaming === true || pacedText !== message.text;
  // Keep the placeholder until the pacer has visible text, never an empty
  // markdown bubble: between the first network chunk and its first shown
  // word, and at completion, when a reply that showed no words yet arrives
  // whole and the pacer publishes it a commit later (device check
  // 2026-10-01: the empty bubble, clock and tail flashed for about 30 ms).
  const thinking = textAnimating && pacedText.trim().length === 0;
  // The final words land while the view is still in streaming mode; the mode
  // switch follows in a commit that leaves the text alone.
  const streamingAnimation = useStreamingSettleHold(textAnimating, message.renderKey ?? message.id);
  const displayText = useMemo(() => {
    if (!textAnimating) return message.text;
    // No synthetic cursor: the native view animates only truly appended tail
    // content, so a trailing glyph would absorb the fade and hide the effect.
    return remend(pacedText, STREAMING_REMEND_OPTIONS);
  }, [message.text, pacedText, textAnimating]);

  // Until the first words show, the reply is a live pill (A+ chat design):
  // the same row becomes the bubble, so the cell never remounts.
  if (thinking) return <ThinkingPill testID={`thread-thinking-${message.id}`} />;

  return (
    <View>
    {identity && showIdentity ? <ChatMessageIdentity {...identity} /> : null}
    <Bubble
      testID={`thread-bubble-${message.id}`}
      role="assistant"
      joinsOlder={joinsOlder}
      joinsNewer={joinsNewer}
    >
      <View>
        <EnrichedMarkdownText
          testID={`thread-markdown-${message.id}`}
          flavor={THREAD_MARKDOWN_FLAVOR}
          markdown={displayText}
          markdownStyle={markdownStyle}
          textBreakStrategy={CHAT_MARKDOWN_BREAK_STRATEGY}
          onLinkPress={openChatMarkdownLink}
          selectable={selectable}
          selectionMenuConfig={selectionMenu}
          streamingAnimation={streamingAnimation}
        />
        {time ? (
          <View>
            <MessageMeta testID={`thread-meta-${message.id}`} time={time} style={stylesStatic.metaRowAssistant} />
          </View>
        ) : null}
      </View>
    </Bubble>
    </View>
  );
}

const COMPOSER_CHIP_HIT_SLOP = { top: (HitSize.md - HitSize.sm) / 2, bottom: (HitSize.md - HitSize.sm) / 2 } as const;
const COMPOSER_CHIP_MAX_WIDTH = 148;
// Below this the name would shrink to a letter or two; the mark alone says more.
const COMPOSER_CHIP_NAMED_MIN_WIDTH = HitSize.sm + 44;

/**
 * The model chip inside the composer capsule (A+ chat design, owner decision
 * 2026-09-30): the model's mark and short name on a faint tint of the user's
 * bubble color. While a draft is written only the mark stays, leaving the
 * words the room. It opens the model sheet (thinking, context, project).
 */
function ComposerModelChip({ model, label, iconOnly, maxWidth, onPress, accessibilityLabel }: Readonly<{
  model?: string | null;
  label: string;
  iconOnly: boolean;
  /** The room beside the whole placeholder; the name ellipsizes into it. */
  maxWidth?: number;
  onPress: () => void;
  accessibilityLabel: string;
}>): React.JSX.Element {
  const { theme } = useAppTheme();
  const surfaces = useChatSurfaces();
  const tint = useMemo(() => withAlpha(surfaces.outgoing.backgroundColor, 0.1), [surfaces.outgoing.backgroundColor]);
  return (
    <Pressable testID="thread-model-picker" accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      onPress={onPress} hitSlop={COMPOSER_CHIP_HIT_SLOP}
      style={({ pressed }) => [composerChipStyles.chip, iconOnly ? composerChipStyles.iconOnly : null,
        { backgroundColor: tint, opacity: pressed ? 0.7 : 1 },
        !iconOnly && maxWidth != null ? { maxWidth: Math.min(COMPOSER_CHIP_MAX_WIDTH, maxWidth) } : null]}>
      <ModelIcon compact id={model} testID="thread-model-icon" />
      {iconOnly ? null : <Text testID="thread-model-label" numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.3}
        style={[composerChipStyles.label, { color: theme.colors.ink }]}>{label}</Text>}
    </Pressable>
  );
}

const composerChipStyles = StyleSheet.create({
  chip: {
    minHeight: HitSize.sm,
    maxWidth: COMPOSER_CHIP_MAX_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingLeft: Space.xs,
    paddingRight: Space.sm,
    borderRadius: Radius.full,
  },
  iconOnly: { width: HitSize.sm, paddingLeft: 0, paddingRight: 0, justifyContent: 'center' },
  label: { flexShrink: 1, minWidth: 0, fontSize: FontSize.caption, lineHeight: LineHeight.caption, fontWeight: FontWeight.semibold },
});

/** The reply before its first words: a spinner, what the Agent is doing, and how long this turn has run. */
function ThinkingPill({ testID }: Readonly<{ testID: string }>): React.JSX.Element {
  const { t } = useTranslation('chat');
  const live = useContext(ThreadLiveActivityContext);
  const elapsed = useElapsed(live.startedAt);
  const time = elapsed !== undefined && elapsed >= 1000 ? formatActivityDuration(elapsed, t) : undefined;
  return (
    <View testID={`${testID}-row`} accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>
      <ServicePill testID={testID} busy label={live.label} stepKey={live.label} trailing={time}
        accessibilityLabel={[live.label, time].filter(Boolean).join(', ')} />
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
// list's own top/bottom insets frame the oldest and newest rows. Bubbles of
// one speaker sit 2 points apart as one group, Telegram style (A+ chat
// design, owner decision 2026-09-30).
const rowGapStyles = StyleSheet.create<Record<ThreadRowGap, ViewStyle>>({
  none: {},
  joined: { paddingTop: Space.xs / 2 },
  stack: { paddingTop: Space.sm },
  turn: { paddingTop: Space.md },
  section: { paddingTop: Space.lg },
});

const stylesStatic = StyleSheet.create({
  timelineFill: { flex: 1 },
  timelinePlacing: { opacity: 0 },
  // A time label heads the group below it: its gap above comes from the
  // rhythm, and it owns the space down to the first row of the group.
  timeSeparator: { alignItems: 'center', paddingBottom: Space.md },
  timelineItem: {
    width: '100%',
    maxWidth: IPAD_CHAT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: THREAD_ROW_INSET,
    gap: Space.xs,
  },
  // A file sits on the wallpaper as a small card-colored chip beside its bubble.
  fileAttachment: {
    alignSelf: 'flex-start',
    paddingHorizontal: Space.md,
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
  userBody: {
    position: 'relative',
  },
  // Same glyphs as the visible meta, painted invisibly, so the last text line
  // leaves exactly enough room for the overlay.
  metaSpacer: {
    color: 'transparent',
    fontSize: FontSize.meta,
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
    // The empty conversation's hint floats over the (empty) list it replaces.
    emptyHint: {
      ...StyleSheet.absoluteFill,
      justifyContent: 'center',
      paddingHorizontal: Space.lg,
    },
    historyRetry: { marginHorizontal: Space.lg, marginVertical: Space.sm },
    historyMore: {
      alignSelf: 'center',
      width: '24%',
      marginVertical: Space.md,
    },
    composer: {
      marginHorizontal: Space.md,
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
    composerOptions: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, flexShrink: 1, minWidth: 0, marginLeft: Space.sm },
  });
}
