# Bridge CLI

Publishable bridge CLI (`@p697/clawket`) inside the Clawket monorepo.

## Hermes Local Dev Rule

When improving the local Hermes testing flow:

1. Prefer a single productized `bridge-cli` entrypoint over ad hoc shell scripts that duplicate pairing and bridge startup logic.
2. Auto-clean only Clawket-managed Hermes local bridge processes, plus Hermes gateway processes when the user explicitly opts into a restart.
3. Do not kill unrelated processes solely because they occupy the same port; fail with a clear error instead of risking collateral damage.
4. QR generation, PNG export, and terminal QR output should all come from the same CLI flow so local testing, docs, and future automation stay aligned.
5. If a watch mode is added for Hermes local development, keep its watch scope narrow to bridge-only sources and config (`apps/bridge-cli`, `packages/bridge-core`, `packages/bridge-runtime`), and do not rebuild on unrelated app changes.
6. Treat `clawket pair local` as a shared product entrypoint. If multiple local-capable backends are installed, emit one local pairing result per detected backend from the same command so the user can choose which QR to scan.

## CLI Observability Rule

When expanding `status`, `doctor`, `logs`, `reset`, or related operational commands:

1. Treat them as product-level diagnostics for both OpenClaw and Hermes, not as OpenClaw-only legacy helpers.
2. Hermes detached bridge and relay runtimes must write to stable log files under the Clawket log directory so `clawket logs` and field debugging work without ad hoc shell inspection.
3. `reset` must clear Hermes bridge and relay local state only in Clawket-owned files and processes; do not delete or mutate Hermes source trees.
4. Do not remove or weaken OpenClaw diagnostics while adding Hermes coverage; the correct outcome is additive dual-backend visibility.
5. Prefer product-facing diagnostics over raw state dumps: `doctor` should surface an overall health conclusion, and `logs` should support a practical follow mode for live debugging.

## CLI Lifecycle Rule

When expanding `start`, `install`, `restart`, `stop`, or `uninstall`:

1. Preserve OpenClaw service semantics exactly; do not regress existing service install/restart behavior for paired OpenClaw users.
2. Hermes support should be additive: manage only Clawket-started Hermes bridge and relay runtimes, not arbitrary Hermes source processes.
3. `stop` and `uninstall` may stop Clawket-managed Hermes runtimes, but should not delete Hermes pairing/config state; `reset` remains the destructive cleanup command.
4. Hermes lifecycle commands must continue to work even when OpenClaw is not paired, so Hermes-only users are not forced through OpenClaw prerequisites.
5. The service launcher path (`clawket-launcher.sh` -> `clawket run --service`) must preserve OpenClaw startup semantics and may only restore Hermes bridge/relay runtimes as a best-effort additive step. Hermes restore failures should be logged, not allowed to break OpenClaw service startup.
