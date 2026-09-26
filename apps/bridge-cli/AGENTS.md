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
7. Use Bridge Runtime's shared Hermes installation resolver for pairing detection and doctor output. Honor explicit source/command overrides and the current official installation directory without requiring a user to edit shell PATH.

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

## CLI Test Isolation Rule

`index.test.ts` re-imports the CLI per test, but `main()` is fire-and-forget: a finished test's Hermes pid polling and OpenClaw reconnect polling keep running for up to 25 seconds. Mocks those pollers touch (`execFileSync`, `spawn`, `getServiceStatus`, `readRecentCliLogs`) must stay per-test instances re-registered with `vi.doMock` in `beforeEach`; never move them back into the shared hoisted set, and restore real timers in `afterEach`.

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

Managed OpenClaw runtimes advertise additive independent-client channel support. The Relay must negotiate it before the runtime allocates per-client Gateway connections; older Relay deployments continue using the legacy transport.

## Local model Preview

`local-model pair` (also `pair --backend local-model`) runs a foreground, isolated Preview Bridge and prints a secure six-digit code only after Relay readiness. `local-model run` restores its saved configuration. Optional llama.cpp router startup must never replace an occupied port or terminate unrelated model processes. Local-model state is separate from existing OpenClaw and Hermes state. See `../../docs/3.0/15-local-model.md`. Model discovery goes through `discoverLocalModelEndpoints`: an unreachable address, a non-OpenAI-compatible reply, an empty model list or an unknown `--engine` must fail with the address and the `--base-url` / `--engine` remedy, never a bare `fetch failed`; keep its engine list equal to the Mobile onboarding tabs.

Windows local-model persistence uses `scripts/bridge/windows-local-model.ps1` and its detached supervisor. Restore existing pairing only; keep independent bundle snapshots, per-config exclusive control, bounded child restart backoff, and graceful IPC shutdown/parent-loss cleanup. Logon recovery is per-user, not a pre-login service. See `../../docs/3.0/21-windows-local-model-recovery.md`.

Supervisor Stop must wait for the owned child to exit before acknowledging; Start must wait out stopping instances. Install attempts use fresh release directories and validate the CLI before activation, never mutate a referenced snapshot. Cover these boundaries with process and Windows installation-failure regressions.

The CLI keeps `https-proxy-agent` as an explicit external runtime dependency for Relay-only proxy support; preserve it in the packaged install. Managed service proxy configuration must not modify global host networking.

Diagnostics resolve the invoked CLI symlink before matching managed process command lines; a global `clawket` symlink and its real bundle path must identify the same runtime. Missing paths remain safe to inspect.

On an explicit `restart`, retire the owned Hermes Bridge and Relay children before the OpenClaw service launcher resumes. Its normal recovery path reuses healthy children, which must not leave a pre-upgrade runtime active. Keep Hermes API/gateway processes and pairing files intact; do not spawn duplicate children alongside the launcher.

A Hermes Relay command that deliberately yields to another owner stays alive with its diagnostic until explicit stop/restart. Do not let the service watchdog respawn a yielded instance and resume the ownership fight; signal shutdown must release the CLI keepalive handle.

## Pi project lifecycle

`pi pair` / `pair --backend pi` authorizes the current or explicitly selected project. Pairing starts an isolated background child only after readiness; `--foreground` keeps the terminal-owned path. Pi state/logs live under a project-specific Clawket directory. Temporary pairing output goes over parent IPC, never persistent logs. `pi start/restart/stop/status/doctor/logs/reset` (also `--backend pi`) operate on that configuration only; authenticate local control before stopping anything, never kill a process merely by PID/port. Reset removes pairing and retains session files. Preserve explicit agent/session directories and never copy model credentials. Pi requires its own supported Node version; a Bridge installation alone is not proof Pi can run.

## Codex projects

`clawket codex pair` / `clawket pair --backend codex` creates a device connection by default, with a persistent `~/Documents/Clawket/Chats` fallback. Explicit `--project` retains project-only authorization. Existing `--config` files never widen silently. Device lifecycle/state lives under `~/.clawket/codex/device/<environment>`; legacy project configuration stays in its hashed directory. Reuse the installed Codex credentials; never migrate them or change another client process. Local and Relay pairing must report readiness only after native initialization. `--preview` must use the isolated Codex Preview Registry.

Codex default state and listen ports are isolated by project and service environment. Refresh pairing through the existing Registry access-code endpoint so previously paired clients retain their identity; refuse refresh while a task is active.

## Claude Code projects

`clawket claude-code pair` / `pair --backend claude-code` uses the installed, unmodified Claude executable and device discovery by default. `--project` authorizes only that project. State, logs and Preview credentials live under the independent `~/.clawket/claude-code` tree; lifecycle commands stop only authenticated Clawket-owned runtimes. The official `@anthropic-ai/claude-agent-sdk` is an explicit package external, retained as a production dependency; do not bundle its assets or silently substitute its packaged CLI for the user's selected executable. Native authentication remains on the computer. See `../../docs/3.1/claude-code.md`.

Claude first-time detached pairing must carry the resolved device scope into the child even when adding a not-yet-created `--config` path. Existing scoped configurations are never silently widened.
