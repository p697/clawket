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
