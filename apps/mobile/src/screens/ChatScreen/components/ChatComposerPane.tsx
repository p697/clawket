import React from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { PendingImageBar } from '../../../components/chat/PendingImageBar';
import { ChatComposer } from '../../../components/chat/ChatComposer';
import { PendingImage } from '../../../types/chat';
import type { ThinkingLevel } from '../../../utils/gateway-settings';
import { isComposerInputEditable } from '../hooks/composerInteractionPolicy';

type ComposerGesture = ReturnType<typeof Gesture.Pan>;

type Props = {
  canAddMoreImages: boolean;
  canSend: boolean;
  composerBottomPadding: number;
  composerRef: React.RefObject<import('../../../components/chat/ChatComposer').ChatComposerHandle | null>;
  composerSwipeGesture: ComposerGesture;
  input: string;
  isConnecting: boolean;
  isSending: boolean;
  pendingImages: PendingImage[];
  placeholder: string;
  animatedPlaceholder?: boolean;
  thinkingLevel?: string | null;
  thinkingLevelOptions?: ThinkingLevel[];
  modelLabel?: string | null;
  onAbort?: () => void;
  onBlur: () => void;
  onChangeText: (value: string) => void;
  onChooseFile: () => void | Promise<void>;
  onCommandPress: () => void;
  onFocus: () => void;
  onModelPress?: () => void;
  onPickImage: () => void | Promise<void>;
  onWebSearchPress?: () => void;
  onPromptPress?: () => void;
  onOpenPreview: (index: number) => void;
  onRemovePendingImage: (index: number) => void;
  onSelectThinkingLevel?: (value: string) => void;
  onSend: () => void;
  onTakePhoto: () => void | Promise<void>;
  onVoiceInputPress?: () => void;
  showVoiceInput?: boolean;
  voiceInputActive?: boolean;
  voiceInputDisabled?: boolean;
  voiceInputLevel?: number;
};

export function ChatComposerPane({
  canAddMoreImages,
  canSend,
  composerBottomPadding,
  composerRef,
  composerSwipeGesture,
  input,
  isConnecting,
  isSending,
  pendingImages,
  placeholder,
  animatedPlaceholder,
  thinkingLevel,
  thinkingLevelOptions,
  modelLabel,
  onAbort,
  onBlur,
  onChangeText,
  onChooseFile,
  onCommandPress,
  onFocus,
  onModelPress,
  onPickImage,
  onWebSearchPress,
  onPromptPress,
  onOpenPreview,
  onRemovePendingImage,
  onSelectThinkingLevel,
  onSend,
  onTakePhoto,
  onVoiceInputPress,
  showVoiceInput,
  voiceInputActive,
  voiceInputDisabled,
  voiceInputLevel,
}: Props): React.JSX.Element {
  const inputEditable = isComposerInputEditable({
    editable: true,
    voiceInputActive: !!voiceInputActive,
  });

  return (
    <GestureDetector gesture={composerSwipeGesture}>
      <View>
        {pendingImages.length > 0 ? (
          <PendingImageBar
            images={pendingImages}
            canAddMore={canAddMoreImages}
            attachDisabled={!inputEditable}
            onOpenPreview={onOpenPreview}
            onRemove={onRemovePendingImage}
            onPickImage={onPickImage}
            onTakePhoto={onTakePhoto}
            onChooseFile={onChooseFile}
          />
        ) : null}

        <ChatComposer
          value={input}
          placeholder={placeholder}
          animatedPlaceholder={animatedPlaceholder}
          editable={inputEditable}
          canSend={canSend}
          composerRef={composerRef}
          onChangeText={onChangeText}
          onSend={onSend}
          onPickImage={onPickImage}
          onTakePhoto={onTakePhoto}
          onChooseFile={onChooseFile}
          onCommandPress={onCommandPress}
          attachDisabled={!inputEditable}
          commandDisabled={isConnecting || isSending}
          thinkingLevel={thinkingLevel}
          thinkingLevelOptions={thinkingLevelOptions}
          onSelectThinkingLevel={onSelectThinkingLevel}
          modelLabel={modelLabel}
          onModelPress={onModelPress}
          onWebSearchPress={onWebSearchPress}
          onPromptPress={onPromptPress}
          isSending={isSending}
          onAbort={onAbort}
          bottomPadding={composerBottomPadding}
          bottomOffset={0}
          onFocus={onFocus}
          onBlur={onBlur}
          onVoiceInputPress={onVoiceInputPress}
          showVoiceInput={showVoiceInput}
          voiceInputActive={voiceInputActive}
          voiceInputDisabled={voiceInputDisabled}
          voiceInputLevel={voiceInputLevel}
        />
      </View>
    </GestureDetector>
  );
}
