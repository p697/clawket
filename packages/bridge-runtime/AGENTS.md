# Bridge Runtime

OpenClaw, Hermes, and local-model runtime implementations for the Clawket Bridge. Keep backend identity separate from Relay transport state.

## Module Map

| Path | Responsibility |
|---|---|
| `src/protocol.ts` | Bridge control frames and connect metadata parsing |
| `src/frame-limit.ts` | Shared 8 MiB WebSocket frame boundary |
| `src/relay-session.ts` | Backend-neutral Relay connection attempts, health evidence, heartbeat timeout, and reconnect backoff state |
| `src/openclaw.ts` | Installed OpenClaw discovery, credentials, setup-code, permissions, and diagnostics |
| `src/openclaw/skill-documents.ts` | Scoped OpenClaw SKILL.md read/write compatibility for authenticated local Gateway client channels |
| `src/openclaw/runtime.ts` | OpenClaw `BridgeRuntime`, on-demand Gateway lifecycle, and Bridge-owned connect metadata termination |
| `src/hermes/index.ts` | `HermesLocalBridge` assembly, lifecycle, and request dispatch |
| `src/hermes/http-server.ts` | Local Hermes HTTP/WebSocket server, authentication, health, and connection handling |
| `src/hermes/session-store.ts` | Bridge-owned session metadata and session-ID rotation |
| `src/hermes/native-sessions.ts` | Read-only native SessionDB listing/history and history cursors |
| `src/hermes/usage-ledger.ts` | Clawket usage/cost ledger plus read-only native usage reconciliation |
| `src/hermes/commands.ts` | Global `/model`, `/thinking`, `/reasoning`, and `/fast` behavior |
| `src/hermes/cron.ts` | Hermes cron validation and command mapping |
| `src/hermes/management.ts` | Hermes skills and other management surfaces |
| `src/hermes/stream-mapping.ts` | Image input, `/v1/runs` streaming, protocol events, and active-run cancellation |
| `src/hermes/python-runner.ts` | Hermes Python resolution and isolated subprocess execution |
| `src/hermes/relay.ts` | Hermes Relay transport, probes, reconnect, and runtime health |
| `src/hermes/internal.ts` | Hermes-only constants, normalizers, and module composition helpers |

Keep each Hermes implementation file and each Hermes test file at or below 1,200 lines. Split by responsibility; do not compress formatting or merge tests to meet the limit.

## Session and Storage Boundaries

1. Open native SQLite databases with URI `mode=ro` and `PRAGMA query_only = ON`. Native sessions are read-only: do not rename, reset, delete, shadow, or tombstone them.
2. A native read failure degrades to Bridge-owned sessions and returns a warning; it must not make the Bridge unavailable.
3. Persist only Bridge-owned session metadata. Do not copy native transcripts into the Clawket store. Reset cancels active work and rotates the Bridge session ID instead of mutating a native record.
4. Stop, reset, and delete must deterministically release active runs and session resources owned by Clawket.
5. Hermes session listings expose additive `lastActivityAt` (null for no human message), paired with the last user or textual assistant preview. Rename/reset metadata and tool/system messages must not advance it. Preserve legacy `updatedAt`; native reads remain read-only and transcript-free in persisted Clawket metadata. Mobile consumers on older Bridges retain their legacy fallback.
6. Preserve Hermes message deltas byte-for-byte, including whitespace-only tokens, newlines and indentation. Identifier normalizers that trim strings must never process streamed text; active history and final text must concatenate the same deltas.

## Protocol Boundaries

