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

type ComposerQueueParams = {
  connectionState: ConnectionState;
  hasSession: boolean;
  hasContent: boolean;
  isSending: boolean;
  /** False while a send preflight or dictation owns the composer. */
  composerAvailable: boolean;
  queueHasCapacity: boolean;
};

/**
 * A message composed while the Agent is still replying joins the local queue
 * instead of being blocked. Queueing is local, so it does not wait on history
 * refreshes, but it still needs a ready connection and a real session.
 */
export function canQueueMessage({
  connectionState,
  hasSession,
  hasContent,
  isSending,
  composerAvailable,
  queueHasCapacity,
}: ComposerQueueParams): boolean {
  return (
    hasContent
    && isSending
    && composerAvailable
    && queueHasCapacity
    && connectionState === 'ready'
    && hasSession
  );
}
