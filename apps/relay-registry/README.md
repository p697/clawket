# Registry Worker

Policy-driven Cloudflare Worker for Clawket pairing, claims, verification, and registration limits. The OpenClaw and Hermes instances share implementation only.

## Backend selection

Set `RELAY_BACKEND` in every Wrangler configuration:

| Value | Pairing KV | Public route family |
|---|---|---|
| `openclaw` | `ROUTES_KV` | `/v1/pair/*`, `/v1/verify/:gatewayId` |
| `hermes` | `HERMES_ROUTES_KV` | `/v1/hermes/pair/*`, `/v1/hermes/verify/:bridgeId` |

Omission preserves the legacy OpenClaw default; unknown values fail closed. Production and Preview deploy separately for each backend, for four isolated Registry services in total. Each instance needs its own pairing KV and `PAIR_REGISTER_LIMITER` Durable Object namespace; service bindings and secrets must target only its matching Relay.

Tracked Wrangler files contain placeholders. Copy the matching local or Preview example, lock it to the intended Cloudflare account, and use the root deploy command; deploy wrappers run `tests/compat` first.

## Verify and operate

```bash
npm run --workspace @clawket/registry-worker typecheck
npm run --workspace @clawket/registry-worker test
```

Configuration, local workflows, service names, and isolation rules live in [`docs/relay/`](../../docs/relay/CONFIGURATION.md).
