import {
  formatMessageText,
  stableMessageId,
  extractAssistantDisplayText,
  extractAssistantTextForSilentCheck,
  extractText,
  extractImageUris,
  extractImageRawData,
  hasImageBlocks,
  extractIdempotencyKey,
  isAssistantDeliveryMirrorMessage,
  isAssistantSilentReplyMessage,
  isSilentReplyPrefixText,
  isSilentReplyText,
  parseMessageTimestamp,
  sanitizeDisplayText,
  sanitizeSilentPreviewText,
  sanitizeUserMessageText,
  stripGatewayPrefixes,
  sessionLabel,
  relativeTime,
} from './chat-message';

describe('stableMessageId', () => {
  it('generates a stable id from role, timestamp, and text hash', () => {
    const id = stableMessageId('user', 1000, 'hello world');
    expect(id).toMatch(/^h_user_1000_[0-9a-f]+$/);
  });

  it('produces the same id for the same input', () => {
    const a = stableMessageId('user', 1000, 'hello world');
    const b = stableMessageId('user', 1000, 'hello world');
    expect(a).toBe(b);
  });

  it('produces different ids for different text', () => {
    const a = stableMessageId('user', 1000, 'hello world');
    const b = stableMessageId('user', 1000, 'hello world!');
    expect(a).not.toBe(b);
  });

  it('distinguishes long texts that share the same prefix', () => {
    const prefix = 'a'.repeat(100);
    const a = stableMessageId('assistant', 0, prefix + ' suffix A');
    const b = stableMessageId('assistant', 0, prefix + ' suffix B');
    expect(a).not.toBe(b);
  });

  it('produces different ids for different roles or timestamps', () => {
    const a = stableMessageId('user', 1000, 'text');
    const b = stableMessageId('assistant', 1000, 'text');
    const c = stableMessageId('user', 2000, 'text');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('extractText', () => {
  it('returns string content directly', () => {
    expect(extractText('hello')).toBe('hello');
  });

  it('returns empty string for non-string/non-array', () => {
    expect(extractText(null)).toBe('');
    expect(extractText(undefined)).toBe('');
    expect(extractText(42)).toBe('');
  });

  it('extracts text from content blocks', () => {
    const blocks = [
      { type: 'text', text: 'hello ' },
      { type: 'text', text: 'world' },
    ];
    expect(extractText(blocks)).toBe('hello world');
  });

  it('includes thinking blocks', () => {
    const blocks = [
      { type: 'thinking', text: 'hmm ' },
      { type: 'text', text: 'answer' },
    ];
    expect(extractText(blocks)).toBe('hmm answer');
  });

  it('ignores non-text/thinking blocks', () => {
    const blocks = [
      { type: 'image', data: 'base64data' },
      { type: 'text', text: 'only this' },
    ];
    expect(extractText(blocks)).toBe('only this');
  });

  it('handles missing text property', () => {
    const blocks = [{ type: 'text' }];
    expect(extractText(blocks)).toBe('');
  });
});

describe('extractAssistantDisplayText', () => {
  it('ignores thinking blocks so restored assistant text matches live display', () => {
    const blocks = [
      { type: 'thinking', text: '\n\n' },
      { type: 'text', text: 'received' },
    ];
    expect(extractAssistantDisplayText(blocks)).toBe('received');
  });

  it('returns string content directly', () => {
    expect(extractAssistantDisplayText('hello')).toBe('hello');
  });
});

describe('silent reply helpers', () => {
  it('matches exact NO_REPLY with surrounding whitespace', () => {
    expect(isSilentReplyText('NO_REPLY')).toBe(true);
    expect(isSilentReplyText('  NO_REPLY  ')).toBe(true);
    expect(isSilentReplyText('NO_REPLY later')).toBe(false);
  });

  it('matches streamed NO_REPLY lead fragments without suppressing normal text', () => {
    expect(isSilentReplyPrefixText('NO')).toBe(true);
    expect(isSilentReplyPrefixText('NO_')).toBe(true);
    expect(isSilentReplyPrefixText('NO_RE')).toBe(true);
    expect(isSilentReplyPrefixText('NO_REPLY')).toBe(true);
    expect(isSilentReplyPrefixText('NO ')).toBe(true);
    expect(isSilentReplyPrefixText('NO\n')).toBe(true);
    expect(isSilentReplyPrefixText('No')).toBe(false);
    expect(isSilentReplyPrefixText('NO_REPLY more')).toBe(false);
  });

  it('uses assistant text field before content for silent checks', () => {
    expect(extractAssistantTextForSilentCheck({
      role: 'assistant',
      text: 'real reply',
      content: 'NO_REPLY',
    })).toBe('real reply');
  });

  it('filters assistant-only silent reply messages and keeps user messages', () => {
    expect(isAssistantSilentReplyMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'NO_REPLY' }],
    })).toBe(true);
    expect(isAssistantSilentReplyMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'NO_' }],
    })).toBe(true);
    expect(isAssistantSilentReplyMessage({
      role: 'assistant',
      text: 'real reply',
      content: 'NO_REPLY',
    })).toBe(false);
    expect(isAssistantSilentReplyMessage({
      role: 'user',
      content: [{ type: 'text', text: 'NO_REPLY' }],
    })).toBe(false);
  });

  it('sanitizes silent preview text for exact and prefix-only values', () => {
    expect(sanitizeSilentPreviewText('NO')).toBeUndefined();
    expect(sanitizeSilentPreviewText('NO_')).toBeUndefined();
    expect(sanitizeSilentPreviewText('NO_REPLY')).toBeUndefined();
    expect(sanitizeSilentPreviewText('  hello  ')).toBe('hello');
  });

  it('strips assistant final tags from previews before trimming', () => {
    expect(sanitizeSilentPreviewText('<final>\nhello\n</final>')).toBe('hello');
  });

  it('detects assistant delivery-mirror transcript messages without matching normal replies', () => {
    expect(isAssistantDeliveryMirrorMessage({
      role: 'assistant',
      provider: 'openclaw',
      model: 'delivery-mirror',
      content: [{ type: 'text', text: 'mirrored reply' }],
    })).toBe(true);
    expect(isAssistantDeliveryMirrorMessage({
      role: 'assistant',
      provider: 'openai',
      model: 'gpt-5',
      content: [{ type: 'text', text: 'real reply' }],
    })).toBe(false);
    expect(isAssistantDeliveryMirrorMessage({
      role: 'user',
      provider: 'openclaw',
      model: 'delivery-mirror',
    })).toBe(false);
  });
});

