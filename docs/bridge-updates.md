# Bridge updates

A normal upgrade retains pairing, tokens, conversation history and each backend's original project/device scope. Do not delete the phone connection, run `pair`, or reset local state as an upgrade step. `npx ... pair choose` selects pairing; it is not a global package or all-runtime update.

## Unified command

After a release advertising package metadata `clawket.updateProtocol: 1` is published:

```sh
npx -y @p697/clawket@latest update
```

The command checks the official npm stable release, installs that exact version into a fresh private `~/.clawket/runtime/releases/` directory with lifecycle scripts disabled, validates its package/entrypoint, then uses that installed CLI to replace existing managed runtimes. It does not change npm's global prefix. Re-running `npx ...@latest` alone never replaces a daemon already running from a previous npx cache.

Default update covers the saved OpenClaw service (Production and Preview share one process), Hermes Bridge and Relay, and all saved Codex, Claude Code and Pi scopes in Clawket's bounded state layout. `--preview` limits native discovery to Preview; OpenClaw's shared process still retains both environments. Custom configs use their original scope:

```sh
npx -y @p697/clawket@latest update --backend codex --config /original/runtime.json
npx -y @p697/clawket@latest update --backend pi --project /original/project
```

`--json` reports per-instance outcomes. `--version X.Y.Z` selects an exact stable, updater-capable release; known running versions cannot be downgraded. Configurations already stopped remain stopped. An existing stopped OpenClaw autostart registration is refreshed without starting it; absent autostart remains absent, and registration failures restore the previous files/command. The active manifest directs subsequent run/start/install/restart commands from an updater-capable CLI to the verified snapshot. An older global CLI cannot honor that new manifest: use the latest npx command for subsequent lifecycle operations, or separately update that npm prefix. Updating one npm prefix does not change another Node installation.

## Runtime transition and failure

Every new managed process publishes a private authenticated local owner endpoint with its actual version, entrypoint, PID and scope. It is never a Relay/phone stop RPC. Bounded requests and active/queued native operations block shutdown. Once idle, admission closes before the stop acknowledgement, so new tasks cannot race that transition. The updater waits for the captured process to exit before starting its replacement. OpenClaw restarts the transport Bridge only; its native Gateway runs independently.

The shared OpenClaw watchdog stops first; Hermes Bridge starts before Hermes Relay; the shared service starts last. Success requires the expected replacement owner, actual package version and backend-specific local readiness. A local pass does not prove a phone/Relay round trip or inference: the phone must reconnect and complete its authenticated handshake before it displays the new current version.

A failed transition stops only verified replacements and attempts restoration from each captured original entrypoint, retaining configuration. An uncertain stop never permits another owner. Results distinguish updated, kept stopped, restored and failed. Restoration is best effort, not a guarantee after arbitrary process/filesystem failures. The package is staged before any stop; a failed download or invalid release leaves runtimes untouched. Updates serialize with a private lock; only a proven exited PID permits stale-lock recovery.

Legacy owners migrate only when authenticated local health, exact known Clawket process entry and idle-session evidence can be verified. Legacy admission is not atomic: finish tasks before that first update. Unknown ownership, duplicate entries, ambiguous command paths, failed authentication or timeout fail without a replacement. Legacy Windows Hermes has no reliable process discovery: stop and restart the selected old runtime with the latest CLI using its original deployment method before unified update. Never stop an arbitrary port occupant.

On POSIX, npm `.bin/clawket` and global `bin/clawket` executable symlinks are resolved before legacy entry validation. The target must be a known Clawket bundle whose package name and `clawket` bin match; the updater captures that resolved bundle for restoration. Broken, unrelated or ambiguous launchers are rejected. Entry-discovery failures name the backend and whether the selected scope is a configuration or shared service, without printing its path. Published 3.1.11/3.1.12 predate this fix: a valid npm executable link can still fail discovery there. Finish tasks, stop the selected Clawket Bridge through its authenticated lifecycle command, rerun update with the original backend/scope, then explicitly start that scope; stopped runtimes remain stopped after update. Keep pairing and history intact.

Local-model processes started by the new ordinary CLI participate through the same private control and retain their port/configuration. Legacy terminal processes, independent Windows supervisors, Docker and custom services must use their original deployment method. A default-discovered local-model config without a managed owner is reported `manual`; the overall command exits nonzero and does not claim every installation updated. Windows supervisor installations update their independent snapshot through `scripts/bridge/windows-local-model.ps1`; restore the existing pairing, never pair again.

## Phone settings

Settings permanently links to Bridge and updates. The guide lists saved Bridge connections, authenticated current or last-confirmed versions, and the latest stable npm release. Direct OpenClaw Gateway connections are excluded. Credential-free version evidence is pruned when connections disappear. Unknown/offline state never proves an outdated Bridge; Gateway version is never used as Bridge version.

Latest release checks cache for 24 hours and can be retried manually. Failure preserves previous evidence and shows an explicit check failure. Only a published update-protocol marker enables the unified command, pinned to the checked version. Older releases receive original-deployment guidance; the old fixed 3.0.0 command is removed. Copying/sharing does not change versions or report update success.

## Release boundary

Public Bridge 3.1.11 contains the updater; 3.1.10 and older do not. Invoke 3.1.11 or a later verified release through npx for the first update. The phone guide/UI requires a separately delivered compatible App; Bridge publication does not distribute it or automatically update running processes. See the [3.1.11 release record](3.1/codex-production-bridge-3.1.11-release.md). Keep old protocol frames additive, and pass the v1 replay and desktop gates before releasing.
