# Overview

This repository is the Clawket monorepo.

## Workspace Layout

| Path | Role |
|------|------|
| `apps/mobile` | React Native mobile app |
| `apps/relay-registry` | Cloudflare registry worker |
| `apps/relay-worker` | Cloudflare relay worker |
| `apps/bridge-cli` | Publishable bridge CLI |
| `packages/bridge-core` | Bridge shared helpers |
| `packages/bridge-runtime` | Bridge runtime |
| `packages/relay-shared` | Relay shared protocol/types |

## External Dependency

OpenClaw still lives outside this repository. From the monorepo root, its expected sibling path is `../../openclaw` or `/Users/lucy/Desktop/op/openclaw`.

Hermes source under `/Users/lucy/.hermes/hermes-agent` is also an external dependency.

## External Source Boundary

1. Do not modify Hermes source code, tests, or scripts under `/Users/lucy/.hermes/hermes-agent`.
2. Hermes may be inspected for behavior, protocol, and debugging context only.
3. Any Hermes compatibility work must be implemented inside the Clawket monorepo unless the user explicitly asks to change Hermes itself.

## Dual Backend Architecture Rule

During the OpenClaw + Hermes coexistence period, treat backend identity and transport identity as separate concerns.

1. Backend answers “what product is this?” and must be modeled explicitly (`openclaw` vs `hermes`).
2. Transport answers “how do we connect to it?” and must stay separate (`local`, `relay`, `tailscale`, `cloudflare`, `custom`).
3. Do not introduce new architecture that treats Hermes as just another transport mode beside Relay/Tailscale/Local.
4. Prefer centralized backend capability registries and adapters over scattered `if (backend === 'hermes')` checks.
5. If a page or action is unsupported for one backend, gate it through capability metadata instead of letting requests fail at runtime.

## OpenClaw and Hermes Non-Regression Rule

**This is a mandatory, non-negotiable constraint for all changes.** Regardless of what you modify, you must **at the same time** preserve **connection stability** and **functional completeness** for both the **OpenClaw** connection path and the **Hermes** connection path. You must not fix or extend one path in a way that breaks, weakens, or incompletely supports the other.

## Mechanical Merge Rule

This monorepo is in the first migration phase:

1. Preserve product behavior.
2. Preserve deploy and publish boundaries.
3. Prefer path fixes and workspace orchestration over logic refactors.
4. Do not mix protocol redesign with structural migration.

## Repository Instruction Rule

When work touches a specific workspace or subdirectory, read the closest applicable `AGENTS.md` for that area before making changes. Do not start implementation based only on the monorepo root instructions when a more specific directory-level instruction file exists.

## Documentation Rule

If you update `README.md`, you must update `README.zh-CN.md` in the same change so the English and Chinese versions stay aligned.

## Hermes Implementation Boundaries

1. Hermes adapter lifecycle state (run, session, stop) must be self-contained and deterministically cleanable inside the adapter layer.
2. Hermes relay must use isolated infrastructure (separate workers, KV, Durable Objects); do not modify OpenClaw relay deploy units or public contracts.
3. Hermes model switching is global-scoped only; do not build per-session model state.
4. Detailed implementation rules for each area live in the relevant workspace `AGENTS.md` files.
5. Hermes relay runtime health cannot rely only on websocket open state or cloud bridge attachment. When maintaining long-lived Hermes relay connections, prefer real request/response probes against the local Hermes bridge so stale bridge sockets are actively recycled.

## Pair Command Product Rule

1. Treat `clawket pair` as the product-facing multi-backend pairing entrypoint, not as an OpenClaw-only legacy shortcut.
2. When `clawket pair` detects multiple installed pairable backends on the same machine, it should emit one pairing result per detected backend in a single run so the user can scan either QR code.
3. OpenClaw pairing emitted from `clawket pair` remains Relay-backed and must preserve its existing service-install behavior.
4. Hermes pairing emitted from `clawket pair` must prefer Hermes Relay, not Hermes Local, unless the user explicitly chooses `local`.
5. If Hermes Relay pairing succeeds from `clawket pair`, the CLI should also try to bring up the Hermes local bridge and Hermes relay runtime automatically so the scanned QR is usable immediately.
6. `clawket pair local` remains the explicit escape hatch for local-only QR flows, and when multiple local-capable backends are installed it should emit one local pairing result per detected backend.

## CLI Observability Rule

1. `clawket status`, `clawket doctor`, `clawket logs`, and `clawket reset` must remain reliable for both OpenClaw and Hermes during coexistence.
2. Hermes detached bridge and relay processes must write to persistent Clawket-owned log files so product diagnostics work without attaching a terminal.
3. Diagnostics and reset flows may clean up only Clawket-owned Hermes config files and Clawket-started Hermes processes; do not mutate Hermes source trees or unrelated host processes.

## CLI Lifecycle Rule

1. `clawket start`, `clawket install`, `clawket restart`, `clawket stop`, and `clawket uninstall` must preserve OpenClaw's existing service lifecycle semantics.
2. Hermes support in those commands must be additive and limited to Clawket-managed Hermes bridge and relay runtimes.
3. `stop` and `uninstall` should stop Hermes runtimes without deleting Hermes config; `reset` remains the command that clears local Hermes state.
4. Hermes-only users must be able to use lifecycle commands without requiring an OpenClaw pairing config.

## CLI Lifecycle Rule

1. `clawket start`, `clawket install`, `clawket restart`, `clawket stop`, and `clawket uninstall` must preserve OpenClaw's existing service lifecycle semantics.
2. Hermes support in those commands must be additive and limited to Clawket-managed Hermes bridge and relay runtimes.
3. `stop` and `uninstall` should stop Hermes runtimes without deleting Hermes config; `reset` remains the command that clears local Hermes state.
4. Hermes-only users must be able to use lifecycle commands without requiring an OpenClaw pairing config.
