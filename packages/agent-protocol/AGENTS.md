# Agent Protocol Package

This package is the platform-neutral contract between Clawket UI and backend adapters.

`ModelInfo.resolvedModel` is optional native evidence for an alias’s concrete model; display/search it without replacing the selectable `id` or guessing a version when absent.

`ModelInfo.sortOrder` is optional backend recommendation order within a provider (lower first). Missing order retains legacy alphabetical presentation; consumers must not infer model age from names.

`ModelSelectionState.thinkingLevels` optionally carries the levels the current model accepts, in display order, when the backend reports them per session or model. It takes precedence over `ModelInfo.reasoningLevels` and `listThinkingLevels()`; a missing field keeps those. An adapter exposes `setThinkingLevel` only when its backend validates the write.

1. Keep runtime dependencies empty. Do not import React, React Native, storage, networking, or backend implementations.
2. Export only serializable protocol data, adapter interfaces, capability policy, errors, and deterministic test helpers.
3. Backend support is expressed through `Capabilities`; unsupported management groups are absent instead of throwing at runtime. `attachments` means image attachments, while the additive optional `fileAttachments` capability enables non-image files. Missing refinements fail closed.
4. Contract changes must remain additive unless a 3.0 specification update explicitly requires a breaking change.
5. Runtime branches require 100% branch coverage. Keep `createMockAdapter` deterministic and usable without a device runtime.
6. The package currently exposes TypeScript source for Metro/Jest. Node workspaces must use type-only imports until a compiled runtime export is added.
7. Historical tool records may use `unknown` when no result was recorded. This is not success or a live run event; a summary is not an output payload. Optional `tool_call.status` reports the initial projection; omission retains the legacy running start. `tool_call_update` can report unknown. Optional history `tool.statusReported` retains this explicit state through reloads; unknown must not become inferred execution or completion.
8. Usage queries may carry an Agent owner. OpenClaw queries from an Agent page must preserve that owner; single-Agent adapters retain their backend's native query shape.
9. Optional `cronTimeZone`, `cronAdvanced` and `cronModel` refine scheduled-task editing, not transport support. OpenClaw supports per-job timezone, advanced execution options (including creating paused jobs) and a per-job `agentTurn` model override; Hermes does not (its Bridge does not forward `model` yet, so the flag stays off until it does). Missing flags fail closed; existing Cron schedule/payload metadata remains valid and must survive unrelated edits.
10. Optional `modelManage` refines `models` with Gateway config editing (`getCatalog` / `saveCatalog` / `addModel` / `inspectDeletion` / `deleteModel` / `setCost`). OpenClaw declares it; Hermes and local-model do not and keep only global `setSelection`. `ModelCatalogState.allowlist` is `null` when the backend has no allowlist, never an empty array. Missing flags fail closed.
11. Optional `channelManage` refines `channels` with Gateway config writes: `getRouting` / `setRouting` (the global `session.dmScope`, one of `DM_SCOPES`; unset reads as `main`) and `setAccountEnabled` (`channels.<id>.accounts.<accountId>.enabled`). `ChannelsOperations` is `Partial`; `status` stays the only read for backends without the refinement. OpenClaw declares it; Hermes and local-model do not. Missing flags fail closed.

`SessionDescriptor.lastActivityAt` is the additive human-activity clock: adapters that can tell a user message or user-facing reply apart from record housekeeping (heartbeats, metadata patches) must set it, `null` when the session never had such activity; adapters that cannot leave it undefined so `sessionActivityAt` falls back to `updatedAt`. `HUMAN_SESSION_KINDS` names the session kinds a person takes part in. Consumers order and unread-mark on this clock only.

`SessionHistory.pagination: cursor` is optional adapter-authored read semantics: `nextCursor` absence means completion, even on the first empty page. Omission retains legacy limit/local-cache handling; a cursor alone remains sufficient to enter cursor paging. Adapters set the marker only for a known cursor API, never infer it from a short result.

`SessionHistory.toolCallAliases` optionally carries confirmed source-to-canonical tool identities; consumers may retire a source copy only with its matching canonical tool in the snapshot. `SessionHistory.activeRun` is an optional backend recovery snapshot (identity, visible text, start time and session-scoped cancellation hint). Peers without it retain their existing behavior; mocks clone it independently.

`agent_commentary_chunk` is additive: a commentary paragraph a backend streams outside its reply text (OpenClaw Gateway preamble progress). `text` is that item's whole text so far; reply snapshots and finals never repeat it. Consumers show each item as its own paragraph; peers that ignore it keep their history-only behavior.