describe('sanitizeDisplayText', () => {
  it('strips leaked reasoning blocks and keeps the final body', () => {
    const input = '<think>\nUpdate completed successfully.\n</think> <final> 搞定啦！';
    expect(sanitizeDisplayText(input)).toBe('搞定啦！');
  });

  it('strips reasoning-tag variants used by Gemini-style output', () => {
    const input = '<reasoning>hidden</reasoning>\n<syncing>also hidden</syncing>\n<final>\nvisible\n</final>';
    expect(sanitizeDisplayText(input)).toBe('visible');
  });

  it('strips final envelope tags around assistant output', () => {
    expect(sanitizeDisplayText('<final>\nhello world\n</final>')).toBe('hello world');
  });

  it('keeps inline final tags so markdown/code content is not rewritten', () => {
    expect(sanitizeDisplayText('before <final>middle</final> after')).toBe('before <final>middle</final> after');
  });

  it('keeps code fences containing final tags intact', () => {
    expect(sanitizeDisplayText('```xml\n<final>\nhello\n</final>\n```')).toBe('```xml\n<final>\nhello\n</final>\n```');
  });

  it('strips an opening final tag during streaming before the closing tag arrives', () => {
    expect(sanitizeDisplayText('<final>\npartial reply')).toBe('partial reply');
  });

  it('suppresses a leaked reasoning block during streaming before the closing tag arrives', () => {
    expect(sanitizeDisplayText('<think>\npartial hidden')).toBe('');
  });

  it('strips bracketed system message blocks from display text', () => {
    const input = '好嘞\n\n[System: The content may include mention tags.]\n[System: If user_id is "abc", that mention refers to you.]';
    expect(sanitizeDisplayText(input)).toBe('好嘞');
  });

  it('keeps reasoning tags inside fenced code blocks intact', () => {
    const input = '```xml\n<think>demo</think>\n<final>answer</final>\n```';
    expect(sanitizeDisplayText(input)).toBe(input);
  });

  it('keeps literal reasoning tags in normal prose', () => {
    const input = 'Use <think>demo</think> tags in docs.';
    expect(sanitizeDisplayText(input)).toBe(input);
  });

  it('keeps literal final tags in normal prose', () => {
    const input = 'Literal <final> marker should stay visible.';
    expect(sanitizeDisplayText(input)).toBe(input);
  });

  it('does not unwrap a final tag when it is not the outer envelope', () => {
    const input = '<final>hello</final> and more';
    expect(sanitizeDisplayText(input)).toBe(input);
  });
});

