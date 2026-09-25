# Message participants

Owner-approved 2026-09-25: channel `user` messages must not impersonate the person using Clawket. Model role and message authorship are separate. This supersedes the two-voice assumption for channel conversations, while preserving ordinary direct-chat presentation.

## Contract and rendering

`ChatMessage.attribution` is optional and serializable:

```ts
{
  channel: 'slack',
  accountId: 'workspace-account',
  conversationId: 'conversation',
  threadId: 'thread',
  messageId: 'source-message',
  sender: { id: 'person', name: 'Display name', username: 'handle',
            avatarUrl: 'https://cdn.example.com/avatar.png', kind: 'human' }
}
```

Only `channel` is required. A channel is not a backend or a connection transport. Participant identity is scoped to the connection plus channel/account/sender ID; names do not establish identity. No global directory or cross-connection profile cache is introduced.

External participants render incoming with a small avatar/name signature. Consecutive messages group only on an explicit matching sender ID within channel/account. Agent replies show their Agent signature in conversations containing participants. Local sends retain the outgoing bubble and existing delivery semantics. Attachments, favorites, entrance direction, accessibility and restored history follow the same classification.

Display fallback: name → username → platform ID → localized channel member. Missing/failed avatars retain an initial on a stable low-saturation color selected from the six existing accent scales by channel/account/sender identity (name changes do not recolor known IDs). Light/dark variants use accent100 backgrounds and accent700 initials. Participant names use primary ink; the channel stays secondary. In participant conversations, Agent signatures retain the existing unbordered Agent avatar and add an explicit localized Agent badge. This role distinction does not rely on color alone; bubble colors and direct-chat signature preferences remain unchanged (owner-approved refinement, 2026-09-25). Remote avatar references are bounded HTTPS URLs without embedded credentials, credential query parameters or local-address targets. This is display metadata, never proof of self or permission to execute anything. Body mentions never identify the author.

`sentLocally` is persisted local provenance. The Gateway mapper deliberately ignores this property on wire input. Local ownership survives an exact send-key echo or confirmed stored message identity. Text/time similarity must not merge a local send with a participant or two different/unknown participants. Explicit source message identity prevents equal text/timestamps from collapsing.

## Existing backends and producers

OpenClaw native `__openclaw.senderId`, `senderName`, `senderUsername`, `senderIdentity` and `transport` map to the contract. Legacy `senderLabel` is a display fallback. Explicit web/client transport overrides a channel-session fallback. Recognized channel/group/direct/issue session keys can supply the platform when sender data is absent; main, cron and subagents do not become participants by inference.

Adapters may supply the same optional `attribution` for Hermes, Telegram, Discord, Linear or custom channels. No new RPC, Relay storage, cloud directory, backend source mutation or channel login is required. Existing direct Hermes/OpenClaw histories keep their previous behavior. A foreign run refreshes its user input through the existing coalesced history loader; recovery events use the same metadata projection.

The owner's Slack history was verified to contain IDs/names for the screenshot's messages, but no avatar. Native profile avatar fields are consumed only when they are usable public URLs; a relative Gateway profile URL is not a Slack photo and is not fetched against the Relay origin. Automatic platform directory/photo lookup is not provided by the existing history contract. Upstream producers must supply a safe avatar URL for a real photo; missing photos are an expected first-class state.

The owner's custom Linear webhook currently writes trigger names into prompt prose rather than structured transcript metadata. Clawket shows the Linear source where recognizable and consumes structured attribution if supplied, but does not guess authors from arbitrary prompt instructions or unhide backend-hidden hook messages. Historical identities already discarded by a producer cannot be recovered by the App. Producers should persist the comment author separately from an assignment/event trigger and map the appropriate actor to `sender`.

## Validation

Use anonymized recorded Slack field shapes; cover same-text/same-time different authors, account isolation, absent/malformed fields, owner/mention spoofing, local echoes, avatar fallback, cached/favorited restoration, channel grouping and OpenClaw/Hermes history projection. Run `npm run check:required`. This is an App/protocol addition; no backend deployment is needed. Device visual acceptance remains with the owner.
