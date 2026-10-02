# CLI Runtime Architecture

The maintained architecture is intentionally small:

- `apps/bridge-cli` owns user command parsing and output formatting.
- `packages/bridge-core` owns pairing, config discovery, QR generation helpers, and service install/status primitives.
- `packages/bridge-runtime` owns the long-running relay/gateway runtime.

## Dependency Direction

```text
apps/bridge-cli   -> packages/bridge-core
apps/bridge-cli   -> packages/bridge-runtime
packages/runtime  -> packages/bridge-core
```

Rules:

1. Keep reusable transport logic in `packages/`.
2. Keep command parsing and terminal output in `apps/`.
3. Do not create package dependencies that point from `packages/` back into `apps/`.
4. Do not add desktop-only compatibility layers. The repository is CLI-only.

## Pairing entry points

`clawket pair` keeps the legacy automatic OpenClaw/Hermes pairing output for older App versions and agent prompts. `clawket pair choose` inventories locally available OpenClaw, Hermes, Codex, Claude Code and Pi installations, marks existing local Bridge configuration, then pairs only the backend selected in an interactive terminal. It never treats local configuration as proof that a particular phone is paired. New App prompts select the backend explicitly with `clawket pair --backend <name>`; automation should do the same. Pi also asks for a project folder.

Pairing codes and QR images remain in terminal output. OpenClaw pairing invitations no longer open a browser automatically; `clawket pair --open` and `clawket refresh-code --open` opt in to opening the page.


## Operational commands (2026-10-02 audit)

| Command | Default scope and current behavior |
|---|---|
| `pair` / `pair local` | Preserve automatic OpenClaw/Hermes pairing; `--backend` selects an additional supported backend. |
| `pair choose` | Interactive installed-backend discovery, read-only until selection; not a runtime health check. |
| `status` | Compact local-state rows for the shared services and all saved Codex/Claude Code/Pi project/device/environment configurations. Include saved local-model state as unverified. |
| `doctor` | Same inventory with findings and remedies; missing/invalid/stopped/unverified selected state returns nonzero. No offline native process or SDK startup. |
| `logs` | All saved backend logs, including legacy stderr; label each source. `--lines 1..2000`, `--last`, `--follow`, `--verbose`, `--json`. |
| `start` / `install` | Existing OpenClaw/Hermes shared service behavior. Codex/Claude Code/Pi `start` restores only their explicitly selected saved configuration. |
| `restart` | Existing shared service, or explicitly selected Agent. Confirm authenticated stop before replacement; a native-health failure is not absence. |
| `stop` / `uninstall` | Shared service lifecycle; backend `stop` affects only authenticated owned runtimes. New Agents do not claim persistent OS service installation/uninstallation. |
| `reset` | Default clears OpenClaw/Hermes local pairing; `--preview` limits the OpenClaw environment. `--backend` scopes cleanup. Codex/Claude Code/Pi reset retains Bridge and native session histories. |
| `refresh-code` | OpenClaw by default, Hermes via `--backend hermes` or the existing `hermes-refresh-code` alias. New Agent code refresh remains their existing `pair` flow. |
| `run` | Existing foreground runtime and service-launcher boundaries; each new backend keeps its own run entrypoint. |
| `help` / `--help` | Side-effect-free command help. Unknown command/backend and conflicting selectors fail before changes. |

`status` previously dumped dozens of IDs, URLs, paths and capability fields but omitted the new Agents. Those details remain under `--verbose`. Global doctor JSON preserves its legacy report fields and adds `connections` / `summary`; status JSON now works. Backend-specific status/doctor/logs use the same implementation before any config-directory creation or native discovery.

Global `--backend codex` (or Claude Code/Pi) filters the saved inventory. Add `--project`, `--device` or `--config` to select one connection. The corresponding `clawket codex status|doctor|logs` command retains its pairing-scope default. Custom configs outside the standard tree are inspected only when explicitly supplied. A removed project or corrupt config cannot prevent reading its sibling log. Inventory is bounded to 32 configs, 256 entries per backend directory, and four concurrent five-second authenticated loopback probes; excess inventory fails with an explicit selector remedy.

Logs read the final 256 KiB per source and report truncation. Timestamped lines are ordered; untimestamped legacy lines retain source order and remain visible under `--last`, with their age marked unknown. Follow reads appended bytes, preserves incomplete lines/UTF-8 and handles missing/recreated, truncated and rotated files. `--json --follow` emits JSONL. `--errors` remains accepted as the old include-stderr option; stderr is now included by default. New Codex/Claude Code/Pi callbacks use `[epoch_ms]` around their existing sanitized diagnostics, never pairing codes or native bodies. Local-model foreground output belongs to its terminal; the Windows supervisor log is `windows-service/supervisor.jsonl`.

Readiness is local evidence. OpenClaw's row combines service state with Gateway TCP reachability; Hermes checks bounded local HTTP/upstream health and whether its Relay process exists; the new Agent rows use authenticated local health. None proves current cloud attachment, the phone path or successful inference. Local-model's foreground/Windows supervisor lifecycle stays separate; the generic commands do not guess a port, start/stop its model server, or report a saved config as running.

Lifecycle changes close the Claude Code/Pi catch-all-offline gap. Explicit stop/restart/reset authenticates independently of native health via the existing native-independent agent identity fallback; failure/timeout retains the owner/config. Unknown backend values previously fell through to legacy operations, and native diagnostics could launch an offline SDK/App Server. Both paths now fail or report state without replacement. No Bridge/Relay wire contracts, pairing identities, OS autostart semantics or release versions change.
