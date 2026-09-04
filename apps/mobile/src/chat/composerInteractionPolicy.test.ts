import { canSendMessage, isComposerActionLocked, isComposerInputEditable } from './composerInteractionPolicy';

describe('isComposerInputEditable', () => {
  it('keeps the input editable while streaming when voice input is inactive', () => {
    expect(isComposerInputEditable({
      editable: true,
      voiceInputActive: false,
    })).toBe(true);
  });

  it('disables the input while voice input is active', () => {
    expect(isComposerInputEditable({
      editable: true,
      voiceInputActive: true,
    })).toBe(false);
  });
});

describe('isComposerActionLocked', () => {
  const base = {
    connectionState: 'ready' as const,
    hasSession: true,
    isSending: false,
    refreshingConversation: false,
    refreshingSessions: false,
  };

  it('allows composer actions when the chat is ready and idle', () => {
    expect(isComposerActionLocked(base)).toBe(false);
  });

  it('locks composer actions while a response is streaming', () => {
    expect(isComposerActionLocked({
      ...base,
      isSending: true,
    })).toBe(true);
  });

  it('locks composer actions while the connection is unavailable', () => {
    expect(isComposerActionLocked({
      ...base,
      connectionState: 'reconnecting',
    })).toBe(true);
  });

  it('locks composer actions while conversation refresh is running', () => {
    expect(isComposerActionLocked({
      ...base,
      refreshingConversation: true,
    })).toBe(true);
  });

  it('locks composer actions while session refresh is running', () => {
    expect(isComposerActionLocked({
      ...base,
      refreshingSessions: true,
    })).toBe(true);
  });
});

describe('canSendMessage', () => {
  const base = {
    connectionState: 'ready' as const,
    hasSession: true,
    hasContent: true,
    isSending: false,
    refreshingConversation: false,
    refreshingSessions: false,
  };

  it('allows send when there is content and no lock condition', () => {
    expect(canSendMessage(base)).toBe(true);
  });

  it('blocks send when content is empty', () => {
    expect(canSendMessage({
      ...base,
      hasContent: false,
    })).toBe(false);
  });

  it('blocks send during refresh even if content exists', () => {
    expect(canSendMessage({
      ...base,
      refreshingConversation: true,
    })).toBe(false);
  });
});
