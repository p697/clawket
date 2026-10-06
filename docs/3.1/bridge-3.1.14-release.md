# Bridge 3.1.14 release

The owner explicitly authorized a new Bridge publication from latest main on 2026-10-06. The clean source base is `350c0aa8` (PR193), refreshed before publication to `5ba5be00` (PR194). Only the public CLI patch version and its publish guard advance to 3.1.14; internal workspace and App versions remain unchanged.

## Scope

PR191 repairs Claude Code history synchronization when the official SDK returns a record without its optional cwd. Such a record cannot be assigned a project and is excluded from the native catalog without blocking eligible history. Pagination still advances across unscoped or foreign-project records. Malformed fields, duplicate identities, bounded scanning and incomplete-snapshot protections remain. Original project authorization, native history and writer ownership are preserved.

PR192 repairs Codex update preparation after a completed turn: settled starts no longer count as active work. Independent Agent runtimes are checked before the shared OpenClaw/Hermes service, and update results explain waiting, failure and the actual rollback version. Only known-defective Codex 3.1.11–3.1.13 owners may use the authenticated legacy idle proof and stop fallback. Finish active Codex tasks before updating those older versions; their migration proof is not atomic. Existing authentication, exact scope, pairing, history and rollback protections remain.

PR194 preserves native Codex step clocks through history, live events and restores so clients can retain chronological presentation. The initial artifact from source `1de6b12a` is superseded before upload because main gained this Bridge change.

This publication includes the prior Codex Desktop input compatibility repair. PR193's Mobile live release lookup is separate client code and requires a later App delivery to installed clients. Package publication does not update running Bridges or establish phone/Desktop acceptance.

## Publication gates

Require six publish-guard cases, documentation rules, dependency audits, v1 replay, fresh read-only Production Worker snapshot compatibility, exact-source CI, bundle provenance, a fixed-tarball dry run and an isolated empty-auth candidate installation. Public completion requires version/latest and a complete unauthenticated download matching the fixed candidate and npm integrity, followed by an independent public installation. Private evidence lives at `/Volumes/Lucy-SSD/clawket-release-evidence/bridge-3.1.14-20261006`.

## Recovery and acceptance

Keep public 3.1.13 available for deliberate rollback. An explicit managed update must preserve the original backend/config/project/environment. Check authenticated running versions rather than disk manifests. After updating, verify Claude All projects and single-project history refresh, older conversations, return-and-refresh and new messages; verify the existing two-computer Codex phone continuation/Desktop reopen checkpoint. No App distribution or Production Worker change is included in this authorization.

Publication checks and public verification are pending in this preparation commit.
