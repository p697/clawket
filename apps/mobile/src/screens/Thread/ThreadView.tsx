import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
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
  Brain,
  CalendarDays,
  ChevronLeft,
  CircleAlert,
  Info,
  MessageCircle,
  Paperclip,
  Settings,
  Star,
  WifiOff,
} from 'lucide-react-native';
import type { PendingImage, UiMessage } from '../../types/chat';
import type { SlashCommand } from '../../data/slash-commands';
import type { ThinkingLevel } from '../../utils/gateway-settings';
import { useAppTheme } from '../../theme';
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
import { Bubble } from '../../components/ui/Bubble';
import {
  Composer,
  type ComposerHandle,
  type ComposerProps,
} from '../../components/ui/Composer';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { HeaderTextAction } from '../../components/ui/HeaderTextAction';
import { HeaderPill } from '../../components/ui/HeaderPill';
import { RunCard } from '../../components/ui/RunCard';
import { Skeleton } from '../../components/ui/Skeleton';
import { SystemEventRow } from '../../components/ui/SystemEventRow';
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
  resolveThreadHeaderName,
  resolveThreadHeaderSubtitle,
  type ThreadContentState,
  type ThreadRunCard,
  type ThreadTimelineItem,
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
  file: string;
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
  logs: string;
  formatAsk: (name: string) => string;
  formatEmpty: (name: string) => string;
  formatAttachments: (count: number) => string;
  formatRunDetail: (status: string, time: string) => string;
  formatModelContext: (model: string, remainingPercent: number) => string;
  formatThinkingLevel: (level: string) => string;
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
  onChangeInput: (value: string) => void;
  onSend: () => void;
  composerRef?: React.Ref<ComposerHandle>;
  onCancel?: () => void;
  onOpenAddMenu?: () => void;
  onVoice?: () => void;
  onRetry?: () => void;
  onOpenPaywall?: () => void;
  onErrorAction?: (state: Extract<ThreadContentState, { kind: 'error' }>) => void;
  onLoadMoreHistory?: () => void;
  onOpenRunSession?: (
    sessionKey: string,
    agentId: string | undefined,
    kind: ThreadRunCard['kind'],
  ) => void;
  onOpenRunLogs?: (jobId: string, agentId?: string) => void;
  onOpenAttachments?: (message: UiMessage) => void;
  onMessageLongPress?: (message: UiMessage) => void;
  favoriteMessageIds?: ReadonlySet<string>;
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
  onChangeInput,
  onSend,
  composerRef,
  onCancel,
  onOpenAddMenu,
  onVoice,
  onRetry,
  onOpenPaywall,
  onErrorAction,
  onLoadMoreHistory,
  onOpenRunSession,
  onOpenRunLogs,
  onOpenAttachments,
  onMessageLongPress,
  favoriteMessageIds,
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
  const [selectedToolMessageId, setSelectedToolMessageId] = useState<string | null>(null);
  const selectedToolMessage = selectedToolMessageId
    ? messages.find((message) => message.id === selectedToolMessageId) ?? null
    : null;
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
  const timelineItems = useMemo(() => buildThreadTimelineItems({
    messages,
    runs: runCards,
    locale,
  }), [locale, messages, runCards]);

  useEffect(() => {
    if (selectedToolMessageId && !selectedToolMessage) {
      setSelectedToolMessageId(null);
    }
  }, [selectedToolMessage, selectedToolMessageId]);

  const renderMessage = useCallback(
    ({ item }: ListRenderItemInfo<ThreadTimelineItem>) => {
      if (item.type === 'date') {
        return (
          <View style={stylesStatic.timelineItem}>
            <SystemEventRow
              testID={`thread-${item.key}`}
              icon={CalendarDays}
              label={item.label}
            />
          </View>
        );
      }
      if (item.type === 'run') {
        return (
          <ThreadRunTimelineItem
            run={item.run}
            copy={copy}
            onOpenSession={onOpenRunSession}
            onOpenLogs={onOpenRunLogs}
          />
        );
      }
      return (
        <ThreadMessageTimelineItem
          message={item.message}
          capabilities={capabilities}
          copy={copy}
          onOpenTool={(message) => setSelectedToolMessageId(message.id)}
          onOpenAttachments={onOpenAttachments}
          onLongPress={onMessageLongPress}
          favorited={favoriteMessageIds?.has(item.message.id) ?? false}
          onResolveApproval={onResolveApproval}
        />
      );
    },
    [
      capabilities,
      copy,
      favoriteMessageIds,
      onMessageLongPress,
      onOpenAttachments,
      onOpenRunLogs,
      onOpenRunSession,
      onResolveApproval,
    ],
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
            data={timelineItems}
            inverted
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.key}
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
        <View
          testID={`${testID}-composer-region`}
          style={[styles.composerRegion, { paddingBottom: Math.max(bottomInset, Space.lg) }]}
        >
          {showSlashSuggestions && onSelectSlashCommand ? (
            <View style={styles.slashSuggestions}>
              <Pressable
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
          {thinkingLevel && thinkingLevel !== 'off' && onSelectThinkingLevel ? (
            <ThinkingLevelMenu
              current={thinkingLevel}
              onSelect={onSelectThinkingLevel}
              options={thinkingLevelOptions}
              style={styles.thinkingMenu}
            >
              <View testID={`${testID}-thinking-level`} style={styles.thinkingChip}>
                <Brain size={FontSize.caption} color={theme.colors.accent} strokeWidth={2} />
                <Text style={styles.thinkingText}>{copy.formatThinkingLevel(thinkingLevel)}</Text>
              </View>
            </ThinkingLevelMenu>
          ) : null}
          {pendingAttachments.length > 0
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
          <Composer
            ref={composerRef}
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
            onPasteFiles={capabilities.attachments ? onPasteFiles : undefined}
            onPasteFailed={capabilities.attachments ? onPasteFailed : undefined}
            canSend={!offline && canSend}
            isRunning={isRunning}
            editable
            style={styles.composer}
          />
        </View>
      ) : null}
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
    </KeyboardAvoidingView>
  );
}

