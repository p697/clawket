import {
  buildPromptAttachments,
  buildUiFileAttachments,
  buildInitialAgentIdentity,
  extractSlashCommand,
  resolveAttachmentOnlyFallbackKey,
  sanitizeVisibleStreamText,
  summarizeAttachmentFormats,
} from './chatControllerUtils';

describe('chatControllerUtils', () => {
  it.each(['openclaw', 'hermes'])('keeps a named pasted image image-typed for %s', () => {
    expect(buildPromptAttachments([{
      uri: 'file:///tmp/pasted.png',
      base64: 'cGl4ZWxz',
      mimeType: ' Image/PNG ',
      fileName: 'pasted.png',
    }])).toEqual([{
      type: 'image',
      mimeType: 'image/png',
      content: 'cGl4ZWxz',
    }]);
  });

  it('keeps an ordinary document file-typed and preserves its name', () => {
    expect(buildPromptAttachments([{
      uri: 'file:///tmp/spec.pdf',
      base64: 'cGRm',
      mimeType: 'application/pdf',
      fileName: ' spec.pdf ',
    }])).toEqual([{
      type: 'file',
      mimeType: 'application/pdf',
      content: 'cGRm',
      name: 'spec.pdf',
    }]);
  });

  it('summarizes attachment formats in sorted order', () => {
    expect(
      summarizeAttachmentFormats([
        { uri: 'a', base64: '1', mimeType: 'image/png' },
        { uri: 'b', base64: '2', mimeType: 'application/pdf' },
        { uri: 'c', base64: '3', mimeType: 'image/png' },
      ]),
    ).toBe('application/pdf,image/png');
  });

  it.each([
    [[{ uri: 'image', base64: 'a', mimeType: 'image/png' }], 'Look at this image'],
    [[
      { uri: 'one', base64: 'a', mimeType: 'image/png' },
      { uri: 'two', base64: 'b', mimeType: 'image/jpeg' },
    ], 'Look at these images'],
    [[{ uri: 'file', base64: 'a', mimeType: 'application/pdf' }], 'Review this file'],
    [[
      { uri: 'one', base64: 'a', mimeType: 'application/pdf' },
      { uri: 'two', base64: 'b', mimeType: 'text/plain' },
    ], 'Review these files'],
    [[
      { uri: 'image', base64: 'a', mimeType: ' Image/PNG ' },
      { uri: 'file', base64: 'b', mimeType: 'application/pdf' },
    ], 'Review these attachments'],
    [[], null],
  ] as const)('selects attachment-only fallback copy for %#', (attachments, expected) => {
    expect(resolveAttachmentOnlyFallbackKey(attachments)).toBe(expected);
  });

  it('builds payload-free UI metadata for non-image files only', () => {
    expect(buildUiFileAttachments([
      { uri: 'file:///photo.png', base64: 'image-bytes', mimeType: 'image/png' },
      {
        uri: ' file:///spec.pdf ',
        base64: 'pdf-bytes',
        mimeType: ' Application/PDF ',
        fileName: ' spec.pdf ',
      },
    ])).toEqual([{
      uri: 'file:///spec.pdf',
      mimeType: 'application/pdf',
      fileName: 'spec.pdf',
    }]);
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
