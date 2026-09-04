import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { Capabilities } from '@clawket/agent-protocol';
import {
  ChevronLeft,
  CircleAlert,
  Info,
  MessageCircle,
  Paperclip,
  Settings,
  WifiOff,
} from 'lucide-react-native';
import type { UiMessage } from '../../types/chat';
import { useAppTheme } from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  LineHeight,
  Motion,
  Space,
} from '../../theme/tokens';
import { ApprovalCard } from '../../components/ui/ApprovalCard';
import { Banner } from '../../components/ui/Banner';
import { Bubble } from '../../components/ui/Bubble';
import { Composer } from '../../components/ui/Composer';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { HeaderPill } from '../../components/ui/HeaderPill';
import { RunCard } from '../../components/ui/RunCard';
import { Skeleton } from '../../components/ui/Skeleton';
import { SystemEventRow } from '../../components/ui/SystemEventRow';
import {
  createChatMarkdownStyle,
  getChatMarkdownFlavor,
  openChatMarkdownLink,
} from '../../components/chat/chatMarkdown';
import type { ThreadContentState } from './model';
import {
  resolveThreadHeaderName,
  resolveThreadHeaderSubtitle,
} from './model';

const THREAD_MARKDOWN_FLAVOR = getChatMarkdownFlavor();

export type ThreadCopy = Readonly<{
  back: string;
  settings: string;
  openSessions: string;
  add: string;
  voice: string;
  send: string;
  stop: string;
  reconnect: string;
  offline: string;
  thinking: string;
  loadingHistory: string;
  locked: string;
  viewPro: string;
  retry: string;
  tool: string;
  toolRunning: string;
  toolCompleted: string;
  toolFailed: string;
  approvalTitle: string;
  allow: string;
  reject: string;
  allowed: string;
  denied: string;
  expired: string;
  formatAsk: (name: string) => string;
  formatEmpty: (name: string) => string;
  formatAttachments: (count: number) => string;
  formatModelContext: (model: string, remainingPercent: number) => string;
}>;

export type ThreadViewProps = Readonly<{
  agentId: string;
  agentName: string;
  agentEmoji?: string | null;
  sessionTitle?: string | null;
  isMainSession?: boolean;
  model?: string | null;
  contextUsed?: number;
  contextWindow?: number;
  activityLabel?: string | null;
  capabilities: Capabilities;
  state: ThreadContentState;
  messages: ReadonlyArray<UiMessage>;
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
  onChangeInput: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  onOpenAddMenu?: () => void;
  onVoice?: () => void;
  onRetry?: () => void;
  onOpenPaywall?: () => void;
  onErrorAction?: (state: Extract<ThreadContentState, { kind: 'error' }>) => void;
  onLoadMoreHistory?: () => void;
  onOpenRun?: (message: UiMessage) => void;
  onOpenAttachments?: (message: UiMessage) => void;
  onResolveApproval?: (
    approvalId: string,
    decision: 'allow-once' | 'allow-always' | 'deny',
  ) => void;
  testID?: string;
}>;

