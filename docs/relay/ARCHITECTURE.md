# Architecture

## Overview

This repository provides the relay control plane and realtime transport for Clawket remote connectivity.

High-level flow:

1. A gateway host registers with the registry worker and receives `gatewayId`, `relaySecret`, `relayUrl`, and a one-time `accessCode`.
2. A client claims that `accessCode` and receives a long-lived `clientToken`.
3. Both sides connect to the relay worker over WebSocket using the shared `gatewayId`.
4. The relay worker verifies pairing credentials and forwards messages between the connected client sockets and the gateway socket.

The relay transport is intentionally separate from billing or entitlement decisions. Pairing and relay auth depend only on pairing records.

## Components

### Registry Worker

Path: `apps/relay-registry`

Responsibilities:

1. Issue pairing credentials.
2. Store pairing records in Cloudflare KV under `pair-gateway:<gatewayId>`.
3. Verify `relaySecret` and `clientToken` values for relay auth.
4. Mint one-time `accessCode` values and long-lived client tokens.
5. Optionally push fresh client-token hashes into the target relay room for strong-consistency auth immediately after claim.

Public HTTP routes:

1. `POST /v1/pair/register`
2. `POST /v1/pair/access-code`
3. `POST /v1/pair/claim`
4. `GET /v1/verify/:gatewayId`

Notes:

1. One-time pairing `accessCode` values are 6-character uppercase codes from `ABCDEFGHJKMNPQRSTVWXYZ23456789`.
2. Claim remains backward-compatible with older unclaimed 6-digit numeric access codes.

### Hermes Registry Worker

Path: `apps/hermes-relay-registry`

Responsibilities:

1. Issue Hermes relay pairing credentials.
2. Store Hermes pairing records in Cloudflare KV under `hermes-pair-bridge:<bridgeId>`.
3. Verify Hermes `relaySecret` and `clientToken` values for relay auth.
4. Keep Hermes rollout isolated from OpenClaw registry APIs and storage.

Public HTTP routes:

1. `POST /v1/hermes/pair/register`
2. `POST /v1/hermes/pair/access-code`
3. `POST /v1/hermes/pair/claim`
4. `GET /v1/hermes/verify/:bridgeId`

### Relay Worker

Path: `apps/relay-worker`

Responsibilities:

1. Route each `gatewayId` to a Durable Object room.
2. Accept both gateway and client WebSocket connections.
3. Forward application payloads bidirectionally.
4. Route relay control envelopes while preserving target-client delivery boundaries.
5. Persist room metadata needed for reconnect recovery, including mirrored client-token hashes and pending handshake state.

WebSocket auth:

1. Legacy clients may still send the pairing token as query `token=`.
2. New clients may send `Authorization: Bearer <token>`.
3. Telemetry must not log tokens or user-correlatable identifiers.

### Hermes Relay Worker

Path: `apps/hermes-relay-worker`

Responsibilities:

1. Route each `bridgeId` to a Hermes Durable Object room.
2. Accept Hermes bridge and client WebSocket connections.
3. Verify Hermes pairing credentials against Hermes registry state only.
4. Keep Hermes relay rooms, bindings, and DO classes isolated from OpenClaw.

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

## Privacy And Logging Constraints

Public deployments should keep these constraints intact:

1. Do not log pairing tokens, access codes, or full credentialed relay URLs.
2. Do not log raw chat payloads or user message content from relay transport paths.
3. Prefer event names, counts, booleans, and latency fields over user-correlatable identifiers.

## Deployment Boundaries

1. Registry and relay are separate Worker services and may be deployed independently.
2. Both services must use resources in the operator's own Cloudflare account.
3. Checked-in `wrangler.toml` files use open-source-safe placeholders for account-bound bindings.
4. Hermes relay services are separate from OpenClaw relay services and must not replace the existing OpenClaw workers.
