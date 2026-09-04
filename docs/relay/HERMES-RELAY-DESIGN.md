# Hermes Relay Design

## Goal

Run OpenClaw and Hermes relay infrastructure from the same implementation while preserving separate public services, storage, room classes, credentials, and rollback boundaries.

Backend identity and transport identity remain separate:

- `backendKind` is `openclaw` or `hermes`.
- Relay is one possible transport for either backend.
- Preview is a service environment, not a backend or transport kind.

## One Codebase, Isolated Instances

Both backends are implemented by these workspaces:

1. `apps/relay-registry`
2. `apps/relay-worker`

`RELAY_BACKEND=openclaw|hermes` selects a centralized backend policy. Four isolated service pairs are deployed from those two workspaces:

| Environment | Registry | Relay | Backend |
|---|---|---|---|
| OpenClaw Production | `clawket-registry` | `clawket-relay` | `openclaw` |
| OpenClaw Preview | `clawket-registry-preview` | `clawket-relay-preview` | `openclaw` |
| Hermes Production | `clawket-hermes-registry` | `clawket-hermes-relay` | `hermes` |
| Hermes Preview | `clawket-hermes-registry-preview` | `clawket-hermes-relay-preview` | `hermes` |

Code reuse must never collapse the deployment boundary. Each pair keeps its own KV namespace, Durable Object namespace, pairing credentials, service names, and local pairing files.

## Compatibility Contract

OpenClaw keeps:

1. `/v1/pair/*` and `/v1/verify/:gatewayId`
2. `gatewayId` and the `gw_`, `grs_`, and `gct_` prefixes
3. `pair-gateway:<gatewayId>` KV keys
4. `ROOM` and the `RelayRoom` Durable Object class
5. `~/.clawket/pairing.json`

Hermes keeps:

1. `/v1/hermes/pair/*` and `/v1/hermes/verify/:bridgeId`
2. `bridgeId` and the `hbg_`, `hrs_`, and `hct_` prefixes
3. `hermes-pair-bridge:<bridgeId>` KV keys
4. `HERMES_ROOM` and the `HermesRelayRoom` Durable Object class
5. `~/.clawket/hermes-relay.json`

The historical wire role for the Hermes owner remains `gateway`; backend semantics still identify it as a bridge.

## Shared Policy Boundary

The backend policy owns every intentional difference, including:

1. identity parameter names and ID prefixes
2. KV binding names and key codecs
3. pair, verify, and internal route prefixes
4. Durable Object binding and room naming
5. owner replacement reasons and watchdog behavior
6. telemetry scope and safe identity-field names

Backend-specific lifecycle behavior stays in small class overrides when a policy value cannot express it cleanly. New call sites must not scatter `backend === 'hermes'` checks.

## Public API

Hermes Registry routes:

1. `POST /v1/hermes/pair/register`
2. `POST /v1/hermes/pair/access-code`
3. `POST /v1/hermes/pair/claim`
4. `GET /v1/hermes/verify/:bridgeId`

Hermes Relay routes:

1. `GET /v1/health`
2. `POST /v1/internal/hermes/pairing/client-tokens`
3. `GET /v1/internal/hermes/bridge-status`
4. `GET /ws?bridgeId=<bridgeId>&role=gateway|client...`

The `/ws` path is shared only at source level. Service isolation and the query contract keep backend traffic separate.

## Security And Liveness

Both deployments enforce the same safety envelope:

1. Registry registration is limited to 10 attempts per source IP per hour without storing or logging the raw address.
2. Unclaimed pairing records expire after 24 hours; a successful claim restores the 365-day record lifetime.
3. Relay verifies the pairing record exists before resolving a Durable Object room.
4. WebSocket application frames are limited to 8 MiB and oversize peers close with code `1009` and reason `frame_too_large`.
5. `/v1/health` and `relay.ready` advertise `relay.frame-limit.v2`.
6. Client pong expiry applies only to clients that advertise `relay.client-pong.v1`.

Hermes uses a 30-second heartbeat and probes its Bridge only while at least one client is attached. The Bridge runtime keeps its independent request/response health probe; a WebSocket `open` event alone is not healthy evidence.

## Bridge And Mobile Boundaries

Hermes relay state remains separate from OpenClaw pairing state. Mobile stores Hermes relay connections as `backendKind: 'hermes'` plus `transportKind: 'relay'`; it does not introduce a Hermes transport mode.

The shared `pair` command may continue to choose Hermes local pairing by default until the Hermes relay product path is explicitly enabled. The explicit Hermes relay commands and Preview smoke tests remain available for infrastructure validation.

## Local Bridge Contract

The local Hermes Bridge owns Clawket's WebSocket protocol, capability negotiation, logical-session metadata, active run controllers, and translation to Hermes HTTP APIs. It may use supported Hermes APIs and tools for requested operations, but native Hermes session storage is a read-only data source. Relay transports frames and does not take ownership of these semantics.

### Readiness and capabilities

