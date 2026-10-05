# Bridge 3.1.12 release

The owner explicitly requested another Bridge publication on 2026-10-05 after PR175 merged. Preparation starts from clean main `7bd62f45fde4af7012285a4b335259b008f6c6ac`, in a separate release task worktree. The public CLI patch version is 3.1.12; internal workspace and App versions stay unchanged.

## Scope

Includes the existing Desktop continuation repair: all owner discovery requests explicitly scope `hostId=local`, foreign or malformed host scopes fail before dispatch, and only a read-only owner query may reconnect and retry once after socket loss. Submitted turns/settings are never replayed and exclusive writer checks remain in force. Fixed-category Desktop IPC diagnostics contain no native messages, errors, identities, paths or credentials. See [incident evidence](codex-desktop-continuation-20261005.md).

Only the npm Bridge package is authorized here. No App distribution, Worker deployment, pairing refresh, native thread write or automatic user runtime replacement is included. The current installed Bridge 3.1.11 does not receive this repair until an explicit managed update. Owner phone-originated continuation and Desktop reopen/Retry acceptance remain pending; the initiating cause of the earlier native IPC reset is unconfirmed.

## Publication gates

Verify the six publish-guard cases, documentation rules, dependency audit, v1 replay, current production Worker snapshot compatibility matrix, source-specific CI, package build provenance, immutable tarball dry run and fresh isolated installation. Public completion requires npm version/latest and an unauthenticated tarball download matching the exact candidate and npm integrity. Evidence is kept privately at `/Volumes/Lucy-SSD/clawket-release-evidence/bridge-3.1.12-20261005`.

## Recovery and acceptance

Retain public 3.1.11. Dist-tag changes affect future installations only; installed runtimes require an explicit authenticated version transition using their original configuration. Preserve pairing, native IDs and history. After updating, continue two affected old Desktop conversations and reopen them on Desktop; inspect prior failed messages before any manual resend.

## Verified publication

Source head `dd08ceb455a8c1c3bb5c1cf0a7144019f40e82e2` passes all eleven jobs in [CI37313256838](https://github.com/p697/clawket/actions/runs/37313256838), including Windows/macOS Bridge compatibility and the v1 replay. Six publish-guard cases, eight instruction pairs/five checker cases, v1 five files/41 cases, and the fresh Production snapshot matrix four cases/24 phases pass. The dependency audit has zero blocking advisories, with the two existing owner-approved exceptions; this is not a claim of zero vulnerable packages. All six inspected Production Worker anchors/source hashes match the prior release. No Worker was deployed.

Package verification covers three files, four runtime boundaries, 91 runtime modules and 141 build-provenance inputs. Fixed-tarball dry run and an empty-auth isolated candidate installation pass, including installed-bundle byte equality and CLI help. The immutable artifact is `p697-clawket-3.1.12.tgz`, 277,198 bytes, SHA-256 `c99678d48b64a5f5ac660ef9b34e7114b0b37cc0d2b1440b37dc71f54c9968c1`, SHA-1 `df7a3df23404d877395a57e68bb1ef7a782e2bea`.

The first npm security-key request expired without publication. The owner completed the renewed authentication; npm accepted the immutable upload for processing. Several initial public lookups returned 404 and are retained. At 2026-10-06 00:48:21 JST (`2026-10-05T15:48:21.187Z`), public version and `latest` both report 3.1.12. An unauthenticated complete download matches the candidate byte-for-byte and by SHA-256, npm SHA-1 and SHA-512 integrity.

A second fresh installation directly from public npm with empty user/global authentication configurations passes package identity, exact installed-bundle bytes and CLI help. No user runtime has been updated/restarted. The observed Codex Production owner still runs 3.1.11. Use the original explicit config/project when applicable; for the saved default Production device scope, run:

```bash
npx -y @p697/clawket@3.1.12 update --backend codex --version 3.1.12
```

This command is an owner acceptance step; publication did not execute it. No App has been rebuilt or distributed. The old-thread phone and Desktop reopen acceptance remains pending after updating.