describe('formatMessageText', () => {
  it('applies multiple formatting transforms through one shared pipeline', () => {
    const input = 'System: [2026-03-01 23:51:03 GMT+8] Model switched.\n\n<final>\nhello\n[System: hidden]\n</final>';
    expect(formatMessageText(input, {
      stripGatewayPrefixes: true,
      stripWrappedFinalTag: true,
      stripBracketedSystemMessageBlocks: true,
      trim: true,
    })).toBe('hello');
  });
});

describe('sanitizeUserMessageText', () => {
  it('strips gateway prefixes and bracketed system message blocks from user text', () => {
    const input = 'System: [2026-03-01 23:51:03 GMT+8] Model switched.\n\n[Sun 2026-03-01 23:52 GMT+8] 好嘞\n\n[System: hidden context]';
    expect(sanitizeUserMessageText(input)).toBe('好嘞');
  });
});

describe('extractImageUris', () => {
  it('returns undefined for non-array input', () => {
    expect(extractImageUris('string')).toBeUndefined();
    expect(extractImageUris(null)).toBeUndefined();
  });

  it('returns undefined when no image blocks', () => {
    expect(extractImageUris([{ type: 'text', text: 'hi' }])).toBeUndefined();
  });

  it('extracts data URI from image block with data field', () => {
    const blocks = [{ type: 'image', data: 'abc123', mimeType: 'image/png' }];
    const result = extractImageUris(blocks);
    expect(result).toEqual(['data:image/png;base64,abc123']);
  });

  it('extracts data URI from image block with source.data', () => {
    const blocks = [{ type: 'image', source: { data: 'xyz', media_type: 'image/webp' } }];
    const result = extractImageUris(blocks);
    expect(result).toEqual(['data:image/webp;base64,xyz']);
  });

  it('defaults mime type to image/jpeg', () => {
    const blocks = [{ type: 'image', data: 'abc' }];
    const result = extractImageUris(blocks);
    expect(result).toEqual(['data:image/jpeg;base64,abc']);
  });
});

describe('extractImageRawData', () => {
  it('returns undefined for non-array input', () => {
    expect(extractImageRawData('string')).toBeUndefined();
  });

  it('returns undefined when no image blocks', () => {
    expect(extractImageRawData([{ type: 'text' }])).toBeUndefined();
  });

  it('extracts raw data from image blocks', () => {
    const blocks = [{ type: 'image', data: 'abc', mimeType: 'image/png' }];
    const result = extractImageRawData(blocks);
    expect(result).toEqual([{ base64: 'abc', mimeType: 'image/png' }]);
  });
});

describe('hasImageBlocks', () => {
  it('returns false for non-array', () => {
    expect(hasImageBlocks('string')).toBe(false);
  });

  it('returns false when no image blocks', () => {
    expect(hasImageBlocks([{ type: 'text' }])).toBe(false);
  });

  it('returns true when image blocks exist', () => {
    expect(hasImageBlocks([{ type: 'image' }])).toBe(true);
  });
});

