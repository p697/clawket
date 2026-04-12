# Hermes Relay Design

## Goal

Add relay connectivity for Hermes without changing OpenClaw relay behavior, APIs, storage, or deployment units.

This design treats "do not break existing OpenClaw users" as a hard compatibility contract, not a best effort.

## Compatibility Contract

OpenClaw must remain unchanged in all of these areas:

1. Existing public registry routes:
   - `POST /v1/pair/register`
   - `POST /v1/pair/access-code`
   - `POST /v1/pair/claim`
   - `GET /v1/verify/:gatewayId`
2. Existing relay worker route and room behavior.
3. Existing KV keys:
   - `pair-gateway:<gatewayId>`
4. Existing Durable Object class names and room naming.
5. Existing bridge pairing config:
   - `~/.clawket/pairing.json`
6. Existing mobile claim flow in:
   - `apps/mobile/src/services/relay-pairing.ts`

Hermes relay must therefore use new worker services, new HTTP routes, new KV keys, new Durable Object names, and new client claim codepaths.

## Why Not Extend The Existing OpenClaw Relay

The current OpenClaw relay stack is tightly coupled around OpenClaw-specific identity and storage:

1. Registry records are keyed by `gatewayId`.
2. Pairing storage assumes `pair-gateway:<gatewayId>`.
3. Worker auth fallback assumes OpenClaw verify semantics.
4. Mobile relay claim assumes OpenClaw response shapes.
5. Bridge pairing state assumes a single legacy pairing model.

Adding Hermes into those surfaces now would create hidden regression risk for old users. A separate Hermes relay keeps the blast radius contained.

## Architecture

Hermes relay v1 is an isolated sibling stack:

1. `apps/hermes-relay-registry`
2. `apps/hermes-relay-worker`
3. Hermes-specific shared protocol types in `packages/relay-shared`
4. Hermes-specific bridge relay state in a separate config file
5. Hermes-specific mobile claim service

The only intentional reuse is implementation-level code and Cloudflare platform primitives. Public behavior and storage remain separate.

## Public API

Registry routes:

1. `POST /v1/hermes/pair/register`
2. `POST /v1/hermes/pair/access-code`
3. `POST /v1/hermes/pair/claim`
4. `GET /v1/hermes/verify/:bridgeId`

Relay routes:

1. `GET /v1/health`
2. `POST /v1/internal/hermes/pairing/client-tokens`
3. `GET /ws?bridgeId=<bridgeId>&role=gateway|client...`

The relay worker stays on `/ws` because it is deployed as a separate Worker service. Route separation happens at the service boundary and in the query contract.

## Identity Model

OpenClaw relay identity:

1. `gatewayId`
2. `relaySecret`
3. `clientToken`

Hermes relay identity:

1. `bridgeId`
2. `relaySecret`
3. `clientToken`

Hermes IDs intentionally do not reuse OpenClaw prefixes:

1. `bridgeId`: `hbg_...`
2. `relaySecret`: `hrs_...`
3. `clientToken`: `hct_...`

This keeps logs, support, and storage debugging unambiguous.

## Storage Model

Hermes registry KV keys:

1. `hermes-pair-bridge:<bridgeId>`

Hermes relay DO room names:

1. `hermes:<bridgeId>`

Hermes bridge local state:

1. `~/.clawket/hermes-relay.json`

OpenClaw keeps using its legacy files and keys unchanged.

## Worker Bindings

Hermes registry:

1. `HERMES_ROUTES_KV`

Hermes relay worker:

1. `HERMES_ROOM`
2. `HERMES_ROUTES_KV`

Even when both services live in the same Cloudflare account, bindings and namespaces should be separate from OpenClaw.

## Protocol Shapes

Hermes register request:

```json
{
  "displayName": "optional host label",
  "preferredRegion": "us",
  "bridgeVersion": "optional version string"
}
```

Hermes register response:

```json
{
  "bridgeId": "hbg_...",
  "relaySecret": "hrs_...",
  "relayUrl": "wss://hermes-relay.example.com/ws",
  "accessCode": "ABC234",
  "accessCodeExpiresAt": "2026-04-11T00:00:00.000Z",
  "displayName": "optional host label",
  "region": "us"
}
```

Hermes claim response:

```json
{
  "bridgeId": "hbg_...",
  "relayUrl": "wss://hermes-relay.example.com/ws",
  "clientToken": "hct_...",
  "displayName": "optional host label",
  "region": "us"
}
```

## Bridge Runtime Plan

Hermes relay will not reuse OpenClaw pairing state.

Instead:

1. bridge CLI adds Hermes relay config load/save helpers backed by `~/.clawket/hermes-relay.json`
2. Hermes relay registration and access-code refresh use Hermes registry endpoints only
3. Hermes runtime connects to the Hermes relay worker with `bridgeId`
4. Hermes relay `pair` support remains behind explicit integration until full end-to-end validation is complete

Until then, the shared `pair` command may continue to surface Hermes local by default.

## Mobile Plan

Mobile must use a new Hermes claim service instead of mutating the OpenClaw relay service in place.

Planned files:

1. `apps/mobile/src/services/hermes-relay-pairing.ts`
2. Hermes QR payload support in scanner/parser helpers
3. Hermes relay connection bootstrap through `backendKind: 'hermes'` and `transportKind: 'relay'`

OpenClaw mobile relay code remains untouched except for integration points that explicitly branch on QR payload kind before delegating to separate services.

## Cloudflare Deployment Strategy

Hermes relay deploys as separate services:

1. `clawket-hermes-registry`
2. `clawket-hermes-relay`

This provides the strongest isolation:

1. Separate deploy commands
2. Separate logs and tails
3. Separate KV namespaces
4. Separate Durable Object namespaces
5. Separate rollback path

## Rollout Phases

### Phase 1

Scaffold isolated Hermes registry/worker and protocol types.

Exit criteria:

1. No OpenClaw codepaths changed in behavior
2. Hermes registry/worker typecheck and tests pass locally

### Phase 2

Add Hermes bridge relay state and CLI registration helpers.

Exit criteria:

1. Hermes bridge can register and refresh access codes against new registry
2. Existing OpenClaw pair flows still pass regression tests

### Phase 3

Add mobile Hermes relay claim and QR support.

Exit criteria:

1. Mobile can scan and claim Hermes relay QR payloads
2. Mobile stores Hermes relay as `backendKind: 'hermes'` and `transportKind: 'relay'`

### Phase 4

Enable product-facing `pair` integration for Hermes relay after explicit end-to-end validation.

Exit criteria:

1. `pair` uses Hermes relay only when the Hermes relay stack is configured and verified
2. OpenClaw relay remains unchanged

## Non-Goals For V1

1. Unifying Hermes and OpenClaw relay storage
2. Rewriting OpenClaw relay API shapes
3. Migrating old OpenClaw pairing records
4. Sharing one `verify` endpoint across both backends

## Future Refactor Opportunity

After Hermes relay is stable, we can consider extracting implementation-only shared relay primitives:

1. access-code generation
2. token hashing helpers
3. Durable Object routing utilities
4. heartbeat and stale-client pruning

That refactor must happen after stability is proven, not before.