1. Advertise `bridge.capabilities.v2` and `hermes.multi-session.v2` only while their complete behavior is implemented. Hermes handshake and health surfaces must agree; missing capability metadata keeps v1 behavior.
2. OpenClaw's closed RequestFrame schema does not accept top-level `meta`. New Apps request Bridge capabilities through the existing `connect.params.caps` array so old Bridges remain usable. Accept that array and the pre-release top-level metadata format; consume/remove the latter before the Gateway leg. Advertise Bridge capabilities only on the matching negotiated success response.
3. `bridgeVersion` means the running Clawket CLI package version. Normalize it before publication, include it only on a negotiated successful OpenClaw connect response or a Hermes health surface, and omit it for blank/invalid values and legacy peers. Never forward a Gateway-supplied `bridgeVersion` or infer it from the Gateway's `server.version`.
4. Encode Hermes image attachments as one OpenAI-style user message whose content contains the text part followed by `image_url` data-URL parts; keep the current user turn out of `conversation_history`. Reject malformed or unsupported input before starting a run.
5. `chat.abort` owns an `AbortController` for the matching `/v1/runs` request and emits one terminal raw `chat` event with `state: 'aborted'`; the App maps that state to `chatAborted`. Do not report success while leaving the run active.
6. Model flag parsing accepts both the legacy three-field and newer five-field Hermes tuples; consume only the needed fields and preserve global scope. Python subprocess failures must not put command scripts or payloads into client error messages.
7. Validate all `hermes.cron.jobs.create` parameters before invoking Hermes. Model selection remains global, never session-scoped.
8. OpenClaw diagnostics accept legacy `checks` and current `findings` reports, including nonzero CLI exits. Preserve finding severity and repair hints; never discard an unrecognized report into an empty issue list.

## Python Resolution

Resolve the Hermes Python executable in this order:

1. Explicit `hermesPythonPath` runtime option.
2. `HERMES_PYTHON_PATH`.
3. `<hermesSourcePath>/.venv/bin/python`.
4. `<hermesSourcePath>/venv/bin/python`.
5. `<hermesHomePath>/venvs/hermes-dev/bin/python`.
6. `python` on Windows, `python3` on POSIX.

Windows virtual environments use `Scripts/python.exe` in the same candidate order.

The shared Hermes Python runner must yield the Node event loop, bound duration/concurrency, cancel owned children on stop, and keep errors credential-free. Serialize whole configuration mutations while health bypasses their queue; cancellation during asynchronous history preparation or terminal hydration must not start work or restore stale replies. Skills helpers support both the legacy tools module and current split agent utilities through the shared compatibility preamble.

Subprocesses set `HERMES_HOME` and prepend `hermesSourcePath` to `PYTHONPATH`. Do not mutate the external Hermes checkout.

Installation discovery honors explicit runtime options and `HERMES_SOURCE_PATH` / `HERMES_COMMAND`. Otherwise prefer the current official `~/.local/share/hermes-agent` checkout, retain the legacy `~/.hermes/hermes-agent` fallback, and find the executable on PATH or at `~/.local/bin/hermes`. CLI detection and runtime discovery share this resolver.

The managed Hermes API uses an explicit API key when supplied, otherwise a deterministic SHA-256 derivation of the persisted Bridge token, API URL and Hermes home scope. Pass it to the owned gateway as `API_SERVER_KEY`; never print it. Readiness probes use authenticated `/v1/models`, not the public health endpoint. An already-running API returning 401/403 must report a credential mismatch and must not trigger an automatic replacement. Handle child spawn errors without crashing the Bridge.

Hermes Relay checks cloud socket reachability with matched WebSocket ping/pong independently of local Bridge health. Recycle half-open cloud sockets and clear probe deadlines on stop/replacement; transport pong must not mark the backend ready or reset backend handshake backoff. Ignore frames from replaced cloud sockets.

An explicit current-owner replacement (`4010/duplicate_socket` or `4001/replaced_by_new_bridge`) yields the Hermes Relay runtime until an explicit restart; otherwise two runtimes sharing persisted pairing identity can evict each other forever. Close local transport and cancel probes/retries, report the replacement, and keep ordinary network/dead/orphan-socket recovery. A late replacement event from an already retired socket must not stop its successor.

Ignore late frames from replaced local Bridge sockets too. Cloud status probes are abortable, bounded to 10 seconds and owned by the requesting socket; stop/replacement cancels them. Only an explicit `hasBridge: false` from the current probe may recycle Relay, never a late result or malformed status payload.

Only an explicit validated Relay client-count of zero may suppress local periodic `tick`/`health` events on the cloud leg. Preserve real messages, responses, local probes and Relay ping/pong. Reset presence to unknown on every new cloud socket so old servers and reconnects keep forwarding safely.

