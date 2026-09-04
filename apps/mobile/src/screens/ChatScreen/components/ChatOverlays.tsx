import React from 'react';
import { Animated, View } from 'react-native';
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
import { Space } from '../../../theme/tokens';
import { MessageSelectionFrames } from '../../../components/MessageBubble';
import type { UiMessage } from '../../../types/chat';
import type { ThinkingLevel } from '../../../utils/gateway-settings';
import { SelectedMessageOverlay } from './SelectedMessageOverlay';

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
  shareProductLabel?: string;
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
  models: ModelInfo[];
  pickFile: () => void;
  pickImage: () => void;
  takePhoto: () => void;
  clearSelection: () => void;
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
  clearSelection,
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
  shareProductLabel,
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
}: Props): React.JSX.Element {
  return (
    <>
      <SelectedMessageOverlay
        copiedSelected={copiedSelected}
        copyButtonSize={copyButtonSize}
        currentAgentEmoji={currentAgentEmoji}
        currentAgentName={currentAgentName}
        shareProductLabel={shareProductLabel}
        effectiveAvatarUri={effectiveAvatarUri}
        hasSelectedMessageText={hasSelectedMessageText}
        insetsTop={insetsTop}
        modalBottomInset={modalBottomInset}
        onCopySelectedMessage={onCopySelectedMessage}
        onToggleSelectedMessageFavorite={onToggleSelectedMessageFavorite}
        renderSelectedMessage={renderSelectedMessage}
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
