# Native iOS program

Owner authorization: 2026-10-15; coexistence decision: 2026-10-16. React Native remains the default supported iOS and Android client. Native iOS is an independent product and design experiment, with current capabilities preserved as its acceptance target. Product, UI and architecture decisions within this boundary are delegated to the implementation agent. Android native is deferred. The owner has not accepted the current native UI; functional tests do not establish visual quality.

## Authority and scope

Current code, tests and workspace instructions define existing behavior. This directory defines the native implementation and its acceptance. The owner's decision supersedes 3.0's single shared UI, self-drawn navigation and prohibition on SF Symbols, Liquid Glass and simulator screenshots. Security, privacy, protocol compatibility, resource limits and release authorization are unchanged. Existing prices, entitlement rules and selected app version remain in force.

Support OpenClaw, Hermes, Codex, Claude Code, Pi and local-model. The owner's exclusion of Claude from design research does not remove the existing Claude Code backend. Do not add backends or cloud message persistence.

Keep `apps/mobile` and its existing UI, default commands, Expo/EAS configuration, store identity and release path intact. Native development must preserve React Native connection stability and shared contracts. The two implementations may coexist indefinitely. [Parity](PARITY.md), upgrade acceptance and CI are quality evidence, not permission to change the default. Switching the default, removing React Native or delivering native under the store bundle each requires an explicit later owner decision, in addition to the existing release authorization.

## Product direction

Clawket brings the Agents on a person's computers into one dependable mobile workspace. The primary journey is **find an Agent → resume a conversation → guide or approve work → inspect its result**. A useful first connection and trustworthy recovery matter as much as the finished chat screen.

1. **Agents is home.** Native list, semantic large title, purposeful avatars, concise preview, time and independent unread/attention indicators. No backend tabs, dashboard cards or generic AI greeting. Preserve pinned Agents, chosen home conversations and recent human activity ordering.
2. **Conversation is the focus.** Native navigation, a tappable Agent/conversation identity, readable transcript and a keyboard-attached composer. Show the user's messages as compact trailing bubbles; assistant content has room for prose, code and artifacts. External channel participants stay incoming with their identity. Preserve chat appearance choices when migrating.
3. **Work has a clear place.** A restrained work dock opens the current steps and execution record. Questions and consent remain distinct, explicit decisions. Dismissing a sheet cannot answer, approve or cancel a task.
4. **Controls feel like iOS.** System navigation, sheets, menus, confirmations, pickers and share actions. Brand identity lives in Agent faces, content, accent and the existing Companion. Glass belongs to navigation/controls; long-form content stays legible. Availability fallbacks preserve the same product behavior.
5. **Failure preserves context.** Offline retains the conversation, draft and pending state. Reconnect never silently replays an uncertain message. Distinguish phone↔Relay evidence, backend health and successful model output.

## Architecture

```text
apps/mobile/                # default React Native iOS/Android client
apps/ios/                   # independent experimental Xcode application
  Clawket/                  # SwiftUI/UIKit features, assets and String Catalog
  ClawketTests/             # actual application integration tests
packages/apple/             # one Swift package with focused modules
  Sources/ClawketTransport/ # URLSession sockets, RPC, generation/timeout safety
  Sources/ClawketPairing/   # existing QR/invitation/code wire compatibility
  Sources/…/                # native domain/adapters/persistence as milestones land
  Tests/                    # deterministic protocol, recovery and storage tests
tests/native-contract/      # synthetic cross-language vectors and recorded contracts
```

- Swift 6, strict concurrency, Foundation actors for connection ownership; native SwiftUI features with UIKit for text/selection and any measured timeline behavior requiring it. No React Native, WebView or JavaScriptCore application runtime in the new iOS target.
- Preserve the existing iOS 16.4 deployment floor. Newer appearance/scroll APIs require availability checks. Support compact and resizable iPad windows using actual geometry, not device-name or global-screen assumptions.
- UI → backend-neutral native adapter → transport → connection registry. Backend, transport and service environment remain separate values. Runtime negotiation may only downgrade the centrally declared capability matrix.
- TypeScript protocol sources and real fixtures remain the compatibility oracle. Check shared enums, capability keys, wire envelopes and crypto vectors; never handwave equivalence between similarly named algorithms.
- One active connection, inactive cache-only entries. Every awaited socket/adapter/history/storage continuation checks its captured generation and scope. Actors alone do not provide this fence.
- NaCl-compatible pairing uses pinned Swift-Sodium; SHA-256/HMAC/Ed25519 use supported native primitives with exact old wire/key formats. No custom cryptography or protocol change.
- Keychain secrets; protected on-device structured storage and files. Existing Expo SecureStore, AsyncStorage, identity, archives, drafts, speech recordings and RevenueCat identity require a verified, transactional importer before same-bundle delivery.
- The experimental iOS target is `Clawket Native`, using `com.p697.clawket.nativeqa`; React Native retains `com.p697.clawket`. Their app sandboxes and Keychain services are separate, so both can stay installed. Do not replace the store app or automatically transfer its credentials, data or purchase identity. Store identity, signing team and distribution configuration stay out of community build requirements. Native version does not change merely because architecture changes.

## Execution and completion gates

