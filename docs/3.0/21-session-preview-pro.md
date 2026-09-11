# Non-main conversation preview — owner-approved September 11

This owner-approved change extends the earlier Pro matrix. The Session Panel remains browseable; this does not add creation controls or change connection/Agent quota gates.

- Main conversations retain their full history, sending, tools and approvals. Canonical descriptor kind is authoritative; the Agent's main key and legacy main aliases cover roster hydration.
- Free access to other conversations is read-only. Show the two latest user/assistant content messages; tool events do not consume preview slots. A message containing only an attachment also counts.
- Freeze the preview window for the current mounted conversation. Update its streaming text but never replace an already visible message with a lock when a new reply arrives. Session scope changes reset the window.
- Hidden history is represented by decorative, fading shapes and an explicit Pro action. Do not mount hidden text, tool payloads or attachment views underneath an overlay. Do not imply older history exists when all messages fit and pagination is exhausted.
- Pending approvals, connection recovery/errors, task identity and task status remain accessible. Task summary fallback is not an alternative path to gated transcript content.
- Preview footer explains read-only access and offers main-chat navigation and an explicit unlock action. Entering the session does not itself present a paywall. No background send, composer action or pagination is enabled by the preview.
- `sessionHistory` is the contextual paywall reason. Subscription purchase/restore unlocks the mounted thread without reconnecting, replacing its route or forcing a scroll to the newest message. Existing entitlement grace also permits complete session access; source data is never deleted.
- Search still discovers non-main message/favorite matches and session titles, but free results omit message excerpts. Message-detail access retains its existing Pro gate. All Thread entry paths share the projection.
- `session_preview_viewed` records backend and canonical session kind only. Existing paywall analytics identify the `sessionHistory` feature and `thread` trigger; no identifiers or message text are added.

Validation covers OpenClaw/Hermes policy, YouMind main identity, stable preview selection, approvals, empty/short history, cross-session isolation, streaming, send suppression, contextual paywall, purchase-state restoration, search excerpts and light/dark component rendering. Native device visual acceptance remains with the owner. RevenueCat sandbox purchase/restore and device scroll/keyboard behavior must not be claimed from mocked component tests.

Loading contract: render the current session's cached two-message preview before the network refresh completes. `ready` must be based on projected visible content, not raw hidden messages. With no renderable content, show the shared companion loader until history resolves; loading footer copy must not claim that latest messages are already displayed. Subscription lookup does not block the safe free preview; confirmed Pro unlocks the mounted thread in place. A completed tool-only history may render the history gate without body messages.
