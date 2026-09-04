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

## OpenClaw Pairing Credential Rule

1. Treat configured OpenClaw auth and readable plaintext auth as separate facts. SecretRef-backed auth is configured even when Clawket cannot read its value.
2. When raw auth is unavailable, use OpenClaw's official setup-code command and keep the temporary credential exchange out of terminal summaries and machine-readable product output.
3. Never log setup bootstrap tokens, decoded setup payloads, or issued device tokens.
4. Preserve raw token/password pairing for existing installations and keep Hermes pairing behavior unchanged.

## Preview Environment Rule

1. `clawket pair --preview` uses the official Preview Registry and writes `~/.clawket/bridge-cli.preview.json`; it must never overwrite Production pairing state.
2. The installed service runs every configured OpenClaw Relay environment in one process. Treat each runtime as independent so a Preview outage cannot break Production.
3. `refresh-code --preview` and `reset --preview` affect Preview only. A full reset may clear both OpenClaw environments while preserving existing Hermes cleanup semantics.
4. Preview currently supports OpenClaw Relay only. Do not silently route Hermes or local pairing through Preview.

## Secure Pairing Invitation Rule

1. `pair` and `refresh-code` should create a best-effort encrypted pairing invitation and may open its page for interactive users.
2. Invitation failure or an older Registry must fall back silently to the existing QR output; never make the QR path depend on the invitation endpoint.
3. Keep decryption keys and human codes out of Registry plaintext and persistent Bridge config. Do not log decoded connection payloads.
4. A six-digit code must use `pairing.secure-short-code.v2`; never derive the payload encryption key directly from six digits.
5. Keep the legacy 12-character encrypted code and compact QR internally for version skew. Only advertise the six-digit code after the Registry explicitly returns the version-2 capability.
6. The installed service must advertise its secure-pairing responder capability. A new CLI may restart an older running service once to load the responder, but subsequent code refreshes must not create duplicate runtimes.
