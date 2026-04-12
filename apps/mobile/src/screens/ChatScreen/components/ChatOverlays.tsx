import React, { useCallback, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Check, Copy, Share2, Star } from 'lucide-react-native';
import { CanvasSheet } from '../../../components/canvas/CanvasSheet';
import { AgentAvatarModal } from '../../../components/chat/AgentAvatarModal';
import { AgentsModal, AgentRowData, GatewayRowData } from '../../../components/chat/AgentsModal';
import { CreateAgentModal } from '../../../components/agents/CreateAgentModal';
import { CommandOptionPickerModal } from '../../../components/chat/CommandOptionPickerModal';
import { ThinkingLevelPickerModal } from '../../../components/chat/ThinkingLevelPickerModal';
import { WebSearchModal } from '../../../components/chat/WebSearchModal';
import { PromptPickerModal } from '../../../components/chat/PromptPickerModal';
import { ImagePreviewModal } from '../../../components/chat/ImagePreviewModal';
import { ModelPickerModal, ModelInfo } from '../../../components/chat/ModelPickerModal';
import type { ModelProviderInfo } from '../../../components/chat/model-picker-data';
import { useAppTheme } from '../../../theme';
import { Radius, Shadow, Space } from '../../../theme/tokens';
import { MessageSelectionFrames } from '../../../components/MessageBubble';
import type { UiMessage } from '../../../types/chat';
import type { ThinkingLevel } from '../../../utils/gateway-settings';
import { ChatSharePosterModal } from './ChatSharePosterModal';
import { getSelectedMessageOverlayLayout } from './selectedMessageOverlayLayout';

type PreviewState = {
  closePreview: () => void;
  previewIndex: number;
  previewUris: string[];
  previewVisible: boolean;
  screenHeight: number;
  screenWidth: number;
  setPreviewIndex: (index: number) => void;
};

type Props = {
  agentActivityRows: AgentRowData[];
  agentActivityVisible: boolean;
  gateways: GatewayRowData[];
  gatewayLoading: boolean;
  avatarModalVisible: boolean;
  canvasRef: React.RefObject<unknown>;
  canvasTitle: string;
  canvasUrl: string;
  canvasVisible: boolean;
  commandPickerError: string | null;
  commandPickerLoading: boolean;
  commandPickerOptions: { value: string; isCurrent: boolean }[];
  commandPickerTitle: string;
  commandPickerVisible: boolean;
  copiedSelected: boolean;
  copyButtonSize: number;
  createAgentVisible: boolean;
  currentAgentEmoji?: string;
  currentAgentName: string;
  effectiveAvatarUri?: string;
  handleAgentCreated: (agentId: string) => void;
  handleNewAgent: () => void;
  handlePickAvatar: () => Promise<void>;
  handleRemoveAvatar: () => Promise<void>;
  hasSelectedMessageText: boolean;
  insetsTop: number;
  isSending: boolean;
  modalBottomInset: number;
  modelPickerDefaultModel?: string;
  modelPickerDefaultProvider?: string;
  modelPickerError: string | null;
  modelPickerLoading: boolean;
  modelPickerVisible: boolean;
  modelProviders?: ModelProviderInfo[];
  onCloseCommandPicker: () => void;
  onCloseCreateAgent: () => void;
  onCloseToolAvatar: () => void;
  onCopySelectedMessage: () => Promise<void>;
  onToggleSelectedMessageFavorite: () => Promise<{ favorited: boolean; favoriteKey: string | null }>;
  onRetryCommandPickerLoad: () => void;
  onRetryModelPickerLoad: () => void;
  onAddGateway: () => void;
  onManageAgents: () => void;
  onOpenAgentSessionsBoard?: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectGateway: (configId: string) => void | Promise<void>;
  onSelectCommandOption: (option: string) => void;
  onSelectModel: (model: ModelInfo) => void;
  preview: PreviewState;
  renderSelectedMessage: () => React.ReactNode;
  selectedFrames: MessageSelectionFrames | null;
  selectedMessageFavorited: boolean;
  selectedMessage: UiMessage | null;
  selectedMessageVisible: boolean;
  selectionAnim: Animated.Value;
  setAgentActivityVisible: (value: boolean) => void;
  setAvatarModalVisible: (value: boolean) => void;
  setCreateAgentVisible: (value: boolean) => void;
  setModelPickerVisible: (value: boolean) => void;
  theme: ReturnType<typeof useAppTheme>['theme'];
  models: ModelInfo[];
  pickFile: () => void;
  pickImage: () => void;
  takePhoto: () => void;
  clearSelection: () => void;
  closeCanvas: () => void;
  webSearchVisible: boolean;
  onCloseWebSearch: () => void;
  promptPickerVisible: boolean;
  onClosePromptPicker: () => void;
  onSelectPrompt: (text: string) => void;
  staticThinkPickerVisible: boolean;
  thinkingLevel: string | null;
  thinkingLevelOptions: ThinkingLevel[];
  onCloseStaticThinkPicker: () => void;
  onSelectStaticThinkLevel: (level: string) => void;
};

