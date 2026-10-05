# Bridge 3.1.12 release

The owner explicitly requested another Bridge publication on 2026-10-05 after PR175 merged. Preparation starts from clean main `7bd62f45fde4af7012285a4b335259b008f6c6ac`, in a separate release task worktree. The public CLI patch version is 3.1.12; internal workspace and App versions stay unchanged.

## Scope

Includes the existing Desktop continuation repair: all owner discovery requests explicitly scope `hostId=local`, foreign or malformed host scopes fail before dispatch, and only a read-only owner query may reconnect and retry once after socket loss. Submitted turns/settings are never replayed and exclusive writer checks remain in force. Fixed-category Desktop IPC diagnostics contain no native messages, errors, identities, paths or credentials. See [incident evidence](codex-desktop-continuation-20261005.md).

Only the npm Bridge package is authorized here. No App distribution, Worker deployment, pairing refresh, native thread write or automatic user runtime replacement is included. The current installed Bridge3.1.11 does not receive this repair until an explicit managed update. Owner phone-originated continuation and Desktop reopen/Retry acceptance remain pending; the initiating cause of the earlier native IPC reset is unconfirmed.

## Publication gates

Verify the six publish-guard cases, documentation rules, dependency audit, v1 replay, current production Worker snapshot compatibility matrix, source-specific CI, package build provenance, immutable tarball dry run and fresh isolated installation. Public completion requires npm version/latest and an unauthenticated tarball download matching the exact candidate and npm integrity. Evidence is kept privately at `/Volumes/Lucy-SSD/clawket-release-evidence/bridge-3.1.12-20261005`.

## Recovery and acceptance

Retain public3.1.11. Dist-tag changes affect future installations only; installed runtimes require an explicit authenticated version transition using their original configuration. Preserve pairing, native IDs and history. After updating, continue two affected old Desktop conversations and reopen them on Desktop; inspect prior failed messages before any manual resend.

Status: authorized preparation; no public3.1.12 upload or live runtime replacement yet.