## Test Boundary

1. `npm run test:required` is self-contained and must not inspect a developer home directory or external checkout.
2. Tests that inspect the external read-only Hermes checkout must use the `*.integration.test.ts` suffix. They may verify behavior but may not modify source, state, tests, or scripts outside this repository.
3. `npm test` is the broad suite and includes both self-contained and integration tests. Do not silently skip an external integration test or replace it with a stub to obtain a green run.
4. Keep tests beside the module they cover and add regressions for both OpenClaw and Hermes whenever shared Relay or frame behavior changes.
5. Export only runtime contracts consumed outside their implementation module. Keep implementation-only helpers and record shapes private so the published surface does not grow accidentally.

## OpenClaw handshake recovery

A forwarded challenge with client demand but no connect request has an 8-second watchdog. Suspend it during bootstrap credential issuance and cancel it on connect, disconnect, replacement, or stop. On expiry recycle the Relay owner transport so legacy cloud routing also resets; preserve reconnect backoff until authenticated health. Ignore events from replaced sockets. Log only stage, stable failure code and durations; never log challenge nonces or credentials.

Managed CLI runtimes opt into `bridge.client-sockets.v1`. With a supporting Relay, each authenticated client socket gets a child runtime with its own local Gateway handshake; the owner only coordinates lifecycle and restricted pairing. Retire children on socket incarnation removal, owner loss, or stop. Never reuse an authenticated Gateway socket for another client. Legacy runtime consumers and older Relays retain the v1 path.

In negotiated client-channel mode, pairing approve/reject must target a live child owning the request. If that child has gone, return an unavailable-request error; never fall back to the owner's unhandshaken Gateway. Legacy mode keeps its existing routing.

## Local model runtime

`src/local-model/` implements OpenAI-compatible streaming, one durable main conversation, live vision probing and the isolated Preview Relay owner. Persist before acknowledgement, reject conflicting idempotency keys, cancel the actual upstream request, and never replay interrupted runs. Model selection is global and excludes in-flight generation. Do not advertise Agent tools. See `../../docs/3.0/15-local-model.md`.

Local-model health probes must not cold-load an unloaded llama.cpp router preset. Explicit selection owns the longer model-load timeout; ordinary probes fail with an actionable message.

Local-model Relay must bound application readiness after every WebSocket upgrade, retain backoff until authenticated `relay.ready`, ignore replaced socket callbacks, and clear all reconnect/readiness/heartbeat timers on stop. Diagnostic output is limited to fixed event names, stable error codes, retry counts and durations; never include close reason text or authentication URLs.

## Relay network configuration

`CLAWKET_RELAY_PROXY_URL` explicitly enables HTTP(S) CONNECT for cloud Relay sockets across all three Bridge runtimes. Never apply it to local Gateway/model sockets or infer a proxy from unrelated environment variables. Validate once during runtime construction, redact invalid values, and bound the Relay handshake to 15 seconds.

OpenClaw Relay heartbeat expiry logs bounded idle/timeout/scheduler-delay durations and queued-frame count without payloads. A pong from a retired socket must not refresh the current watchdog or reset backoff. These diagnostics do not add cloud requests or relax expiry.

An OpenClaw secondary channel upgrade rejected with HTTP 409 refers to an unavailable client incarnation. Retire that child instead of retrying the same diagnostic ID; fresh owner `client.sockets` IDs create new children. Owner upgrade failures and transient non-409 failures retain bounded reconnect backoff. The incident log showed five futile 409 retries after the 13:36 UTC challenge watchdog; no retry is necessary for an identity the Relay has retired.

## Managed Hermes API recovery

An explicit user stop must POST to the scoped Hermes `/v1/runs/{run_id}/stop` before ending its local event stream. Bound the request; unsupported or failed upstream stop must remain visible and must not falsely report cancellation. An accepted stop request is not proof all tool processes have exited.

After an API child owned by the current runtime exits, health checks may restart it with a 30-second initial cooldown and exponential backoff capped at five minutes. Coalesce health refreshes; guard asynchronous completions against stop. Never replace a live child, a warm externally owned API, or an API rejecting credentials. Recovery is local and must not create additional Relay probes.

