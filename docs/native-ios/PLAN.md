# Native iOS program

Owner authorization: 2026-10-15. Product, UI and architecture decisions are delegated to the implementation agent. iOS comes first; Android native follows later. This is a complete client migration, with current capabilities preserved, not a new chat-only product.

## Authority and scope

Current code, tests and workspace instructions define existing behavior. This directory defines the native implementation and its acceptance. The owner's decision supersedes 3.0's single shared UI, self-drawn navigation and prohibition on SF Symbols, Liquid Glass and simulator screenshots. Security, privacy, protocol compatibility, resource limits and release authorization are unchanged. Existing prices, entitlement rules and selected app version remain in force.

Support OpenClaw, Hermes, Codex, Claude Code, Pi and local-model. The owner's exclusion of Claude from design research does not remove the existing Claude Code backend. Do not add backends or cloud message persistence. Keep the current app usable throughout migration; native iOS becomes the default only after [parity](PARITY.md) and upgrade acceptance pass.

## Product direction

Clawket brings the Agents on a person's computers into one dependable mobile workspace. The primary journey is **find an Agent → resume a conversation → guide or approve work → inspect its result**. A useful first connection and trustworthy recovery matter as much as the finished chat screen.

1. **Agents is home.** Native list, semantic large title, purposeful avatars, concise preview, time and independent unread/attention indicators. No backend tabs, dashboard cards or generic AI greeting. Preserve pinned Agents, chosen home conversations and recent human activity ordering.
2. **Conversation is the focus.** Native navigation, a tappable Agent/conversation identity, readable transcript and a keyboard-attached composer. Show the user's messages as compact trailing bubbles; assistant content has room for prose, code and artifacts. External channel participants stay incoming with their identity. Preserve chat appearance choices when migrating.
3. **Work has a clear place.** A restrained work dock opens the current steps and execution record. Questions and consent remain distinct, explicit decisions. Dismissing a sheet cannot answer, approve or cancel a task.
4. **Controls feel like iOS.** System navigation, sheets, menus, confirmations, pickers and share actions. Brand identity lives in Agent faces, content, accent and the existing Companion. Glass belongs to navigation/controls; long-form content stays legible. Availability fallbacks preserve the same product behavior.
5. **Failure preserves context.** Offline retains the conversation, draft and pending state. Reconnect never silently replays an uncertain message. Distinguish phone↔Relay evidence, backend health and successful model output.

## Architecture

```text
apps/ios/                   # maintained Xcode application and platform extensions
  Sources/                  # SwiftUI features, UIKit text/timeline integration
  Resources/                # asset catalogs and String Catalog localization
  Tests/                    # UI/upgrade integration tests
packages/apple/             # one Swift package with focused modules
  Sources/ClawketTransport/ # URLSession sockets, RPC, generation/timeout safety
  Sources/ClawketPairing/   # existing QR/invitation/code wire compatibility
  Sources/…/                # native domain/adapters/persistence as milestones land
  Tests/                    # deterministic protocol, recovery and storage tests
tests/native-contract/      # synthetic cross-language vectors and recorded contracts
apps/mobile/                # current client, Android and migration oracle
```

- Swift 6, strict concurrency, Foundation actors for connection ownership; native SwiftUI features with UIKit for text/selection and any measured timeline behavior requiring it. No React Native, WebView or JavaScriptCore application runtime in the new iOS target.
- Preserve the existing iOS 16.4 deployment floor. Newer appearance/scroll APIs require availability checks. Support compact and resizable iPad windows using actual geometry, not device-name or global-screen assumptions.
- UI → backend-neutral native adapter → transport → connection registry. Backend, transport and service environment remain separate values. Runtime negotiation may only downgrade the centrally declared capability matrix.
- TypeScript protocol sources and real fixtures remain the compatibility oracle. Check shared enums, capability keys, wire envelopes and crypto vectors; never handwave equivalence between similarly named algorithms.
- One active connection, inactive cache-only entries. Every awaited socket/adapter/history/storage continuation checks its captured generation and scope. Actors alone do not provide this fence.
- NaCl-compatible pairing uses pinned Swift-Sodium; SHA-256/HMAC/Ed25519 use supported native primitives with exact old wire/key formats. No custom cryptography or protocol change.
- Keychain secrets; protected on-device structured storage and files. Existing Expo SecureStore, AsyncStorage, identity, archives, drafts, speech recordings and RevenueCat identity require a verified, transactional importer before same-bundle delivery.
- The maintained iOS target uses a separate QA bundle identifier during development. Store identity, signing team and distribution configuration stay out of community build requirements. Native version does not change merely because architecture changes.

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

N0 source research, architecture audit and the current feature checklist are complete; three-app USB WebDriver input/attachment observations are recorded separately in RESEARCH. N1 transport/pairing and the initial backend/UI packages are merged with protocol and compile evidence. N2 now has a maintained development app with scoped persistence, real adapter bindings and simulator CI; the wired WebDriver development pass has verified a real Hermes text round trip and saved-token cold reconnect against a fresh uncached catalog. A later main9b03cb88 cold pass refreshed the roster automatically and verified the exact QA history. Its twenty-second background pass exposed lost detail selection (Welcome placeholder); returning through the roster restores the unchanged reply, so navigation recovery still needs repair and USB retesting; OpenClaw reaches its normal device-pairing requirement after exact input verification and has not yet completed phone inference. Complete two-backend connection/inference/recovery acceptance and the later parity gates remain pending. No same-bundle upgrade, distribution package, upload, production deployment or public release is claimed.

The task host now has a bounded protected work/review journal, exact producer-lineage grouping, native work inspection and inert cold-restored consent/question receipts. Missing/ambiguous attribution stays unknown; complete history reconciliation, actual backend work flows and USB inspection remain acceptance gates. See `WORK-JOURNAL.md`.
