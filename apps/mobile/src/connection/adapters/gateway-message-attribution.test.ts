import { mapGatewayHistoryMessage, mergeGatewayHistory } from './gateway-history';
import { mapAdapterChatMessage } from '../../chat/useAdapterChatEvents';
import { readGatewayMessageAttribution, sessionChannelAttribution } from './gateway-message-attribution';
import { canMatchMessageAuthors, isIncomingParticipant, publicAvatarUrl } from '../../chat/messageAttribution';
import { resolveUserMessageStatus } from '../../chat/messageDelivery';
import { preserveMessagePresentation, preserveOptimisticAssistantMessage } from '../../chat/historyMergePolicy';

// Shape recorded from the owner's Slack history on 2026-09-25; identifiers/text anonymized.
const key = 'agent:main:slack:channel:channel-a:thread:thread-a';
const packet = (id: string, name: string) => ({
  role: 'user', content: 'Same message', timestamp: 100_000,
  __openclaw: { id: `message-${id}`, senderIsOwner: true, senderId: id, senderName: name,
    senderIdentity: { type: 'observation', id, pluginId: 'slack', accountId: 'default', senderKind: 'unknown' },
    transport: { channel: 'slack', conversationRef: 'conversation-a', messageId: `source-${id}`, threadId: 'thread-a' } },
});

it('carries recorded Slack identity through history and live reconciliation, never using owner as self', () => {
  const mapped = mapGatewayHistoryMessage(key, packet('person-a', 'Alice'), 0)!;
  expect(mapped.attribution).toMatchObject({ channel: 'slack', accountId: 'default',
    sender: { id: 'person-a', name: 'Alice' }, threadId: 'thread-a' });
  const ui = mapAdapterChatMessage(mapped)!;
  expect(ui.attribution).toEqual(mapped.attribution);
  expect(isIncomingParticipant(ui)).toBe(true);
  expect(resolveUserMessageStatus({ messages: [ui], index: 0 })).toBeNull();
});

it.each(['telegram', 'discord', 'linear', 'custom-chat'])('accepts additive %s attribution without backend-specific rendering', channel => {
  const mapped = mapGatewayHistoryMessage('native-session', { role: 'user', content: 'Hello',
    sentLocally: true, attribution: { channel, accountId: 'account', sender: { id: '42', name: 'Name', avatarUrl: 'https://cdn.example.com/avatar.png' } } }, 0)!;
  expect(mapped.attribution?.sender?.avatarUrl).toBe('https://cdn.example.com/avatar.png');
  expect(mapped.sentLocally).toBeUndefined();
  expect(isIncomingParticipant(mapped)).toBe(true);
});

it('preserves legacy direct OpenClaw/Hermes presentation and never identifies mentions as authors', () => {
  for (const session of ['main', 'agent:main:main', 'agent:main:cron:job', 'agent:main:subagent:child']) {
    expect(readGatewayMessageAttribution(session, { role: 'user', content: '<@U123> (Mindy) hi' })).toBeUndefined();
  }
  expect(readGatewayMessageAttribution(key, { role: 'user', content: '<@U123> (Mindy) hi' }))
    .toMatchObject({ channel: 'slack', conversationId: 'channel-a' });
  expect(readGatewayMessageAttribution(key, { role: 'user', content: 'hi' })?.sender).toBeUndefined();
  expect(sessionChannelAttribution('agent:main:linear:issue:issue-a')?.channel).toBe('linear');
  expect(readGatewayMessageAttribution(key, { role: 'assistant', content: 'Hi' })).toBeUndefined();
});

it('separates client messages inside a channel and bounds untrusted display fields', () => {
  expect(readGatewayMessageAttribution(key, { role: 'user', __openclaw: { transport: { channel: 'webchat' }, senderName: 'Desktop' } }))
    .toMatchObject({ channel: 'webchat', sender: { name: 'Desktop' } });
  expect(readGatewayMessageAttribution(key, { ...packet('id', 'x'.repeat(201)), senderLabel: 'fallback' })?.sender?.name).toBe('fallback');
  expect(readGatewayMessageAttribution(key, { role: 'user', senderLabel: 'Legacy name' })?.sender?.name).toBe('Legacy name');
});

it('never merges two people with identical text/time or acknowledges our send from another participant', () => {
  const first = mapGatewayHistoryMessage(key, packet('a', 'Alice'), 0)!;
  const second = mapGatewayHistoryMessage(key, packet('b', 'Bob'), 1)!;
  expect(canMatchMessageAuthors(first, second)).toBe(false);
  expect(mergeGatewayHistory([second], [{ ...first, id: 'h_user_cached' }])).toHaveLength(2);
  const local = { id: 'usr_100000', renderKey: 'usr_100000', role: 'user' as const,
    text: 'Same message', timestampMs: 100_000, sentLocally: true as const, idempotencyKey: 'send-1' };
  const incoming = mapAdapterChatMessage(first)!;
  expect(preserveOptimisticAssistantMessage([local], [incoming])).toEqual(expect.arrayContaining([local, incoming]));
  const echoed = { ...local, id: 'canonical', renderKey: undefined, sentLocally: undefined };
  expect(preserveMessagePresentation([local], [echoed])[0].sentLocally).toBe(true);
  expect(mergeGatewayHistory([echoed], [local])[0].sentLocally).toBe(true);
  expect(canMatchMessageAuthors(first, { ...first, attribution: { ...first.attribution!, accountId: 'other' } })).toBe(false);
});

it.each(['http://example.com/a', 'https://user:pass@example.com/a', 'https://example.com/a?token=secret',
  'https://127.0.0.1/a', 'https://10.0.0.1/a', 'file:///tmp/avatar', 'data:image/png;base64,abc'])('rejects unsafe avatar reference %s', url => {
  expect(publicAvatarUrl(url)).toBeUndefined();
});


it('restores old channel caches without claiming unknown participants are self', () => {
  const { restoreCachedAttribution, normalizeMessageAttribution } = require('../../chat/messageAttribution');
  const unknown = restoreCachedAttribution({ id: 'history-a', role: 'user' }, key);
  expect(isIncomingParticipant(unknown)).toBe(true);
  expect(unknown.attribution.sender).toBeUndefined();
  expect(restoreCachedAttribution({ id: 'usr_123', role: 'user' }, key).sentLocally).toBe(true);
  expect(normalizeMessageAttribution({ channel: 'slack', sender: { id: 'U\u0000A' } }).sender).toBeUndefined();
  expect(sessionChannelAttribution('agent:main:linear:12345678-1234-1234-1234-123456789012')?.channel).toBe('linear');
  expect(publicAvatarUrl('https://cdn.example.com/avatar?%74oken=secret')).toBeUndefined();
});

it('keeps cached local ownership when a canonical echo already has the same renderer identity', () => {
  const { preserveHydratedMessageKeys } = require('../../chat/historyMergePolicy');
  const old = { id: 'same', role: 'user', text: 'Hi', sentLocally: true };
  const remote = { id: 'same', role: 'user', text: 'Hi', attribution: { channel: 'slack' } };
  expect(preserveHydratedMessageKeys([old], [remote])[0].sentLocally).toBe(true);
  expect(preserveHydratedMessageKeys([old], [{ ...remote, renderKey: 'same' }])[0].sentLocally).toBe(true);
});
