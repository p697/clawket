# Agent Protocol Package

This package is the platform-neutral contract between Clawket UI and backend adapters.

1. Keep runtime dependencies empty. Do not import React, React Native, storage, networking, or backend implementations.
2. Export only serializable protocol data, adapter interfaces, capability policy, errors, and deterministic test helpers.
3. Backend support is expressed through `Capabilities`; unsupported management groups are absent instead of throwing at runtime. `attachments` means image attachments, while the additive optional `fileAttachments` capability enables non-image files. Missing refinements fail closed.
4. Contract changes must remain additive unless a 3.0 specification update explicitly requires a breaking change.
5. Runtime branches require 100% branch coverage. Keep `createMockAdapter` deterministic and usable without a device runtime.
6. The package currently exposes TypeScript source for Metro/Jest. Node workspaces must use type-only imports until a compiled runtime export is added.
7. Historical tool records may use `unknown` when no result was recorded. This is not success or a live run event; a summary is not an output payload.
8. Usage queries may carry an Agent owner. OpenClaw queries from an Agent page must preserve that owner; single-Agent adapters retain their backend's native query shape.
9. Optional `cronTimeZone`, `cronAdvanced` and `cronModel` refine scheduled-task editing, not transport support. OpenClaw supports per-job timezone, advanced execution options (including creating paused jobs) and a per-job `agentTurn` model override; Hermes does not (its Bridge does not forward `model` yet, so the flag stays off until it does). Missing flags fail closed; existing Cron schedule/payload metadata remains valid and must survive unrelated edits.
10. Optional `modelManage` refines `models` with Gateway config editing (`getCatalog` / `saveCatalog` / `addModel` / `inspectDeletion` / `deleteModel` / `setCost`). OpenClaw declares it; Hermes, YouMind and local-model do not and keep only global `setSelection`. `ModelCatalogState.allowlist` is `null` when the backend has no allowlist, never an empty array. Missing flags fail closed.
11. Optional `channelManage` refines `channels` with Gateway config writes: `getRouting` / `setRouting` (the global `session.dmScope`, one of `DM_SCOPES`; unset reads as `main`) and `setAccountEnabled` (`channels.<id>.accounts.<accountId>.enabled`). `ChannelsOperations` is `Partial`; `status` stays the only read for backends without the refinement. OpenClaw declares it; Hermes, YouMind and local-model do not. Missing flags fail closed.

`SessionDescriptor.lastActivityAt` is the additive human-activity clock: adapters that can tell a user message or user-facing reply apart from record housekeeping (heartbeats, metadata patches) must set it, `null` when the session never had such activity; adapters that cannot leave it undefined so `sessionActivityAt` falls back to `updatedAt`. `HUMAN_SESSION_KINDS` names the session kinds a person takes part in. Consumers order and unread-mark on this clock only.

`SessionHistory.toolCallAliases` optionally carries confirmed source-to-canonical tool identities; consumers may retire a source copy only with its matching canonical tool in the snapshot. `SessionHistory.activeRun` is an optional backend recovery snapshot (identity, visible text, start time and session-scoped cancellation hint). Peers without it retain their existing behavior; mocks clone it independently.

`agent_message_chunk.textMode` is additive: `snapshot` replaces the whole run text, `delta` appends verbatim (including repeated tokens); omission preserves legacy adapter behavior. This is text semantics, independent of backend capabilities and transport identity.

`ConfigOperations.backups.remove` is additive and optional: it removes a local restore point without restoring or modifying the Gateway. Older adapters without it remain valid. Cron mock updates normalize `agentTurn.model: null` to an absent stored override.

`SkillStatusEntry.invocation` is an optional adapter-authored draft prefix for an available installed skill. `SkillsOperations.install` is an optional source-pinned native installation with a verified installed-status result. `Capabilities.steer` and `AgentAdapter.steer` describe exact active-run guidance; Hermes may enable it only after explicit API/Bridge capability negotiation. Other backends and legacy peers keep it absent/disabled.

Execution approvals may carry `expiresAtMs: null` when the backend publishes no deadline. Consumers wait for the authoritative resolution/termination and must not invent an expiry or treat null as an expired timestamp. Known OpenClaw deadlines retain their normal behavior.

Hermes per-job model selection is declared in the product matrix but downgraded until `hermes.cron-model.v1` is positively negotiated. It does not permit per-session model configuration.

`sessionFiles` is an optional runtime-negotiated capability with opaque file IDs and bounded offset-based reads. It is separate from Agent configuration `files`; older peers must leave it unavailable.

`ChatMessage.attribution` optionally supplies channel/account/conversation/message/thread facts and a sender's ID, name, username, avatar and kind. These are display facts, independent of backend, transport, model role and authorization. `sentLocally` is cache-only provenance, never accepted from a wire message or inferred from owner flags. Missing fields preserve older direct-chat contracts; mock histories clone attribution independently.
