import i18next from 'i18next';
import { SessionInfo } from '../types';

export const SILENT_REPLY_TOKEN = 'NO_REPLY';

/**
 * Fast non-cryptographic string hash (djb2 variant).
 * Produces a short hex digest suitable for dedup IDs.
 */
function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

export function stableMessageId(role: string, timestampMs: number, text: string): string {
  const textHash = djb2Hash(text);
  return `h_${role}_${timestampMs}_${textHash}`;
}

export function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: { type?: string }) => b.type === 'text' || b.type === 'thinking')
      .map((b: { text?: string }) => b.text ?? '')
      .join('');
  }
  return '';
}

/**
 * Extract assistant-visible text from history/final payloads.
 * Unlike extractText(), this intentionally ignores thinking blocks so
 * restored history matches the live chatFinal/WebView display contract.
 */
export function extractAssistantDisplayText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: { type?: string }) => b.type === 'text')
      .map((b: { text?: string }) => b.text ?? '')
      .join('');
  }
  return '';
}

export function isSilentReplyText(text: string | undefined, token: string = SILENT_REPLY_TOKEN): boolean {
  if (!text) return false;
  return new RegExp(`^\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`).test(text);
}

export function isSilentReplyPrefixText(text: string | undefined, token: string = SILENT_REPLY_TOKEN): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed !== trimmed.toUpperCase()) return false;

  const normalized = trimmed.toUpperCase();
  if (normalized.length < 2) return false;
  if (/[^A-Z_]/.test(normalized)) return false;

  const tokenUpper = token.toUpperCase();
  if (!tokenUpper.startsWith(normalized)) return false;
  if (normalized.includes('_')) return true;

  return tokenUpper === SILENT_REPLY_TOKEN && normalized === 'NO';
}

export function extractAssistantTextForSilentCheck(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const entry = message as Record<string, unknown>;
  if (entry.role !== 'assistant') return undefined;
  if (typeof entry.text === 'string') return entry.text;
  return extractAssistantDisplayText(entry.content);
}

export function isAssistantSilentReplyMessage(message: unknown): boolean {
  const text = extractAssistantTextForSilentCheck(message);
  return isSilentReplyText(text) || isSilentReplyPrefixText(text);
}

export function isAssistantDeliveryMirrorMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const entry = message as Record<string, unknown>;
  if (entry.role !== 'assistant') return false;
  return entry.provider === 'openclaw' && entry.model === 'delivery-mirror';
}

function stripWrappedFinalTag(text: string): string {
  let result = text;
  const hasOpeningWrapper = /^\s*<\s*final\b[^>]*>\s*(?:\r?\n)?/i.test(result);
  const hasClosingWrapperAtEnd = /(?:\r?\n)?\s*<\s*\/\s*final\s*>\s*$/i.test(result);
  const hasClosingWrapperAnywhere = /<\s*\/\s*final\s*>/i.test(result);

  // MiniMax may wrap the entire visible answer in a transport-only <final> envelope.
  // Strip only clear boundary wrappers so inline Markdown/code examples remain untouched.
  // If a closing tag exists but not at the end, treat it as normal content instead of guessing.
  if (hasOpeningWrapper && (hasClosingWrapperAtEnd || !hasClosingWrapperAnywhere)) {
    result = result.replace(/^\s*<\s*final\b[^>]*>\s*(?:\r?\n)?/i, '');
  }
  if (hasOpeningWrapper && hasClosingWrapperAtEnd) {
    result = result.replace(/(?:\r?\n)?\s*<\s*\/\s*final\s*>\s*$/i, '');
  }

  return result;
}

const REASONING_TAG_NAMES = ['think', 'thinking', 'thought', 'reasoning', 'syncing'] as const;
const LEADING_REASONING_BLOCK_RE = new RegExp(
  String.raw`^\s*<\s*(${REASONING_TAG_NAMES.join('|')})\b[^>]*>[\s\S]*?(?:<\s*\/\s*\1\s*>|$)\s*`,
  'i',
);
const PROTECTED_MARKDOWN_SEGMENT_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g;

function stripModelControlTags(text: string): string {
  if (!/[<](?:\/)?(?:think|thinking|thought|reasoning|syncing|final)\b/i.test(text)) {
    return text;
  }

  let result = '';
  let cursor = 0;
  for (const match of text.matchAll(PROTECTED_MARKDOWN_SEGMENT_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      result += stripModelControlTagsFromPlainText(text.slice(cursor, start));
    }
    result += match[0];
    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    result += stripModelControlTagsFromPlainText(text.slice(cursor));
  }

  return result;
}

function stripModelControlTagsFromPlainText(text: string): string {
  let result = text;

  while (LEADING_REASONING_BLOCK_RE.test(result)) {
    result = result.replace(LEADING_REASONING_BLOCK_RE, '');
  }

  result = stripWrappedFinalTag(result);

  return result
    .replace(/^[ \t]+(?=\S)/, '')
    .replace(/(\r?\n){3,}/g, '\n\n');
}