`agent_message_chunk.textMode` is additive: `snapshot` replaces the whole run text, `delta` appends verbatim (including repeated tokens); omission preserves legacy adapter behavior. This is text semantics, independent of backend capabilities and transport identity.

Optional `agent_message_chunk.timestampMs` and `SessionHistory.activeRun.messageTimestampMs` describe the current visible paragraph independently of run start. A producer must keep the same paragraph's clock fixed; absent fields preserve older peers. These clocks are presentation metadata, never activity, ownership or dispatch proof.

Optional `tool_call.startedAtMs` and `tool_call_update.startedAtMs`/`finishedAtMs`/`durationMs` carry the producer's native or observed step clocks (Unix ms) and native run time (ms); only a settled call carries completion or duration. Consumers prefer them over receipt time; absent or malformed values keep receipt timing. Like paragraph clocks they are presentation metadata, never execution proof.

`ConfigOperations.backups.remove` is additive and optional: it removes a local restore point without restoring or modifying the Gateway. Older adapters without it remain valid. Cron mock updates normalize `agentTurn.model: null` to an absent stored override.

`SkillStatusEntry.invocation` is an optional adapter-authored draft prefix for an available installed skill. `SkillsOperations.install` is an optional source-pinned native installation with a verified installed-status result. `Capabilities.steer` and `AgentAdapter.steer` describe exact active-run guidance; Hermes may enable it only after explicit API/Bridge capability negotiation. Other backends and legacy peers keep it absent/disabled.

Execution approvals may carry `expiresAtMs: null` when the backend publishes no deadline. Consumers wait for the authoritative resolution/termination and must not invent an expiry or treat null as an expired timestamp. Known OpenClaw deadlines retain their normal behavior.

Hermes per-job model selection is declared in the product matrix but downgraded until `hermes.cron-model.v1` is positively negotiated. It does not permit per-session model configuration.

`sessionFiles` is an optional runtime-negotiated capability with opaque file IDs and bounded offset-based reads. It is separate from Agent configuration `files`; older peers must leave it unavailable.

`ChatMessage.attribution` optionally supplies channel/account/conversation/message/thread facts and a sender's ID, name, username, avatar and kind. These are display facts, independent of backend, transport, model role and authorization. `sentLocally` is cache-only provenance, never accepted from a wire message or inferred from owner flags. Missing fields preserve older direct-chat contracts; mock histories clone attribution independently.

Pi is an explicit backend using ordinary sessions and per-session model selection. Optional `agentQuestions` / `questions` and question updates describe extension select/confirm/input/editor interactions, independently of `execApproval`. Optional `sessionBranch` and `createSession(..., { fromSession })` permit continuing native read-only history as a new owned session. Missing refinements remain unavailable.

Structured question fields may opt into `multiSelect: true`. Omission remains single-select. Answer arrays contain selected labels or an explicit custom answer; adapters retain the native question identity separately and must not infer an answer from dismissal or a default selection.

Codex is an independent backend with an optional runtime-negotiated `projects` capability. `ProjectDescriptor` provides an opaque ID and display path; `SessionDescriptor.canContinue` explicitly opts native sessions into original-thread continuation. Absence retains read-only behavior. Structured `form` questions group native IDs, options/descriptions and optional custom answers in one response, separate from approvals. `ModelInfo.reasoningLevels` optionally carries the native model-specific levels; missing metadata preserves existing adapters. Execution approvals may describe command/file/network/permission categories and a reason, with the same exact-request decision contract; category is display metadata, never authorization.

Optional `AgentDescriptor.entryMode: sessions` declares that an Agent has no privileged main chat. Its empty `mainSessionKey` is a navigation entry only, never a backend conversation ID. Consumers must choose/restore a real session before chat operations; Agents without this refinement keep their existing main-session behavior.

`SessionDescriptor.continuationBlockedReason` optionally explains `in_use`, `ownership_unknown`, or `project_unavailable` when original-session input is blocked. Cache it with `canContinue`; it never authorizes takeover, branching or filesystem creation. Missing metadata retains legacy behavior.

`SessionDescriptor.attention: input` distinguishes an unanswered Agent question from execution consent. It is display state only; answering remains governed by the exact native request and existing question/approval capabilities.

