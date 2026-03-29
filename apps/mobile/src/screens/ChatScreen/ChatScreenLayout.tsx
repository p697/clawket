import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, LayoutAnimation, Platform, Pressable, ScrollView, StyleSheet, Text, UIManager, View, useWindowDimensions } from 'react-native';
// navigation imports removed — agent creation is now handled in-place
import Reanimated from 'react-native-reanimated';
import { ImageUp, Link2, ScanLine } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useIsFocused } from '@react-navigation/native';
import { EdgeInsets } from 'react-native-safe-area-context';
import { ChatHeader } from '../../components/chat/ChatHeader';
import { CompactionBanner } from '../../components/chat/CompactionBanner';
import { ChatBackgroundLayer } from '../../components/chat/ChatBackgroundLayer';
import { DebugOverlay } from '../../components/chat/DebugOverlay';
import { PairingPendingCard } from '../../components/chat/PairingPendingCard';
import { AgentRowData } from '../../components/chat/AgentsModal';
import { useAppContext } from '../../contexts/AppContext';
import { pickAvatarImage, saveAgentAvatar, removeAgentAvatar, buildAvatarKey, readAgentAvatar } from '../../services/agent-avatar';
import { useShareIntent } from '../../hooks/useShareIntent';
import { useChatGatewaySwitcher } from '../../hooks/useChatGatewaySwitcher';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Shadow, Space } from '../../theme/tokens';
import { useGatewayScanner } from '../../contexts/GatewayScannerContext';
import { sessionLabel } from '../../utils/chat-message';
import { formatSessionContextLabel } from '../../utils/usage-format';
import { resolveGatewayCacheScopeId } from '../../services/gateway-cache-scope';
import { SlashCommand } from '../../data/slash-commands';
import { canAddAgent } from '../../utils/pro';
import { pickAgentIdentityAvatarUri } from '../../utils/agent-avatar-uri';
import { ChatComposerPane } from './components/ChatComposerPane';
import { ChatMessagePane } from './components/ChatMessagePane';
import { ChatOverlays } from './components/ChatOverlays';
import { renderChatMessageBubble } from './components/renderChatMessageBubble';
import { useChatController } from './hooks/useChatController';
import { useChatKeyboardLayout } from './hooks/useChatKeyboardLayout';
import { useCanvasController } from './hooks/useCanvasController';
import { getChatHeaderSyncState } from './hooks/chatSyncPolicy';
import { getChatHeaderStatusLabel } from './hooks/chatHeaderStatusLabel';
import { useChatListViewport } from './hooks/useChatListViewport';
import { useChatMessageEntrance } from './hooks/useChatMessageEntrance';
import { useChatMessageSelection } from './hooks/useChatMessageSelection';
import { useMessageFavorites } from './hooks/useMessageFavorites';
import { useRotatingPlaceholder } from './hooks/useRotatingPlaceholder';
import { QuickConnectGuideCard } from '../../components/config/QuickConnectGuideCard';

