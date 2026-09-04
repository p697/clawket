# Architecture

## Overview

This repository provides the relay control plane and realtime transport for Clawket remote connectivity.

High-level flow for either backend:

1. A gateway or bridge host registers with its backend-specific Registry instance and receives a principal ID, `relaySecret`, `relayUrl`, and a one-time `accessCode`.
2. A client claims that `accessCode` and receives a long-lived `clientToken`.
3. Both sides connect to the matching Relay instance over WebSocket using the shared principal ID.
4. The relay worker verifies pairing credentials and forwards messages between the connected client sockets and the gateway socket.

The relay transport is intentionally separate from billing or entitlement decisions. Pairing and relay auth depend only on pairing records.

## Components

### Registry Worker

Path: `apps/relay-registry`

Responsibilities:

1. Select the OpenClaw or Hermes contract through `RELAY_BACKEND` and issue matching pairing credentials.
2. Store pairing records in the backend's isolated Cloudflare KV namespace.
3. Verify `relaySecret` and `clientToken` values for relay auth.
4. Mint one-time `accessCode` values and long-lived client tokens.
5. Optionally push fresh client-token hashes into the target relay room for strong-consistency auth immediately after claim.
6. Enforce a persistent, per-IP registration limit before creating a pairing record.

Public HTTP routes:

1. `POST /v1/pair/register`
2. `POST /v1/pair/access-code`
3. `POST /v1/pair/claim`
4. `GET /v1/verify/:gatewayId`

Notes:

1. One-time pairing `accessCode` values are 6-character uppercase codes from `ABCDEFGHJKMNPQRSTVWXYZ23456789`.
2. Claim remains backward-compatible with older unclaimed 6-digit numeric access codes.
3. An unclaimed registration expires after 24 hours; a successful claim extends the record to 365 days.
4. Registration is limited to 10 attempts per source IP per hour. The raw IP address is hashed before selecting its dedicated limiter object and is never logged.

The same workspace serves the isolated Hermes Registry instance. Its public routes are:

Public HTTP routes:

1. `POST /v1/hermes/pair/register`
2. `POST /v1/hermes/pair/access-code`
3. `POST /v1/hermes/pair/claim`
4. `GET /v1/hermes/verify/:bridgeId`

### Relay Worker

Path: `apps/relay-worker`

Responsibilities:

1. Select the OpenClaw or Hermes contract through `RELAY_BACKEND` and route each principal to the backend's Durable Object class.
2. Accept both gateway and client WebSocket connections.
3. Forward application payloads bidirectionally.
4. Route relay control envelopes while preserving target-client delivery boundaries.
5. Persist room metadata needed for reconnect recovery, including mirrored client-token hashes and pending handshake state.
6. Reject unknown principals before creating a room and cache successful bounded existence checks for 60 seconds; misses remain uncached so a newly registered principal is not hidden by KV propagation.
7. Enforce an 8 MiB application-frame limit and advertise `relay.frame-limit.v2` in health and `relay.ready`.

WebSocket auth:

1. Legacy clients may still send the pairing token as query `token=`.
2. New clients may send `Authorization: Bearer <token>`.
3. Telemetry must not log tokens or user-correlatable identifiers.

The same workspace exports `RelayRoom` and `HermesRelayRoom`. Deployments bind only the class and KV namespace for their backend. Hermes uses a 30-second heartbeat and probes its Bridge only while clients are attached.

### Gateway Runtime

The gateway-side bridge runtime lives in this monorepo:

- `apps/bridge-cli`
- `packages/bridge-core`
- `packages/bridge-runtime`

## Public Contracts

### Pair Register

`POST /v1/pair/register`

Request body:

```json
{
  "displayName": "optional host label",
  "preferredRegion": "us",
  "gatewayVersion": "optional version string"
}
```

Response shape:

```json
{
  "gatewayId": "gw_...",
  "relaySecret": "grs_...",
  "relayUrl": "wss://relay.example.com/ws",
  "accessCode": "ABC234",
  "accessCodeExpiresAt": "2026-03-22T00:00:00.000Z",
  "displayName": "optional host label",
  "region": "us"
}
```

### Pair Access Code Refresh

`POST /v1/pair/access-code`

Request body:

```json
{
  "gatewayId": "gw_...",
  "relaySecret": "grs_...",
  "displayName": "optional updated host label"
}
```

### Pair Claim

`POST /v1/pair/claim`

Request body:

```json
{
  "gatewayId": "gw_...",
  "accessCode": "ABC234",
  "clientLabel": "optional client label"
}
```

Response shape:

```json
{
  "gatewayId": "gw_...",
  "relayUrl": "wss://relay.example.com/ws",
  "clientToken": "gct_...",
  "displayName": "optional host label",
  "region": "us"
}
```

### Pair Verify

`GET /v1/verify/:gatewayId`

Header:

```http
Authorization: Bearer <relaySecret-or-clientToken>
```

Response shape:

```json
{
  "ok": true,
  "role": "gateway"
}
```

### Hermes Pair Verify

`GET /v1/hermes/verify/:bridgeId`

Header:

```http
Authorization: Bearer <relaySecret-or-clientToken>
```

### Relay WebSocket

`GET /ws?gatewayId=<gatewayId>&role=gateway|client&clientId=<id>&token=<optional-legacy-token>`

Rules:

1. One gateway socket may own a room at a time.
2. Multiple client sockets may be connected to the same room.
3. Gateway-targeted control envelopes are delivered only to their declared `targetClientId`.
4. Offline replay of general gateway payloads is not part of the current transport contract.
5. The Registry pairing record must exist before Relay resolves the room ID; unknown principals receive `404 UNKNOWN_GATEWAY` without a Durable Object invocation.
6. A message larger than 8 MiB closes the sender with code `1009` and reason `frame_too_large`.

## Storage Model

### KV

`ROUTES_KV` stores:

1. Pairing records keyed by `pair-gateway:<gatewayId>`.
2. Relay auth source-of-truth data used by registry verification and relay fallback paths.

`HERMES_ROUTES_KV` stores:

1. Hermes pairing records keyed by `hermes-pair-bridge:<bridgeId>`.
2. Hermes relay auth source-of-truth data used only by the Hermes relay stack.

### Durable Object State

Each relay room stores only room-scoped transport metadata, for example:

1. Room identity metadata.
2. Mirrored client-token hashes.
3. Pending handshake artifacts with bounded lifetime.

Each Registry deployment also binds `PairRegisterRateLimiter`, sharded one object per hashed source IP. Its SQLite state preserves the fixed one-hour window across isolate eviction, and its alarm removes expired counter state.

## Privacy And Logging Constraints

Public deployments should keep these constraints intact:

1. Do not log pairing tokens, access codes, or full credentialed relay URLs.
2. Do not log raw chat payloads or user message content from relay transport paths.
3. Prefer event names, counts, booleans, and latency fields over user-correlatable identifiers.

## Deployment Boundaries

1. Registry and Relay are separate Worker services and may be deployed independently.
2. OpenClaw and Hermes use the same source workspaces but remain separate Worker services with independent KV, Durable Objects, credentials, logs, and rollback paths.
3. Production and Preview are isolated service environments for each backend.
4. All services must use resources in the operator's own Cloudflare account.
5. Checked-in Wrangler files use open-source-safe placeholders for account-bound bindings.
