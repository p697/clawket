# Native iOS preservation checklist

Baseline: current `apps/mobile`, `packages/agent-protocol` and their tests on 2026-10-15. The six backends are OpenClaw, Hermes, Codex, Claude Code, Pi and local-model. Every row starts **pending**; only linked implementation and recorded verification may change it. Build-only, source-test, simulated traffic, real Relay and actual inference evidence are distinct.

## Capability boundary

Use `packages/agent-protocol/src/capabilities.ts` plus runtime adapter negotiation. Missing optional refinements fail closed. Backend identity never follows transport or environment. Preserve sessions-first Agents with empty `mainSessionKey`, per-session model scope for native backends, Hermes global model selection and local-model's independent resources. Do not expose unsupported Hermes management by copying OpenClaw menus.

## Checklist

| Area | Existing behavior to preserve | Source / test oracle | Native status |
|---|---|---|---|
| Pairing entry | Six-product chooser, code, camera/imported QR, invitation link, direct connection, local-model engines | `connection/pairing/`; `services/pairing-session.test.ts` | Pending |
| Secure pairing | Six-digit NaCl Box + HMAC; twelve-character/link SecretBox; exact proof/key formats; single use | `services/pairing-session.ts`; Registry/Bridge fixtures | Pending |
| Service isolation | Backend checks before/after claim; official aliases/environment, custom URLs, Hermes-specific routes | `backend-pairing-profile.test.ts`; `relay-environment` | Pending |
| Re-pairing | Stable connection identity and local label; rollback-safe save | `save-paired-connection.test.ts`; `registry/connection-store.test.ts` | Pending |
| Device authentication | Ed25519 v3 payload, NaCl64-byte secret import, scoped operator/Node tokens; bounded stale-token repair | `services/gateway-auth.test.ts`; `protocol/gateway-client.*.test.ts` | Pending |
| Transport | Native WebSocket, exact UTF-8 8MiB limit, bounded pending RPCs, fresh request identities | `transports/`; `services/websocket-frame-limit` | Pending |
| Readiness | Open/Relay echo/OS path are not backend ready; validate backend identity and Hermes degraded health | `hermes-health-recovery.test.ts`; `gateway-profiles.ts` | Pending |
| Reconnect | One active connection, generation fencing, proven-health backoff reset, pause/auth rejection, foreground joining | `connection/index.ts`; recovery/network tests | Pending |
| Liveness | Negotiated legacy pong, client nonce probes and absolute transfer budgets; advertise only implemented behavior | `relay-ws.client-ping.test.ts`; `relay-ws.transfer.test.ts` | Pending |
| Catalog | Complete paginated sessions, opaque cursors, live activity, project filters, native archive, last valid conversation | `adapters/session-catalog*.test.ts`; SessionPanel | Pending |
| Roster | Pins/home sessions, latest human activity order, unread watermarks, independent attention, truthful stale cache | `registry/roster-cache`; `unread-watermarks`; Roster; `ROSTER.md` | Active/paused-cache local pins/home/read-watermarks and human-activity ordering implemented; full multi-connection entitlement, upgrade and device acceptance pending |
| Conversation | Text/Markdown/code, snapshot vs delta semantics, paragraph/tool boundaries, stable render IDs, participant identity | `chat/`; `gateway-adapters.recorded.test.ts`; `25-message-participants.md` | Pending |
| History | Serialized head/older reads; reset/compaction markers; partial pages and scope fences | `cursorHistoryWindow`; `historyLineage`; `historyMergePolicy` | Pending |
| Sending | Immediate local echo, durable scoped drafts, serial queue, Current/Next guidance, exact receipts, no uncertain replay | `useChatController.queue/contract`; `sendRecovery`; `messageDelivery` | Pending |
| Stop | Explicit abort; ACK does not invent idle/completion; recovery retains active work | adapter abort and controller tests | Pending |
| Work records | Work dock, newest-first steps, exact turn/input lineage, clocks, completed receipt, failure details | `turn-work`; `turnIdentity`; `WorkTimeline`; Thread tests | Pending |
| Questions | Radio/checkbox/custom/editor forms; dismissal is inert; bounded seven-day/32-request persisted drafts | `AgentQuestions`; `Thread/question-drafts` | Pending |
| Consent | Execution consent separate from questions, advertised choices/expiry, native permission confirmation | approvals; `gateway-runtime-settings`; adapter tests | Pending |
| Native continuation | Ownership-aware continue/copy/branch, blocked reasons, no native takeover | Codex/Claude/Pi adapter and SessionPanel tests | Pending |
| Model controls | Catalog order, recent/current choices, session/global scope, thinking, fast mode, confirmed permissions, stale-read fences | ModelSheet; `gateway-models`; runtime-settings tests | Pending |
| Composer craft | Multiline and expanded same editor, IME/selection/undo, attachments-only send, skill prefix, hardware keyboard | `16-composer`; `22-chat-navigation`; composer tests | Pending |
| Input media | Photos/camera/files/paste, six attachments, 5MiB image flow, known text-only guard, held failed drafts | `preparePendingImagesForSend`; pasted-attachment/image-picker tests | Pending |
| Output artifacts | Negotiated stable references, image-only finals, download/retry/share, image zoom/copy pixels/add-only save | `artifact-adapters`; `gateway-attachments`; `backend-attachments.md` | Pending |
| Agent identity | Rename/create/edit/delete where supported; product faces/custom avatars; local device label preserved | AgentProfile; connection-name; descriptors | Pending |
| Models management | Providers/default/fallback/allowlist/cost overrides and model health where negotiated | Models; model-manage tests | Pending |
| Skills | Installed/discover/details/SKILL.md/install/use; native project/session context | Skills; skill-invocation tests | Pending |
| Scheduling | Cron create/edit/delete/enable/run/history, timezone/model/advanced refinements, heartbeat | Cron; management contract tests | Pending |
| Files | Read/edit/history with correct Pro gate; session files and native document handles | Files/Document; `session-files`; profile tests | Pending |
| Usage | Usage/cost/posters; native quota/defaults/limiting reset window | Usage; Codex profile tests | Pending |
| OpenClaw management | Hash-confirmed config, permissions/repair, diagnostics, backups/restore, tools, channels/routing, devices/nodes, logs | settings-sections; `management.ts`; related tests | Pending |
| Codex profile | Negotiated profile version, project skills/instructions, unknown quota, MCP/plugins read-only | `codex-profile.md`; native-profile consumer tests | Pending |
| Local search | Cross-connection cached messages/Agents/sessions/favorites, correct access gate | Search; chat cache; favorites tests | Pending |
| Saved history | Immutable saved conversations/export separate from evictable cache; document versions | saved-conversation/version/history services | Pending |
| Connection settings | Activate/pause/resume/reconnect/remove/rename/free-slot; version/caps; negotiated remote Bridge update | Connection screens; `bridge-update` tests | Pending |
| Appearance | Theme/accent/chat/wallpaper/fonts/avatar preference/icons, language; existing choices retained | appearance services; theme; icons; `SETTINGS-NAVIGATION.md` | Free native theme/accent/type/Agent signature implemented; wallpaper/bubbles/icons/language/upgrade/device acceptance pending |
| Voice | Native16k PCM, signed speech WSS, ACK flow control, durable110s segments/10min recording recovery, no automatic send | `services/speech`; `clawket-voice-capture` Swift | Pending |
| Audio ownership | Record only on intent; no idle audio session or stopped music; cancellation/background retain recovery audio | `voiceCapture.test.ts`; `useChatVoiceInput.test.ts` | Pending |
| Phone Node | Distinct role handshake; per-command info/status/notify/camera/photos/location/clipboard/media, foreground permissions | `node-client`; handlers/dispatcher/capability tests | Pending |
| Incoming share | Native extension/app-group handoff, review draft and selected destination, staged files | share extension; `features/sharing`; incoming-share tests | Pending |
| Widgets and links | Existing shortcuts, app-group state, universal/custom links, QR flow | `native-widgets/ios`; app config; navigation tests | Pending |
| Pro | RevenueCat identity, purchase/restore/manage/redeem, dynamic prices/offering, free slot/grace, success continuation | ProPaywall; entitlement/pro/storage tests | Pending |
| Review and help | Eligible system review, store/manual link, releases/help/community/legal, debug/Preview controls | ios-app-review; releases; AccountSettings | Pending |
| Localization | All19locales, Arabic RTL, dynamic formatting, localized accessibility | `src/i18n/locales`; strict i18n gate | Pending |
| Adaptive/accessibility | iPad windows, Dynamic Type, VoiceOver/focus, contrast/reduced motion/transparency, gestures/hit regions | native acceptance matrix in PLAN | Pending |
| Diagnostics/privacy | Allowlisted bounded metadata,20-event local history, no payload/credential/path/device labels | `connection-diagnostics.test.ts`; `20-connection-diagnostics.md` | Pending |
| Upgrade | Install marker vs Keychain leftovers, secure current/rollback registry, original identity/scoped tokens, Pro/grace | `install-state`; `storage`; `connection-store` tests | Pending |
| Upgrade user content | AsyncStorage manifest/MD5 files, chat chunks/index, archives/favorites/drafts/question drafts/recordings/preferences | existing storage fixtures and service tests | Pending |
| Delivery | Same-bundle transactional import/readback, compatible app group, community build without maintainer secrets | native upgrade integration and clean-checkout build | Pending |