Hermes `/v1/runs` timestamps and durations use seconds; convert them to the millisecond protocol once at the stream boundary. Native tool IDs alias to live Bridge IDs during history reconciliation, including still-running calls when name, complete arguments and timestamp match uniquely; never guess between ambiguous calls. Persist only bounded identity metadata (512 aliases per session), validate on load and clear on reset; do not persist duplicate transcript content. Never emit a second tool row solely because native persistence used another ID, including after a Bridge restart.

Hermes history includes session-scoped `hasActiveRun` and the existing `inFlightRun` snapshot (run ID, partial text, start time, abortability). Read live ownership after asynchronous history/model reads so a finished or cancelled run cannot be resurrected. Keep these snapshots in memory; they add no polling or persisted transcript copy.

Hermes history may include additive `toolCallAliases` (native ID to live ID) from the bounded confirmed alias store, restricted to tools represented on that page. This lets newer clients reconcile older cached identities; older clients may ignore the field. Never infer aliases from truncated previews.

## OpenClaw skill documents

Legacy bootstrap issuance must inspect native credential storage read-only. If SQLite owns `device_bootstrap_tokens`, return the existing bootstrap error so old Apps can use their QR token/password and normal device approval; never write unused JSON credentials or modify SQLite. Keep official mobile setup and JSON-only hosts unchanged. Load the prefix-only `node:sqlite` builtin lazily through `createRequire` so the Node 20-targeted CLI bundle preserves its name.

Only negotiated isolated full-client channels to a loopback Gateway may supply missing `skills.get` / `skills.content.update` methods in the successful handshake's `features.methods`. Preserve native methods and leave remote/legacy forwarding unchanged. Each operation resolves the key through that same authenticated socket's Agent-scoped `skills.status`; never trust client paths or another session's report. Read permission is mandatory; writes additionally require operator.admin and a nonbundled workspace/managed skill. Only the default SKILL.md is writable. Auxiliary scripts/references are read-only, resolved beneath the same authenticated skill directory; reject hidden/unlisted paths, traversal and symlink components. Listing is bounded to 512 visited entries and five directory levels; validate the opened inode again before returning content. Bound documents to 1 MiB and four in-flight status lookups with ten-second deadlines; reject symlinks, hardlinks, non-files, invalid UTF-8 and binary content. Preserve exact source, replace writes atomically, redact filesystem errors, and dispose pending work on challenge, replacement, disconnect or stop. No cloud or Hermes source changes are required.

Close the read descriptor before atomically replacing a skill document so Windows can rename the temporary file. Keep descriptor inspection inside its cleanup guard and revalidate the source inode before replacement.

## Hermes mobile workflows

Native skill installation uses the installed Hermes Hub with an explicit source and owner, retains its security scan, never forces overwrite, and verifies the installed status before returning success. Do not modify the external checkout. `run-control.ts` negotiates `/v1/capabilities` and restricts steering to the exact Bridge-owned active run and session; do not fall back to a new run or replay an uncertain request. Every health/handshake surface must publish the same negotiated capabilities.

Serialize native skill installation and reject existing Hub records or target directories, including manual installs. Advertise installation only with the native target-validation hook. A subprocess-local compatibility shim qualifies only the exact ClawHub resource/download requests with the requested owner; require matching returned owner metadata and verify the installed directory rather than its display name. Preserve native quarantine/scanning and never treat an older lock entry as a successful new install.

Skill source read/write payloads preserve every character, including leading/trailing whitespace and final newlines. Identifier trimming helpers must never normalize document content; otherwise version restore and conflict checks falsely reject the App's own saves.

Resolve Hermes Hub provenance by the contained install path, not a display name. Hub removals must use the native Hub uninstaller so its registry and audit remain consistent; manual skills retain native skill-manager deletion. Reject malformed, escaped or ambiguous registries before deletion, preserve native refusals, and never report an unknown deletion result as success.