export function ThreadView({
  agentId,
  agentName,
  agentEmoji,
  sessionTitle,
  isMainSession = true,
  model,
  contextUsed,
  contextWindow,
  activityLabel,
  capabilities,
  state,
  messages,
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
  onChangeInput,
  onSend,
  onCancel,
  onOpenAddMenu,
  onVoice,
  onRetry,
  onOpenPaywall,
  onErrorAction,
  onLoadMoreHistory,
  onOpenRun,
  onOpenAttachments,
  onResolveApproval,
  testID = 'thread-screen',
}: ThreadViewProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const offline = state.kind === 'offline';
  const locked = state.kind === 'locked';
  const headerName = resolveThreadHeaderName(agentName, sessionTitle, isMainSession);
  const headerSubtitle = resolveThreadHeaderSubtitle({
    capabilities,
    state,
    isRunning,
    activityLabel,
    model,
    contextUsed,
    contextWindow,
    offlineLabel: copy.offline,
    thinkingLabel: copy.thinking,
    formatModelContext: copy.formatModelContext,
  });
  const avatarStatus = locked
    ? 'locked'
    : offline
      ? 'offline'
      : isRunning
        ? 'working'
        : 'idle';
  const canOpenSessions = capabilities.sessions && Boolean(onOpenSessionPanel);
  const canOpenAddMenu = (capabilities.attachments || capabilities.skills)
    && Boolean(onOpenAddMenu);
  const canUseVoice = Boolean(onVoice);
  const canCancel = capabilities.abort && Boolean(onCancel);
  const hasBanner = state.kind === 'offline' || state.kind === 'error';
  const headerClearance = topInset
    + Space.sm
    + ControlSize.floatingButton
    + Space.xl;
  const timelineClearance = headerClearance
    + (hasBanner ? ControlSize.floatingButton + Space.sm : 0);

  const renderMessage = useCallback(
    ({ item }: ListRenderItemInfo<UiMessage>) => (
      <ThreadTimelineItem
        message={item}
        capabilities={capabilities}
        copy={copy}
        onOpenRun={onOpenRun}
        onOpenAttachments={onOpenAttachments}
        onResolveApproval={onResolveApproval}
      />
    ),
    [capabilities, copy, onOpenAttachments, onOpenRun, onResolveApproval],
  );

  return (
    <KeyboardAvoidingView
      testID={testID}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { backgroundColor: theme.colors.canvas }]}
    >
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
            subtitle={headerSubtitle}
            emoji={agentEmoji}
            status={avatarStatus}
            accessibilityLabel={copy.openSessions}
            onPress={!locked && canOpenSessions ? onOpenSessionPanel : undefined}
          />
        </View>
        <FloatingButton
          testID={`${testID}-settings`}
          icon={Settings}
          accessibilityLabel={copy.settings}
          onPress={onOpenSettings}
          disabled={locked}
        />
      </View>

      {state.kind === 'offline' ? (
        <Banner
          testID={`${testID}-offline`}
          icon={WifiOff}
          message={copy.offline}
          actionLabel={onRetry ? copy.reconnect : undefined}
          onAction={onRetry}
          style={[styles.banner, { top: headerClearance }]}
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
          style={[styles.banner, { top: headerClearance }]}
        />
      ) : null}

      <View style={styles.timeline}>
        {state.kind === 'loading' ? (
          <ThreadHistorySkeleton copy={copy} topInset={timelineClearance} />
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
            testID={`${testID}-timeline`}
            data={messages as UiMessage[]}
            inverted
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={[
              styles.timelineContent,
              { paddingBottom: timelineClearance },
            ]}
            onEndReached={onLoadMoreHistory}
            onEndReachedThreshold={0.3}
            ListFooterComponent={loadingMoreHistory ? (
              <Skeleton
                testID={`${testID}-history-more`}
                accessibilityLabel={copy.loadingHistory}
                style={styles.historyMore}
              />
            ) : null}
          />
        )}
      </View>

      {!locked && capabilities.chat ? (
        <Composer
          testID={`${testID}-composer`}
          value={input}
          placeholder={copy.formatAsk(agentName)}
          accessibilityLabels={{
            add: copy.add,
            voice: copy.voice,
            send: copy.send,
            stop: copy.stop,
          }}
          onChangeText={onChangeInput}
          onSend={onSend}
          onStop={canCancel ? onCancel : undefined}
          onAddPress={canOpenAddMenu ? onOpenAddMenu : undefined}
          onVoicePress={canUseVoice ? onVoice : undefined}
          canSend={!offline && canSend}
          isRunning={isRunning}
          editable
          style={[styles.composer, { paddingBottom: Math.max(bottomInset, Space.lg) }]}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

type ThreadTimelineItemProps = Readonly<{
  message: UiMessage;
  capabilities: Capabilities;
  copy: ThreadCopy;
  onOpenRun?: (message: UiMessage) => void;
  onOpenAttachments?: (message: UiMessage) => void;
  onResolveApproval?: ThreadViewProps['onResolveApproval'];
}>;

function ThreadTimelineItem({
  message,
  capabilities,
  copy,
  onOpenRun,
  onOpenAttachments,
  onResolveApproval,
}: ThreadTimelineItemProps): React.JSX.Element | null {
  if (message.approval) {
    if (!capabilities.execApproval) return null;
    return (
      <ThreadApprovalTimelineItem
        messageId={message.id}
        approval={message.approval}
        copy={copy}
        onResolveApproval={onResolveApproval}
      />
    );
  }

  if (message.role === 'tool') {
    const detail = message.toolStatus === 'running'
      ? copy.toolRunning
      : message.toolStatus === 'error'
        ? copy.toolFailed
        : copy.toolCompleted;
    return (
      <View style={stylesStatic.timelineItem}>
        <RunCard
          testID={`thread-run-${message.id}`}
          title={message.toolName?.trim() || copy.tool}
          detail={detail}
          tone={message.toolStatus === 'error' ? 'bad' : message.toolStatus === 'running' ? 'warn' : 'accent'}
          onPress={onOpenRun ? () => onOpenRun(message) : undefined}
        />
      </View>
    );
  }

  if (message.role === 'system') {
    return (
      <View style={stylesStatic.timelineItem}>
        <SystemEventRow icon={Info} label={message.text} />
      </View>
    );
  }

  if (message.role !== 'assistant' && message.role !== 'user') return null;
  const attachmentCount = message.imageUris?.length ?? 0;
  return (
    <View style={stylesStatic.timelineItem}>
      {message.text ? (
        message.role === 'assistant' ? (
          <AssistantBubble message={message} />
        ) : (
          <Bubble
            testID={`thread-bubble-${message.id}`}
            role={message.role}
          >
            {message.text}
          </Bubble>
        )
      ) : null}
      {attachmentCount > 0 ? (
        <SystemEventRow
          icon={Paperclip}
          label={copy.formatAttachments(attachmentCount)}
          onPress={onOpenAttachments ? () => onOpenAttachments(message) : undefined}
        />
      ) : null}
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

function AssistantBubble({ message }: { message: UiMessage }): React.JSX.Element {
  const { theme } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const cursorOpacity = useSharedValue(1);
  const cursorStyle = useAnimatedStyle(() => ({ opacity: cursorOpacity.value }));
  const markdownStyle = useMemo(
    () => createChatMarkdownStyle(theme.colors, FontSize.body),
    [theme.colors],
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
    <Bubble
      testID={`thread-bubble-${message.id}`}
      role="assistant"
    >
      <View>
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
        ) : null}
      </View>
    </Bubble>
  );
}

function ThreadHistorySkeleton({
  copy,
  topInset,
}: {
  copy: ThreadCopy;
  topInset: number;
}): React.JSX.Element {
  return (
    <View
      testID="thread-history-loading"
      accessibilityLabel={copy.loadingHistory}
      style={[stylesStatic.skeletonList, { paddingTop: topInset }]}
    >
      <Skeleton testID="thread-history-skeleton-1" style={stylesStatic.skeletonAssistant} />
      <Skeleton testID="thread-history-skeleton-2" style={stylesStatic.skeletonUser} />
      <Skeleton testID="thread-history-skeleton-3" style={stylesStatic.skeletonAssistantWide} />
    </View>
  );
}

const stylesStatic = StyleSheet.create({
  streamingCursor: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.regular,
  },
  timelineItem: {
    paddingHorizontal: Space.lg,
    paddingVertical: Space.xs,
    gap: Space.xs,
  },
  skeletonList: {
    flex: 1,
    justifyContent: 'flex-end',
    gap: Space.lg,
    padding: Space.lg,
  },
  skeletonAssistant: {
    alignSelf: 'flex-start',
    width: '58%',
    height: LineHeight.body + Space.xl,
  },
  skeletonUser: {
    alignSelf: 'flex-end',
    width: '46%',
    height: LineHeight.body + Space.lg,
  },
  skeletonAssistantWide: {
    alignSelf: 'flex-start',
    width: '76%',
    height: LineHeight.body + Space.xxl,
  },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: {
      flex: 1,
    },
    header: {
      position: 'absolute',
      top: 0,
      right: 0,
      left: 0,
      zIndex: 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      paddingHorizontal: Space.xs,
      paddingBottom: Space.xl,
    },
    headerPillSlot: {
      flex: 1,
      alignItems: 'center',
      minWidth: 0,
    },
    banner: {
      position: 'absolute',
      right: Space.lg,
      left: Space.lg,
      zIndex: 2,
    },
    timeline: {
      flex: 1,
      minHeight: 0,
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
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      backgroundColor: colors.canvas,
    },
  });
}
