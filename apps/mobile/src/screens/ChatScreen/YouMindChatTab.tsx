import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated as RNAnimated,
  Image,
  InteractionManager,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useTranslation } from 'react-i18next';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { DrawerContentComponentProps, createDrawerNavigator, useDrawerProgress } from '@react-navigation/drawer';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { useAppContext } from '../../contexts/AppContext';
import { SessionSidebar } from '../../components/chat/SessionSidebar';
import { ChatHeader } from '../../components/chat/ChatHeader';
import { ImagePreviewModal } from '../../components/chat/ImagePreviewModal';
import { YouMindSignInPanel } from '../../components/youmind/YouMindSignInPanel';
import { ChatMessagePane } from './components/ChatMessagePane';
import { ChatComposerPane } from './components/ChatComposerPane';
import { SelectedMessageOverlay } from './components/SelectedMessageOverlay';
import {
  YouMindSkillPickerModal,
  type YouMindSkillPickerModalHandle,
} from './components/YouMindSkillPickerModal';
import { YouMindSkillIcon } from './components/YouMindSkillIcon';
import { renderChatMessageBubble } from './components/renderChatMessageBubble';
import { useChatImagePreview } from '../../hooks/useChatImagePreview';
import { useChatImagePicker } from '../../hooks/useChatImagePicker';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, PresentationColor, Radius, Shadow, Space } from '../../theme/tokens';
import { resolveGatewayCacheScopeId } from '../../services/gateway-cache-scope';
import { hydrateYouMindChatAttachmentCache, rememberYouMindChatAttachments } from '../../services/youmind-chat-attachment-cache';
import {
  YouMindClient,
  applyYouMindChunk,
  getYouMindAuthFailureReason,
  mapYouMindChatDetail,
  type YouMindChatAttachmentReference,
  type YouMindChatDetail,
  type YouMindInstalledSkills,
  type YouMindChatSummary,
  type YouMindSkillSummary,
} from '../../services/youmind';
import { SessionInfo } from '../../types';
import { PendingImage } from '../../types/chat';
import { useChatKeyboardLayout } from './hooks/useChatKeyboardLayout';
import { useChatMessageSelection } from './hooks/useChatMessageSelection';
import { useChatListViewport } from './hooks/useChatListViewport';
import { useMessageFavorites } from './hooks/useMessageFavorites';
import { mapYouMindChatToUiMessages } from './hooks/youMindMessageMapping';
import { analyticsEvents } from '../../services/analytics/events';
import { LastOpenedSessionSnapshot, StorageService } from '../../services/storage';
import { getYouMindSkillBackgroundUri } from '../../services/youmind-skill-background';
import { readFileAsBase64, summarizeAttachmentFormats } from './hooks/chatControllerUtils';
import { isMacCatalyst } from '../../utils/platform';

type DrawerParamList = {
  YouMindChatMain: undefined;
};

const MAIN_SESSION_KEY = 'main';
const ONBOARDING_PACK_ID = '019c1d00-ab03-7a50-99d6-6903b7e0bae6';
const YouMindDrawer = createDrawerNavigator<DrawerParamList>();
const MAX_ATTACHMENTS = 6;
const YOUMIND_CHAT_DEBUG_PREFIX = '[YouMindChatDebug]';
const YOUMIND_AGENT_ID = 'youmind';
const RECOMMENDED_SKILL_SKELETON_COUNT = 3;
const RECOMMENDED_SKILL_ITEM_HEIGHT = 68;

type PendingImageWithFile = PendingImage & { fileName?: string };

function buildAttachmentMentionMessage(references: YouMindChatAttachmentReference[]): string {
  return references
    .map((reference) => {
      if (reference.type === 'material') {
        return `@[@${reference.at_name}](id:${reference.id};type:material)`;
      }
      if (reference.type === 'inlineImage') {
        return `@[@${reference.at_name}](id:${reference.image_url};type:inlineImage)`;
      }
      return '';
    })
    .filter(Boolean)
    .join(' ');
}

function buildSubmittedYouMindMessage(
  message: string,
  references: YouMindChatAttachmentReference[],
): string {
  const trimmedMessage = message.trim();
  const mentionMessage = buildAttachmentMentionMessage(references);
  if (!trimmedMessage) {
    return mentionMessage;
  }
  if (!mentionMessage) {
    return trimmedMessage;
  }
  return `${trimmedMessage}\n${mentionMessage}`;
}

function hasUserAttachmentPayload(message: Record<string, any> | null | undefined): boolean {
  if (!message) return false;
  return (
    (Array.isArray(message.atReferences) && message.atReferences.length > 0)
    || (Array.isArray(message.at_references) && message.at_references.length > 0)
    || (Array.isArray(message.atReference) && message.atReference.length > 0)
    || (Array.isArray(message.mobileAtReference) && message.mobileAtReference.length > 0)
  );
}

function SkillAvatarGlyph({
  skill,
  size,
}: {
  skill: YouMindSkillSummary;
  size: number;
}): React.JSX.Element {
  return (
    <View style={styles.skillGlyphWrap}>
      <View style={styles.skillGlyphShadow}>
        <YouMindSkillIcon skill={skill} color={PresentationColor.mediaScrim} size={size} />
      </View>
      <YouMindSkillIcon skill={skill} color={PresentationColor.onMedia} size={size} />
    </View>
  );
}

function useSkeletonOpacity(): RNAnimated.Value {
  const opacity = React.useRef(new RNAnimated.Value(0.55)).current;

  React.useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(opacity, {
          toValue: 0.95,
          duration: 900,
          useNativeDriver: true,
        }),
        RNAnimated.timing(opacity, {
          toValue: 0.55,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return opacity;
}

function SkillSkeletonBlock({
  width,
  height,
  opacity,
  radius = Radius.md,
  style,
}: {
  width: number | string;
  height: number;
  opacity: RNAnimated.Value;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const skeletonColor = theme.scheme === 'light' ? '#E1E5EB' : theme.colors.surfaceMuted;

  return (
    <RNAnimated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: skeletonColor,
        } as ViewStyle,
        { opacity } as unknown as ViewStyle,
        style,
      ]}
    />
  );
}

function RecommendedSkillSkeleton(): React.JSX.Element {
  const opacity = useSkeletonOpacity();

  return (
    <View style={styles.skillItem}>
      <View style={styles.skillAvatarWrap}>
        <SkillSkeletonBlock width={52} height={52} radius={Radius.full} opacity={opacity} />
      </View>
      <View style={styles.skillBody}>
        <SkillSkeletonBlock width="48%" height={18} opacity={opacity} />
        <SkillSkeletonBlock width="86%" height={14} opacity={opacity} />
        <SkillSkeletonBlock width="64%" height={14} opacity={opacity} />
      </View>
    </View>
  );
}