Hermes documents require a positively detected native extractor. Bound count, decoded bytes, expanded Office archives and extracted text; never install converters during a request. Preserve the same enriched user content across native/local history for deduplication, while the App renders compact attachment names. Exact-run approvals require negotiated native support and a pending request ID; only acknowledge a decision after the matching native response. Retain unsuccessful requests, expire on run termination, and never resolve every request implicitly. Return accepted-but-unused steering as draft recovery, never replay it automatically.

Image sends retain only an in-memory image count beside clean local text. For history matching, project the native one-marker-per-image representation and keep the existing one-to-one boundary/time matching; never strip literal markers from user prose, merge repeated sends, or persist image bytes/native transcripts in the Bridge store.

## Native Hermes model health

Advertise `hermes.model-health.v1` only after the native configuration/auth/doctor modules import successfully. `model.health` returns bounded provider credential states and optional native doctor probe results, never keys, endpoint details or raw exception text. Reading does not probe; explicit probes are coalesced and rate limited. Keep the operation inside Clawket-owned code and do not modify Hermes source or configuration.

Hermes approvals use a null deadline when native events omit it; never fabricate a timeout. Native `approval_not_pending` / `approval_not_active` retires the exact request, while transport errors retain it. Cron local-only delivery is native `local`, not the client protocol's `none`; normalize legacy writes and repair that exact legacy value before an explicitly requested run. Native processed/skipped/blocked results and output headers are distinct from successful Agent execution; malformed outcomes fail closed and unknown output formats stay unknown.

Native Cron output reads are confined to regular, bounded UTF-8 files under one validated job directory; reject traversal, symlinks and hardlinks. `hermes.cron-model.v1` requires native signature support for model/provider pins; clear pins explicitly and never change the global chat model. Native history exposes stable session-scoped message IDs. A native `stopping` response is only an acknowledgement: preserve the stream/active run and publish cancellation only after a confirmed terminal state or event.

After an event stream ends or fails, poll the exact native run status with abortable, bounded requests and capped backoff. Preserve active ownership until a confirmed terminal status; partial text and completed tools are never completion evidence. Stop/reset/runtime disposal must cancel recovery waits.

Native tool history must preserve structured failures, including nonzero exit codes and interrupted/cancelled results. Never hardcode persisted tool results to success or infer failure from ordinary prose containing error words.

When a native run event stream disconnects, exact-run status polling also recovers `waiting_for_approval` requests. Require matching run IDs in both envelopes, retain resolved-request tombstones for that active run, and never revive acknowledged consent from a stale snapshot. This does not claim process-restart recovery of unowned native runs.

When the installed native run handler positively supports session-history resume and the matching native session has history, omit explicit `conversation_history`: Hermes stringifies that legacy field and loses structured tool IDs. Preserve the old request for unverified versions and locally seeded sessions. Recover only the exact bounded legacy Bridge tool-call repr during read-only history projection; never mutate the native database or evaluate arbitrary text.

## On-demand session files

`clawket.files.list/read` offers bounded assistant-referenced files from the same session under verified local workspaces (Hermes: configured local terminal cwd and outputs). Keep opaque expiring handles, per-session scope, regular-file/size/type checks, and mutation detection on every chunk. Never accept a caller-provided filesystem path, spool file bytes, or add cloud storage. OpenClaw exposes this only on authenticated isolated loopback Gateway channels with native history/workspace read capability. Dispose handles on channel shutdown; Hermes clears them on reset/delete/stop.

## Pi RPC runtime

`src/pi/` owns independent Pi RPC processes and private sessions for an explicitly configured project. Preserve the installed Pi's configuration and trust; never add automatic approval flags. Native JSONL v3 sessions (including an explicit native session directory) are read-only and can only be copied into a private branch. Remote requests use opaque session IDs, never filesystem paths or arbitrary RPC commands. Ordinary extension questions are not execution approvals.

Persist input fingerprints before acknowledging, serialize session mutations, never replay uncertain prompts, and keep Pi stdin open across phone disconnections. `agent_settled` is terminal; `agent_end` is not. Stop releases only owned children. Real-Pi tests are explicit integration tests and use isolated credentials/state plus a deterministic local model endpoint; required CI tests do not require Pi or inspect user home state.