- `GET /v1/hermes/health` performs a bounded request/response probe of the local Hermes API. A listening HTTP or WebSocket socket alone is not healthy evidence.
- The health response includes `capabilities: ['bridge.capabilities.v2', 'hermes.multi-session.v2']` only when the Bridge implements this complete contract.
- After `/v1/hermes/ws` is accepted, the first application frame is the existing `health` event and carries the same capability array. This lets direct and Relay-backed clients apply the same negotiation rule before issuing session operations.
- A client enables Hermes multi-session operations only when the exact `hermes.multi-session.v2` value is present. Missing, malformed, or unknown capability metadata falls back to the single `main` session and marks the Bridge as outdated; capabilities are never inferred.

### Session ownership

| Source | Authority | Mutability through Clawket |
|---|---|---|
| `bridge` | Clawket persists the logical key, backing `sessionId`, title, and update time in its own state. | Create, rename, reset, and delete are allowed. |
| `native` | Hermes remains authoritative; Bridge reads its SessionDB or documented session files in read-only mode. | All `allowedActions` are false. |

`sessions.list` merges these views without copying native rows into Bridge state. It must not create native shadow records or tombstones, and `sessions.patch`, `sessions.reset`, and `sessions.delete` must reject native targets rather than modifying Hermes storage. A native read failure degrades to Bridge-owned sessions and is returned in the list-level `warnings` array.

A Bridge reset preserves the logical key and title but cancels its active runs, clears its visible history, and assigns a fresh backing `sessionId`. Rotation is mandatory: reusing the old ID would let Hermes continue the supposedly reset context. Existing cursors are consequently invalid after reset. Delete cancels active runs and removes only Bridge-owned metadata; it does not delete a native Hermes row.

### Session and run methods

| Method | Contract |
|---|---|
| `sessions.list` | `{ limit? }` returns newest-first descriptors with `key`, `sessionId`, `title`, `kind`, `updatedAt`, preview, `hasActiveRun`, `source`, and `allowedActions`, plus read warnings. |
| `sessions.create` | `{ title? }` creates a Bridge-owned logical session with a fresh private backing `sessionId`. |
| `sessions.patch` | `{ key, title }` requires a non-empty title and renames only a Bridge-owned session. |
| `sessions.reset` / `sessions.delete` | `{ key }` applies only to a Bridge-owned session and follows the rotation/deletion rules above. |
| `chat.history` | `{ sessionKey, limit?, cursor? }` returns chronological messages and `nextCursor` only while older messages remain. The cursor is opaque and bound to the backing `sessionId`; malformed, cross-session, and post-reset cursors are rejected. |
| `chat.abort` | `{ sessionKey, runId? }` aborts the matching active event-stream `fetch` through its `AbortController`; without `runId`, it aborts active runs for that session. It replies `{ ok: true }` and emits one terminal `chat` event with `state: 'aborted'`, which the App exposes as `chatAborted`. |

Aborting the event stream does not claim that the upstream Hermes engine cancelled work; an additive response field may report that distinction. Controllers must be removed on success, error, or abort, and a supplied `runId` must not cancel a run owned by another session.

### Attachments

`chat.send` keeps its existing text-only `/v1/runs` input when `attachments` is absent. When present, `attachments` must be an array of image entries with an image MIME type and valid base64 `content`; malformed, non-image, and unsupported entries are rejected rather than silently dropped. The Bridge translates one or more images into the Hermes message wrapper:

```json
{"input":[{"role":"user","content":[{"type":"text","text":"..."},{"type":"image_url","image_url":{"url":"data:image/png;base64,..."}}]}]}
```

The current user turn appears only in `input`; `conversation_history` contains prior turns, and `session_id` is the current backing ID. This wrapper is required by Hermes's message-list parser; a bare content-parts array is not equivalent. The shared 8 MiB application-frame limit still applies.

### Cron creation

`hermes.cron.jobs.create` is global, not session-scoped. It requires non-empty string `name` and `schedule`, plus at least one execution source: either a non-empty `prompt` or one or more `skills`; a skills-only job is valid. When supplied, `skills` must be an array whose entries are non-empty strings; an empty array is valid when `prompt` is present. `repeat` must be null or a positive integer, and `startAt` must be null or a valid ISO timestamp. Optional `deliver`, `script`, and `scheduleDisplay` remain strings when supplied. Invalid input is rejected before invoking the Hermes cron tool; semantic schedule parsing remains Hermes-owned. A successful response returns the persisted job and fails closed if Hermes supplies no job ID or the job cannot be read back.

## Deployment Gate

Every Registry or Relay deploy runs the v1 compatibility replay gate first. A deployment is valid only when:

1. both backend configurations pass typecheck and tests
2. `tests/compat` passes without skipped cases
3. OpenClaw and Hermes Preview smoke tests pass against their isolated resources
4. account-bound IDs and secrets remain only in ignored local Wrangler files or Cloudflare secrets

Rollback one backend service independently if it regresses; never reuse the other backend's bindings as a shortcut.