`SkillsOperations.status` accepts optional session context for project-specific discovery. Existing Agent/global skill backends may ignore it; it never authorizes arbitrary directory input.

Optional `fastMode`, `sessionPermissions` and `sessionArchive` are runtime-negotiated Codex refinements. Settings resolve with authoritative native state; `permissions.mode: custom | null` never authorizes a default override. `unencryptedTransport` is local transport evidence for the permission UI, not a server security claim. Archive is reversible through `archiveSession(key, false)` and `listArchivedSessions`; it must retain native IDs/history and remain absent on older peers.

`AdapterError.recoveryAction: confirm_permissions` is an optional adapter classification for a verified rejection before prompt dispatch, never a generic server failure or unknown receipt. It pauses sending for explicit permission review without replaying the input. Optional `permissions.requiresConfirmation` retains an unresolved native permission restore across reconnects. A current readable mode is not confirmation; clients keep Send blocked until an explicit permission selection returns verified state with the flag cleared.

Optional `promptStatus` and `getPromptStatus` negotiate read-only receipt lookup. `recorded` identifies a durable Bridge receipt and run ID, not native dispatch, running or completion. `unknown` is not a rejection; neither result authorizes resending. Only exact native message identity reconciles an uncertain bubble. Missing capability preserves older peers.

Optional `validatePrompt` is synchronous local validation of the prepared prompt, with no networking or side effects. Only `LocalSendRejectedError` proves an adapter rejected a too-large complete frame before socket dispatch; a remote `frame_too_large`, matching message/name or copied outcome property is not this proof. Consumers keep the unsent item editable and held, without automatic replay.

Optional `run_finished.terminalMessage` carries a fixed, safe system notice for a failed native turn. Its ID and timestamp match its history projection so recovery preserves one notice. It is not an assistant reply, raw provider diagnostic, or evidence to retry a prompt; older peers may ignore the additive field and read the same system row in history.

Optional `FinalMessage.timestampMs` is the backend-authored final-reply clock in milliseconds. Omission preserves receipt-time presentation; it does not supply a tool timestamp, run outcome or authorization to retry. Existing final-message peers remain compatible.

`health.sessionCatalogSync === 1` optionally negotiates `sessions.sync` for Codex, Claude Code and Pi without changing `sessions.list` or the adapter's array return type. Full snapshots use immutable epoch/revision pages of at most 64 KiB; small deltas carry exact base revision, upserts, removed keys and complete order. Clients apply only complete, validated results atomically and may restart an expired page sequence once. Incomplete native discovery is not deletion evidence. Keep these wire types runtime-free.

Codex may independently negotiate `health.sessionCatalogPageIndex === 1`. Only then request `pageIndex: true` on an initial/base read; the optional first-page `pageOffsets` indexes frozen continuations. Bound it to 512 increasing offsets and three outstanding reads; keep complete atomic validation, one expiry restart and all existing size limits. Missing negotiation/index retains serial v1 pages.

`ChatMessage.attachments[].artifactId` and `FinalMessage.attachments` preserve stable, backend-authored attachment references. Optional `AgentAdapter.artifacts` resolves a session-bound artifact into an opaque expiring file handle with bounded reads. This capability is independent of transport and workspace configuration files; absence never authorizes a URL/path fallback. Keep the package runtime-neutral.

`SessionActivity` and the optional negotiated `AgentAdapter.readSessionActivity` provide ephemeral presentation evidence for a bounded visible window (32 keys). `session_activity_update` carries only that projection. Unknown never proves idle, health or ownership; keep this evidence out of durable catalogs and history. See [session activity](../../docs/3.1/session-activity.md).
Optional `profileManagement` is Codex-only and runtime-negotiated by profile version 1. `AgentProfileOperations` covers native defaults, quota, authorized project skills/instructions, and read-only MCP/plugins; it is separate from per-session settings, ownership and arbitrary filesystem access. Replies use opaque IDs, document/config versions and explicit nullable unknown usage. Missing capability remains unavailable. Keep these contracts runtime-free; see `../../docs/3.1/codex-profile.md`.

Optional `ChatMessage.turnId` groups native execution items independently of local run IDs. Active history and run/text/tool updates may carry `turnId` plus the original `inputMessageId`, with `inputMessageKey` only when a durable receipt proves that original client key. Same-run `run_started` enrichment must preserve presentation. Missing/invalid metadata retains legacy boundaries; never group by text/time or an unkeyed user. These fields do not authorize dispatch or ownership.
