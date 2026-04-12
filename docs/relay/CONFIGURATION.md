# Configuration

This document describes the public configuration surface for the registry worker and relay worker. All account-bound resources must be created in the operator's own Cloudflare account.

## Registry Worker

Path: `apps/relay-registry`

### Required bindings

1. `ROUTES_KV`
   - Cloudflare KV namespace for pairing records.
   - Must be the same namespace used by the relay worker.

### Vars

1. `RELAY_REGION_MAP`
   - JSON object mapping region name to relay WebSocket URL.
   - Example:

```json
{
  "us": "wss://relay-us.example.com/ws",
  "sg": "wss://relay-sg.example.com/ws"
}
```

2. `PAIR_ACCESS_CODE_TTL_SEC`
   - Lifetime of a one-time pairing `accessCode` in seconds.
   - Default in checked-in templates: `600`.

3. `PAIR_CLIENT_TOKEN_MAX`
   - Maximum number of active client tokens retained per `gatewayId`.
   - Older tokens beyond this cap are dropped from the pairing record.
   - Default in checked-in templates: `8`.

4. `PAIRING_SYNC_SECRET`
   - Optional shared secret used for registry-to-relay immediate token sync after a successful claim.
   - If unset, relay auth falls back to KV and registry verification paths only.
   - If set on one service, set the same value on both registry and relay.

## Hermes Registry Worker

Path: `apps/hermes-relay-registry`

### Required bindings

1. `HERMES_ROUTES_KV`
   - Cloudflare KV namespace for Hermes pairing records.
   - Keep this separate from the OpenClaw `ROUTES_KV` namespace for rollout safety.

## Relay Worker

Path: `apps/relay-worker`

### Required bindings

1. `ROOM`
   - Durable Object namespace for relay rooms.

2. `ROUTES_KV`
   - Same KV namespace used by the registry worker.

### Vars

1. `REGISTRY_VERIFY_URL`
   - Base URL of the registry worker used for relay verification fallback.
   - Example: `https://registry.example.com`

2. `PAIRING_SYNC_SECRET`
   - Optional shared secret for the internal `client-tokens` sync endpoint.
   - Must match the registry worker value when enabled.

3. `MAX_MESSAGES_PER_10S`
   - Baseline inbound message limit per socket over a 10-second window.
   - Default in checked-in templates: `120`.

4. `MAX_CLIENT_MESSAGES_PER_10S`
   - Client-specific inbound message limit over a 10-second window.
   - Defaults higher than the baseline worker limit in the checked-in template.

5. `HEARTBEAT_INTERVAL_MS`
   - Relay heartbeat interval for active rooms.
   - Default in checked-in templates: `30000`.

6. `GATEWAY_OWNER_LEASE_MS`
   - Gateway ownership lease duration used to avoid rapid gateway replacement churn.
   - Default in checked-in templates: `20000`.

7. `AWAITING_CHALLENGE_TTL_MS`
   - Maximum time a client may remain in the awaiting-challenge set before prune logic may treat it as stale.
   - Default in checked-in templates: `25000`.

8. `CLIENT_IDLE_TIMEOUT_MS`
   - Absolute idle timeout for silent or ghost client sockets.
   - Default in checked-in templates: `600000`.

## Hermes Relay Worker

Path: `apps/hermes-relay-worker`

### Required bindings

1. `HERMES_ROOM`
   - Durable Object namespace for Hermes relay rooms.

2. `HERMES_ROUTES_KV`
   - Same Hermes KV namespace used by the Hermes registry worker.

### Vars

1. `REGISTRY_VERIFY_URL`
   - Base URL of the Hermes registry worker used for relay verification fallback.
   - Example: `https://hermes-registry.example.com`

2. `PAIRING_SYNC_SECRET`
   - Optional shared secret for the internal Hermes `client-tokens` sync endpoint.
   - Must match the Hermes registry worker value when enabled.

## Checked-In Wrangler Files

The tracked `wrangler.toml` files are open-source-safe templates:

1. Account-bound IDs are placeholders.
2. Service URLs must stay on neutral placeholder domains such as `example.com`, not the official hosted deployment.
3. Do not put private account IDs, KV IDs, route IDs, or custom-domain configuration into tracked files.

## Local Override Files

For local deploys or remote dev against your own Cloudflare account:

1. Copy `apps/relay-registry/wrangler.local.example.toml` to `apps/relay-registry/wrangler.local.toml`.
2. Copy `apps/relay-worker/wrangler.local.example.toml` to `apps/relay-worker/wrangler.local.toml`.
3. Fill in your own `account_id`, KV IDs, and service URLs.
4. Keep these `wrangler.local.toml` files untracked.

For Hermes relay, also create:

1. `apps/hermes-relay-registry/wrangler.local.toml`
2. `apps/hermes-relay-worker/wrangler.local.toml`

Repo scripts prefer `wrangler.local.toml` automatically when present.

## Minimum Self-Hosted Setup

At minimum, a working deployment needs:

1. One KV namespace shared by registry and relay.
2. One deployed registry worker.
3. One deployed relay worker with a Durable Object namespace.
4. `RELAY_REGION_MAP` values that point to the relay worker WebSocket endpoint.
5. `REGISTRY_VERIFY_URL` that points to the registry worker.

Hermes relay needs its own equivalent set of resources and must not reuse the OpenClaw production bindings during rollout.

## Account-Safety Rules

1. Confirm the active Cloudflare account before deploy or tail operations with `npm run relay:cf:whoami` or `npx wrangler whoami`.
2. If your login can access multiple accounts, set `account_id` in each local override file and treat missing account locks as a deploy blocker.
3. Create and manage all bindings in your own Cloudflare account.