function ThreadRunTimelineItem({
  run,
  copy,
  onOpenSession,
  onOpenLogs,
}: Readonly<{
  run: ThreadRunCard;
  copy: ThreadCopy;
  onOpenSession?: ThreadViewProps['onOpenRunSession'];
  onOpenLogs?: ThreadViewProps['onOpenRunLogs'];
}>): React.JSX.Element {
  const sessionKey = run.sessionKey;
  const jobId = run.jobId;
  const openSession = onOpenSession && sessionKey
    ? () => onOpenSession(sessionKey, run.agentId, run.kind)
    : undefined;
  const openLogs = run.canOpenLogs && onOpenLogs && jobId
    ? () => onOpenLogs(jobId, run.agentId)
    : undefined;
  return (
    <View style={stylesStatic.timelineItem}>
      <RunCard
        testID={`thread-${run.kind}-run-${run.id}`}
        title={run.title}
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
        onPress={openSession}
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
  onOpenTool: (message: UiMessage) => void;
  onOpenAttachments?: (message: UiMessage) => void;
  onLongPress?: (message: UiMessage) => void;
  favorited: boolean;
  onResolveApproval?: ThreadViewProps['onResolveApproval'];
}>;

function ThreadMessageTimelineItem({
  message,
  capabilities,
  copy,
  onOpenTool,
  onOpenAttachments,
  onLongPress,
  favorited,
  onResolveApproval,
}: ThreadMessageTimelineItemProps): React.JSX.Element | null {
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
          onPress={() => onOpenTool(message)}
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
  const fileAttachments = message.fileAttachments ?? [];
  return (
    <Pressable
      testID={`thread-message-${message.id}`}
      accessibilityRole={onLongPress ? 'button' : undefined}
      delayLongPress={220}
      onLongPress={onLongPress ? () => onLongPress(message) : undefined}
      style={stylesStatic.timelineItem}
    >
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
      {favorited ? (
        <FavoriteIndicator messageId={message.id} role={message.role} />
      ) : null}
    </Pressable>
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
    },
    composerRegion: {
      gap: Space.sm,
      paddingTop: Space.sm,
      backgroundColor: colors.canvas,
    },
    slashSuggestions: {
      paddingHorizontal: Space.lg,
      zIndex: 2,
    },
    thinkingMenu: {
      alignSelf: 'flex-start',
      marginLeft: Space.lg,
    },
    thinkingChip: {
      minHeight: ControlSize.pill,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
      borderRadius: Radius.full,
      paddingHorizontal: Space.md,
      backgroundColor: colors.accentSoft,
    },
    thinkingText: {
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
      fontWeight: FontWeight.semibold,
    },
  });
}