function stripBracketedSystemMessageBlocks(text: string): string {
  const stripped = text.replace(/(^|\r?\n)\[system:[\s\S]*?\](?=\r?\n|$)/gi, (_match, prefix: string) => prefix || '');
  return stripped
    .replace(/(\r?\n){3,}/g, '\n\n')
    .replace(/^(?:[ \t]*\r?\n)+/, '')
    .replace(/(?:\r?\n[ \t]*)+$/, '');
}

type FormatMessageTextOptions = {
  stripWrappedFinalTag?: boolean;
  stripGatewayPrefixes?: boolean;
  stripBracketedSystemMessageBlocks?: boolean;
  trim?: boolean;
};

export function formatMessageText(text: string, options: FormatMessageTextOptions = {}): string {
  let result = text;

  if (options.stripGatewayPrefixes) {
    result = stripGatewayPrefixes(result);
  }
  if (options.stripWrappedFinalTag) {
    result = stripModelControlTags(result);
  }
  if (options.stripBracketedSystemMessageBlocks) {
    result = stripBracketedSystemMessageBlocks(result);
  }
  if (options.trim) {
    result = result.trim();
  }

  return result;
}

export function sanitizeDisplayText(text: string): string {
  return formatMessageText(text, {
    stripWrappedFinalTag: true,
    stripBracketedSystemMessageBlocks: true,
  });
}

export function sanitizeUserMessageText(text: string): string {
  return formatMessageText(text, {
    stripGatewayPrefixes: true,
    stripBracketedSystemMessageBlocks: true,
  });
}

