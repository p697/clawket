# Bridge CLI

Publishable bridge CLI (`@p697/clawket`) inside the Clawket monorepo.

## Hermes Local Dev Rule

When improving the local Hermes testing flow:

1. Prefer a single productized `bridge-cli` entrypoint over ad hoc shell scripts that duplicate pairing and bridge startup logic.
2. Auto-clean only Clawket-managed Hermes local bridge processes, plus Hermes gateway processes when the user explicitly opts into a restart. The Bridge may replace a key-rejecting gateway only with the ownership record defined in `packages/bridge-runtime`.
3. Do not kill unrelated processes solely because they occupy the same port; fail with a clear error instead of risking collateral damage.
4. QR generation, PNG export, and terminal QR output should all come from the same CLI flow so local testing, docs, and future automation stay aligned.
5. If a watch mode is added for Hermes local development, keep its watch scope narrow to bridge-only sources and config (`apps/bridge-cli`, `packages/bridge-core`, `packages/bridge-runtime`), and do not rebuild on unrelated app changes.
6. Treat `clawket pair local` as a shared product entrypoint. If multiple local-capable backends are installed, emit one local pairing result per detected backend from the same command so the user can choose which QR to scan.
7. Use Bridge Runtime's shared Hermes installation resolver for pairing detection and doctor output. Honor explicit source/command overrides and the current official installation directory without requiring a user to edit shell PATH.

## Hermes Pairing Readiness

1. Hermes relay and local pairing print a QR only after the Bridge `/health` reports a usable Hermes API. Otherwise print no QR, exit non-zero and emit `ok: false` JSON with `hermesApiIssue` and a remedy in `runtimeMessage`; a rejected key fails at once, other issues after a short grace. Bridges that predate `hermesApiReachable` keep the old success path.
2. `--restart-hermes` on pairing replaces a running Clawket-managed Bridge with its saved token, so a running relay runtime reconnects; never forward it to the relay child, which would restart the Bridge again.
3. `reset` keeps `hermes-gateway-owner.json`: the gateway it names keeps running, and the record holds no credential.

## CLI Observability Rule

1. `status`, `doctor` and `logs` cover all saved Clawket backends. `src/agent-inventory.ts` reads only the bounded Clawket state layout; custom configs require their original `--config`. Never scan native histories or start a native/Bridge process for an offline diagnostic.
2. Default status is a compact local-state summary; `--verbose` exposes details. Doctor reports findings/remedies and exits nonzero for missing, invalid, stopped or unverified selected state. Local readiness, configured model, Relay attachment and successful inference are separate evidence.
3. `src/cli-logs.ts` provides bounded tails, timestamp filtering and byte-based follow for both global and backend commands. Include stderr by default, label sources, preserve untimestamped legacy lines with an explicit age warning, and retain JSON snapshots / JSONL follow. New Agent runtime callbacks timestamp only their existing sanitized messages.
4. Stop/reset/restart require authenticated local lifecycle control even after native-health failure; only `ECONNREFUSED` proves no listener. Authentication failures, mismatched identities, timeouts and resets never authorize replacement or config deletion. Preserve exact response correlation and the bounded authenticated legacy identity fallback.
5. Default lifecycle/reset retains the OpenClaw/Hermes service scope. Codex, Claude Code and Pi require an explicit backend and original scope; reset removes only pairing config and retains history. Unknown/conflicting backends and scope flags without a backend fail before mutations. Never delete native source/config or stop unrelated processes.

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
4. The shared service Preview scope is OpenClaw Relay only. Codex/Claude Code use their independent Preview state; Pi requires its original isolated Registry/config. Do not enroll Hermes or infer Preview from a transport kind.

## Secure Pairing Invitation Rule

1. `pair` and `refresh-code` should create a best-effort encrypted pairing invitation. Print its code and QR without opening a browser; only an explicit `--open` may open its page.
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

Repeated Pi pairing against an authenticated running owner must reuse its exact target and identity. Refresh the saved Registry access code and print a QR without stopping, registering, spawning, or rewriting its in-memory invitation/config; explicitly explain that six-digit refresh is unavailable on this path. Recover legacy Registry provenance only from a matching Pi invitation, never infer it from a Relay URL or send an existing secret to a different Registry. Changed explicit scope/options, uncertain owner authentication, or a locked owner without a listener must fail without replacement. Local repeats only reprint the existing local identity. Offline pairing retains its existing registration behavior; this exception does not add an invitation hot-update RPC.

## Codex projects

Persist Codex `desktop_ipc_diagnostic` metadata alongside native RPC diagnostics: only the timestamp, fixed operation/reason, pending count and optional frame size. Never spread a runtime diagnostic object into logs or include native errors, conversation identities, paths or request bodies.

Explicit Codex stop/restart/reset uses authenticated lifecycle control independent of native health. Older Bridges may confirm their authenticated `agents.list` identity after a native-health error; wrong identity, authentication rejection and uncertain timeouts never authorize a replacement. Only connection refusal means no local listener; never kill an occupant by PID or port.

