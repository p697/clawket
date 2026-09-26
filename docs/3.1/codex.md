# Codex integration

Owner authorization: 2026-09-26. Implement Codex as an independent backend; perform local, Preview, iOS simulator and connected Android development testing. Production release and package publication remain separate decisions.

## Approved next phase (2026-09-26)

The owner approved device-level project discovery, recent-first project navigation and original-thread continuity, excluding Git/IDE management. The detailed target and user-question acceptance are in `../research/codex-project-sync-direction-2026-09-26.md`. Desktop IPC adaptation is now authorized for this extension, with explicit ownership, supported-version checks and safe degradation; implementation and acceptance evidence are tracked separately below. Update affected contracts and workspace instructions alongside implementation. Existing single-project authorization must not silently widen.

Structured user questions are a required end-to-end interaction: options plus allowed custom input, grouped questions, exact-owner replies, reconnection, desktop resolution and cancellation. Preserve the distinction between ordinary questions and approval-bearing tool prompts. A displayed sheet or a successful adapter fixture alone does not prove the original native task continues.

## Device continuity implementation

New pairings connect one computer, discover saved workspace roots and native thread directories, and select an explicit project for new chats. Existing project pairings retain their original boundary. Codex has no privileged main conversation: opening its roster entry restores the last existing chat on that device, otherwise opens the project-aware session sheet. New chats require explicit creation and project choice; deleting the current owned chat returns to the sheet. Existing landing records retain their IDs/history as ordinary, deletable chats. Bridge-created chats retain free access; imported native history keeps its existing entitlement policy. Listing models or starting the Bridge must not create a chat. The current project path uses the fixed-height header subtitle while idle; activity and connection states take precedence. Keep project names in session rows and full paths in the project picker; do not reserve composer height for a directory label. Reuse the quiet Clawket composer, optimistic outbox, activity rows, image picker and session sheets. Stream text immediately; keep tools collapsed until opened. Put consequential approvals in the conversation with their actual command/file/network scope. Never label ordinary questions as permission grants. Preserve drafts on interruption and reconnection; never replay an uncertain submission.

Scope: native App Server conversations, history and branching, per-session model/reasoning, exact-turn steering/cancellation, command/file approvals, grouped native questions, original-thread continuity, and authenticated local/Relay pairing. User credentials, providers, skills, MCP and project instructions remain managed by installed Codex. Do not replace the owner's installation or interfere with an existing Codex task.

Native conversations retain their IDs. Desktop-owned turns are followed through local versioned IPC; continuation, steering, stop and answers go to that owner. Only an explicit bus no-owner response and a non-active native history permit a local resume. A timeout/disconnection never permits a second writer. Native metadata mutation and unrelated active CLI takeover remain unsupported. Branching is still an explicit separate action. Git publication, cross-Agent orchestration and unattended permission escalation remain out of scope. Native Plan mode requires explicit protocol support, not a prompt pretending to be Plan mode.

## Architecture and safety

Use one Clawket-owned `codex app-server --listen stdio://` child per pairing configuration, with explicit cwd and sandbox boundaries on every owned thread. This matches App Server’s native multi-thread architecture and avoids a process for every discovered project. Initialize the supported JSON-RPC protocol; bound frames, pending requests, session indexes and history pages. Resolve remote opaque IDs only through the authenticated project catalog and thread registry. Never expose arbitrary App Server methods or file paths.

Persist owned-thread metadata and prompt fingerprints before acknowledgement. Native transcript storage stays Codex-owned. Reconnect reads native state and pending approvals; phone disconnection leaves work running. Bridge loss never silently reruns work. Stop only owned children. Honor native permission refusals; never add bypass flags. Explicit approvals apply once to one pending native request and retire only after dispatch/terminal resolution.

Codex Registry/Relay resources, room classes, pairing state, secrets and Preview deployment units are isolated from OpenClaw, Hermes and Pi. Existing clients and transports keep their contracts and 8 MiB frame limits.

## Research baseline