const YouMindRecommendedSkillsEmptyState = React.memo(function YouMindRecommendedSkillsEmptyState({
  loading,
  skills,
  onSelectSkill,
}: {
  loading: boolean;
  skills: YouMindSkillSummary[];
  onSelectSkill: (skill: YouMindSkillSummary) => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();

  return (
    <View style={styles.emptyStateWrap}>
      <Text style={[styles.emptyStateTitle, { color: theme.colors.text }]}>
        {t('What can I help you with?')}
      </Text>
      <View style={styles.skillsSection}>
        {loading ? (
          <View style={styles.skillsList}>
            {Array.from({ length: RECOMMENDED_SKILL_SKELETON_COUNT }).map((_, index) => (
              <RecommendedSkillSkeleton key={`skill-skeleton-${index}`} />
            ))}
          </View>
        ) : (
          <View style={styles.skillsList}>
            {skills.map((skill) => (
              <RecommendedSkillItem
                key={skill.id}
                skill={skill}
                onPress={onSelectSkill}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
});

function RecommendedSkillItem({
  skill,
  onPress,
}: {
  skill: YouMindSkillSummary;
  onPress: (skill: YouMindSkillSummary) => void;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={() => onPress(skill)}
      style={({ pressed }) => [
        styles.skillItem,
        { opacity: pressed ? 0.82 : 1 },
      ]}
    >
      <View style={styles.skillAvatarWrap}>
        <Image
          source={{ uri: getYouMindSkillBackgroundUri(skill) }}
          style={styles.skillAvatar}
          resizeMode="cover"
        />
        <View pointerEvents="none" style={styles.skillAvatarShade} />
        <View pointerEvents="none" style={styles.skillAvatarOverlay}>
          <SkillAvatarGlyph skill={skill} size={28} />
        </View>
      </View>
      <View style={styles.skillBody}>
        <Text style={[styles.skillName, { color: theme.colors.text }]} numberOfLines={1}>
          {skill.name}
        </Text>
        <Text style={[styles.skillDescription, { color: theme.colors.textMuted }]} numberOfLines={2}>
          {skill.description}
        </Text>
      </View>
    </Pressable>
  );
}

function toSessionInfo(chat: YouMindChatSummary): SessionInfo {
  return {
    key: `youmind:${chat.id}`,
    sessionId: chat.id,
    kind: 'unknown',
    label: chat.title,
    title: chat.title,
    updatedAt: chat.updatedAtMs,
  };
}

function isYouMindSessionKey(sessionKey: string | null | undefined): boolean {
  return sessionKey === MAIN_SESSION_KEY || !!sessionKey?.startsWith('youmind:');
}

function buildYouMindPreviewSession(snapshot: LastOpenedSessionSnapshot | null): SessionInfo | null {
  if (!snapshot?.sessionKey || !isYouMindSessionKey(snapshot.sessionKey)) {
    return null;
  }
  return {
    key: snapshot.sessionKey,
    sessionId: snapshot.sessionId ?? getChatIdFromSessionKey(snapshot.sessionKey) ?? undefined,
    kind: 'unknown',
    label: snapshot.sessionLabel,
    title: snapshot.sessionLabel,
    updatedAt: snapshot.updatedAt,
  };
}

function mergeSessionPreview(mainSession: SessionInfo, previewSession: SessionInfo | null): SessionInfo[] {
  if (!previewSession || previewSession.key === mainSession.key) {
    return [mainSession];
  }
  return [mainSession, previewSession];
}

function getChatIdFromSessionKey(sessionKey: string | null): string | null {
  if (!sessionKey) return null;
  if (sessionKey === MAIN_SESSION_KEY) return null;
  if (!sessionKey.startsWith('youmind:')) return null;
  return sessionKey.slice('youmind:'.length) || null;
}

function stringifyValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function resolveStreamingAssistantMessageId(chat: YouMindChatDetail | null, sending: boolean): string | null {
  if (!sending || !chat) return null;
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];
    if (message.role === 'assistant') {
      return message.id;
    }
  }
  return null;
}

function useYouMindClient(baseUrl: string, authScopeKey: string | null): YouMindClient {
  return React.useMemo(
    () => new YouMindClient(baseUrl, { authScopeKey }),
    [authScopeKey, baseUrl],
  );
}

type SidebarProps = DrawerContentComponentProps & {
  bottomPadding: number;
  gatewayConfigId: string;
  sessionKey: string;
  sessions: SessionInfo[];
  sidebarPreset: {
    requestedAt: number;
    tab: 'sessions' | 'subagents' | 'cron';
    channel?: string;
  } | null;
  onSelectSession: (session: SessionInfo) => void;
  onRefreshSessions: () => Promise<void>;
  onRenameSession: (session: SessionInfo, title: string | null) => Promise<void>;
  onDeleteSession: (session: SessionInfo) => Promise<void>;
  onResetSession: (session: SessionInfo) => Promise<void>;
};

const YouMindDrawerContent = React.memo(function YouMindDrawerContent({
  navigation,
  bottomPadding,
  gatewayConfigId,
  sessionKey,
  sessions,
  sidebarPreset,
  onSelectSession,
  onRefreshSessions,
  onRenameSession,
  onDeleteSession,
  onResetSession,
}: SidebarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const progress = useDrawerProgress();
  const prevProgressRef = React.useRef(0);
  const { theme } = useAppTheme();

  React.useEffect(() => {
    const id = setInterval(() => {
      const current = progress.get();
      const previous = prevProgressRef.current;
      prevProgressRef.current = current;
      if (current === 1 && previous < 1) {
        InteractionManager.runAfterInteractions(() => {
          void onRefreshSessions();
        });
      }
    }, 200);
    return () => clearInterval(id);
  }, [onRefreshSessions, progress]);

  const shadowAnimatedStyle = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      shadowColor: theme.colors.shadow,
      shadowOffset: { width: 4, height: 0 },
      shadowOpacity: interpolate(p, [0, 0.15], [0, theme.scheme === 'dark' ? 0.5 : 0.12]),
      shadowRadius: interpolate(p, [0, 0.15], [0, 20]),
      elevation: p > 0.05 ? 24 : 0,
    };
  }, [theme.colors.shadow, theme.scheme]);

  return (
    <Animated.View style={[styles.drawerShadowWrap, shadowAnimatedStyle]}>
      <SessionSidebar
        sessions={sessions}
        activeSessionKey={sessionKey}
        topPadding={insets.top + (Platform.OS === 'android' ? 12 : 0)}
        bottomPadding={Platform.OS === 'android' ? 12 : bottomPadding}
        presentation="chat-only"
        gatewayConfigId={gatewayConfigId}
        onClose={() => navigation.closeDrawer()}
        onSelectSession={(session) => {
          onSelectSession(session);
          navigation.closeDrawer();
        }}
        onRefresh={onRefreshSessions}
        onRenameSession={onRenameSession}
        onResetSession={onResetSession}
        onDeleteSession={onDeleteSession}
        externalSelection={sidebarPreset}
      />
    </Animated.View>
  );
});

function YouMindChatScreen({
  gatewayConfigId,
  openSidebarRequestAt,
  sessions,
  sessionKey,
  currentChat,
  sending,
  input,
  statusLabel,
  onOpenSidebar,
  onStartNewChat,
  onChangeInput,
  onSend,
  onAbort,
  authState,
  emptyState,
  selectedSkill,
  onOpenSkillPicker,
  onClearSelectedSkill,
  canAddMoreImages,
  pendingImages,
  onChooseFile,
  onOpenPendingPreview,
  onPickImage,
  onRemovePendingImage,
  onTakePhoto,
}: {
  gatewayConfigId: string | null;
  openSidebarRequestAt?: number | null;
  sessions: SessionInfo[];
  sessionKey: string;
  currentChat: YouMindChatDetail | null;
  sending: boolean;
  input: string;
  statusLabel: string | null;
  onOpenSidebar: () => void;
  onStartNewChat: () => void;
  onChangeInput: (value: string) => void;
  onSend: () => void;
  onAbort: () => void;
  authState: React.ReactNode;
  emptyState: React.ReactNode;
  selectedSkill: YouMindSkillSummary | null;
  onOpenSkillPicker: () => void;
  onClearSelectedSkill: () => void;
  canAddMoreImages: boolean;
  pendingImages: PendingImageWithFile[];
  onChooseFile: () => void | Promise<void>;
  onOpenPendingPreview: (index: number) => void;
  onPickImage: () => void | Promise<void>;
  onRemovePendingImage: (index: number) => void;
  onTakePhoto: () => void | Promise<void>;
}): React.JSX.Element {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation(['chat', 'common']);
  const { theme } = useAppTheme();
  const flatListRef = React.useRef<any>(null);
  const composerRef = React.useRef<any>(null);
  const listFadeAnim = React.useRef(new RNAnimated.Value(1)).current;
  const { height: screenHeight } = useWindowDimensions();
  const preview = useChatImagePreview();
  const streamingAssistantMessageId = React.useMemo(
    () => resolveStreamingAssistantMessageId(currentChat, sending),
    [currentChat, sending],
  );
  const uiMessages = React.useMemo(
    () => mapYouMindChatToUiMessages(currentChat, { streamingAssistantMessageId }),
    [currentChat, streamingAssistantMessageId],
  );
  const currentSession = React.useMemo(
    () => sessions.find((item) => item.key === sessionKey) ?? null,
    [sessionKey, sessions],
  );
  const favorites = useMessageFavorites({
    agentId: YOUMIND_AGENT_ID,
    agentName: 'YouMind',
    gatewayConfigId,
    listData: uiMessages,
    sessionKey,
    sessionLabel: currentSession?.label ?? currentSession?.title ?? null,
  });
  const {
    clearSelection,
    copiedSelected,
    copyButtonSize,
    copySelectedMessage,
    handleSelectMessage,
    hasSelectedMessageText,
    selectedFrames,
    selectedMessage,
    selectedMessageFavorited,
    selectedMessageId,
    selectedMessageVisible,
    selectionAnim,
    toggleMessageSelection,
    toggleSelectedMessageFavorite,
  } = useChatMessageSelection({
    isFavoritedMessage: favorites.isFavoritedMessage,
    listData: uiMessages,
    onToggleFavorite: favorites.toggleFavorite,
  });
  const streamingText = React.useMemo(() => {
    if (!sending || !currentChat) return null;
    const lastAssistant = [...currentChat.messages].reverse().find((item) => item.role === 'assistant');
    if (!lastAssistant) return null;
    return lastAssistant.blocks.map((block) => {
      if (block.kind === 'tool') {
        return stringifyValue(block.toolResult) || block.toolResponse || block.toolName;
      }
      return block.text;
    }).join('\n');
  }, [currentChat, sending]);

  const handleSingleMessageAppend = React.useCallback(() => {
    flatListRef.current?.prepareForLayoutAnimationRender?.();
  }, []);
  const {
    onListContentSizeChange: handleListContentSizeChange,
    onScrollBeginDrag: handleScrollBeginDrag,
    onScrollEndDrag: handleScrollEndDrag,
    onScrollStateChange: handleScrollStateChange,
    onScrollToBottom,
    showScrollButton,
  } = useChatListViewport({
    flatListRef,
    isSending: sending,
    listLength: uiMessages.length,
    onSingleMessageAppend: handleSingleMessageAppend,
    streamingText,
  });
  const {
    animatedRootStyle,
    composerBottomPadding,
    composerSwipeGesture,
    handleComposerBlur,
    handleComposerFocus,
    modalBottomInset,
  } = useChatKeyboardLayout({
    insets,
    screenHeight,
  });
  const messageListExtraData = React.useMemo(() => ({
    favoriteMessageIds: favorites.favoriteMessageIdSet,
    selectedMessageId,
  }), [favorites.favoriteMessageIdSet, selectedMessageId]);

  React.useEffect(() => {
    if (!openSidebarRequestAt) return;
    navigation.openDrawer();
  }, [navigation, openSidebarRequestAt]);

  if (!statusLabel) {
    return <>{authState}</>;
  }

  const renderMessageBubble = (
    item: (typeof uiMessages)[number],
    options?: { overlayMode?: boolean; forceSelected?: boolean },
  ) => renderChatMessageBubble({
    agentDisplayName: 'YouMind',
    chatFontSize: 16,
    item,
    isFavorited: favorites.favoriteMessageIdSet.has(item.id),
    onAvatarPress: () => {},
    onImagePreview: preview.openPreview,
    onResolveApproval: () => {},
    onSelectMessage: handleSelectMessage,
    onToggleSelection: toggleMessageSelection,
    options,
    selectedMessageId,
    showAgentAvatar: false,
    showModelUsage: false,
  });

  return (
    <Animated.View style={[{ flex: 1 }, animatedRootStyle]}>
      <ChatHeader
        title={currentSession?.title || currentSession?.label || t('YouMind')}
        connectionState={statusLabel ? 'ready' : 'idle'}
        isTyping={sending}
        agentName="YouMind"
        statusLabel={statusLabel}
        onOpenSidebar={onOpenSidebar}
        onRefresh={onStartNewChat}
        refreshDisabled={sending}
        refreshing={false}
        rightActionKind="new"
        topPadding={insets.top}
      />
        <View style={{ flex: 1 }}>
        {currentChat || sessionKey !== MAIN_SESSION_KEY ? (
          <ChatMessagePane
            extraData={messageListExtraData}
            flatListRef={flatListRef}
            gatewayEpoch={1}
            listData={uiMessages}
            listFadeAnim={listFadeAnim}
            loadingMoreHistory={false}
            newMessageIds={new Set<string>()}
            onDismissSlashSuggestions={() => {}}
            onEndReached={() => {}}
            onListContentSizeChange={handleListContentSizeChange}
            onScroll={handleScrollStateChange}
            onScrollBeginDrag={handleScrollBeginDrag}
            onScrollEndDrag={handleScrollEndDrag}
            onScrollToBottom={onScrollToBottom}
            onSelectSlashCommand={() => {}}
            renderMessageBubble={(item) => renderMessageBubble(item)}
            sessionKey={sessionKey}
            showScrollButton={showScrollButton}
            showSlashSuggestions={false}
            slashInputValue={input}
            slashSuggestions={[]}
            slashSuggestionsMaxHeight={0}
            theme={theme}
          />
        ) : (
          emptyState
        )}
      </View>
      <SelectedMessageOverlay
        copiedSelected={copiedSelected}
        copyButtonSize={copyButtonSize}
        currentAgentName="YouMind"
        shareProductLabel="YouMind"
        hasSelectedMessageText={hasSelectedMessageText}
        insetsTop={insets.top}
        modalBottomInset={modalBottomInset}
        onCopySelectedMessage={copySelectedMessage}
        onToggleSelectedMessageFavorite={toggleSelectedMessageFavorite}
        renderSelectedMessage={() => (
          selectedMessage
            ? renderMessageBubble(selectedMessage, { overlayMode: true, forceSelected: true })
            : null
        )}
        clearSelection={clearSelection}
        selectedFrames={selectedFrames}
        selectedMessage={selectedMessage}
        selectedMessageFavorited={selectedMessageFavorited}
        selectedMessageVisible={selectedMessageVisible}
        selectionAnim={selectionAnim}
      />
      <ImagePreviewModal
        visible={preview.previewVisible}
        uris={preview.previewUris}
        index={preview.previewIndex}
        screenWidth={preview.screenWidth}
        screenHeight={preview.screenHeight}
        insetsTop={insets.top}
        insetsBottom={modalBottomInset}
        onClose={preview.closePreview}
        onIndexChange={preview.setPreviewIndex}
      />
      <View style={styles.composerArea}>
        {selectedSkill ? (
          <View style={styles.composerSkillBar}>
            <Pressable
              onPress={onClearSelectedSkill}
              style={({ pressed }) => [
                styles.composerSkillChip,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.84 : 1,
              },
            ]}
          >
            <View style={styles.composerSkillChipAvatarWrap}>
              <Image
                source={{ uri: getYouMindSkillBackgroundUri(selectedSkill) }}
                style={styles.composerSkillChipAvatar}
                resizeMode="cover"
              />
              <View pointerEvents="none" style={styles.composerSkillChipAvatarShade} />
              <View pointerEvents="none" style={styles.composerSkillChipAvatarOverlay}>
                <SkillAvatarGlyph skill={selectedSkill} size={12} />
              </View>
            </View>
              <Text style={[styles.composerSkillChipText, { color: theme.colors.text }]} numberOfLines={1}>
                {selectedSkill.name}
              </Text>
              <X size={14} color={theme.colors.textMuted} strokeWidth={2.2} />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.composerPaneWrap}>
          <ChatComposerPane
            canAddMoreImages={canAddMoreImages}
            canSend={(!!input.trim() || pendingImages.length > 0) && !sending && !!statusLabel}
            composerBottomPadding={composerBottomPadding}
            composerRef={composerRef}
            composerSwipeGesture={composerSwipeGesture}
            input={input}
            isConnecting={false}
            isSending={sending}
            leadingActionsGap={0}
            pendingImages={pendingImages}
            placeholder={t('Message YouMind')}
            onAbort={statusLabel ? onAbort : undefined}
            onBlur={handleComposerBlur}
            onChangeText={onChangeInput}
            onChooseFile={onChooseFile}
            onCommandPress={() => {
              Alert.alert(t('Not supported yet'), t('YouMind command shortcuts are not included in this first version.'));
            }}
            onFocus={handleComposerFocus}
            onSkillPress={onOpenSkillPicker}
            onOpenPreview={onOpenPendingPreview}
            onPickImage={onPickImage}
            onRemovePendingImage={onRemovePendingImage}
            onSend={onSend}
            onTakePhoto={onTakePhoto}
          />
        </View>
      </View>
    </Animated.View>
  );
}

export function YouMindChatTab(): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common', 'console']);
  const isFocused = useIsFocused();
  const { theme } = useAppTheme();
  const {
    activeGatewayConfigId,
    config,
    chatSidebarRequest,
    clearChatSidebarRequest,
    currentAgentId,
    initialChatPreview,
    mainSessionKey,
  } = useAppContext();
  const baseUrl = config?.url || 'https://youmind.com';
  const client = useYouMindClient(baseUrl, activeGatewayConfigId);
  const gatewayConfigId = React.useMemo(
    () => resolveGatewayCacheScopeId({ activeConfigId: activeGatewayConfigId, config }),
    [activeGatewayConfigId, config],
  );
  const mainSession = React.useMemo<SessionInfo>(
    () => ({
      key: MAIN_SESSION_KEY,
      kind: 'unknown',
      label: t('New chat'),
      title: t('New chat'),
    }),
    [t],
  );
  const {
    pendingImages,
    setPendingImages,
    pickImage,
    clearPendingImages,
    removePendingImage,
    canAddMoreImages,
  } = useChatImagePicker(MAX_ATTACHMENTS);
  const initialPreviewSession = React.useMemo(
    () => buildYouMindPreviewSession(initialChatPreview),
    [initialChatPreview],
  );
  const initialSessionKey = React.useMemo(() => {
    const previewKey = initialPreviewSession?.key;
    if (previewKey && isYouMindSessionKey(previewKey)) {
      return previewKey;
    }
    if (mainSessionKey && isYouMindSessionKey(mainSessionKey)) {
      return mainSessionKey;
    }
    return MAIN_SESSION_KEY;
  }, [initialPreviewSession?.key, mainSessionKey]);
  const [sidebarPreset, setSidebarPreset] = React.useState<{
    requestedAt: number;
    tab: 'sessions' | 'subagents' | 'cron';
    channel?: string;
  } | null>(null);
  const [openSidebarRequestAt, setOpenSidebarRequestAt] = React.useState<number | null>(null);
  const [authLoading, setAuthLoading] = React.useState(true);
  const [authenticated, setAuthenticated] = React.useState(false);
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);
  const [authFailureReason, setAuthFailureReason] = React.useState<'signed_out' | 'expired' | null>(null);
  const [statusLabel, setStatusLabel] = React.useState<string | null>(null);
  const [sessions, setSessions] = React.useState<SessionInfo[]>(
    () => mergeSessionPreview(mainSession, initialPreviewSession),
  );
  const [sessionKey, setSessionKey] = React.useState(initialSessionKey);
  const [currentChat, setCurrentChat] = React.useState<YouMindChatDetail | null>(null);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [recommendedSkills, setRecommendedSkills] = React.useState<YouMindSkillSummary[]>([]);
  const [recommendedSkillsLoading, setRecommendedSkillsLoading] = React.useState(true);
  const recommendedSkillsRef = React.useRef<YouMindSkillSummary[]>([]);
  const [installedSkills, setInstalledSkills] = React.useState<YouMindInstalledSkills | null>(null);
  const [installedSkillsLoading, setInstalledSkillsLoading] = React.useState(false);
  const [installedSkillsError, setInstalledSkillsError] = React.useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = React.useState<YouMindSkillSummary | null>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const skillPickerRef = React.useRef<YouMindSkillPickerModalHandle>(null);
  const startupPreviewHydratedRef = React.useRef(false);
  const lastPersistedSessionSnapshotRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!activeGatewayConfigId) return;
    void StorageService.migrateLegacyYouMindState(baseUrl, activeGatewayConfigId);
  }, [activeGatewayConfigId, baseUrl]);

  React.useEffect(() => {
    void hydrateYouMindChatAttachmentCache();
  }, []);

  React.useEffect(() => {
    if (startupPreviewHydratedRef.current) return;
    if (!initialPreviewSession) return;
    startupPreviewHydratedRef.current = true;
    setSessions((prev) => (prev.length > 1 ? prev : mergeSessionPreview(mainSession, initialPreviewSession)));
    setSessionKey((prev) => (
      prev === MAIN_SESSION_KEY && initialPreviewSession.key !== MAIN_SESSION_KEY
        ? initialPreviewSession.key
        : prev
    ));
  }, [initialPreviewSession, mainSession]);

  React.useEffect(() => {
    recommendedSkillsRef.current = recommendedSkills;
  }, [recommendedSkills]);

  const refreshSessions = React.useCallback(async () => {
    const chats = await client.listChats();
    const nextSessions = [
      mainSession,
      ...chats.map(toSessionInfo),
    ];
    setSessions(nextSessions);
    return nextSessions;
  }, [client, mainSession]);

  const loadChat = React.useCallback(async (chatId: string | null) => {
    if (!chatId) {
      setCurrentChat(null);
      return;
    }
    await hydrateYouMindChatAttachmentCache();
    const detail = await client.getChat(chatId);
    setCurrentChat(detail);
  }, [client]);

  const loadRecommendedSkills = React.useCallback(async () => {
    const hasExistingSkills = recommendedSkillsRef.current.length > 0;
    if (!hasExistingSkills) {
      setRecommendedSkillsLoading(true);
    }
    try {
      const skills = await client.getPackSkills(ONBOARDING_PACK_ID);
      setRecommendedSkills(skills.slice(0, 3));
    } catch {
      if (!hasExistingSkills) {
        setRecommendedSkills([]);
      }
    } finally {
      if (!hasExistingSkills) {
        setRecommendedSkillsLoading(false);
      }
    }
  }, [client]);

  const loadInstalledSkills = React.useCallback(async () => {
    setInstalledSkillsLoading(true);
    setInstalledSkillsError(null);
    try {
      const nextSkills = await client.listInstalledSkills();
      setInstalledSkills(nextSkills);
      return nextSkills;
    } catch (error) {
      const message = error instanceof Error ? error.message : t('Unable to load skills right now.');
      setInstalledSkillsError(message);
      setInstalledSkills((prev) => prev ?? { all: [], pinned: [], mySkills: [], installed: [] });
      return null;
    } finally {
      setInstalledSkillsLoading(false);
    }
  }, [client, t]);

  const resetAuthState = React.useCallback((reason: 'signed_out' | 'expired') => {
    setAuthenticated(false);
    setCurrentUserId(null);
    setAuthFailureReason(reason);
    setStatusLabel(null);
    setCurrentChat(null);
    setSessionKey(MAIN_SESSION_KEY);
    setSessions([mainSession]);
    setRecommendedSkills([]);
    setInstalledSkills(null);
    setInstalledSkillsError(null);
    setSelectedSkill(null);
  }, [mainSession]);

  const handleAuthFailure = React.useCallback((error: unknown, options?: { hadStoredSession?: boolean }) => {
    const reason = getYouMindAuthFailureReason(error, {
      hadStoredSession: options?.hadStoredSession,
    });
    if (!reason) return false;
    resetAuthState(reason);
    return true;
  }, [resetAuthState]);

  const restoreAuth = React.useCallback(async () => {
    setAuthLoading(true);
    const storedSession = await client.getStoredSession();
    try {
      const session = await client.getValidSession();
      if (!session) {
        resetAuthState('signed_out');
        return;
      }
      setCurrentUserId(session.user?.id ?? storedSession?.user?.id ?? null);
      let userLabel = session.user?.email || session.user?.name || null;
      if (!userLabel) {
        try {
          const currentUser = await client.getCurrentUser();
          if (currentUser?.id) {
            setCurrentUserId(currentUser.id);
          }
          userLabel = currentUser?.email || currentUser?.name || userLabel;
        } catch (error) {
          if (handleAuthFailure(error, { hadStoredSession: true })) {
            return;
          }
        }
      }
      setAuthenticated(true);
      setAuthFailureReason(null);
      setStatusLabel(userLabel || t('Signed in'));
      const nextSessions = await refreshSessions().catch((error) => {
        if (handleAuthFailure(error, { hadStoredSession: true })) {
          return [mainSession];
        }
        return [mainSession];
      });
      setSessionKey((prev) => {
        if (prev === MAIN_SESSION_KEY) return prev;
        return nextSessions.some((sessionInfo) => sessionInfo.key === prev) ? prev : MAIN_SESSION_KEY;
      });
      await Promise.allSettled([
        loadRecommendedSkills(),
        loadInstalledSkills(),
      ]);
    } catch (error) {
      if (!handleAuthFailure(error, { hadStoredSession: Boolean(storedSession) })) {
        resetAuthState(Boolean(storedSession) ? 'expired' : 'signed_out');
      }
    } finally {
      setAuthLoading(false);
    }
  }, [client, handleAuthFailure, loadInstalledSkills, loadRecommendedSkills, mainSession, refreshSessions, resetAuthState, t]);

  React.useEffect(() => {
    if (!isFocused) return;
    void restoreAuth();
  }, [isFocused, activeGatewayConfigId, baseUrl]);

  React.useEffect(() => {
    if (!chatSidebarRequest) return;
    setSidebarPreset({
      requestedAt: chatSidebarRequest.requestedAt,
      tab: chatSidebarRequest.tab,
      channel: chatSidebarRequest.channel,
    });
    if (chatSidebarRequest.openDrawer) {
      setOpenSidebarRequestAt(chatSidebarRequest.requestedAt);
    }
    clearChatSidebarRequest();
  }, [chatSidebarRequest, clearChatSidebarRequest]);

  React.useEffect(() => {
    const chatId = getChatIdFromSessionKey(sessionKey);
    if (!authenticated) return;
    void loadChat(chatId).catch((error) => {
      handleAuthFailure(error, { hadStoredSession: true });
    });
  }, [authenticated, handleAuthFailure, loadChat, sessionKey]);

  React.useEffect(() => {
    if (!gatewayConfigId || !sessionKey || !isYouMindSessionKey(sessionKey)) return;
    const currentSession = sessions.find((item) => item.key === sessionKey) ?? null;
    const snapshot: LastOpenedSessionSnapshot = {
      sessionKey,
      sessionId: currentChat?.id ?? currentSession?.sessionId ?? getChatIdFromSessionKey(sessionKey) ?? undefined,
      sessionLabel: currentChat?.title ?? currentSession?.title ?? currentSession?.label,
      updatedAt: currentChat?.updatedAtMs ?? currentSession?.updatedAt ?? Date.now(),
      agentId: currentAgentId,
      agentName: 'YouMind',
    };
    const signature = JSON.stringify(snapshot);
    if (lastPersistedSessionSnapshotRef.current === signature) return;
    lastPersistedSessionSnapshotRef.current = signature;
    StorageService.setLastSessionKey(sessionKey, gatewayConfigId).catch(() => {});
    StorageService.setLastOpenedSessionSnapshot(gatewayConfigId, snapshot).catch(() => {
      if (lastPersistedSessionSnapshotRef.current === signature) {
        lastPersistedSessionSnapshotRef.current = null;
      }
    });
  }, [currentAgentId, currentChat, gatewayConfigId, sessionKey, sessions]);

  const handleSelectSession = React.useCallback((session: SessionInfo) => {
    setSessionKey(session.key);
    setInput('');
    clearPendingImages();
    setSelectedSkill(null);
  }, [clearPendingImages]);

  const clearSelectedSkill = React.useCallback(() => {
    if (!selectedSkill) return;
    const trackedSkill = selectedSkill;
    setSelectedSkill(null);
    InteractionManager.runAfterInteractions(() => {
      analyticsEvents.chatSkillSelected({
        source: 'youmind_chat',
        action: 'clear',
        skill_id: trackedSkill.id,
        skill_name: trackedSkill.name,
        session_key_present: Boolean(currentChat?.id),
      });
    });
  }, [currentChat?.id, selectedSkill]);

  const handleSelectRecommendedSkill = React.useCallback((skill: YouMindSkillSummary) => {
    setSelectedSkill(skill);
    InteractionManager.runAfterInteractions(() => {
      analyticsEvents.chatSkillSelected({
        source: 'youmind_chat_recommended',
        action: 'select',
        skill_id: skill.id,
        skill_name: skill.name,
        session_key_present: Boolean(currentChat?.id),
      });
    });
  }, [currentChat?.id]);

  const handleOpenSkillPicker = React.useCallback(() => {
    analyticsEvents.chatSkillPickerOpened({
      source: 'youmind_chat',
      session_key_present: Boolean(currentChat?.id),
      skill_count: installedSkills?.all.length ?? 0,
    });
    if (!installedSkills && authenticated && !installedSkillsLoading) {
      void loadInstalledSkills();
    }
    skillPickerRef.current?.present();
  }, [authenticated, currentChat?.id, installedSkills, installedSkillsLoading, loadInstalledSkills]);

  const handleSelectSkill = React.useCallback((skill: YouMindSkillSummary) => {
    setSelectedSkill(skill);
    skillPickerRef.current?.dismiss();
    InteractionManager.runAfterInteractions(() => {
      analyticsEvents.chatSkillSelected({
        source: 'youmind_chat_picker',
        action: 'select',
        skill_id: skill.id,
        skill_name: skill.name,
        session_key_present: Boolean(currentChat?.id),
      });
    });
  }, [currentChat?.id]);

  const handleStartNewChat = React.useCallback(() => {
    setCurrentChat(null);
    setInput('');
    clearPendingImages();
    setSelectedSkill(null);
    setSessionKey(MAIN_SESSION_KEY);
  }, [clearPendingImages]);

  const handleRefresh = React.useCallback(async () => {
    await restoreAuth();
    const chatId = getChatIdFromSessionKey(sessionKey);
    if (!authenticated) return;
    await loadChat(chatId).catch((error) => {
      handleAuthFailure(error, { hadStoredSession: true });
    });
  }, [authenticated, handleAuthFailure, loadChat, restoreAuth, sessionKey]);

  const pickFile = React.useCallback(async () => {
    if (pendingImages.length >= MAX_ATTACHMENTS) return;
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    if (!asset.uri) return;
    try {
      const base64 = await readFileAsBase64(asset.uri);
      const attachment: PendingImageWithFile = {
        uri: asset.uri,
        base64,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        fileName: asset.name,
      };
      setPendingImages((prev) => [...prev, attachment].slice(0, MAX_ATTACHMENTS));
    } catch {
      // Ignore local picker read failures so the user can retry.
    }
  }, [pendingImages.length, setPendingImages]);

  const takePhoto = React.useCallback(async () => {
    const ImagePicker = await import('expo-image-picker');
    const result = isMacCatalyst
      ? await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 0.8,
        base64: true,
        exif: false,
      })
      : await (async () => {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) return { canceled: true, assets: [] };
        return ImagePicker.launchCameraAsync({
          quality: 0.8,
          base64: true,
          exif: false,
        });
      })();

    if (!result.canceled && result.assets?.[0]?.base64) {
      const asset = result.assets[0];
      setPendingImages((prev) => [
        ...prev,
        {
          uri: asset.uri,
          base64: asset.base64!,
          mimeType: asset.mimeType ?? 'image/jpeg',
          width: asset.width,
          height: asset.height,
        },
      ].slice(0, MAX_ATTACHMENTS));
    }
  }, [setPendingImages]);

  const preview = useChatImagePreview();

  const handleOpenPendingPreview = React.useCallback((index: number) => {
    const selectedAttachment = pendingImages[index] as PendingImageWithFile | undefined;
    if (!selectedAttachment?.mimeType.startsWith('image/')) return;
    const imageUris = pendingImages
      .filter((item) => item.mimeType.startsWith('image/'))
      .map((item) => item.uri);
    const previewIndex = imageUris.findIndex((uri) => uri === selectedAttachment.uri);
    if (previewIndex >= 0) {
      preview.openPreview(imageUris, previewIndex);
    }
  }, [pendingImages, preview]);

  const runSend = React.useCallback(async () => {
    const message = input.trim();
    const activeSkill = selectedSkill ? { id: selectedSkill.id, name: selectedSkill.name } : null;
    const attachments = [...pendingImages] as PendingImageWithFile[];
    if ((!message && attachments.length === 0) || sending || !authenticated) return;

    analyticsEvents.chatSendTapped({
      has_text: message.length > 0,
      has_skill: !!activeSkill,
      text_length: message.length,
      attachment_count: attachments.length,
      image_count: attachments.filter((attachment) => attachment.mimeType.startsWith('image/')).length,
      file_count: attachments.filter((attachment) => !attachment.mimeType.startsWith('image/')).length,
      attachment_formats: summarizeAttachmentFormats(attachments) ?? undefined,
      is_command: false,
      session_key_present: Boolean(currentChat?.id),
    });

    setSending(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let attachmentReferences: YouMindChatAttachmentReference[] = [];
    try {
      attachmentReferences = await client.prepareChatAttachments(
        attachments.map((attachment) => ({
          uri: attachment.uri,
          mimeType: attachment.mimeType,
          fileName: attachment.fileName,
        })),
        controller.signal,
      );
      console.log(`${YOUMIND_CHAT_DEBUG_PREFIX} prepared attachments`, {
        attachments: attachments.map((attachment) => ({
          uri: attachment.uri,
          mimeType: attachment.mimeType,
          fileName: attachment.fileName,
        })),
        attachmentReferences,
      });
      rememberYouMindChatAttachments(
        client.cacheScopeId,
        attachmentReferences,
        attachments.map((attachment) => ({
          uri: attachment.uri,
          mimeType: attachment.mimeType,
          fileName: attachment.fileName,
        })),
      );
    } catch (error) {
      if (handleAuthFailure(error, { hadStoredSession: true })) {
        setSending(false);
        abortControllerRef.current = null;
        return;
      }
      setSending(false);
      abortControllerRef.current = null;
      Alert.alert(t('Unable to send message'), error instanceof Error ? error.message : t('Please try again later.', { ns: 'common' }));
      return;
    }

    setInput('');
    clearPendingImages();

    const submittedMessage = buildSubmittedYouMindMessage(message, attachmentReferences);
    console.log(`${YOUMIND_CHAT_DEBUG_PREFIX} sending payload`, {
      chatId: currentChat?.id ?? null,
      originalMessage: message,
      submittedMessage,
      attachmentReferences,
      activeSkill,
    });

    const localUserMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user' as const,
      createdAt: new Date().toISOString(),
      content: message,
      skill: activeSkill ?? undefined,
      atReferences: attachmentReferences,
    };
    const localAssistantMessage = {
      id: `local-assistant-${Date.now()}`,
      role: 'assistant' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: '',
      status: 'running',
      blocks: [],
    };

    let draft: Record<string, any> = currentChat
      ? {
        id: currentChat.id,
        title: currentChat.title,
        createdAt: new Date(currentChat.createdAtMs).toISOString(),
        updatedAt: new Date(currentChat.updatedAtMs).toISOString(),
        messages: currentChat.messages.map((item) => (
          item.role === 'user'
            ? {
              id: item.id,
              role: 'user',
              createdAt: new Date(item.createdAtMs).toISOString(),
              updatedAt: new Date(item.createdAtMs).toISOString(),
              content: item.content,
              skill: item.skill,
            }
            : {
              id: item.id,
              role: 'assistant',
              createdAt: new Date(item.createdAtMs).toISOString(),
              updatedAt: new Date(item.createdAtMs).toISOString(),
              model: item.model,
              status: item.status,
              blocks: item.blocks.map((block) => {
                if (block.kind === 'tool') {
                  return {
                    id: block.id,
                    type: 'tool',
                    status: block.status,
                    toolName: block.toolName,
                    toolResponse: block.toolResponse,
                    toolArguments: block.toolArguments,
                    toolResult: block.toolResult,
                    toolExecuteElapsedMs: block.elapsedMs,
                  };
                }
                return {
                  id: block.id,
                  type: block.kind,
                  status: block.status,
                  content: block.text,
                  reasoning: block.text,
                };
              }),
            }
        )),
      }
      : {
        id: '',
        title: t('New chat'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };

    draft.messages = [...(draft.messages ?? []), localUserMessage, localAssistantMessage];
    setCurrentChat(mapYouMindChatDetail(draft, client.cacheScopeId));
    if (activeSkill) {
      setSelectedSkill(null);
    }

    try {
      const stream = currentChat?.id
        ? await client.streamSendMessage(
          currentChat.id,
          submittedMessage,
          activeSkill,
          attachmentReferences,
          controller.signal,
        )
        : await client.streamCreateChat(
          submittedMessage,
          activeSkill,
          attachmentReferences,
          controller.signal,
        );

      for await (const chunk of stream) {
        if (chunk.mode === 'insert' && chunk.dataType === 'Message' && chunk.data?.role === 'user') {
          console.log(`${YOUMIND_CHAT_DEBUG_PREFIX} received user message chunk`, chunk.data);
          if (!hasUserAttachmentPayload(chunk.data as Record<string, any>)) {
            chunk.data = {
              ...chunk.data,
              atReferences: localUserMessage.atReferences,
            };
          }
        }
        if (chunk.mode === 'error') {
          throw new Error(chunk.error?.message || t('Unable to load messages right now.'));
        }
        if (chunk.mode === 'insert' && chunk.dataType === 'Message' && chunk.data?.role === 'user') {
          draft.messages = (draft.messages ?? []).filter((item: any) => item?.id !== localUserMessage.id);
        }
        applyYouMindChunk(draft, chunk);
        const next = mapYouMindChatDetail(draft, client.cacheScopeId);
        setCurrentChat(next);
        if (!currentChat?.id && next.id) {
          setSessionKey(`youmind:${next.id}`);
        }
      }

      const finalChatId = typeof draft.id === 'string' ? draft.id : '';
      if (finalChatId) {
        setSessionKey(`youmind:${finalChatId}`);
        await loadChat(finalChatId);
      }
      await refreshSessions();
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        const chatId = typeof draft.id === 'string' ? draft.id : '';
        if (chatId) {
          await client.abortMessage(chatId).catch(() => {});
          await loadChat(chatId);
        }
      } else {
        if (handleAuthFailure(error, { hadStoredSession: true })) {
          return;
        }
        Alert.alert(t('Unable to send message'), error instanceof Error ? error.message : t('Please try again later.', { ns: 'common' }));
      }
    } finally {
      setSending(false);
      abortControllerRef.current = null;
    }
  }, [
    authenticated,
    clearPendingImages,
    client,
    currentChat,
    input,
    loadChat,
    pendingImages,
    refreshSessions,
    selectedSkill,
    sending,
    t,
  ]);

  const handleAbort = React.useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleRenameSession = React.useCallback(async (session: SessionInfo, title: string | null) => {
    const chatId = getChatIdFromSessionKey(session.key);
    if (!chatId || !title?.trim()) return;
    await client.updateChatTitle(chatId, title.trim());
    await refreshSessions();
    if (currentChat?.id === chatId) {
      setCurrentChat({ ...currentChat, title: title.trim() });
    }
  }, [client, currentChat, refreshSessions]);

  const handleDeleteSession = React.useCallback(async (session: SessionInfo) => {
    const chatId = getChatIdFromSessionKey(session.key);
    if (!chatId) return;
    await client.deleteChat(chatId);
    if (currentChat?.id === chatId) {
      setCurrentChat(null);
      setSessionKey(MAIN_SESSION_KEY);
    }
    await refreshSessions();
  }, [client, currentChat, refreshSessions]);

  const handleResetSession = React.useCallback(async (session: SessionInfo) => {
    if (session.key === MAIN_SESSION_KEY) {
      handleStartNewChat();
      return;
    }
    handleStartNewChat();
  }, [handleStartNewChat]);

  const authState = authLoading ? (
    <View style={styles.centered}>
      <ActivityIndicator color={theme.colors.primary} />
    </View>
  ) : authenticated ? null : (
    <View style={styles.authStateWrap}>
      <YouMindSignInPanel
        client={client}
        source="chat"
        centered
        headline={t('YouMind sign-in required', { ns: 'console' })}
        description={authFailureReason === 'expired'
          ? t('Your YouMind session expired. Sign in again to keep using this connection.')
          : t('Sign in to YouMind to use this connection.')}
        onSignedIn={async () => {
          await restoreAuth();
        }}
      />
    </View>
  );

  const emptyState = React.useMemo(() => (
    <YouMindRecommendedSkillsEmptyState
      loading={recommendedSkillsLoading}
      skills={recommendedSkills}
      onSelectSkill={handleSelectRecommendedSkill}
    />
  ), [handleSelectRecommendedSkill, recommendedSkills, recommendedSkillsLoading]);

  const bottomPadding = Space.md;

  const renderDrawerContent = React.useCallback(
    (props: DrawerContentComponentProps) => (
      <YouMindDrawerContent
        {...props}
        bottomPadding={bottomPadding}
        gatewayConfigId={gatewayConfigId}
        sessionKey={sessionKey}
        sessions={sessions}
        sidebarPreset={sidebarPreset}
        onSelectSession={handleSelectSession}
        onRefreshSessions={async () => {
          await refreshSessions();
        }}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
        onResetSession={handleResetSession}
      />
    ),
    [
      bottomPadding,
      gatewayConfigId,
      handleDeleteSession,
      handleRenameSession,
      handleResetSession,
      handleSelectSession,
      refreshSessions,
      sessionKey,
      sessions,
      sidebarPreset,
    ],
  );

  const screenOptions = React.useMemo(() => ({
    headerShown: false as const,
    drawerType: 'front' as const,
    drawerPosition: 'left' as const,
    swipeEnabled: true,
    swipeEdgeWidth: 40,
    drawerStyle: {
      width: '85%' as const,
      backgroundColor: theme.colors.surface,
      shadowOpacity: 0,
      elevation: 0,
    },
    overlayColor: theme.scheme === 'dark' ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.3)',
  }), [theme.colors.surface, theme.scheme]);

  return (
    <View style={{ flex: 1 }}>
      <YouMindDrawer.Navigator drawerContent={renderDrawerContent} screenOptions={screenOptions}>
        <YouMindDrawer.Screen name="YouMindChatMain">
          {(drawerScreenProps) => (
      <YouMindChatScreen
        gatewayConfigId={gatewayConfigId}
        openSidebarRequestAt={openSidebarRequestAt}
        sessions={sessions}
              sessionKey={sessionKey}
              currentChat={currentChat}
              sending={sending}
              input={input}
              statusLabel={statusLabel}
              onOpenSidebar={() => {
                drawerScreenProps.navigation.openDrawer();
              }}
              onStartNewChat={handleStartNewChat}
              onChangeInput={setInput}
              onSend={() => {
                void runSend();
              }}
              onAbort={handleAbort}
              authState={authState}
              emptyState={emptyState}
              selectedSkill={selectedSkill}
              onOpenSkillPicker={handleOpenSkillPicker}
              onClearSelectedSkill={clearSelectedSkill}
              canAddMoreImages={canAddMoreImages}
              pendingImages={pendingImages as PendingImageWithFile[]}
              onChooseFile={pickFile}
              onOpenPendingPreview={handleOpenPendingPreview}
              onPickImage={pickImage}
              onRemovePendingImage={removePendingImage}
              onTakePhoto={takePhoto}
            />
          )}
        </YouMindDrawer.Screen>
      </YouMindDrawer.Navigator>
      <YouMindSkillPickerModal
        ref={skillPickerRef}
        onClose={() => {}}
        onRetry={() => {
          void loadInstalledSkills();
        }}
        onSelectSkill={handleSelectSkill}
        selectedSkillId={selectedSkill?.id ?? null}
        skills={installedSkills}
        currentUserId={currentUserId}
        loading={installedSkillsLoading}
        error={installedSkillsError}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerShadowWrap: {
    flex: 1,
  },
  composerSkillBar: {
    paddingBottom: Space.xs,
    paddingHorizontal: Space.sm,
  },
  composerSkillChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: Space.xs,
    maxWidth: '88%',
    minHeight: 36,
    paddingLeft: 6,
    paddingRight: 10,
    paddingVertical: 4,
  },
  composerSkillChipAvatar: {
    borderRadius: Radius.full,
    height: 24,
    width: 24,
  },
  composerSkillChipAvatarOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    ...StyleSheet.absoluteFillObject,
  },
  composerSkillChipAvatarWrap: {
    height: 24,
    position: 'relative',
    width: 24,
  },
  composerSkillChipAvatarShade: {
    backgroundColor: PresentationColor.mediaScrim,
    borderRadius: Radius.full,
    ...StyleSheet.absoluteFillObject,
  },
  composerSkillChipText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    maxWidth: 220,
  },
  composerArea: {
    paddingBottom: Space.sm,
  },
  composerPaneWrap: {
    borderRadius: Radius.xl,
    overflow: 'hidden',
  },
  emptyStateTitle: {
    fontSize: FontSize.emoji,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.5,
    textAlign: 'left',
  },
  emptyStateWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: Space.xl,
    paddingBottom: Space.xl + Space.sm,
  },
  authStateWrap: {
    flex: 1,
  },
  skillAvatar: {
    backgroundColor: PresentationColor.skillAvatarFallback,
    borderRadius: Radius.full,
    height: 52,
    width: 52,
  },
  skillAvatarWrap: {
    height: 52,
    position: 'relative',
    width: 52,
  },
  skillAvatarOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    ...StyleSheet.absoluteFillObject,
  },
  skillAvatarShade: {
    backgroundColor: PresentationColor.mediaScrim,
    borderRadius: Radius.full,
    ...StyleSheet.absoluteFillObject,
  },
  skillGlyphWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillGlyphShadow: {
    position: 'absolute',
    transform: [{ translateY: 1 }],
  },
  skillBody: {
    flex: 1,
    gap: 3,
    justifyContent: 'center',
    minWidth: 0,
  },
  skillDescription: {
    fontSize: FontSize.sm,
    lineHeight: 17,
  },
  skillItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.md,
    minHeight: 68,
  },
  skillName: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    letterSpacing: -0.15,
  },
  skillsList: {
    gap: Space.lg,
    marginTop: Space.xl,
  },
  skillsSection: {
    minHeight: RECOMMENDED_SKILL_ITEM_HEIGHT * RECOMMENDED_SKILL_SKELETON_COUNT
      + Space.lg * (RECOMMENDED_SKILL_SKELETON_COUNT - 1)
      + Space.xl,
  },
  secondaryButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  secondaryButtonText: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.medium,
  },
});
