# Relay Worker

Policy-driven Cloudflare Worker for Clawket's OpenClaw and Hermes Relay instances. Shared source does not imply shared services or state.

## Backend selection

Set `RELAY_BACKEND` in every Wrangler configuration:

| Value | Room binding / class | Pairing KV |
|---|---|---|
| `openclaw` | `ROOM` / `RelayRoom` | `ROUTES_KV` |
| `hermes` | `HERMES_ROOM` / `HermesRelayRoom` | `HERMES_ROUTES_KV` |

Omission preserves the legacy OpenClaw default; unknown values fail closed. Production and Preview deploy separately for each backend, for four isolated Relay services in total. Never reuse KV, Durable Object namespaces, credentials, or local Wrangler overrides across those instances.

Tracked Wrangler files contain placeholders. Copy the matching local or Preview example, lock it to the intended Cloudflare account, and use the root deploy command; deploy wrappers run `tests/compat` first.

## Verify and operate

```bash
npm run --workspace @clawket/relay-worker typecheck
npm run --workspace @clawket/relay-worker test
```

Configuration, local workflows, service names, and isolation rules live in [`docs/relay/`](../../docs/relay/CONFIGURATION.md).