Pi’s landing record must publish `kind: main` together with the Agent’s `mainSessionKey`; additional private/native sessions remain `direct`. Free main-chat access must not depend on a paid history entitlement.

Pi reset rotates private storage and clears transcript preview/activity and stale model metadata while preserving acceptance fingerprints; old network retries must never repopulate the reset conversation.

While an accepted Pi extension command is waiting before `agent_start`, history projects its in-memory input after completed native entries so phone recovery anchors the pending run to the current turn. Retire that projection on agent start or settlement; never write synthetic commands into native Pi JSONL.

Pi Relay owner-lease conflicts (HTTP 409) retry every two seconds within the startup readiness deadline; other failures retain exponential backoff. Only `relay.ready` resets recovery state, and retired socket events cannot affect the replacement.

## Claude Code Agent SDK

`src/claude-code/` implements the independent Claude Code runtime using the official SDK and an explicitly selected installed CLI. Native discovery/history is read-only; opaque mappings and acceptance fingerprints may be stored, transcripts and Claude credentials may not. Live ownership includes idle owners and unknown states fail closed. Keep native consent and question identities, respect abort signals, and declare only supported dialogs. See `../../docs/3.1/claude-code.md`; do not change another backend's process or native ownership protocol.

Model choices retain native aliases and optional resolved IDs. Exclude exact native model-switch and interruption envelopes from human chat history without stripping ordinary text discussing commands.

## Codex App Server

`src/codex/` owns one stdio App Server per pairing configuration. Device pairing selects per-thread cwd from saved projects/native thread metadata; legacy project pairing retains its single cwd. Native thread history remains in Codex storage; only private metadata and prompt fingerprints belong to Clawket. Keep remote methods allowlisted and project IDs opaque. Use exact native turn IDs for steering, stopping and approvals. Never equate a stop acknowledgement or missing RPC response with completion. Preserve pending consent while the phone disconnects, retire it on authoritative resolution, and refuse unsupported interactions. Default to project sandboxing and one-time consent; never enable bypass flags or terminate another Codex client.

Never resume a Codex thread that has never submitted a turn after App Server restart: empty native rollouts are not durable. Recreate only that empty case, preserving chosen model; accepted or uncertain inputs retain their original native identity. Native reasoning selection changes session configuration without generating a slash-command prompt.

Codex preserves the selected native reasoning level across owned-process restart. Never rename/archive an unmaterialized native thread solely because its ephemeral ID was indexed; retain the local title until a real thread is available.

Codex model selectors query the configured executable's native `model/list` on every request, consume bounded pagination and retain native picker visibility. Do not inject model names or use another installation's cache as a catalog. Supported desktop-bundled executables may have SemVer prerelease/build suffixes; version recognition is not a substitute for protocol readiness or integration tests. Never silently replace the user's selected executable to obtain more models.

Codex Relay owner-lease conflicts do not increment network-failure backoff. Bound readiness separately from socket-open and allow a lease expiry plus transient handshake failure; keep the CLI parent's startup deadline longer than Relay readiness.

Codex device continuity uses versioned local Desktop IPC with bounded frames and snapshots. Follow only requested conversations; reject foreign hosts, invalid patches and unknown revisions. Preserve canonical turn IDs and the start-turn result envelope. Never retry an uncertain write through another owner. Native metadata stays read-only; original-thread continuation is distinct from branching. Group user-input fields by their original IDs, preserve options/custom input, and keep cancellation pending until native termination. Phone dismissal is never an answer. Only the exact pending command/file/permission request can be answered; unsupported or secret interactions fail closed.

Codex does not create a landing record at startup. Advertise `entryMode: sessions` with an empty `mainSessionKey`; all owned records, including former landing records, are ordinary deletable conversations. Preserve existing IDs/history. A sessionless model list reads the native catalog without creating or selecting a thread; model mutation requires an explicit session.

Claude device discovery supplements native session directories with bounded, read-only project keys from the standard `~/.claude.json`; never expose configuration values or use this fallback across a custom `CLAUDE_CONFIG_DIR`. Explicit project pairings do not read the global project registry.
