# Bridge 3.1.18 release

The owner authorized the server rollout and a Bridge npm patch on 2026-11-08, after the five-connection QA. The source base is `adfed05f`. Only the public CLI manifest/lock entry and publication guard advance to 3.1.18; internal workspace and App versions remain unchanged.

## Scope

PR284 is the only Bridge change since 3.1.17:

- A managed snapshot removed outside the updater no longer makes every start, including the service an update launches, fail with `ENOENT` and roll back to nothing. This happened on the owner's Mac on 2026-11-08 after a disk cleanup removed the 3.1.16 snapshot.
- Status, doctor and lifecycle recognize runtimes started by any published Clawket bundle, so `npx …@latest status` no longer reports a running Hermes runtime as stopped.
- Pi and Claude Code pass an owner lock after connection refusal only when its PID is proven gone (`ESRCH`), as Codex already did. A Pi runtime that exited uncleanly on 2026-10-12 could not start again until this fix.
- Claude Code `<task-notification>` envelopes stay out of human history and previews.

No wire protocol or capability changes. Older Apps and Relays are unaffected. Publication does not update or restart installed Bridges, refresh pairing, distribute an App or deploy Workers.

## Production Relay rollout (same authorization)

PR215 (bounded legacy owner churn) and PR216 (Registry fallback must confirm `ok: true` and the requested wire role) had reached only Hermes Relay on 2026-10-07. On 2026-11-08 the other four production Relays received the same source, built from `adfed05f`; the deployed bytes match Hermes Relay's verified bundle (SHA-256 `d66d765f61cac4af80b0bda2672eaacab8baabc36ebbea7a026976a2d330cb20`).

| Worker | Previous version | New version | Deployed (UTC) |
|---|---|---|---|
| clawket-pi-relay | `e99fd95f-08e1-4c3c-a91e-e3d5ff492df3` | `21697610-08ea-418c-86c0-255af4db2153` | 2026-11-08 00:15:28 |
| clawket-codex-relay | `5049b110-5855-4f64-b10d-60646a9a5ae8` | `1b745db5-9049-4953-ac00-155eff2b71dd` | 2026-11-08 00:16:41 |
| clawket-claude-code-relay | `85531bf2-8fff-4ac2-9e16-b8d451001b04` | `168bc2fa-cc1a-4377-ad2d-9ad82c7e506d` | 2026-11-08 00:17:19 |
| clawket-relay | `267ef8c2-ef47-4e24-a2b1-dbf509fb9fdc` | `9c0a5704-1d6b-4c88-ac5f-5b38432bd34a` | 2026-11-08 00:23:37 |

Gates: local deployment configuration matched each live variable, KV, Durable Object binding, compatibility date and flags before deployment (no migration, secrets retained); fresh read-only production exports passed the four-case, seven-phase release matrix (including published 0.7.0 Bridges and rollback); each deployment ran the 44-case v1 replay. Afterwards every Relay reported healthy, read-back hashes matched, configuration was unchanged, Hermes Relay and all Registries kept their versions, and the owner's running OpenClaw, Codex, Claude Code and Pi Bridges reconnected within about one second. A simulator App then completed a real send and reply over each redeployed Relay in a dedicated test conversation. Previous versions remain the rollback targets. Private exports and logs: `/Volumes/Lucy-SSD/clawket-release-evidence/relay-roles-rollout-20261108`.