| Milestone | Concrete result | Gate |
|---|---|---|
| N0 Research and inventory | Primary-source design findings, repository architecture audit, full current capability checklist, device identity discipline | Sources distinguish observation from inference; no false phone/gesture claims |
| N1 Native protocol foundation | Swift transport/RPC/recovery, exact NaCl pairing and device identity, contract vectors | Cross-language vectors; malformed/boundary/cancellation/replaced-generation regressions; real Foundation socket test |
| N2 Working native conversation | QA app, durable connections/drafts/cache, roster/session navigation, real OpenClaw and Hermes text streaming/stop/history | Both backends: initial pair, saved-token reconnect, text round trip, background/foreground, network loss and owner replacement |
| N3 Current backend task semantics | All six adapters; projects, catalog paging, models/thinking/permissions, approvals/questions, queued/uncertain sends, attachments/artifacts | Each supported operation maps to current negotiated contract and relevant recorded fixture; unsupported operations hidden |
| N4 Full feature and data preservation | Management, voice, search/saved history, sharing/widgets/Node, payments/settings, 19 languages/RTL, upgrade importer | Every PARITY row evidenced; old installation data/entitlement/identity preserved |
| N5 Native craft and acceptance | Refined iPhone/iPad experience and measured recovery/performance | Simulator UI matrix + authorized test phone, VoiceOver/Dynamic Type, long transcripts/IME/media, soak/recovery and clean-checkout builds |
| N6 Owner acceptance | Agent-reviewed development build with precise remaining limits | Owner receives tested version; distribution/upload/submission/publication require separate authorization |

Do not call N1 a finished app, a build a successful connection, a replay successful inference, or a beautiful screenshot functional acceptance. Keep progress current after every milestone. A missing owner-only prerequisite goes in the shared HUMAN TODO table while independent work continues.

## Verification rules

Use narrow test files serially and at most two compiler/test workers under the existing leases. CI carries the full old-client gates. Native protocol tests must include real URLSession traffic against an isolated local server; mock-only success is insufficient. Preserve the v1 deployment gate and leave production services unchanged during client migration.

Native acceptance includes cold/warm launch, initial pairing and saved credentials, long idle, background suspension, changed network, dropped responses, Bridge restart/owner replacement, stale callbacks, frame boundaries and large media. Do not replay writes to make a test pass. Measure ready from authenticated backend evidence; log metadata only.

Screen acceptance includes a small phone, regular phone, landscape/resizable iPad, light/dark, accessibility text sizes, VoiceOver, Reduce Motion/Transparency, increased contrast, English/Chinese/Japanese/Arabic, Chinese/Japanese marked-text input, keyboard/selection/undo/paste, multitasking, attachment cancellation and long history. Keep reading position during stream, paging, media load and reconnect; jump to latest only at the reader's request or their own send.

## Status

The chat/upload craft pass now uses a dedicated standard iPhone simulator and WebDriver, with real app/runtime envelopes against an isolated synthetic peer. It refines the composer, media gallery, system-picker lifetime and reconnect presentation; measured results and remaining real-service/device gaps live in [MEDIA](MEDIA.md#chat-craft-simulator-acceptance--2026-10-16). This advances N5 without completing it or changing the default client.

The subsequent real Direct checks are recorded separately in [BACKEND-ACCEPTANCE](BACKEND-ACCEPTANCE.md): Hermes text and protected cold restoration passed, its Stop attempt failed, and OpenClaw has not passed credential authentication. Later complete history recovery does not erase that failed Stop or prove a bounded reconnect time. These findings do not authorize changing a shared backend or replacing React Native.

N0 source research, architecture audit and the current feature checklist are complete; three-app USB WebDriver input/attachment observations are recorded separately in RESEARCH. N1 transport/pairing and the initial backend/UI packages are merged with protocol and compile evidence. N2 now has a maintained development app with scoped persistence, real adapter bindings and simulator CI; the wired WebDriver development pass has verified a real Hermes text round trip and saved-token cold reconnect against a fresh uncached catalog. A later main9aebc8d0 wired WebDriver pass verified the existing synthetic Hermes conversation after cold catalog recovery and twenty-/thirty-second background returns; a measured return settled with its header, messages and composer in 0.811 seconds after the initial accessibility sample. The prior lost detail selection was not reproduced. This same pass exposed horizontal overflow of long text: the composer action lay outside the 420-point window and the attempted tool test remained an unsent draft, which was cleared by exact value. A 4d8adf0a plus layout development build corrected the width constraints on that same QA installation: the 44-point Send action was visible within the window, one synthetic printf tool request produced its exact reply and one inspectable original tool result, and the same reply/work output remained readable after restarting only the QA app. Real-host geometry regressions cover narrow and wide width proposals; complete history and work acceptance remains pending. OpenClaw reaches its normal device-pairing requirement after exact input verification and has not yet completed phone inference. Complete two-backend connection/inference/recovery acceptance and the later parity gates remain pending. No same-bundle upgrade, distribution package, upload, production deployment or public release is claimed.

The task host now has a bounded protected work/review journal, exact producer-lineage grouping, native work inspection and inert cold-restored consent/question receipts. Missing/ambiguous attribution stays unknown; complete history reconciliation, actual backend work flows and USB inspection remain acceptance gates. See `WORK-JOURNAL.md`.