type Props = {
  controller: ReturnType<typeof useChatController>;
  insets: EdgeInsets;
  onOpenSidebar: () => void;
  onAddGatewayConnection: () => void;
  onOpenCustomConnection: () => void;
  onManageAgents: () => void;
  openAgentsModalRequestAt?: number | null;
};

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Smooth spring config for new message appearance
const messageLayoutConfig = {
  duration: 350,
  create: {
    duration: 350,
    type: LayoutAnimation.Types.spring,
    property: LayoutAnimation.Properties.opacity,
    springDamping: 0.82,
  },
  update: {
    duration: 350,
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
};

function AnimatedEntrance({ children }: { children: React.ReactNode }): React.JSX.Element {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

function InitializationView({ theme, styles, onAdd, onUpload, onAddCustom, t }: {
  theme: ReturnType<typeof useAppTheme>['theme'];
  styles: ReturnType<typeof createStyles>;
  onAdd: () => void;
  onUpload: () => void;
  onAddCustom: () => void;
  t: (key: string, options?: { ns?: string }) => string;
}): React.JSX.Element {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  return (
    <ScrollView
      style={styles.initScroll}
      contentContainerStyle={styles.initScrollContent}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View style={[styles.initWrap, { opacity: fadeAnim }]}>
        <Text style={styles.initTitle}>{t('Your OpenClaw Mobile is ready.')}</Text>
        <Text style={styles.initSubtitle}>{t('One connection away from something interesting.')}</Text>
        <QuickConnectGuideCard style={styles.initGuideCard} variant="simple" />
        <Pressable
          onPress={onAdd}
          style={({ pressed }) => [styles.initButton, pressed && styles.initButtonPressed]}
        >
          <View style={styles.initButtonContent}>
            <ScanLine size={15} color={theme.colors.primaryText} strokeWidth={2} />
            <Text style={styles.initButtonText}>{t('Scan QR Code', { ns: 'config' })}</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={onUpload}
          style={({ pressed }) => [styles.initOutlineButton, pressed && styles.initOutlineButtonPressed]}
        >
          <View style={styles.initButtonContent}>
            <ImageUp size={15} color={theme.colors.primary} strokeWidth={2} />
            <Text style={styles.initOutlineButtonText}>{t('Upload QR Image', { ns: 'config' })}</Text>
          </View>
        </Pressable>
        <Pressable
          onPress={onAddCustom}
          style={({ pressed }) => [styles.initOutlineButton, pressed && styles.initOutlineButtonPressed]}
        >
          <View style={styles.initButtonContent}>
            <Link2 size={15} color={theme.colors.primary} strokeWidth={2} />
            <Text style={styles.initOutlineButtonText}>{t('Add custom connection', { ns: 'config' })}</Text>
          </View>
        </Pressable>
      </Animated.View>
    </ScrollView>
  );
}

export function ChatScreenLayout({ controller, insets, onOpenSidebar, onAddGatewayConnection, onOpenCustomConnection, onManageAgents, openAgentsModalRequestAt }: Props): React.JSX.Element {
  const { t } = useTranslation(['chat', 'config']);
  const { isPro, showPaywall } = useProPaywall();
  const isFocused = useIsFocused();
  const { importGatewayQrImage } = useGatewayScanner();
  const { activeGatewayConfigId, currentAgentId, agentAvatars, setAgentAvatars, agents, gateway, gatewayEpoch, showModelUsage, chatFontSize, chatAppearance, config, requestAddGateway, isMultiAgent, switchAgent, debugMode, onSaved } = useAppContext();
  const [avatarModalVisible, setAvatarModalVisible] = useState(false);
  const [agentActivityVisible, setAgentActivityVisible] = useState(false);
  const currentAgent = agents.find((a) => a.id === currentAgentId);
  const currentAgentName = currentAgent?.identity?.name?.trim() || currentAgent?.name?.trim() || controller.agentDisplayName || null;
  const currentAvatarKey = buildAvatarKey(currentAgentId, currentAgentName ?? undefined);
  const localAvatar = readAgentAvatar(agentAvatars, currentAgent);
  const effectiveAvatarUri = localAvatar?.trim() || controller.agentAvatarUri?.trim() || undefined;

  // Canvas WebView panel
  const { canvasVisible, canvasUrl, canvasTitle, canvasRef, closeCanvas } = useCanvasController();

  // Handle incoming share intents
  useShareIntent(controller.setPendingImages ? {
    setInput: controller.setInput,
    setPendingImages: controller.setPendingImages,
  } : null);

  const handlePickAvatar = useCallback(async () => {
    const dataUri = await pickAvatarImage();
    if (dataUri) {
      const updated = await saveAgentAvatar(currentAvatarKey, dataUri);
      setAgentAvatars(updated);
    }
    setAvatarModalVisible(false);
  }, [currentAvatarKey, setAgentAvatars]);

  const handleRemoveAvatar = useCallback(async () => {
    const updated = await removeAgentAvatar(currentAvatarKey);
    setAgentAvatars(updated);
    setAvatarModalVisible(false);
  }, [currentAvatarKey, setAgentAvatars]);

  const openAgentActivity = useCallback(() => setAgentActivityVisible(true), []);

  // Open agents modal when requested from the session sidebar
  const handledAgentsModalRef = useRef<number | null>(null);
  useEffect(() => {
    if (!openAgentsModalRequestAt) return;
    if (handledAgentsModalRef.current === openAgentsModalRequestAt) return;
    handledAgentsModalRef.current = openAgentsModalRequestAt;
    setAgentActivityVisible(true);
  }, [openAgentsModalRequestAt]);

  const agentActivityRows = useMemo((): AgentRowData[] => {
    const activityMap = controller.agentActivityRef.current;
    return agents.map((agent) => {
      const isCurrent = agent.id === currentAgentId;
      const activity = activityMap.get(agent.id);
      let avatarUri = pickAgentIdentityAvatarUri(agent.identity, gateway.getBaseUrl.bind(gateway));
      const localAv = readAgentAvatar(agentAvatars, agent);
      if (localAv) avatarUri = localAv;

      if (isCurrent) {
        return {
          agentId: agent.id,
          displayName: agent.identity?.name?.trim() || agent.name?.trim() || agent.id,
          emoji: agent.identity?.emoji ?? null,
          avatarUri,
          status: controller.isSending ? 'streaming' : 'idle',
          previewText: controller.activityLabel ?? null,
          toolName: null,
          isCurrent: true,
        };
      }
      return {
        agentId: agent.id,
        displayName: agent.identity?.name?.trim() || agent.name?.trim() || agent.id,
        emoji: agent.identity?.emoji ?? null,
        avatarUri,
        status: activity?.status ?? 'idle',
        previewText: activity?.previewText ?? null,
        toolName: activity?.toolName ?? null,
        isCurrent: false,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- agentActiveCount forces re-read of agentActivityRef
  }, [agents, currentAgentId, controller.agentActivityRef, controller.agentActiveCount, controller.isSending, controller.activityLabel, agentAvatars, gateway]);

  const handleSelectAgent = useCallback((agentId: string) => {
    switchAgent(agentId);
  }, [switchAgent]);
  const handleAddGatewayFromSwitcher = useCallback(() => {
    if (!isPro) {
      showPaywall('gatewayConnections');
      return;
    }
    onAddGatewayConnection();
  }, [isPro, onAddGatewayConnection, showPaywall]);

  const gatewaySwitcher = useChatGatewaySwitcher({
    activeGatewayConfigId,
    config,
    debugMode,
    gateway,
    onSaved,
  });
  const gatewayRows = useMemo(() => (
    gatewaySwitcher.configs
      .map((item) => ({
        configId: item.id,
        name: item.name,
        mode: item.mode,
        url: item.url,
        isCurrent: item.id === gatewaySwitcher.activeConfigId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  ), [gatewaySwitcher.activeConfigId, gatewaySwitcher.configs]);
  const refreshGatewayConfigs = gatewaySwitcher.refreshConfigs;

  useEffect(() => {
    if (!isFocused) return;
    void refreshGatewayConfigs();
  }, [isFocused, refreshGatewayConfigs]);

  const [webSearchVisible, setWebSearchVisible] = useState(false);
  const [promptPickerVisible, setPromptPickerVisible] = useState(false);

  const handleSelectPrompt = useCallback((text: string) => {
    controller.setInput((prev: string) => {
      if (!prev.trim()) return text;
      return prev + '\n\n' + text;
    });
  }, [controller]);
  const [createAgentVisible, setCreateAgentVisible] = useState(false);
  const handleNewAgent = useCallback(() => {
    if (!canAddAgent(agents.length, isPro)) {
      setAgentActivityVisible(false);
      showPaywall('agents');
      return;
    }
    setAgentActivityVisible(false);
    setCreateAgentVisible(true);
  }, [agents.length, isPro, showPaywall]);
  const handleAgentCreated = useCallback((agentId: string) => {
    setCreateAgentVisible(false);
    switchAgent(agentId);
  }, [switchAgent]);

  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const flatListRef = useRef<any>(null);
  const { height: screenHeight } = useWindowDimensions();

  const { listFadeAnim, newMessageIds } = useChatMessageEntrance({
    listData: controller.listData,
  });

  const streamingText = controller.listData.find((m) => m.streaming)?.text ?? null;
  const handleSingleMessageAppend = useCallback(() => {
    // Animate only single-message append to avoid initial/fetch batch jitter.
    flatListRef.current?.prepareForLayoutAnimationRender?.();
    LayoutAnimation.configureNext(messageLayoutConfig);
  }, []);
  const {
    onListContentSizeChange: handleListContentSizeChange,
    onScrollBeginDrag: handleScrollBeginDrag,
    onScrollEndDrag: handleScrollEndDrag,
    onScrollStateChange: handleScrollStateChange,
    onScrollToBottom: scrollToBottom,
    showScrollButton,
  } = useChatListViewport({
    flatListRef,
    isSending: controller.isSending,
    listLength: controller.listData.length,
    onSingleMessageAppend: handleSingleMessageAppend,
    streamingText,
  });
  const handledScrollToBottomRequestRef = useRef<number | null>(null);
  useEffect(() => {
    if (!controller.scrollToBottomRequestAt) return;
    if (handledScrollToBottomRequestRef.current === controller.scrollToBottomRequestAt) return;
    handledScrollToBottomRequestRef.current = controller.scrollToBottomRequestAt;
    requestAnimationFrame(() => {
      scrollToBottom();
    });
  }, [controller.scrollToBottomRequestAt, scrollToBottom]);
  const currentLabel = controller.sessions.find((item) => item.key === controller.sessionKey);
  const currentModelLabel = currentLabel?.model || null;
  const currentModelProvider = currentLabel?.modelProvider || null;
  const gatewayConfigId = useMemo(
    () => resolveGatewayCacheScopeId({ activeConfigId: activeGatewayConfigId, config }),
    [activeGatewayConfigId, config],
  );
  const favorites = useMessageFavorites({
    agentEmoji: controller.agentEmoji,
    agentId: currentAgentId,
    agentName: controller.agentDisplayName,
    gatewayConfigId,
    listData: controller.listData,
    sessionKey: controller.sessionKey,
    sessionLabel: currentLabel?.label ?? null,
  });
  const {
    clearSelection,
    copiedSelected,
    copyButtonSize,
    copySelectedMessage,
    handleSelectMessage,
    hasSelectedMessageText,
    selectedFrames,
    selectedMessageFavorited,
    selectedMessage,
    selectedMessageId,
    selectedMessageVisible,
    selectionAnim,
    toggleSelectedMessageFavorite,
    toggleMessageSelection,
  } = useChatMessageSelection({
    isFavoritedMessage: favorites.isFavoritedMessage,
    listData: controller.listData,
    onToggleFavorite: favorites.toggleFavorite,
  });

  const headerContextLabel = formatSessionContextLabel({
    totalTokens: currentLabel?.totalTokens,
    totalTokensFresh: currentLabel?.totalTokensFresh,
    contextTokens: currentLabel?.contextTokens,
  });
  const headerSyncState = getChatHeaderSyncState({
    config,
    sessionKey: controller.sessionKey,
    connectionState: controller.connectionState,
    refreshing: controller.refreshing,
    historyLoaded: controller.historyLoaded,
    isSending: controller.isSending,
  });
  const isConnecting = headerSyncState.isConnecting;
  const headerStatusLabel = getChatHeaderStatusLabel(headerSyncState.status, t);
  const headerBusy = headerSyncState.busy;

  const isAgentWorking = controller.isSending && !isConnecting && controller.voiceInputState !== 'listening' && controller.voiceInputState !== 'authorizing';
  const rotatingPlaceholder = useRotatingPlaceholder(isAgentWorking);

  const {
    animatedRootStyle,
    composerBottomPadding,
    composerSwipeGesture,
    handleComposerBlur,
    handleComposerFocus,
    modalBottomInset,
    slashSuggestionsMaxHeight,
  } = useChatKeyboardLayout({
    insets,
    keyboardVisible: controller.keyboardVisible,
    screenHeight,
  });
  const handleSelectSlashCommand = useCallback((command: SlashCommand) => {
    controller.onSelectSlashCommand(command);
  }, [controller]);
  const renderMessageBubble = (
    item: (typeof controller.listData)[number],
    options?: { overlayMode?: boolean; forceSelected?: boolean },
  ) => {
    return renderChatMessageBubble({
      agentDisplayName: controller.agentDisplayName ?? null,
      chatFontSize,
      effectiveAvatarUri,
      isFavorited: favorites.favoriteMessageIdSet.has(item.id),
      item,
      onAvatarPress: () => setAvatarModalVisible(true),
      onImagePreview: controller.preview.openPreview,
      onResolveApproval: controller.resolveApproval,
      onSelectMessage: handleSelectMessage,
      onToggleSelection: toggleMessageSelection,
      options,
      selectedMessageId,
      showAgentAvatar: controller.showAgentAvatar,
      showModelUsage,
    });
  };

  const messageListExtraData = useMemo(() => ({
    agentDisplayName: controller.agentDisplayName ?? null,
    chatFontSize,
    effectiveAvatarUri: effectiveAvatarUri ?? null,
    favoriteMessageIds: favorites.favoriteMessageIdSet,
    selectedMessageId,
    showAgentAvatar: controller.showAgentAvatar,
    showModelUsage,
  }), [
    chatFontSize,
    controller.agentDisplayName,
    controller.showAgentAvatar,
    effectiveAvatarUri,
    favorites.favoriteMessageIdSet,
    selectedMessageId,
    showModelUsage,
  ]);

  return (
    <Reanimated.View style={[styles.root, animatedRootStyle]}>
      <ChatBackgroundLayer appearance={chatAppearance} />

      <ChatHeader
        title={currentLabel ? sessionLabel(currentLabel, { currentAgentName }) : controller.sessionKey ?? t('No session')}
        connectionState={controller.connectionState}
        isTyping={controller.isSending}
        agentName={controller.agentDisplayName}
        activityLabel={controller.activityLabel}
        statusLabel={headerStatusLabel}
        agentEmoji={controller.agentEmoji ?? undefined}
        onOpenSidebar={onOpenSidebar}
        onRefresh={controller.onRefresh}
        contextLabel={headerContextLabel}
        wallpaperActive={chatAppearance.background.enabled && !!chatAppearance.background.imagePath}
        hasOtherAgentActivity={isMultiAgent && controller.agentActiveCount > 0}
        onAgentActivity={openAgentActivity}
        refreshDisabled={!config || !controller.sessionKey || controller.refreshing}
        refreshing={headerBusy}
        topPadding={insets.top + (Platform.OS === 'android' ? 12 : 0)}
      />

      {!!controller.compactionNotice && <CompactionBanner message={controller.compactionNotice} />}
      {controller.showDebug && <DebugOverlay logs={controller.debugLog} />}

      {!config ? (
        <InitializationView
          theme={theme}
          styles={styles}
          onAdd={requestAddGateway}
          onUpload={() => {
            void importGatewayQrImage();
          }}
          onAddCustom={onOpenCustomConnection}
          t={t}
        />
      ) : controller.pairingPending ? (
        <PairingPendingCard
          approveCommand={controller.approveCommand}
          copied={controller.copied}
          onCopy={controller.handleCopyCommand}
          connectionMode={config?.mode}
          onRetry={controller.handlePairingRetry}
        />
      ) : (
        <>
          <ChatMessagePane
            extraData={messageListExtraData}
            flatListRef={flatListRef}
            gatewayEpoch={gatewayEpoch}
            listData={controller.listData}
            listFadeAnim={listFadeAnim}
            loadingMoreHistory={controller.loadingMoreHistory}
            newMessageIds={newMessageIds}
            onDismissSlashSuggestions={controller.dismissSlashSuggestions}
            onEndReached={controller.onLoadMoreHistory}
            onListContentSizeChange={handleListContentSizeChange}
            onScroll={handleScrollStateChange}
            onScrollBeginDrag={handleScrollBeginDrag}
            onScrollEndDrag={handleScrollEndDrag}
            onScrollToBottom={scrollToBottom}
            onSelectSlashCommand={handleSelectSlashCommand}
            renderMessageBubble={(item) => renderMessageBubble(item)}
            sessionKey={controller.sessionKey ?? ''}
            showScrollButton={showScrollButton}
            showSlashSuggestions={controller.showSlashSuggestions}
            slashInputValue={controller.input}
            slashSuggestions={controller.slashSuggestions}
            slashSuggestionsMaxHeight={slashSuggestionsMaxHeight}
            theme={theme}
          />

          <ChatComposerPane
            canAddMoreImages={controller.canAddMoreImages}
            canSend={controller.canSend}
            composerBottomPadding={composerBottomPadding}
            composerRef={controller.composerRef}
            composerSwipeGesture={composerSwipeGesture}
            input={controller.input}
            isConnecting={isConnecting}
            isSending={controller.isSending}
            modelLabel={currentModelLabel}
            pendingImages={controller.pendingImages}
            placeholder={
              controller.voiceInputState === 'listening'
                ? t('Listening...')
                : controller.voiceInputState === 'authorizing'
                  ? t('Preparing voice input...')
                  : isConnecting
                    ? t('Connecting...')
                    : isAgentWorking
                      ? rotatingPlaceholder
                      : t('Message...')
            }
            animatedPlaceholder={isAgentWorking}
            thinkingLevel={controller.thinkingLevel}
            onAbort={controller.abortCurrentRun}
            onBlur={handleComposerBlur}
            onChangeText={controller.setInput}
            onChooseFile={controller.pickFile}
            onCommandPress={controller.openSlashMenu}
            onFocus={handleComposerFocus}
            onModelPress={() => controller.openModelPicker()}
            onPickImage={controller.pickImage}
            onWebSearchPress={() => setWebSearchVisible(true)}
            onPromptPress={() => setPromptPickerVisible(true)}
            onOpenPreview={(index) => controller.preview.openPreview(controller.pendingImages.map((image) => image.uri), index)}
            onRemovePendingImage={(index) => {
              controller.removePendingImage(index);
            }}
            onSelectThinkingLevel={controller.onSelectStaticThinkLevel}
            onSend={controller.onSend}
            onTakePhoto={controller.takePhoto}
            onVoiceInputPress={controller.toggleVoiceInput}
            showVoiceInput={controller.voiceInputSupported}
            voiceInputActive={controller.voiceInputActive}
            voiceInputDisabled={controller.voiceInputDisabled}
            voiceInputLevel={controller.voiceInputLevel}
          />
        </>
      )}

      <ChatOverlays
        agentActivityRows={agentActivityRows}
        agentActivityVisible={agentActivityVisible}
        gateways={gatewayRows}
        gatewayLoading={gatewaySwitcher.loading}
        avatarModalVisible={avatarModalVisible}
        canvasRef={canvasRef}
        canvasTitle={canvasTitle ?? t('Canvas')}
        canvasUrl={canvasUrl ?? ''}
        canvasVisible={canvasVisible}
        clearSelection={clearSelection}
        closeCanvas={closeCanvas}
        commandPickerError={controller.commandPickerError}
        commandPickerLoading={controller.commandPickerLoading}
        commandPickerOptions={controller.commandPickerOptions}
        commandPickerTitle={controller.commandPickerTitle}
        commandPickerVisible={controller.commandPickerVisible}
        copiedSelected={copiedSelected}
        copyButtonSize={copyButtonSize}
        createAgentVisible={createAgentVisible}
        currentAgentEmoji={currentAgent?.identity?.emoji ?? undefined}
        currentAgentName={currentAgent?.name ?? currentAgent?.id ?? 'Agent'}
        effectiveAvatarUri={effectiveAvatarUri}
        handleAgentCreated={handleAgentCreated}
        handleNewAgent={handleNewAgent}
        handlePickAvatar={handlePickAvatar}
        handleRemoveAvatar={handleRemoveAvatar}
        hasSelectedMessageText={hasSelectedMessageText}
        insetsTop={insets.top}
        isSending={controller.isSending}
        modalBottomInset={modalBottomInset}
        modelPickerError={controller.modelPickerError}
        modelPickerLoading={controller.modelPickerLoading}
        modelPickerVisible={controller.modelPickerVisible}
        modelPickerDefaultModel={currentModelLabel ?? undefined}
        modelPickerDefaultProvider={currentModelProvider ?? undefined}
        models={controller.availableModels}
        onCloseCommandPicker={controller.closeCommandPicker}
        onCloseCreateAgent={() => setCreateAgentVisible(false)}
        onCloseToolAvatar={() => setAvatarModalVisible(false)}
        onCopySelectedMessage={copySelectedMessage}
        onToggleSelectedMessageFavorite={toggleSelectedMessageFavorite}
        onRetryCommandPickerLoad={controller.retryCommandPickerLoad}
        onRetryModelPickerLoad={controller.retryModelPickerLoad}
        onAddGateway={handleAddGatewayFromSwitcher}
        onManageAgents={onManageAgents}
        onSelectAgent={handleSelectAgent}
        onSelectGateway={gatewaySwitcher.activateConfig}
        onSelectCommandOption={controller.onSelectCommandOption}
        onSelectModel={controller.onSelectModel}
        pickFile={controller.pickFile}
        pickImage={controller.pickImage}
        preview={{
          closePreview: controller.preview.closePreview,
          previewIndex: controller.preview.previewIndex,
          previewUris: controller.preview.previewUris,
          previewVisible: controller.preview.previewVisible,
          screenHeight: controller.preview.screenHeight,
          screenWidth: controller.preview.screenWidth,
          setPreviewIndex: controller.preview.setPreviewIndex,
        }}
        renderSelectedMessage={() => (
          selectedMessage
            ? renderMessageBubble(selectedMessage, { overlayMode: true, forceSelected: true })
            : null
        )}
        selectedFrames={selectedFrames}
        selectedMessageFavorited={selectedMessageFavorited}
        selectedMessage={selectedMessage}
        selectedMessageVisible={selectedMessageVisible}
        selectionAnim={selectionAnim}
        setAgentActivityVisible={setAgentActivityVisible}
        setAvatarModalVisible={setAvatarModalVisible}
        setCreateAgentVisible={setCreateAgentVisible}
        setModelPickerVisible={controller.setModelPickerVisible}
        webSearchVisible={webSearchVisible}
        onCloseWebSearch={() => setWebSearchVisible(false)}
        promptPickerVisible={promptPickerVisible}
        onClosePromptPicker={() => setPromptPickerVisible(false)}
        onSelectPrompt={handleSelectPrompt}
        staticThinkPickerVisible={controller.staticThinkPickerVisible}
        thinkingLevel={controller.thinkingLevel}
        onCloseStaticThinkPicker={controller.closeStaticThinkPicker}
        onSelectStaticThinkLevel={controller.onSelectStaticThinkLevel}
        takePhoto={controller.takePhoto}
        theme={theme}
      />
    </Reanimated.View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: { backgroundColor: colors.background, flex: 1 },
    initScroll: {
      flex: 1,
    },
    initScrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingVertical: Space.xl,
    },
    initWrap: {
      alignItems: 'center' as const,
      paddingHorizontal: Space.xl,
    },
    initTitle: {
      color: colors.text,
      fontSize: FontSize.xl,
      fontWeight: FontWeight.semibold,
      marginBottom: Space.sm,
    },
    initSubtitle: {
      color: colors.textMuted,
      fontSize: FontSize.base,
      textAlign: 'center' as const,
      marginBottom: Space.lg + Space.xs,
    },
    initGuideCard: {
      width: '100%',
      marginBottom: Space.md,
    },
    initButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Radius.md,
      marginTop: Space.md,
      paddingVertical: 11,
      width: '100%',
      ...Shadow.md,
    },
    initButtonPressed: {
      opacity: 0.88,
    },
    initOutlineButton: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.primary,
      marginTop: Space.md,
      paddingVertical: 11,
      width: '100%',
    },
    initOutlineButtonPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    initButtonContent: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: Space.sm,
    },
    initButtonText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    initOutlineButtonText: {
      color: colors.primary,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    listArea: { flex: 1, position: 'relative' as const, zIndex: 1 },
    listAreaContent: { flex: 1 },
    connectingLoadingWrap: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    slashOverlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: 'flex-end',
      paddingHorizontal: Space.md - 2,
      paddingBottom: Space.xs,
      zIndex: 6,
    },
    slashDismissArea: {
      ...StyleSheet.absoluteFillObject,
    },
    slashPopupWrap: {
      width: '100%',
    },
    selectionModalRoot: {
      flex: 1,
    },
    selectionModalMask: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
    },
    selectedCloneWrap: {
      position: 'absolute',
      zIndex: 2,
    },
    floatingCopyWrap: {
      position: 'absolute',
      zIndex: 3,
    },
    floatingCopyBtn: {
      width: '100%',
      height: '100%',
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.borderStrong,
      borderWidth: 1,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    floatingCopyBtnCopied: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.success,
    },
    selectionCopyBtnDisabled: {
      backgroundColor: colors.surfaceMuted,
      borderColor: colors.border,
    },
  });
}
