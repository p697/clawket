import type { MessageAttribution } from '@clawket/agent-protocol';

type AttributedMessage = {
  role: string;
  attribution?: MessageAttribution;
  sentLocally?: true;
};

const CHANNEL_NAMES: Readonly<Record<string, string>> = {
  slack: 'Slack', telegram: 'Telegram', discord: 'Discord', linear: 'Linear',
  whatsapp: 'WhatsApp', signal: 'Signal', imessage: 'iMessage',
  googlechat: 'Google Chat', msteams: 'Microsoft Teams', feishu: 'Feishu',
  webchat: 'Web Chat', matrix: 'Matrix', mattermost: 'Mattermost',
};

export function messageChannelName(channel: string): string {
  return CHANNEL_NAMES[channel] ?? channel;
}

export function messageSenderLabel(attribution: MessageAttribution): string {
  const sender = attribution.sender;
  return sender?.name || sender?.username || sender?.id || messageChannelName(attribution.channel);
}

/** Legacy unattributed direct chats retain their presentation. Ownership is local evidence only. */
export function isIncomingParticipant(message: AttributedMessage): boolean {
  return message.role === 'user' && !!message.attribution && !message.sentLocally;
}

/** Connection scope is supplied by the caller; never share a directory across connections. */
export function messageParticipantKey(attribution: MessageAttribution): string {
  return JSON.stringify([attribution.channel, attribution.accountId ?? '',
    attribution.sender?.id ?? null, attribution.sender?.id ? null : messageSenderLabel(attribution)]);
}

/** Text/time similarity must never merge two people or turn an inbound post into our own send. */
export function canMatchMessageAuthors(a: AttributedMessage, b: AttributedMessage): boolean {
  if (a.role !== 'user' || b.role !== 'user') return true;
  if ((a.sentLocally && isIncomingParticipant(b)) || (b.sentLocally && isIncomingParticipant(a))) return false;
  if (!a.attribution || !b.attribution) return !a.attribution && !b.attribution;
  return !!a.attribution.sender?.id && !!b.attribution.sender?.id
    && messageParticipantKey(a.attribution) === messageParticipantKey(b.attribution);
}

/** Only validated, credential-free public image URLs may leave the adapter. */
export function publicAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash
      || Array.from(url.searchParams.keys()).some(key => /token|secret|key|signature|credential|auth/i.test(key))
      || /^(?:localhost|127\.|0\.|\[|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(url.hostname)
      || url.hostname.endsWith('.local')) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function attributionText(value: unknown, max = 200): string | undefined {
  if (typeof value !== 'string' || value.length > max) return undefined;
  return value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim() || undefined;
}


function attributionIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && value.trim() === value && !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(value)
    ? value : undefined;
}

export function normalizeMessageAttribution(value: unknown): MessageAttribution | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const channel = attributionText(raw.channel, 64);
  if (!channel || !/^[a-z][a-z0-9_-]*$/i.test(channel)) return undefined;
  const sender = raw.sender && typeof raw.sender === 'object' && !Array.isArray(raw.sender)
    ? raw.sender as Record<string, unknown> : {};
  const normalizedSender = {
    id: attributionIdentifier(sender.id), name: attributionText(sender.name),
    username: attributionText(sender.username), avatarUrl: publicAvatarUrl(sender.avatarUrl),
    kind: sender.kind === 'human' || sender.kind === 'bot' || sender.kind === 'unknown' ? sender.kind : undefined,
  } satisfies NonNullable<MessageAttribution['sender']>;
  return {
    channel: channel.toLowerCase(), accountId: attributionIdentifier(raw.accountId),
    conversationId: attributionIdentifier(raw.conversationId), threadId: attributionIdentifier(raw.threadId),
    messageId: attributionIdentifier(raw.messageId),
    ...(Object.values(normalizedSender).some(Boolean) ? { sender: normalizedSender } : {}),
  };
}


/** Source-only fallback for older channel transcripts and device caches. */
export function sessionChannelAttribution(key: string): MessageAttribution | undefined {
  const linearSession = /^(?:agent:[^:]+:)?linear:([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.exec(key);
  if (linearSession) return normalizeMessageAttribution({ channel: 'linear', conversationId: linearSession[1] });
  const match = /^(?:agent:[^:]+:)?([a-z][a-z0-9_-]*):(channel|group|direct|dm|issue|comment):(.+)$/i.exec(key);
  if (!match || ['cron', 'subagent', 'hook'].includes(match[1].toLowerCase())) return undefined;
  const [conversationId, threadId] = match[3].split(':thread:');
  return normalizeMessageAttribution({ channel: match[1], conversationId, threadId });
}

/** Upgrade an old cache without claiming any unknown channel participant is the viewer. */
export function restoreCachedAttribution<T extends AttributedMessage & { id: string }>(message: T, sessionKey: string): T {
  if (message.role !== 'user' || message.attribution || message.sentLocally) return message;
  if (/^usr_\d/.test(message.id)) return { ...message, sentLocally: true };
  const attribution = sessionChannelAttribution(sessionKey);
  return attribution ? { ...message, attribution } : message;
}
