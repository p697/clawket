import React from 'react';
import type { AppUpdateAnnouncement } from '../../../features/app-updates/releases';
import type { UiMessage } from '../../../types/chat';
import type { ThinkingLevel } from '../../../utils/gateway-settings';
import type { ModelInfo } from '../../../components/chat/ModelPickerModal';
import type { ModelProviderInfo } from '../../../components/chat/model-picker-data';
import { ChatSharePosterModal } from '../../../components/chat/ChatSharePosterModal';
import { CommandOptionPickerModal } from '../../../components/chat/CommandOptionPickerModal';
import { ImagePreviewModal } from '../../../components/chat/ImagePreviewModal';
import { ModelPickerModal } from '../../../components/chat/ModelPickerModal';
import { PromptPickerModal } from '../../../components/chat/PromptPickerModal';
import { ThinkingLevelPickerModal } from '../../../components/chat/ThinkingLevelPickerModal';
import { AppUpdateAnnouncementSheet } from './AppUpdateAnnouncementSheet';
import { ThreadAddSheet } from './ThreadAddSheet';
import { ThreadMessageActionsSheet } from './ThreadMessageActionsSheet';
import { ConfirmationModal } from '../../../components/ui';

type PreviewState = Readonly<{
  visible: boolean;
  uris: string[];
  index: number;
  width: number;
  height: number;
  topInset: number;
  bottomInset: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}>;

export type ThreadOverlaysProps = Readonly<{
  addVisible: boolean;
  attachmentsEnabled: boolean;
  skillsEnabled: boolean;
  onCloseAdd: () => void;
  onPickImage: () => void;
  onTakePhoto: () => void;
  onChooseFile?: () => void;
  onOpenSkills?: () => void;
  onOpenPrompts?: () => void;
  selectedMessage: UiMessage | null;
  selectedMessageFavorited: boolean;
  onCloseMessageActions: () => void;
  onCopyMessage: (message: UiMessage) => void;
  onToggleFavorite: (message: UiMessage) => void;
  onShareMessage: (message: UiMessage) => void;
  shareMessage: UiMessage | null;
  agentName: string;
  agentEmoji?: string;
  agentAvatarUri?: string;
  shareProductLabel?: string;
  onCloseShare: () => void;
  preview: PreviewState;
  modelPicker: Readonly<{
    visible: boolean;
    loading: boolean;
    error: string | null;
    models: ModelInfo[];
    providers?: ModelProviderInfo[];
    defaultModel?: string;
    defaultProvider?: string;
    onClose: () => void;
    onRetry: () => void;
    onSelect: (model: ModelInfo) => void;
  }>;
  commandPicker: Readonly<{
    visible: boolean;
    title: string;
    loading: boolean;
    error: string | null;
    options: { value: string; isCurrent: boolean }[];
    isSending: boolean;
    onClose: () => void;
    onRetry: () => void;
    onSelect: (value: string) => void;
  }>;
  promptPicker: Readonly<{
    visible: boolean;
    onClose: () => void;
    onSelect: (text: string) => void;
  }>;
  thinkingPicker: Readonly<{
    visible: boolean;
    current: string;
    options: ThinkingLevel[];
    onClose: () => void;
    onSelect: (level: string) => void;
  }>;
  announcement: Readonly<{
    visible: boolean;
    value: AppUpdateAnnouncement | null;
    debugMode: boolean;
    currentVersion: string;
    onClose: () => void;
    onEntryPress: (entry: AppUpdateAnnouncement['entries'][number]) => void;
  }>;
  stopConfirmation: Readonly<{
    visible: boolean;
    title: string;
    message: string;
    cancelLabel: string;
    confirmLabel: string;
    onClose: () => void;
    onConfirm: () => void;
  }>;
}>;

