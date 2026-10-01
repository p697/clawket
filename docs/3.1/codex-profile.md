# Codex Agent profile

Owner decision, 2026-10-01: expose default model and reasoning, complete installed skill management, prominent native quota, read-only MCP and installed plugins, and paid instruction-file editing in the existing 3.0 Agent profile.

`health.profileVersion === 1` negotiates `profileManagement`. Older Bridges retain their existing model/skill views. The runtime-neutral `AgentProfileOperations` contract is separate from session settings and native thread ownership; none of its reads or configuration writes resumes a thread or starts inference. OpenClaw, Hermes, Pi and Claude Code retain their existing capability gates.

## Native operations

- Defaults read the same owned App Server's model catalog and effective native config. Writes consume an opaque snapshot, compare the native user-layer version and canonical effective-config fingerprint, use `config/batchWrite` with `expectedVersion` and `reloadUserConfig: false`, and confirm by rereading. Only `model` and `model_reasoning_effort` change; null removes an explicit default. These are defaults for new conversations; existing conversation settings remain separate. An uncertain write is never retried automatically. Custom provider defaults remain readable with desktop guidance; the shared OpenAI catalog never overwrites an unverified custom provider model.
- Skills list all native entries, including disabled skills, for one discovered/authorized project, with user/project/system/plugin scope and native discovery-error count. Refresh forces native reload. Enable/disable confirms native readback; `SKILL.md` is readable, with user/project sources editable and system/plugin sources read-only. Use in a new chat creates an owned conversation in the selected project and inserts a draft, without sending it.
- Usage displays all native quota buckets/windows, plan, optional lifetime tokens and recent daily token totals. The profile's large percentage is the lowest remaining percentage across known windows, clamped to 0–100. Missing authentication, API-key-only accounts, unavailable token summaries and unknown resets retain explicit unknown values; they are never reported as zero usage or full quota.
- MCP projects bounded native tools/auth status only. Installed plugins project names, descriptions and enabled state for the selected project. Both pages say to change configuration on the computer; there are no MCP/plugin writes. Failed native tool discovery is shown as unavailable, not an empty successful catalog.
- Instructions include native user and selected project root `AGENTS.md`, plus existing `AGENTS.override.md`. Missing `AGENTS.md` can be created. Only Bridge-issued opaque handles can be read or written; arbitrary paths are never accepted. UTF-8 regular single-link files are limited to 128 KiB, symlinks and linked directories are rejected, versions are content hashes, and same-directory atomic writes recheck the loaded hash and current runtime generation. Conflicts preserve the phone draft. The shared DocumentScreen applies the existing `coreFileEditing` Pro gate at Save, including file creation; reading remains free.

Only explicit `profile.*` methods are dispatched. Restart/stop retires document handles and default snapshots. Mobile validates entire replies, fences reads and mutations by adapter/project/focus, displays confirmed native values and keeps offline/failure states distinct from empty results. MCP pagination is bounded to 500 servers, 2,000 tools per server, 4,000 total and a 6 MiB projected reply; credentials, config, schemas and native error bodies never enter this projection.

## Verification

Self-contained contract, corrupted-reply, configuration conflict, file-boundary and UI tests run in the ordinary CI gate. The explicit native integration requires an installed supported Codex:

```sh
CLAWKET_CODEX_PROFILE_NATIVE=1 npm run test:codex-profile-integration --workspace packages/bridge-runtime
```

It creates an isolated `CODEX_HOME` and project, persists/restores model defaults, toggles a fixture skill and creates/reads/writes a fixture instruction file. It copies no credentials, performs no inference and stops its owned native process. `CLAWKET_CODEX_PROFILE_COMMAND` optionally selects a native executable. Missing prerequisites fail rather than skip. Local verification is separate from Android acceptance and from publishing an App/Bridge update.
