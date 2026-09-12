# Bridge Runtime

OpenClaw, Hermes, and local-model runtime implementations for the Clawket Bridge. Keep backend identity separate from Relay transport state.

## Module Map

| Path | Responsibility |
|---|---|
| `src/protocol.ts` | Bridge control frames and connect metadata parsing |
| `src/frame-limit.ts` | Shared 8 MiB WebSocket frame boundary |
| `src/relay-session.ts` | Backend-neutral Relay connection attempts, health evidence, heartbeat timeout, and reconnect backoff state |
| `src/openclaw.ts` | Installed OpenClaw discovery, credentials, setup-code, permissions, and diagnostics |
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

## Protocol Boundaries

1. Advertise `bridge.capabilities.v2` and `hermes.multi-session.v2` only while their complete behavior is implemented. Hermes handshake and health surfaces must agree; missing capability metadata keeps v1 behavior.
2. OpenClaw's closed RequestFrame schema does not accept top-level `meta`. Consume and remove Bridge-owned connect metadata before the Gateway leg, and advertise Bridge capabilities only on the matching negotiated success response.
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