Paths in the source column are under `apps/mobile/src` unless a package/document is named. Root routes are enumerated in `navigation/root-stack.ts` (18 as audited); settings destinations and shared sheets expand that surface. This checklist deliberately tracks capabilities rather than pretending route count measures completeness.

## Physical evidence

`DEVICE-ACCEPTANCE.md` records the designated USB QA results, including main392 Hermes Local background requests and microphone/cloud/draft/cancel/recovery. Those bounded passes leave the wider rows above pending; they do not certify other transports/backends, full voice accuracy or a store upgrade.

## Upgrade invariants

Expo SecureStore reads generic-password services `app:no-auth`, `app:auth`, then legacy `app`; account and generic attributes are the UTF-8 logical key. Preserve the `WHEN_UNLOCKED_THIS_DEVICE_ONLY` accessibility. Current AsyncStorage is `Library/Application Support/<bundleID>/RCTAsyncLocalStorage_V1/manifest.json`; null manifest entries use MD5-keyed files. Support applicable legacy paths, using synthetic containers before accessing a user's real data.

Keep the install marker, device identity, registry plus rollback, scoped device tokens, RevenueCat identity/entitlement and one-time grace. A new UserDefaults domain is not evidence of a fresh install. Read and validate old data, write a new transaction, read it back, then mark migration complete. Failure retains the old source. Saved conversations are user content, not expendable cache. QA uses a separate sandbox; never extract a personal store app's container for convenience.

The physical-history consumer now has current-head and reset/delete-ACK transactions, durable unknown-mutation holds, exact first-ID binding, old-epoch outbox preservation, late-read/live/consent isolation and epoch-scoped artifact cache consumers. See [HISTORY.md](HISTORY.md). Source controller/storage tests and generic development compilation are separate from actual device/backend reset, repeated reconnect, cold archive and six-backend acceptance; those checklist rows remain pending.