describe('extractIdempotencyKey', () => {
  it('returns undefined for non-object', () => {
    expect(extractIdempotencyKey(null)).toBeUndefined();
    expect(extractIdempotencyKey('string')).toBeUndefined();
  });

  it('returns the key when present', () => {
    expect(extractIdempotencyKey({ idempotencyKey: 'abc-123' })).toBe('abc-123');
  });

  it('returns undefined when key is not a string', () => {
    expect(extractIdempotencyKey({ idempotencyKey: 42 })).toBeUndefined();
  });
});

describe('parseMessageTimestamp', () => {
  it('returns 0 for non-object', () => {
    expect(parseMessageTimestamp(null)).toBe(0);
    expect(parseMessageTimestamp('string')).toBe(0);
  });

  it('returns numeric timestamp directly', () => {
    expect(parseMessageTimestamp({ timestamp: 1000 })).toBe(1000);
  });

  it('parses string timestamp', () => {
    const ts = '2024-01-15T10:00:00Z';
    const expected = Date.parse(ts);
    expect(parseMessageTimestamp({ timestamp: ts })).toBe(expected);
  });

  it('returns 0 for invalid string timestamp', () => {
    expect(parseMessageTimestamp({ timestamp: 'not-a-date' })).toBe(0);
  });

  it('returns 0 when no timestamp', () => {
    expect(parseMessageTimestamp({})).toBe(0);
  });

  it('returns 0 for non-finite number', () => {
    expect(parseMessageTimestamp({ timestamp: NaN })).toBe(0);
    expect(parseMessageTimestamp({ timestamp: Infinity })).toBe(0);
  });
});

describe('stripGatewayPrefixes', () => {
  it('returns plain text unchanged', () => {
    expect(stripGatewayPrefixes('hello world')).toBe('hello world');
  });

  it('strips a single system event line and timestamp envelope', () => {
    const input = 'System: [2026-03-01 23:51:03 GMT+8] Model switched to 0011/claude-opus-4-6.\n\n[Sun 2026-03-01 23:52 GMT+8] hello';
    expect(stripGatewayPrefixes(input)).toBe('hello');
  });

  it('strips multiple system event lines', () => {
    const input = 'System: [2026-03-01 23:50:00 GMT+8] Node connected.\nSystem: [2026-03-01 23:51:03 GMT+8] Model switched.\n\n[Sun 2026-03-01 23:52 GMT+8] hello';
    expect(stripGatewayPrefixes(input)).toBe('hello');
  });

  it('strips timestamp envelope without system events', () => {
    const input = '[Sun 2026-03-01 23:52 GMT+8] hello';
    expect(stripGatewayPrefixes(input)).toBe('hello');
  });

  it('strips system events without timestamp envelope', () => {
    const input = 'System: [2026-03-01 23:51:03 GMT+8] Model switched.\n\nhello';
    expect(stripGatewayPrefixes(input)).toBe('hello');
  });

  it('handles system event as entire text', () => {
    expect(stripGatewayPrefixes('System: [2026-03-01 23:51:03 GMT+8] Model switched.')).toBe('');
  });

  it('does not strip non-system lines', () => {
    expect(stripGatewayPrefixes('SystemError: something failed')).toBe('SystemError: something failed');
  });

  it('preserves text starting with bracket but not a timestamp', () => {
    expect(stripGatewayPrefixes('[not a timestamp] hello')).toBe('[not a timestamp] hello');
  });

  it('handles empty string', () => {
    expect(stripGatewayPrefixes('')).toBe('');
  });
});