export function ChatOverlays({
  agentActivityRows,
  agentActivityVisible,
  gateways,
  gatewayLoading,
  avatarModalVisible,
  canvasRef,
  canvasTitle,
  canvasUrl,
  canvasVisible,
  clearSelection,
  closeCanvas,
  commandPickerError,
  commandPickerLoading,
  commandPickerOptions,
  commandPickerTitle,
  commandPickerVisible,
  copiedSelected,
  copyButtonSize,
  createAgentVisible,
  currentAgentEmoji,
  currentAgentName,
  effectiveAvatarUri,
  handleAgentCreated,
  handleNewAgent,
  handlePickAvatar,
  handleRemoveAvatar,
  hasSelectedMessageText,
  insetsTop,
  isSending,
  modalBottomInset,
  modelPickerDefaultModel,
  modelPickerDefaultProvider,
  modelPickerError,
  modelPickerLoading,
  modelPickerVisible,
  modelProviders,
  models,
  onCloseCommandPicker,
  onCloseCreateAgent,
  onCloseToolAvatar,
  onCopySelectedMessage,
  onToggleSelectedMessageFavorite,
  onRetryCommandPickerLoad,
  onRetryModelPickerLoad,
  onAddGateway,
  onManageAgents,
  onOpenAgentSessionsBoard,
  onSelectAgent,
  onSelectGateway,
  onSelectCommandOption,
  onSelectModel,
  pickFile,
  pickImage,
  preview,
  renderSelectedMessage,
  selectedFrames,
  selectedMessageFavorited,
  selectedMessage,
  selectedMessageVisible,
  selectionAnim,
  setAgentActivityVisible,
  setAvatarModalVisible,
  setCreateAgentVisible,
  setModelPickerVisible,
  webSearchVisible,
  onCloseWebSearch,
  promptPickerVisible,
  onClosePromptPicker,
  onSelectPrompt,
  staticThinkPickerVisible,
  thinkingLevel,
  thinkingLevelOptions,
  onCloseStaticThinkPicker,
  onSelectStaticThinkLevel,
  takePhoto,
  theme,
}: Props): React.JSX.Element {
  const styles = React.useMemo(() => createStyles(theme.colors), [theme]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [sharePosterVisible, setSharePosterVisible] = useState(false);
  const sharePosterDataRef = useRef<{ text: string; modelLabel?: string; timestampMs?: number } | null>(null);

  const handleSharePress = useCallback(() => {
    if (!selectedMessage) return;
    // Capture data before closing selection — selection clear will null out selectedMessage
    sharePosterDataRef.current = {
      text: selectedMessage.text ?? '',
      modelLabel: selectedMessage.modelLabel,
      timestampMs: selectedMessage.timestampMs,
    };
    // Close selection modal first, then open poster after it unmounts
    clearSelection();
    setTimeout(() => {
      setSharePosterVisible(true);
    }, 350);
  }, [selectedMessage, clearSelection]);
  const selectionLayout = React.useMemo(
    () => getSelectedMessageOverlayLayout({
      copyButtonSize,
      frames: selectedFrames,
      insetsTop,
      modalBottomInset,
      screenHeight,
      screenWidth,
    }),
    [copyButtonSize, insetsTop, modalBottomInset, screenHeight, screenWidth, selectedFrames],
  );
  const shouldRenderSelectedMessageOverlay = !!selectionLayout && !!selectedMessage;

  const animatedCloneStyle = React.useMemo(
    () => ({
      opacity: selectionAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
      transform: [
        { translateY: selectionAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
        { scale: selectionAnim.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) },
      ],
    }),
    [selectionAnim],
  );
  const animatedCopyStyle = React.useMemo(
    () => ({
      opacity: selectionAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
      transform: [
        { translateY: selectionAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
        { scale: selectionAnim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      ],
    }),
    [selectionAnim],
  );

  return (
    <>
      <Modal
        transparent
        animationType="fade"
        visible={selectedMessageVisible}
        statusBarTranslucent
        onRequestClose={clearSelection}
      >
        <View style={styles.selectionModalRoot}>
          <Pressable style={styles.selectionModalMask} onPress={clearSelection} />
          {shouldRenderSelectedMessageOverlay ? (
            <>
              <Animated.View
                style={[
                  styles.selectedCloneWrap,
                  selectionLayout.scrollEnabled && styles.selectedCloneWrapScrollable,
                  animatedCloneStyle,
                  {
                    top: selectionLayout.containerTop,
                    left: selectionLayout.containerLeft,
                    width: selectionLayout.containerWidth,
                    height: selectionLayout.containerHeight,
                  },
                ]}
              >
                <ScrollView
                  bounces={selectionLayout.scrollEnabled}
                  contentContainerStyle={styles.selectedCloneScrollContent}
                  scrollEnabled={selectionLayout.scrollEnabled}
                  showsVerticalScrollIndicator={selectionLayout.scrollEnabled}
                >
                  {renderSelectedMessage()}
                </ScrollView>
              </Animated.View>
              <Animated.View
                style={[
                  styles.floatingCopyWrap,
                  animatedCopyStyle,
                  {
                    top: selectionLayout.favoriteButtonTop,
                    left: selectionLayout.favoriteButtonLeft,
                    width: copyButtonSize,
                    height: copyButtonSize,
                  },
                ]}
              >
                <TouchableOpacity
                  activeOpacity={0.78}
                  style={styles.floatingCopyBtn}
                  onPress={() => {
                    void onToggleSelectedMessageFavorite();
                  }}
                >
                  <Star
                    size={18}
                    color={selectedMessageFavorited ? theme.colors.warning : theme.colors.primary}
                    fill={selectedMessageFavorited ? theme.colors.warning : 'transparent'}
                    strokeWidth={2.2}
                  />
                </TouchableOpacity>
              </Animated.View>
              <Animated.View
                style={[
                  styles.floatingCopyWrap,
                  animatedCopyStyle,
                  {
                    top: selectionLayout.copyButtonTop,
                    left: selectionLayout.copyButtonLeft,
                    width: copyButtonSize,
                    height: copyButtonSize,
                  },
                ]}
              >
                <TouchableOpacity
                  activeOpacity={0.78}
                  style={[
                    styles.floatingCopyBtn,
                    copiedSelected && styles.floatingCopyBtnCopied,
                    !hasSelectedMessageText && styles.selectionCopyBtnDisabled,
                  ]}
                  onPress={() => {
                    void onCopySelectedMessage();
                  }}
                  disabled={!hasSelectedMessageText}
                >
                  {copiedSelected ? (
                    <Check size={20} color={theme.colors.success} strokeWidth={2.4} />
                  ) : (
                    <Copy size={18} color={theme.colors.primary} strokeWidth={2.3} />
                  )}
                </TouchableOpacity>
              </Animated.View>
              <Animated.View
                style={[
                  styles.floatingCopyWrap,
                  animatedCopyStyle,
                  {
                    top: selectionLayout.shareButtonTop,
                    left: selectionLayout.shareButtonLeft,
                    width: copyButtonSize,
                    height: copyButtonSize,
                  },
                ]}
              >
                <TouchableOpacity
                  activeOpacity={0.78}
                  style={[
                    styles.floatingCopyBtn,
                    !hasSelectedMessageText && styles.selectionCopyBtnDisabled,
                  ]}
                  onPress={handleSharePress}
                  disabled={!hasSelectedMessageText}
                >
                  <Share2 size={18} color={theme.colors.primary} strokeWidth={2.3} />
                </TouchableOpacity>
              </Animated.View>
            </>
          ) : null}
        </View>
      </Modal>

      <ChatSharePosterModal
        visible={sharePosterVisible}
        onClose={() => {
          setSharePosterVisible(false);
          sharePosterDataRef.current = null;
        }}
        agentName={currentAgentName}
        agentEmoji={currentAgentEmoji}
        agentAvatarUri={effectiveAvatarUri}
        messageText={sharePosterDataRef.current?.text ?? ''}
        modelLabel={sharePosterDataRef.current?.modelLabel}
        timestampMs={sharePosterDataRef.current?.timestampMs}
      />

      <ImagePreviewModal
        visible={preview.previewVisible}
        uris={preview.previewUris}
        index={preview.previewIndex}
        screenWidth={preview.screenWidth}
        screenHeight={preview.screenHeight}
        insetsTop={insetsTop}
        insetsBottom={modalBottomInset}
        onClose={preview.closePreview}
        onIndexChange={preview.setPreviewIndex}
      />

      <ModelPickerModal
        visible={modelPickerVisible}
        loading={modelPickerLoading}
        error={modelPickerError}
        models={models}
        providers={modelProviders}
        onClose={() => setModelPickerVisible(false)}
        onRetry={onRetryModelPickerLoad}
        onSelectModel={onSelectModel}
        defaultModel={modelPickerDefaultModel}
        defaultProvider={modelPickerDefaultProvider}
      />

      <CommandOptionPickerModal
        visible={commandPickerVisible}
        title={commandPickerTitle}
        loading={commandPickerLoading}
        error={commandPickerError}
        options={commandPickerOptions}
        isSending={isSending}
        onClose={onCloseCommandPicker}
        onRetry={onRetryCommandPickerLoad}
        onSelectOption={onSelectCommandOption}
      />

      <WebSearchModal
        visible={webSearchVisible}
        onClose={onCloseWebSearch}
      />

      <PromptPickerModal
        visible={promptPickerVisible}
        onClose={onClosePromptPicker}
        onSelectPrompt={onSelectPrompt}
      />

      <ThinkingLevelPickerModal
        visible={staticThinkPickerVisible}
        onClose={onCloseStaticThinkPicker}
        current={thinkingLevel ?? ''}
        options={thinkingLevelOptions}
        onSelect={onSelectStaticThinkLevel}
      />

      <CanvasSheet
        ref={canvasRef as never}
        visible={canvasVisible}
        url={canvasUrl}
        title={canvasTitle}
        onClose={closeCanvas}
      />

      <AgentAvatarModal
        visible={avatarModalVisible}
        agentName={currentAgentName}
        agentEmoji={currentAgentEmoji}
        avatarUri={effectiveAvatarUri ?? undefined}
        onPickImage={() => {
          void handlePickAvatar();
        }}
        onRemove={() => {
          void handleRemoveAvatar();
        }}
        onClose={onCloseToolAvatar}
      />

      <AgentsModal
        visible={agentActivityVisible}
        onClose={() => setAgentActivityVisible(false)}
        agents={agentActivityRows}
        gateways={gateways}
        gatewayLoading={gatewayLoading}
        onAddGateway={onAddGateway}
        onManageAgents={onManageAgents}
        onOpenAgentSessionsBoard={onOpenAgentSessionsBoard}
        onSelectAgent={onSelectAgent}
        onSelectGateway={onSelectGateway}
        onNewAgent={handleNewAgent}
      />

      <CreateAgentModal
        visible={createAgentVisible}
        onClose={onCloseCreateAgent}
        onCreated={handleAgentCreated}
      />
    </>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    floatingCopyBtn: {
      flex: 1,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      ...Shadow.lg,
    },
    floatingCopyBtnCopied: {
      backgroundColor: colors.surface,
    },
    floatingCopyWrap: {
      position: 'absolute',
    },
    selectedCloneWrap: {
      position: 'absolute',
    },
    selectedCloneWrapScrollable: {
      overflow: 'hidden',
    },
    selectedCloneScrollContent: {
      flexGrow: 1,
    },
    selectionCopyBtnDisabled: {
      opacity: 0.5,
    },
    selectionModalMask: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.overlay,
    },
    selectionModalRoot: {
      flex: 1,
    },
  });
}
