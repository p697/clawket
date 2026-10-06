# Bridge 3.1.15 release

The owner authorized a small Bridge publication from latest main on 2026-10-06. The clean source base is `44db3569` (PR197), refreshed to `19ec342e` (PR199) before packaging. Only the public CLI patch version and publish guard advance to 3.1.15; internal workspace and App versions remain unchanged.

## Scope

PR196 adds authenticated phone-started Bridge updates through parameterless start and read-only status controls. The updater runs outside the requesting runtime's process tree, serializes updates on that computer, and preserves stopped scopes, configuration, pairing and history. Development layouts and independently supervised local-model runtimes do not advertise it. The phone UI requires a separately delivered compatible App.

PR197 makes explicit update and Codex/Claude Code pairing refresh proceed without waiting for replies. An update interrupts running Bridge replies through authenticated lifecycle control or a verified owner PID; pairing refresh restarts only its own Bridge. It also removes confirmed exited-owner records and keeps OpenClaw shutdown signal handlers through cleanup, repairing the observed 3.1.14 update rollback after repeated service-stop signals. Existing native Desktop/terminal work, backend scope and ownership checks remain authoritative.

This package includes all prior Bridge fixes, including Claude history without optional cwd, Codex Desktop input compatibility and native step clocks. Publication does not update running Bridges or establish phone/Desktop acceptance. No App distribution or Production Worker deployment is included.

## Publication gates

Require six publish-guard cases, documentation rules, both lockfile dependency audits, v1 replay, fresh read-only Production Worker snapshot compatibility, exact-source CI including Windows/macOS, bundle provenance, fixed-tarball dry run and isolated empty-auth candidate installation. Public completion requires version/latest and a complete unauthenticated download matching the fixed candidate and npm integrity, followed by an independent public installation. Private evidence lives at `/Volumes/Lucy-SSD/clawket-release-evidence/bridge-3.1.15-20261006`.

## Recovery and acceptance

Retain public 3.1.14 as the previous package for deliberate recovery; its updater/shutdown defects remain documented in [Bridge updates](../bridge-updates.md). An explicit managed update must retain the original backend/config/project/environment and verify the authenticated running version. Replies still running are interrupted. Keep existing Claude history and two-computer Codex continuation/Desktop reopen acceptance checkpoints; compatible Mobile delivery is separate. This publication does not execute a runtime update.

## Verified candidate

Immutable source `56991532c948874dadc685cbb691da52f041add7` passes all eleven jobs in [CI37423086387](https://github.com/p697/clawket/actions/runs/37423086387), including Windows/macOS and v1 replay, and contains latest main `19ec342e`. Six publish-guard cases, eight instruction pairs/five documentation checker cases, local v1 five files/42 cases and fresh Production snapshot compatibility four cases/24 phases pass. Both lockfile audits have zero blocking advisories with the two existing owner-approved exceptions.

Package verification covers three files, four runtime boundaries, 92 modules and 143 provenance inputs. The fixed-tarball dry run and a fresh empty-auth isolated candidate install pass package identity, exact bundle bytes, update protocol and CLI help. The fixed candidate is `p697-clawket-3.1.15.tgz`, 284,360 bytes, SHA-256 `4b9440c27f6ea713d63e4ca2ffa5fddef1d9b0aacddaef882642658c48795902`, SHA-1 `ee962ed4b492c4cf3f9e0b2b591bad169fc27b49`. Bundle SHA-256 is `0786e2c1d90caa44ae0cb9428da6ef3a16e4f14d212b9a718d6537a69846bfc7`, provenance digest `c291800d78266fcc1364cb8424555ac32de76b7cc7aae3dd3535aa38079ca175`. Delivery-record edits do not rebuild or replace this artifact.

Fresh read-only verification confirms all six Production Worker source/config hashes, deployment anchors and observability settings match the prior release. No Worker was deployed.

## Verified publication

The owner completed npm's browser security-key verification. npm accepted the same fixed artifact for processing with exit zero. Initial public 404 responses were retained; the public version/latest metadata appeared before the tarball download became available.

At `2026-10-06T06:38:32.212Z` (2026-10-06 15:38:32 JST), unauthenticated public version and `latest` both report 3.1.15. A complete public tarball download matches the fixed candidate byte-for-byte, SHA-256, npm SHA-1 and SHA-512 integrity. Upload acceptance and public availability were checked separately.

A second fresh installation directly from public npm with empty user/global authentication configurations passes package identity, exact installed-bundle bytes, update protocol and CLI help (`2026-10-06T06:38:49.429Z`). Running Bridges have not been updated or restarted by this publication. Original pairing, configuration, project/environment scope and native history remain intact; phone/Desktop acceptance and compatible Mobile delivery remain separate.

For an explicit managed runtime update, run outside the Clawket repository so npx cannot select a workspace package with an old local dist:

```bash
npx -y @p697/clawket@3.1.15 update --version 3.1.15
```

The update interrupts Bridge replies still in progress. This publication did not execute the update command.

## Later main integration

After upload, main gained PR202 (`3cfc2708`), repairing the standalone local-model supervisor's start behavior across control credential replacement. This script is outside the npm CLI's packaged files and all 143 package input hashes remain unchanged after synchronization. The immutable artifact source remains `56991532`; integration CI checks the later repository state separately. No replacement upload or additional version bump is performed.
