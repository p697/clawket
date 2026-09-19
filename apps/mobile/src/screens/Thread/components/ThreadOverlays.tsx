import React from 'react';
import type { UiMessage } from '../../../types/chat';
import type { ThinkingLevel } from '../../../utils/gateway-settings';
import type { ModelInfo } from '../../../components/chat/ModelPickerModal';
import type { ModelProviderInfo } from '../../../components/chat/model-picker-data';
import { ChatSharePosterModal } from '../../../components/chat/ChatSharePosterModal';
import { CommandOptionPickerModal } from '../../../components/chat/CommandOptionPickerModal';
import { ImagePreviewModal } from '../../../components/chat/ImagePreviewModal';
import { ModelPickerModal } from '../../../components/chat/ModelPickerModal';
import { ThinkingLevelPickerModal } from '../../../components/chat/ThinkingLevelPickerModal';
import { CommandsSheet } from '../../../components/chat/CommandsSheet';
import type { SlashCommand } from '../../../data/slash-commands';
import { ThreadAddSheet, type ThreadAddSheetProps } from './ThreadAddSheet';

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
  remainingAttachmentSlots?: number;
  onCloseAdd: () => void;
  onPickImage: () => void;
  onTakePhoto: () => void;
  onChooseFile?: () => void;
  onAttachRecentPhotos?: ThreadAddSheetProps['onAttachRecentPhotos'];
  onOpenSkills?: () => void;
  onOpenCommands?: () => void;
  onCreateScheduledTask?: () => void;
  onOpenTools?: () => void;
  onAddPresented?: ThreadAddSheetProps['onPresented'];
  onAddAction?: ThreadAddSheetProps['onAction'];
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
    configuredDefaultModel?: string;
    onManage?: () => void;
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
  commandsSheet: Readonly<{
    visible: boolean;
    commands: readonly SlashCommand[];
    onClose: () => void;
    onSelect: (command: SlashCommand) => void;
  }>;
  thinkingPicker: Readonly<{
    visible: boolean;
    current: string;
    options: ThinkingLevel[];
    onClose: () => void;
    onSelect: (level: string) => void;
  }>;
}>;

export function ThreadOverlays({
  addVisible,
  attachmentsEnabled,
  skillsEnabled,
  remainingAttachmentSlots,
  onCloseAdd,
  onPickImage,
  onTakePhoto,
  onChooseFile,
  onAttachRecentPhotos,
  onOpenSkills,
  onOpenCommands,
  onCreateScheduledTask,
  onOpenTools,
  onAddPresented,
  onAddAction,
  shareMessage,
  agentName,
  agentEmoji,
  agentAvatarUri,
  shareProductLabel,
  onCloseShare,
  preview,
  modelPicker,
  commandPicker,
  commandsSheet,
  thinkingPicker,
}: ThreadOverlaysProps): React.JSX.Element {
  return (
    <>
      <ThreadAddSheet
        visible={addVisible}
        attachmentsEnabled={attachmentsEnabled}
        skillsEnabled={skillsEnabled}
        remainingAttachmentSlots={remainingAttachmentSlots}
        onClose={onCloseAdd}
        onPickImage={onPickImage}
        onTakePhoto={onTakePhoto}
        onChooseFile={onChooseFile}
        onAttachRecentPhotos={onAttachRecentPhotos}
        onOpenSkills={onOpenSkills}
        onOpenCommands={onOpenCommands}
        onCreateScheduledTask={onCreateScheduledTask}
        onOpenTools={onOpenTools}
        onPresented={onAddPresented}
        onAction={onAddAction}
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
        configuredDefaultModel={modelPicker.configuredDefaultModel}
        onManage={modelPicker.onManage}
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
      <CommandsSheet
        visible={commandsSheet.visible}
        commands={commandsSheet.commands}
        onClose={commandsSheet.onClose}
        onSelect={commandsSheet.onSelect}
      />
      <ThinkingLevelPickerModal
        visible={thinkingPicker.visible}
        onClose={thinkingPicker.onClose}
        current={thinkingPicker.current}
        options={thinkingPicker.options}
        onSelect={thinkingPicker.onSelect}
      />
    </>
  );
}