- [Official App Server](https://learn.chatgpt.com/docs/app-server): rich client API; installed 0.153.3 and current npm 0.157.0 form the initial compatibility targets. Protocol support is proven against generated schemas and real processes, not inferred from CLI names.
- [Official Remote](https://learn.chatgpt.com/docs/remote): ongoing work, steering and approvals are the benchmark for continuity.
- [remodex](https://github.com/Emanuele-web04/remodex): current README advertises encrypted transport, plans, steering/queues, approvals, Git actions and desktop IPC synchronization. Its feature breadth and encryption are real comparison points; no claim of outperforming without measurements.
- [PocketClaw App Store](https://apps.apple.com/us/app/pocketclaw-business-ai-agent/id6759347960) and [rick-ray-wldd/pocketclaw](https://github.com/rick-ray-wldd/pocketclaw) are distinct products. The latter targets Claude Code. Do not attribute either one's claims or popularity to the other.

## Acceptance

Required gate plus v1 compatibility replay; deterministic App Server protocol tests for ownership, prompts, UTF-8 streaming, duplicate/uncertain input, approvals, stop, steering, history and recovery. Real installed and current Codex tests use isolated projects. Device evidence covers pairing, first send, streaming, tool details, approval deny/allow, long model labels, sessions, images, background/foreground and network recovery. Record measured connection timings, versions, device type and limitations. Recheck OpenClaw/Hermes/Pi. No release-ready claim from mocks alone.

## Operator commands and verification

Model choices come from the configured Codex executable's `model/list` on each picker request, including all pages and native hidden-model semantics. The available catalog depends on the executable/client version and account, so a separately installed CLI can offer fewer models than Desktop. Select the intended executable with `--codex-command` when creating a pairing; existing pairings keep their saved command. Clawket neither hardcodes new models nor reads another client's cache or changes the user's installed CLI. Supported native version strings may include prerelease/build suffixes; a newer version still requires real protocol verification.

The candidate CLI accepts `clawket codex pair --project <directory>` (Relay), `--preview` (isolated Preview), or `--local` (LAN). `clawket pair --backend codex` defaults to device scope; `--project` is the project-only escape hatch. Codex is intentionally not auto-enrolled by plain `clawket pair`. Use the project-specific `codex status`, `doctor`, `logs`, `start`, `restart`, `stop` and `reset` commands. Global lifecycle commands do not manage these project owners.

Default device state is `~/.clawket/codex/device/<production|preview>/runtime.json`; explicit projects retain `~/.clawket/codex/<project-hash>/<production|preview>/runtime.json`; default local ports differ by environment. An explicit `--config` selects that private state file. Same-environment pairing refresh preserves the registration and existing client tokens and requires an idle owner. Native model/provider credentials stay in the installed Codex configuration.

`npm run test:codex:integration` requires `CLAWKET_CODEX_LIVE=1`, an authenticated installed binary, and optionally `CLAWKET_CODEX_COMMAND`. If the test runner isolates HOME, set `CODEX_HOME` to the intended existing Codex configuration directory. It fails when prerequisites are absent and spends real model access in an isolated temporary project. `npm run test:codex:relay` exercises isolated local Workers, secure short-code pairing, client isolation, streaming and recovery. Ordinary required tests never require a developer's Codex login.

Current boundaries: no first-class native Plan-mode toggle, no arbitrary takeover of unsupported/remote desktop hosts, no remote account/provider administration, no application-layer end-to-end encryption, no Git publication interface. Structured input and file/network consent have protocol coverage; device acceptance distinguishes these from actually exercised command approvals. Support for an API-key/custom-provider installation uses that installation's native configuration; the current live matrix uses this computer's authenticated OpenAI setup.

## Continuity verification status

The extension is in acceptance testing; the earlier project-only QA report does not certify device continuity. Installed Codex 0.153.3 has passed a real model reply, duplicate-send protection, discovery of 57 projects/929 conversations, and a real two-field `request_user_input` in native Plan mode. iOS/Android local pairing is exercised. Canonical Desktop v11 history was inspected read-only against the running desktop. Full desktop UI automation is unavailable because the computer-use tool disallows the Codex app; protocol-level and owned-App-Server tests must not be described as a completed desktop UI acceptance. Final device answers, reconnects, Preview and compatibility results will be recorded after verification.

### 2026-09-26 native-question device evidence

- Codex 0.153.3 native Plan mode: iOS LAN completed a two-field `request_user_input`; the original run resumed and finished.
- Android physical device over existing isolated Preview: opened the same original thread through a separate Bridge, answered both fields through native owner IPC, and observed completion. Independent follower logs confirm pending/resolved/terminal state.
- New question UI has explicit radio cards, an on-demand custom field, separate task cancellation and dismissal. Android cold launch restored the exact `DRAFT_QA_0926` custom value plus the first option selection. Maestro text injection dropped characters in two attempts; direct Android input produced the exact value and recovery preserved it. This is not evidence of a storage truncation.
- Local drafts are serialized, bounded to 32 entries/256 KB/seven days, and removed on native resolution. Radio mutual exclusion and failed-answer retention have focused regression tests.
- Current Desktop saved `local-projects` names/rootPaths supplement legacy roots; no filesystem scan. Missing roots remain visible but unavailable for new work.
- Acceptance remains in progress; earlier initial-integration release conclusions do not certify the continuity extension.