export function sanitizeSilentPreviewText(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const trimmed = sanitizeDisplayText(text).trim();
  if (!trimmed) return undefined;
  if (isSilentReplyText(trimmed) || isSilentReplyPrefixText(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function extractImageUris(content: unknown): string[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const uris: string[] = [];
  for (const block of content) {
    if (block.type !== 'image') continue;
    const data = block.data ?? block.source?.data;
    const mimeType = block.mimeType ?? block.source?.media_type ?? 'image/jpeg';
    if (data && typeof data === 'string') {
      uris.push(`data:${mimeType};base64,${data}`);
    }
  }
  return uris.length > 0 ? uris : undefined;
}

export function extractImageRawData(content: unknown): Array<{ base64: string; mimeType: string }> | undefined {
  if (!Array.isArray(content)) return undefined;
  const results: Array<{ base64: string; mimeType: string }> = [];
  for (const block of content) {
    if (block.type !== 'image') continue;
    const data = block.data ?? block.source?.data;
    const mimeType = block.mimeType ?? block.source?.media_type ?? 'image/jpeg';
    if (data && typeof data === 'string') {
      results.push({ base64: data, mimeType });
    }
  }
  return results.length > 0 ? results : undefined;
}

export function hasImageBlocks(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((b) => b.type === 'image');
}

export function extractIdempotencyKey(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const m = message as Record<string, unknown>;
  return typeof m.idempotencyKey === 'string' ? m.idempotencyKey : undefined;
}

/**
 * Strip gateway-injected prefixes from user message text for display.
 *
 * The OpenClaw gateway prepends two types of context to user messages
 * before sending them to the AI agent. These should not be shown in UI:
 *
 * 1. System event lines: "System: [timestamp] Model switched to xxx.\n"
 *    Added by `prependSystemEvents` when there are queued system events.
 *
 * 2. Timestamp envelope: "[Sun 2026-03-01 23:52 GMT+8] "
 *    Added by `injectTimestamp` for date/time awareness.
 *
 * After stripping, "System: [ts] Model switched.\n\n[Sun ts] hello" → "hello".
 */
export function stripGatewayPrefixes(text: string): string {
  let s = text;

  // Strip leading "System: [...]..." lines (one or more, separated by newlines).
  // Pattern: lines starting with "System: " are system event injections.
  while (s.startsWith('System: ')) {
    const newlineIdx = s.indexOf('\n');
    if (newlineIdx < 0) {
      // Entire text is a single system line — strip it all.
      return '';
    }
    s = s.slice(newlineIdx + 1);
  }

  // Strip blank lines between system event block and the actual message.
  s = s.replace(/^\n+/, '');

  // Strip timestamp envelope: "[DOW YYYY-MM-DD HH:MM ...] "
  // Matches the format produced by gateway's injectTimestamp:
  //   [Sun 2026-03-01 23:52 GMT+8] actual message
  const envelopeMatch = s.match(/^\[.{0,6}\d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\]]*\] /);
  if (envelopeMatch) {
    s = s.slice(envelopeMatch[0].length);
  }

  return s;
}

export function parseMessageTimestamp(message: unknown): number {
  if (!message || typeof message !== 'object') return 0;
  const m = message as Record<string, unknown>;
  const direct = m.timestamp;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  if (typeof direct === 'string') {
    const parsed = Date.parse(direct);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

/**
 * Strip channel/platform prefixes and noise from a detail string.
 * E.g. "telegram/group_name" → "group_name"
 *      "Discord Thread #general" → "general"
 *      "Slack thread #random" → "random"
 *      "飞书：some group" → "some group"
 *      "[Cron] daily-task" → "daily-task"
 */
function cleanDetail(raw: string): string {
  let s = raw;
  // Strip leading "[Cron] " or "[cron] " prefix
  s = s.replace(/^\[cron\]\s*/i, '');
  // Strip leading 'Cron: ' or 'Subagent: ' prefix
  s = s.replace(/^(?:cron|subagent):\s*/i, '');
  // Strip "Discord Thread " / "Slack thread " (case-insensitive)
  s = s.replace(/^(?:discord|slack|telegram|feishu|whatsapp|signal|imessage|webchat|googlechat)\s*(?:thread)?\s*/i, '');
  // Strip channel prefix patterns: "telegram/", "discord:", "飞书：", "飞书:", etc.
  s = s.replace(/^(?:telegram|discord|slack|feishu|whatsapp|signal|imessage|webchat|googlechat|飞书)[:/：/]\s*/i, '');
  // Strip leading # if it's followed by content
  s = s.replace(/^#\s*/, '');
  return s.trim();
}

const LEGACY_MAIN_SESSION_LABEL = 'Main Session';
const MAIN_SESSION_LABEL_KEY = 'Main session';

function localizedMainSessionLabel(): string {
  return i18next.t(MAIN_SESSION_LABEL_KEY, { ns: 'chat', defaultValue: MAIN_SESSION_LABEL_KEY }) || MAIN_SESSION_LABEL_KEY;
}

function isSyntheticMainSessionLabel(label: string): boolean {
  return label === LEGACY_MAIN_SESSION_LABEL || label === MAIN_SESSION_LABEL_KEY;
}

export function formatMainSessionLabel(agentName?: string | null): string {
  const mainSessionLabel = localizedMainSessionLabel();
  const trimmedAgentName = agentName?.trim();
  return trimmedAgentName ? `${trimmedAgentName} (${mainSessionLabel})` : mainSessionLabel;
}

export function sessionLabel(s: SessionInfo, options?: { currentAgentName?: string | null }): string {
  const explicitLabel = s.label?.trim();
  const isMainSession = /^agent:[^:]+:main$/.test(s.key);

  if (explicitLabel) {
    if (isMainSession && isSyntheticMainSessionLabel(explicitLabel)) {
      return formatMainSessionLabel(options?.currentAgentName);
    }

    if (s.channel) {
      const cleaned = cleanDetail(explicitLabel);
      const looksGenerated = cleaned.length > 0 && cleaned !== explicitLabel;
      if (!looksGenerated) return explicitLabel;
      const channelName = s.channel.charAt(0).toUpperCase() + s.channel.slice(1);
      return cleaned ? `${channelName} ${cleaned}` : channelName;
    }

    if (s.key.includes(':cron:')) {
      if (explicitLabel.startsWith('[Cron]')) {
        const cleaned = cleanDetail(explicitLabel);
        return cleaned ? `Cron: ${cleaned}` : 'Cron';
      }
      return explicitLabel;
    }

    return explicitLabel;
  }

  if (isMainSession) return formatMainSessionLabel(options?.currentAgentName);

  // Format channel-based sessions: "Telegram subject", "Discord subject", etc.
  if (s.channel) {
    const channelName = s.channel.charAt(0).toUpperCase() + s.channel.slice(1);
    const raw = s.derivedTitle || s.displayName || '';
    const detail = cleanDetail(raw);
    return detail ? `${channelName} ${detail}` : channelName;
  }

  // Format subagent sessions: "Subagent: label"
  if (s.key.includes(':subagent:')) {
    const raw = s.derivedTitle || s.displayName || '';
    const detail = cleanDetail(raw);
    if (detail) return `Subagent: ${detail}`;
    const id = s.key.split(':subagent:')[1] ?? '';
    return `Subagent: ${id.slice(0, 8)}`;
  }

  // Format cron sessions
  if (s.key.includes(':cron:')) {
    const raw = s.derivedTitle || s.displayName || '';
    const detail = cleanDetail(raw);
    if (detail) return `Cron: ${detail}`;
  }

  if (s.derivedTitle) return s.derivedTitle;
  if (s.title) return s.title;
  if (s.displayName) return s.displayName;
  const parts = s.key.split(':');
  return parts.length > 1 ? parts.slice(1).join(':') : s.key;
}

/** Format a timestamp as relative time (e.g. "3m ago", "2h ago", "Yesterday"). */
export function relativeTime(timestampMs: number | null | undefined): string {
  if (!timestampMs) return '';
  const diff = Date.now() - timestampMs;
  if (diff < 0) return 'now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}