describe('sessionLabel', () => {
  it('returns the localized main session label when agent name is unavailable', () => {
    expect(sessionLabel({ key: 'agent:abc:main' } as any)).toBe('Main session');
  });

  it('prefixes the main session with the current agent name when available', () => {
    expect(sessionLabel({ key: 'agent:abc:main' } as any, { currentAgentName: 'Lucy' })).toBe('Lucy (Main session)');
  });

  it('rewrites the synthetic legacy main session label with the current agent name', () => {
    expect(sessionLabel(
      { key: 'agent:abc:main', label: 'Main Session' } as any,
      { currentAgentName: 'Lucy' },
    )).toBe('Lucy (Main session)');
  });

  it('rewrites the synthetic current main session label with the current agent name', () => {
    expect(sessionLabel(
      { key: 'agent:abc:main', label: 'Main session' } as any,
      { currentAgentName: 'Lucy' },
    )).toBe('Lucy (Main session)');
  });

  it('prefers an explicit renamed main session title', () => {
    expect(sessionLabel({ key: 'agent:abc:main', label: 'Daily planning' } as any)).toBe('Daily planning');
  });

  it('formats channel sessions', () => {
    // cleanDetail strips "telegram" prefix but the "/" remains after regex
    const result = sessionLabel({ key: 'agent:abc:telegram', channel: 'telegram', label: 'telegram/mygroup' } as any);
    expect(result).toBe('Telegram /mygroup');
  });

  it('prefers an explicit renamed channel session title', () => {
    const result = sessionLabel({ key: 'agent:abc:telegram', channel: 'telegram', label: 'Ops War Room' } as any);
    expect(result).toBe('Ops War Room');
  });

  it('returns channel name only when no detail', () => {
    const result = sessionLabel({ key: 'agent:abc:discord', channel: 'discord' } as any);
    expect(result).toBe('Discord');
  });

  it('formats subagent sessions', () => {
    const result = sessionLabel({ key: 'agent:abc:subagent:def12345678' } as any);
    expect(result).toBe('Subagent: def12345');
  });

  it('formats subagent sessions with label', () => {
    const result = sessionLabel({ key: 'agent:abc:subagent:def', label: 'research task' } as any);
    expect(result).toBe('research task');
  });

  it('formats cron sessions', () => {
    const result = sessionLabel({ key: 'agent:abc:cron:daily', label: '[Cron] daily-task' } as any);
    expect(result).toBe('Cron: daily-task');
  });

  it('prefers an explicit renamed cron session title', () => {
    const result = sessionLabel({ key: 'agent:abc:cron:daily', label: 'Morning digest' } as any);
    expect(result).toBe('Morning digest');
  });

  it('falls back to label, derivedTitle, title, displayName', () => {
    expect(sessionLabel({ key: 'other', label: 'My Label' } as any)).toBe('My Label');
    expect(sessionLabel({ key: 'other', derivedTitle: 'Derived' } as any)).toBe('Derived');
    expect(sessionLabel({ key: 'other', title: 'Title' } as any)).toBe('Title');
    expect(sessionLabel({ key: 'other', displayName: 'Display' } as any)).toBe('Display');
  });

  it('falls back to key parts', () => {
    expect(sessionLabel({ key: 'prefix:suffix' } as any)).toBe('suffix');
    expect(sessionLabel({ key: 'single' } as any)).toBe('single');
  });
});

describe('relativeTime', () => {
  it('returns empty string for null/undefined/0', () => {
    expect(relativeTime(null)).toBe('');
    expect(relativeTime(undefined)).toBe('');
    expect(relativeTime(0)).toBe('');
  });

  it('returns "now" for future timestamps', () => {
    expect(relativeTime(Date.now() + 60_000)).toBe('now');
  });

  it('returns "now" for very recent', () => {
    expect(relativeTime(Date.now() - 10_000)).toBe('now');
  });

  it('returns minutes', () => {
    expect(relativeTime(Date.now() - 5 * 60_000)).toBe('5m');
  });

  it('returns hours', () => {
    expect(relativeTime(Date.now() - 3 * 3_600_000)).toBe('3h');
  });

  it('returns "Yesterday" for 1 day ago', () => {
    expect(relativeTime(Date.now() - 86_400_000)).toBe('Yesterday');
  });

  it('returns days', () => {
    expect(relativeTime(Date.now() - 3 * 86_400_000)).toBe('3d');
  });

  it('returns weeks', () => {
    expect(relativeTime(Date.now() - 14 * 86_400_000)).toBe('2w');
  });

  it('returns months', () => {
    expect(relativeTime(Date.now() - 60 * 86_400_000)).toBe('2mo');
  });
});
