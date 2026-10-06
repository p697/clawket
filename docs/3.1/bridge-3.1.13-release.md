# Bridge 3.1.13 release

The owner explicitly requested a Bridge publication on 2026-10-06 after the Desktop input compatibility repair merged in PR184. The release task starts from clean main `2cbe5bdb4d42aec14ec59c83edc8bada18ca6a66`. The release branch is refreshed through main `d3d89610` to include PR183. Only the public CLI patch version changes to 3.1.13; internal workspace and App versions remain unchanged.

## Scope

Codex text submitted through native or Desktop-owned start/steer now carries `text_elements: []`. Desktop follower snapshots normalize omitted arrays in both input representations while preserving existing valid metadata, images and native identity. Malformed existing arrays fail before broadcast. This repairs the confirmed Desktop renderer crash after successful phone-originated continuation. See [incident evidence](codex-desktop-continuation-20261005.md).

The merged PR183 updater repair also resolves verified legacy npm executable symlinks to their real Clawket package entry, preserving authenticated ownership, exact backend/config scope, idle admission and rollback protections. This publication includes the current patched development toolchain. Writer ownership, submitted-turn replay and production Workers remain unchanged. It does not update installed runtimes, publish an App or establish phone/Desktop acceptance. The first failed send near an IPC reset and the intermittent transport incident remain unconfirmed causes.

## Publication gates

Require six publish-guard cases, documentation rules, dependency audit, v1 replay, current read-only Production Worker snapshot compatibility, exact-source CI, build provenance, a fixed tarball dry run and an empty-auth isolated candidate installation. Public completion requires npm version/latest and a complete unauthenticated download matching the fixed candidate and npm integrity. Private evidence lives at `/Volumes/Lucy-SSD/clawket-release-evidence/bridge-3.1.13-20261006`.

## Recovery and acceptance

Keep public 3.1.12 available. Dist-tag changes only affect future installations; installed Bridges require an explicit managed update preserving their original configuration, pairing and history. After updating both affected computers, continue existing Desktop conversations from Clawket, append during an active run, then reopen/retry on Desktop. Inspect a failed message before resending. Publication is not evidence that those acceptance steps passed.

## Publication status

Preparation and verification are in progress. No immutable npm upload or installed runtime replacement has occurred.
