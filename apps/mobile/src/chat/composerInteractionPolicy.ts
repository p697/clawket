import { ConnectionState } from '../types';

type ComposerInteractionParams = {
  connectionState: ConnectionState;
  hasSession: boolean;
  isSending: boolean;
  refreshingConversation: boolean;
  refreshingSessions: boolean;
};

type ComposerSendParams = ComposerInteractionParams & {
  hasContent: boolean;
};

type ComposerInputParams = {
  editable: boolean;
  voiceInputActive: boolean;
};

export function isComposerInputEditable({
  editable,
  voiceInputActive,
}: ComposerInputParams): boolean {
  return editable && !voiceInputActive;
}

export function isComposerActionLocked({
  connectionState,
  hasSession,
  isSending,
  refreshingConversation,
  refreshingSessions,
}: ComposerInteractionParams): boolean {
  return (
    connectionState !== 'ready'
    || !hasSession
    || isSending
    || refreshingConversation
    || refreshingSessions
  );
}

export function canSendMessage({
  hasContent,
  ...rest
}: ComposerSendParams): boolean {
  return hasContent && !isComposerActionLocked(rest);
}
