# Bridge 3.1.13 release

The owner explicitly requested a Bridge publication on 2026-10-06 after the Desktop input compatibility repair merged in PR184. The release task starts from clean main `2cbe5bdb4d42aec14ec59c83edc8bada18ca6a66`. The release branch is refreshed through main `d3d89610` to include PR183. Only the public CLI patch version changes to 3.1.13; internal workspace and App versions remain unchanged.

## Scope

Codex text submitted through native or Desktop-owned start/steer now carries `text_elements: []`. Desktop follower snapshots normalize omitted arrays in both input representations while preserving existing valid metadata, images and native identity. Malformed existing arrays fail before broadcast. This repairs the confirmed Desktop renderer crash after successful phone-originated continuation. See [incident evidence](codex-desktop-continuation-20261005.md).

The merged PR183 updater repair also resolves verified legacy npm executable symlinks to their real Clawket package entry, preserving authenticated ownership, exact backend/config scope, idle admission and rollback protections. This publication includes the current patched development toolchain. Writer ownership, submitted-turn replay and production Workers remain unchanged. It does not update installed runtimes, publish an App or establish phone/Desktop acceptance. The first failed send near an IPC reset and the intermittent transport incident remain unconfirmed causes.

## Publication gates

Require six publish-guard cases, documentation rules, dependency audit, v1 replay, current read-only Production Worker snapshot compatibility, exact-source CI, build provenance, a fixed tarball dry run and an empty-auth isolated candidate installation. Public completion requires npm version/latest and a complete unauthenticated download matching the fixed candidate and npm integrity. Private evidence lives at `/Volumes/Lucy-SSD/clawket-release-evidence/bridge-3.1.13-20261006`.

## Recovery and acceptance

Keep public 3.1.12 available. Dist-tag changes only affect future installations; installed Bridges require an explicit managed update preserving their original configuration, pairing and history. After updating both affected computers, continue existing Desktop conversations from Clawket, append during an active run, then reopen/retry on Desktop. Inspect a failed message before resending. Publication is not evidence that those acceptance steps passed.

## Verified publication

Immutable source `d4087ffcb922a17fd8e2eba7768c45bd69f0ced6` passes all eleven jobs in [CI37404766720](https://github.com/p697/clawket/actions/runs/37404766720), including both desktop platforms and v1 replay. Subsequent main synchronizations affect only Mobile and documentation; all 141 bundle provenance inputs remain identical and package verification still passes. The earlier candidate `dd930e20` was superseded before uploading so PR183 is included.

Six publish-guard cases, eight instruction pairs/five checker cases, v1 five files/41 cases, the fresh Production snapshot matrix four cases/24 phases and both-lockfile dependency audits pass. The matrix's Runtime/Worker inputs did not change in the subsequent CLI updater synchronization. Audits have zero blocking advisories with the two existing approved exceptions. All six Production Worker source/config hashes and deployment anchors remain unchanged; no Worker was deployed.

Package verification covers three files, four runtime boundaries, 91 runtime modules and 141 provenance inputs. Fixed-tarball dry run and an empty-auth isolated candidate installation pass, including exact installed-bundle bytes and CLI help. The published artifact is `p697-clawket-3.1.13.tgz`, 277,707 bytes, SHA-256 `8679640f87c333e98182d551e35e4c9a405f023d97085e47f80cb113fcfb16b2`, SHA-1 `d80b0856d17a9d058c604fe071dc398f612a3f8a`.

The owner completed renewed npm login and the separate publication security-key verification. The first publication challenge expired with E404; it was renewed without an immutable upload. npm then accepted this fixed package for processing. The initial public lookup returned 404 and is retained. At 2026-10-06 11:57:08 JST (`2026-10-06T02:57:08.260Z`), public version and `latest` both report 3.1.13. A complete unauthenticated download matches the candidate byte-for-byte, SHA-256, npm SHA-1 and SHA-512 integrity.

A second fresh installation directly from public npm, with empty user/global authentication configurations, passes package identity, exact installed-bundle bytes and CLI help. No installed user runtime has been updated/restarted by this release task, and no App has been built/distributed. Phone-originated continuation, active-run append and Desktop reopen/retry acceptance remain pending after an explicit update of both affected computers. For a saved default Production Codex device scope, use the verified public CLI:

```bash
npx -y @p697/clawket@3.1.13 update --backend codex --version 3.1.13
```

Preserve an original explicit config/project/environment when applicable. This publication did not execute that command.
