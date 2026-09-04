# Bridge Runtime

Bridge runtime package inside the Clawket monorepo.

## Adapter Lifecycle Rule

When adding Hermes compatibility in bridge/runtime layers:

1. Keep active run/session lifecycle state inside the adapter, not in ad hoc request helpers.
2. `stop`, session reset, and session delete flows must be able to clean up active Hermes work deterministically.
3. Do not claim feature parity through UI flags unless the adapter semantics are actually stable.
4. Avoid unnecessary Hermes cold starts. If the bridge had to spawn a Hermes gateway process for local availability, prefer reusing that warm gateway across bridge/runtime restarts unless the user explicitly requested a Hermes restart.
5. Hermes relay runtime health must be verified with real bridge request/response probes, not only websocket open state or cloud room attachment checks. A long-lived Hermes bridge socket can become stale while still appearing connected.

## Hermes Model Switching Rule

For Hermes in this monorepo, model switching currently has a hard product boundary:

1. Clawket may implement Hermes model switching only inside the monorepo bridge/mobile layers unless the user explicitly approves Hermes source changes.
2. Treat Hermes model switching as `global` only. A switch updates Hermes config and affects future runs across the Hermes environment; do not present it as session-scoped or per-run scoped.
3. Do not build UI, cache, or chat state that assumes Hermes can safely keep different models per session at the same time through the current API server.
4. Any provider alias normalization for Hermes custom providers must live in shared bridge/runtime helpers, not in scattered UI conditionals or screen code.

## Test Boundary

1. `npm run test:required` is the self-contained CI suite and must not read Hermes from a developer home directory.
2. `npm run test:hermes-integration` exercises the runtime against the external read-only Hermes checkout at `/Users/lucy/.hermes/hermes-agent`.
3. `npm test` remains the broad local suite and includes both sets. Do not silently convert an external integration assertion into a stubbed unit assertion merely to make CI green.

## OpenClaw Bootstrap Compatibility Rule

1. Use the installed OpenClaw CLI's official setup-code issuer only when the requesting App advertises `openclaw.bootstrap.mobile-setup.v1`. Missing or unknown capability metadata must select the legacy bound-bootstrap issuer so old Apps remain compatible with new Bridges.
2. Once official setup is negotiated, fall back to the legacy bound-bootstrap file only when that CLI surface is unsupported, not when a modern issuer returns an operational error.
3. Relay control responses may add strategy metadata, but older Bridge/App combinations must continue to work when the field is absent.
4. Never include bootstrap or device-token values in runtime logs.
5. Changes to OpenClaw bootstrap handling must not alter Hermes adapters, relay infrastructure, or lifecycle behavior.
6. Pass the actual Gateway URL used by the Bridge to the OpenClaw setup-code issuer. A Relay transport URL is not an OpenClaw Gateway URL and must never be substituted for it.

## Connection Recovery Rule

1. Reset Relay reconnect backoff only after transport health is proven by pong, inbound traffic, or a stable window; do not let successful long-lived sessions accumulate failure delay forever.
2. Reset OpenClaw Gateway retry backoff only after a successful connect response, not on raw WebSocket open.
3. If an unexpected local OpenClaw Gateway close invalidates the active client session, notify Relay to force a client transport reconnect. Expected demand-driven closes must not trigger that signal.
4. Hermes keeps real local bridge request/response probes. Cloud bridge-status polling is a low-frequency safety check, not the primary five-second health mechanism.
