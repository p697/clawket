# Bridge Runtime

OpenClaw and Hermes runtime implementations for the Clawket Bridge. Keep backend identity separate from Relay transport state.

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
3. Encode Hermes image attachments as one OpenAI-style user message whose content contains the text part followed by `image_url` data-URL parts; keep the current user turn out of `conversation_history`. Reject malformed or unsupported input before starting a run.
4. `chat.abort` owns an `AbortController` for the matching `/v1/runs` request and emits one terminal raw `chat` event with `state: 'aborted'`; the App maps that state to `chatAborted`. Do not report success while leaving the run active.
5. Validate all `hermes.cron.jobs.create` parameters before invoking Hermes. Model selection remains global, never session-scoped.

## Python Resolution

Resolve the Hermes Python executable in this order:

1. Explicit `hermesPythonPath` runtime option.
2. `HERMES_PYTHON_PATH`.
3. `<hermesSourcePath>/.venv/bin/python`.
4. `<hermesSourcePath>/venv/bin/python`.
5. `<hermesHomePath>/venvs/hermes-dev/bin/python`.
6. `python3`.

Subprocesses set `HERMES_HOME` and prepend `hermesSourcePath` to `PYTHONPATH`. Do not mutate the external Hermes checkout.

## Test Boundary

1. `npm run test:required` is self-contained and must not inspect a developer home directory or external checkout.
2. Tests that inspect the external read-only Hermes checkout must use the `*.integration.test.ts` suffix. They may verify behavior but may not modify source, state, tests, or scripts outside this repository.
3. `npm test` is the broad suite and includes both self-contained and integration tests. Do not silently skip an external integration test or replace it with a stub to obtain a green run.
4. Keep tests beside the module they cover and add regressions for both OpenClaw and Hermes whenever shared Relay or frame behavior changes.
