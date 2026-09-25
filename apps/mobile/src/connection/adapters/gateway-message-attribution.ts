import type { MessageAttribution } from '@clawket/agent-protocol';
import { attributionText, normalizeMessageAttribution, sessionChannelAttribution } from '../../chat/messageAttribution';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export { sessionChannelAttribution } from '../../chat/messageAttribution';

/** Native metadata wins; mentions and free-form body text never identify the author. */
export function readGatewayMessageAttribution(key: string, value: Record<string, unknown>): MessageAttribution | undefined {
  if (value.role !== 'user') return undefined;
  const explicit = normalizeMessageAttribution(value.attribution);
  if (explicit) return explicit;
  const meta = record(value.__openclaw);
  const identity = record(meta.senderIdentity);
  const transport = record(meta.transport);
  const channel = attributionText(transport.channel, 64) ?? attributionText(identity.pluginId, 64);
  const fallback = sessionChannelAttribution(key);
  const nativeSender = {
    id: meta.senderId, name: attributionText(meta.senderName) ?? attributionText(value.senderLabel),
    username: meta.senderUsername,
    avatarUrl: meta.senderAvatarUrl ?? meta.senderProfileAvatarUrl,
    kind: identity.senderKind,
  };
  // A web/client send inside a Slack session is not a Slack participant.
  if (channel && ['webchat', 'cli', 'gateway', 'internal'].includes(channel.toLowerCase())) {
    if (!meta.senderId && !meta.senderName && !value.senderLabel) return undefined;
    return normalizeMessageAttribution({ channel: 'webchat', sender: nativeSender });
  }
  if (!channel && !fallback && !nativeSender.id && !nativeSender.name && !nativeSender.username) return undefined;
  return normalizeMessageAttribution({
    ...fallback, channel: channel ?? fallback?.channel ?? 'webchat',
    accountId: identity.accountId ?? transport.accountId,
    conversationId: transport.conversationRef ?? fallback?.conversationId,
    threadId: transport.threadId ?? fallback?.threadId,
    messageId: transport.messageId,
    sender: nativeSender,
  });
}
