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

## Deployment Gate

Every Registry or Relay deploy runs the v1 compatibility replay gate first. A deployment is valid only when:

1. both backend configurations pass typecheck and tests
2. `tests/compat` passes without skipped cases
3. OpenClaw and Hermes Preview smoke tests pass against their isolated resources
4. account-bound IDs and secrets remain only in ignored local Wrangler files or Cloudflare secrets

Rollback one backend service independently if it regresses; never reuse the other backend's bindings as a shortcut.
