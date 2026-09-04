# Overview

This repository is the Clawket monorepo.

## Working Principles

1. Treat the current code, tests, deploy scripts, and product behavior as the source of truth; historical documentation is supporting context only.
2. Preserve unrelated work in a dirty tree. Do not reformat, revert, or opportunistically rewrite files outside the task.
3. Prefer stability and explicit compatibility over broad cleanup, especially across the OpenClaw and Hermes paths.
4. Keep prompts, documentation, and implementation rules concise and non-duplicative. Put detailed workspace rules in the closest workspace document.

## AGENTS / CLAUDE Source Rule

`AGENTS.md` is the only authored instruction source in each directory. A sibling `CLAUDE.md` must be a relative symlink to `AGENTS.md`, not a copied document. When adding a directory-level `AGENTS.md`, add the matching symlink and keep detailed rules in the closest applicable file.

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

## Relay Liveness Compatibility Rule

1. Client liveness must be capability-negotiated. Only clients advertising `relay.client-pong.v1` may be expired for missing Relay pong acknowledgements.
2. Legacy clients must not be disconnected solely because they have not sent application traffic; socket failure and handshake-specific timeouts remain valid cleanup signals.
3. A Bridge or local Gateway reconnect must force any stale client transport to reconnect when its existing backend session can no longer be resumed safely.
4. Successful health evidence must reset reconnect backoff. A raw WebSocket `open` event is not sufficient proof of a completed backend handshake.

## Preview Service Environment Rule

1. Preview is an OpenClaw Relay service environment, not a backend or transport kind. Keep `backendKind=openclaw` and `transportKind=relay` for both Production and Preview.
2. Production and Preview must use isolated Registry, Relay, KV, Durable Object, pairing credentials, and local pairing files. A Preview deploy must never target Production bindings.
3. Official QR codes are environment-checked by mobile. Custom/self-hosted Registry URLs remain supported and must not be misclassified as an official environment.
4. The Bridge service may connect Production and Preview simultaneously, but failure in one environment must not stop the other runtime.
5. Preview is a pre-release OpenClaw surface. Hermes infrastructure and pairing remain isolated and are not implicitly enrolled into Preview.

## Secure Pairing Invitation Compatibility Rule

1. One-tap links and human pairing codes are additive wrappers around the existing single-use Relay claim payload. Keep the legacy QR output usable by old Apps.
2. Registry may store only encrypted invitation payloads. URL decryption keys stay in the fragment; pairing codes are high-entropy, rate-limited, and never stored or transmitted in plaintext.
3. Claim, access-code refresh, and expiry must invalidate the matching invitation. If invitation creation fails against an older Registry, Bridge pairing must continue with the legacy QR flow.
4. Pairing links and codes must converge on the existing backend-aware QR parser and claim path so connection behavior does not fork.

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

When implementation, architecture, or release behavior changes, update the closest `AGENTS.md` and durable documentation in the same change. Run `npm run check:docs` after changing agent instructions.

## Quality Gate Rule

1. `npm run check:required` is the repository-wide, CI-safe required gate for typechecks, self-contained tests, mobile design-system checks, and documentation checks.
2. Check scripts must fail with a non-zero exit code when their inputs are missing, malformed, or empty; they must not silently skip verification.
3. Checks must print the number or scope of verified items so an accidental coverage reduction is visible.
4. New check logic should expose testable validation functions and include a corrupted-input regression test.
5. Tests that require an external checkout or live service must have an explicit integration command and must not make the CI-safe gate depend on a developer's home directory. Keep the ordinary `npm test` command as the broader local suite.

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
7. Six-digit Relay pairing is an additive negotiated protocol. Preserve the encrypted 12-character code and compact QR internally for old clients, and never shorten the legacy code-derived encryption key in place.

## CLI Observability Rule

1. `clawket status`, `clawket doctor`, `clawket logs`, and `clawket reset` must remain reliable for both OpenClaw and Hermes during coexistence.
2. Hermes detached bridge and relay processes must write to persistent Clawket-owned log files so product diagnostics work without attaching a terminal.
3. Diagnostics and reset flows may clean up only Clawket-owned Hermes config files and Clawket-started Hermes processes; do not mutate Hermes source trees or unrelated host processes.

## CLI Lifecycle Rule

1. `clawket start`, `clawket install`, `clawket restart`, `clawket stop`, and `clawket uninstall` must preserve OpenClaw's existing service lifecycle semantics.
2. Hermes support in those commands must be additive and limited to Clawket-managed Hermes bridge and relay runtimes.
3. `stop` and `uninstall` should stop Hermes runtimes without deleting Hermes config; `reset` remains the command that clears local Hermes state.
4. Hermes-only users must be able to use lifecycle commands without requiring an OpenClaw pairing config.
