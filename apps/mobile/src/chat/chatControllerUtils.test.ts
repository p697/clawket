import {
  buildInitialAgentIdentity,
  extractSlashCommand,
  sanitizeVisibleStreamText,
  summarizeAttachmentFormats,
} from './chatControllerUtils';

describe('chatControllerUtils', () => {
  it('summarizes attachment formats in sorted order', () => {
    expect(
      summarizeAttachmentFormats([
        { uri: 'a', base64: '1', mimeType: 'image/png' },
        { uri: 'b', base64: '2', mimeType: 'application/pdf' },
        { uri: 'c', base64: '3', mimeType: 'image/png' },
      ]),
    ).toBe('application/pdf,image/png');
  });

  it('extracts slash commands case-insensitively', () => {
    expect(extractSlashCommand('  /Reasoning high')).toBe('reasoning');
    expect(extractSlashCommand('hello')).toBeNull();
  });

  it('suppresses silent reply placeholders in streamed text', () => {
    expect(sanitizeVisibleStreamText('NO_REPLY')).toBeNull();
    expect(sanitizeVisibleStreamText('NO')).toBeNull();
    expect(sanitizeVisibleStreamText('hello')).toBe('hello');
  });

  it('strips bracketed system message blocks from streamed text', () => {
    expect(sanitizeVisibleStreamText('hello\n\n[System: hidden context]')).toBe('hello');
  });

  it('builds initial agent identity from preview metadata', () => {
    expect(
      buildInitialAgentIdentity({
        agentName: ' Writer ',
        agentAvatarUri: ' https://example.com/avatar.png ',
        agentEmoji: ' ✍️ ',
      }),
    ).toEqual({
      displayName: 'Writer',
      avatarUri: 'https://example.com/avatar.png',
      emoji: '✍️',
    });
  });
});