export function ThreadOverlays({
  addVisible,
  attachmentsEnabled,
  skillsEnabled,
  onCloseAdd,
  onPickImage,
  onTakePhoto,
  onChooseFile,
  onOpenSkills,
  onOpenPrompts,
  selectedMessage,
  selectedMessageFavorited,
  onCloseMessageActions,
  onCopyMessage,
  onToggleFavorite,
  onShareMessage,
  shareMessage,
  agentName,
  agentEmoji,
  agentAvatarUri,
  shareProductLabel,
  onCloseShare,
  preview,
  modelPicker,
  commandPicker,
  promptPicker,
  thinkingPicker,
  announcement,
  stopConfirmation,
}: ThreadOverlaysProps): React.JSX.Element {
  return (
    <>
      <ThreadAddSheet
        visible={addVisible}
        attachmentsEnabled={attachmentsEnabled}
        skillsEnabled={skillsEnabled}
        onClose={onCloseAdd}
        onPickImage={onPickImage}
        onTakePhoto={onTakePhoto}
        onChooseFile={onChooseFile}
        onOpenSkills={onOpenSkills}
        onOpenPrompts={onOpenPrompts}
      />
      <ThreadMessageActionsSheet
        visible={Boolean(selectedMessage)}
        message={selectedMessage}
        favorited={selectedMessageFavorited}
        onClose={onCloseMessageActions}
        onCopy={onCopyMessage}
        onToggleFavorite={onToggleFavorite}
        onShare={onShareMessage}
      />
      <ChatSharePosterModal
        visible={Boolean(shareMessage)}
        onClose={onCloseShare}
        agentName={agentName}
        agentEmoji={agentEmoji}
        agentAvatarUri={agentAvatarUri}
        shareProductLabel={shareProductLabel}
        messageText={shareMessage?.text ?? ''}
        modelLabel={shareMessage?.modelLabel}
        timestampMs={shareMessage?.timestampMs}
      />
      <ImagePreviewModal
        visible={preview.visible}
        uris={preview.uris}
        index={preview.index}
        screenWidth={preview.width}
        screenHeight={preview.height}
        insetsTop={preview.topInset}
        insetsBottom={preview.bottomInset}
        onClose={preview.onClose}
        onIndexChange={preview.onIndexChange}
      />
      <ModelPickerModal
        visible={modelPicker.visible}
        loading={modelPicker.loading}
        error={modelPicker.error}
        models={modelPicker.models}
        providers={modelPicker.providers}
        onClose={modelPicker.onClose}
        onRetry={modelPicker.onRetry}
        onSelectModel={modelPicker.onSelect}
        defaultModel={modelPicker.defaultModel}
        defaultProvider={modelPicker.defaultProvider}
      />
      <CommandOptionPickerModal
        visible={commandPicker.visible}
        title={commandPicker.title}
        loading={commandPicker.loading}
        error={commandPicker.error}
        options={commandPicker.options}
        isSending={commandPicker.isSending}
        onClose={commandPicker.onClose}
        onRetry={commandPicker.onRetry}
        onSelectOption={commandPicker.onSelect}
      />
      <PromptPickerModal
        visible={promptPicker.visible}
        onClose={promptPicker.onClose}
        onSelectPrompt={promptPicker.onSelect}
      />
      <ThinkingLevelPickerModal
        visible={thinkingPicker.visible}
        onClose={thinkingPicker.onClose}
        current={thinkingPicker.current}
        options={thinkingPicker.options}
        onSelect={thinkingPicker.onSelect}
      />
      <AppUpdateAnnouncementSheet
        visible={announcement.visible}
        announcement={announcement.value}
        debugMode={announcement.debugMode}
        currentVersion={announcement.currentVersion}
        onClose={announcement.onClose}
        onEntryPress={announcement.onEntryPress}
      />
      <ConfirmationModal
        visible={stopConfirmation.visible}
        title={stopConfirmation.title}
        message={stopConfirmation.message}
        cancelLabel={stopConfirmation.cancelLabel}
        confirmLabel={stopConfirmation.confirmLabel}
        onClose={stopConfirmation.onClose}
        onConfirm={stopConfirmation.onConfirm}
        destructive
        testID="thread-stop-confirmation"
      />
    </>
  );
}