Codex pair/start/doctor/status must preserve non-refusal health failures instead of treating them as an offline owner. Native-health rejection gives fixed explicit restart guidance without exposing the native error body; pairing must not spawn, stop or refresh Registry credentials on that failure.

Pair chooser and pairing use the shared Codex executable resolver, including macOS desktop fallback when the default PATH CLI is absent. Missing authentication guidance must also work for desktop-only users; preserve explicit command selection and existing configuration scope.

`clawket codex pair` / `clawket pair --backend codex` creates a device connection by default, with a persistent `~/Documents/Clawket/Chats` fallback. Explicit `--project` retains project-only authorization. Existing `--config` files never widen silently. Device lifecycle/state lives under `~/.clawket/codex/device/<environment>`; legacy project configuration stays in its hashed directory. Reuse the installed Codex credentials; never migrate them or change another client process. Local and Relay pairing must report readiness only after native initialization. `--preview` must use the isolated Codex Preview Registry.

Codex default state and listen ports are isolated by project and service environment. Refresh pairing through the existing Registry access-code endpoint so previously paired clients retain their identity; refuse refresh while a task is active.

Codex first-time detached pairing must carry the resolved device scope into the child when adding a not-yet-created `--config` path. Repeated default pairing reuses that state; explicit project scope remains restricted.

## Claude Code projects

`clawket claude-code pair` / `pair --backend claude-code` uses the installed, unmodified Claude executable and device discovery by default. `--project` authorizes only that project. State, logs and Preview credentials live under the independent `~/.clawket/claude-code` tree; lifecycle commands stop only authenticated Clawket-owned runtimes. The official `@anthropic-ai/claude-agent-sdk` is an explicit package external, retained as a production dependency; do not bundle its assets or silently substitute its packaged CLI for the user's selected executable. Native authentication remains on the computer. See `../../docs/3.1/claude-code.md`.

Claude pairing discovery and SDK startup share the runtime's Desktop-first executable resolver. Default macOS/Windows pairing prefers the installed Desktop Code host runtime, including Desktop-only machines, and retains CLI-only fallback. Explicit saved commands stay authoritative. Keep authentication/install guidance usable without a terminal CLI; no credential copying or existing Desktop owner takeover.

Claude first-time detached pairing must carry the resolved device scope into the child even when adding a not-yet-created `--config` path. Existing scoped configurations are never silently widened.

## 3.1 release

The authorized Bridge patch release is `3.1.12`. Keep the publish guard aligned with the CLI manifest; internal workspace and App versions remain unchanged. Preserve the existing OpenClaw/Hermes pair behavior for old clients. `pair choose` is interactive and read-only until selection; explicit `--backend` is required for agent/script prompts. Client distribution is a separate release stage.

Codex and Claude Code pairing saves a `Product · Device name` default via `src/device-connection-name.ts`: prefer the bounded macOS ComputerName lookup, then hostname, then the plain product name. Reuse the saved label for Registry registration, encrypted invitations and Relay/local QR output; explicit pairing backfills a missing/blank saved label, preserving every nonblank saved name. The authenticated access-code refresh synchronizes that saved label to Registry so claims cannot restore an old product-only name. Ordinary run/start/restart never generate or migrate labels, and computer renames never regenerate a saved label. Project/device scope and connection identity never come from the display name; keep device labels out of diagnostics and persistent logs.

Codex foreground/background native RPC diagnostics use the runtime's bounded metadata contract in the existing local log. Never forward raw native frames, stderr or exception text, and do not upload local logs automatically. See `../../docs/3.0/20-connection-diagnostics.md`.

Codex `permission_configuration_diagnostic` logs only the runtime's fixed failure category, allowlisted permission modes, field type categories and thread/cwd/idle comparison booleans. Omit native values, profile names, paths, IDs and errors; configuration confirmation does not attest to a turn's actual execution permissions.

## Pairing progress

`src/progress.ts` draws one live status line while `pair`, `pair choose` discovery, `refresh-code` and Agent/local-model pairing wait. It draws only on an interactive stderr outside CI and `TERM=dumb`; `--json`, pipes and scripts keep byte-identical output. Detached Agent children forward step text over IPC (`<backend>.progress`), and the launching terminal closes the line with ✔/✖ before printing a code, QR or error. Step text must never contain codes, tokens or payloads.

## Unified Bridge update

`update` is the explicit all-saved-managed-runtime exception to default lifecycle scope. Keep its bounded authenticated private owner control, idle admission fence, immutable package staging and verified version transition. Retain exact config/identity/history; never pair/reset, infer ownership from ports, or start a second owner after an uncertain stop. Preserve stopped scopes and report independent supervisors as manual. Future starts use a validated managed snapshot; old global CLIs require the latest npx invocation. Details and release limitations: `../../docs/bridge-updates.md`.
