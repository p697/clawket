# Codex Production and Bridge 3.1.11 release

The owner authorized Codex Production service publication and a Bridge publication on 2026-10-05 for owner acceptance. Preparation starts from clean `main` at `039aac5c`. Codex Registry is deployed and public npm `latest` is 3.1.11; internal workspace versions and the App version stay unchanged. Local running Bridges and App installs are separate acceptance steps.

## Scope and risk

Bridge includes the merged Codex session continuation, native settings, history identity and pagination repairs, plus the already merged managed-update command. The package includes the complete current Bridge tree; OpenClaw, Hermes, Pi and Claude Code compatibility must be preserved. Mobile UI/native repairs require a separately built App and are not delivered by npm publication.

Cloud inspection is limited to existing Codex Production Relay and Registry, with read-only OpenClaw/Hermes snapshots for the release compatibility matrix. Preserve all pairing state, secrets, namespaces, bindings, domains and compatibility dates. Do not introduce a migration or change other backends' deployments. A matching live service can be retained rather than needlessly redeployed.

Material limits remain: the original Desktop reopen/Retry failure has no completed GUI acceptance; the latest combined Bridge real inference/control rerun was blocked by native authentication; the original idle Mobile blank remains unresolved. Automated compatibility and bounded earlier phone results do not close these limits. Publication supports owner acceptance, not a claim that every Codex failure is fixed. A Worker deployment or an explicit Bridge update can cause a recoverable connection interruption.

## Gates and delivery

Before rollout, verify fixed-source CI, dependency audit, v1 replay, current Production snapshot upgrade/recovery matrix, package build/provenance, fixed tarball dry run and fresh isolated installation. Compare cloud source hashes and safe configuration before and after any Codex deployment. npm completion requires public metadata and downloaded tarball integrity verification; an accepted upload alone is not completed publication.

Publication does not replace an installed or running Bridge. Local acceptance requires an explicit managed update/restart with original scope and configuration, and a fresh App native build for the Mobile repairs. No App packaging/upload/store release or automatic local runtime update is included here.

## Recovery

Retain public `@p697/clawket@3.1.10` and the inspected Codex production versions/settings. Restore the recorded compatible service version only after confirming its configuration and namespace compatibility. npm dist-tag changes affect future installs; installed Bridges require explicit version installation/restart. Local protocol recovery tests do not prove a Cloudflare control-plane rollback.

Private evidence lives at `/Volumes/Lucy-SSD/clawket-release-evidence/codex-production-bridge-3.1.11-20261005`. Credentials, pairing payloads, native messages and raw native errors must remain absent from this document.

## Verified rollout

Fixed source `819a52898cae0121ffc395ecffd50ccdce6c018a` passes all eleven jobs in [CI 37304153413](https://github.com/p697/clawket/actions/runs/37304153413). The owner-approved existing braces/node-forge exceptions remain in force; the dependency gate reports zero blocking advisories, not zero vulnerable packages. Publish-guard six cases, documentation checks, v1 replay five files/41 cases, Codex isolated Relay integration and the fresh Production-snapshot matrix four cases/24 phases pass serially. The first replay run failed because the fresh task tree lacked built Bridge Core exports; build and unchanged-source replay passed, with the original failure retained.

Codex Registry published on 2026-10-05 at 11:44:01 UTC, version `d9391209-328e-4cd2-ae70-d1e77e311808`, deployment `e641c8b3-12e5-499b-be0e-d07ee6587251`. Read-back source SHA-256 is `6d59fa44dd139432807e57fdc11887274993ed7dd18d0ea95b5cfde1a94624eb`, exactly matching the fixed uploaded bundle. Its previous compatible version is `c5d0b864-e632-4871-9765-8750a6beff8f`, source `5ffd9eef69460f78ba3d5d0269f57159bd646f5c2bf4d452fc3106ee6b76f87e`. Changes add recognition of existing negotiated handshake capabilities and sanitize Registry logging; pairing storage and resource identities do not change.

Codex Relay is retained at `218bc62c-3b34-4b16-b027-1b43dc0643e7`: the candidate and live bundle match byte-for-byte, SHA-256 `22afaffeb4c5cf65710ff4fc83f965cf30c23f7fd4c9668f05151e4aef33ff91`. Both Codex services preserve all bindings, parameters, compatibility dates, existing DO/KV identities and secret names; invocation logs/traces remain off and query redaction on. Read-back OpenClaw/Hermes source hashes, deployment/version IDs and bindings are unchanged. Pi/Claude services were not targeted.

A new owned Production pairing passed Registry health, candidate transport-owner readiness, claim, authenticated health, controlled sessions, saved-token reconnect, access-code refresh/new claim and continued use of the prior token. The exact test pairing KV record was deleted and its absence verified. All test sockets and the controlled owner stopped. These are real Production networking checks with a controlled backend, not native inference or phone/Desktop UI acceptance.

The immutable package has three files, four runtime boundaries, 91 runtime modules and 141 provenance inputs. Fixed-tarball dry run and a fresh installation with empty npm auth configs pass; the installed bundle matches the candidate and CLI help succeeds. Artifact `p697-clawket-3.1.11.tgz`: 276,870 bytes, SHA-256 `998fe071e1ef678976497ae1cee8d49f3b19fa51813bfaffab9de5fd1ff01b55`, SHA-1 `dbb9dd27d096311c5060ab378f5287508b77aa99`. Owner npm login and separate security-key authentication completed. npm first accepted the upload for processing; public version/latest and unauthenticated tarball download were then verified at 2026-10-05 11:47:49 UTC against the immutable candidate, including SHA-256, npm SHA-1 and SHA-512 integrity. The first public lookup returned 404 during processing and is retained.

A second fresh installation from public npm with empty user/global npm authentication configurations passes package identity, installed-bundle byte equality and CLI help. The public package includes `clawket.updateProtocol: 1`; owners can update a saved default Codex Production device scope using `npx -y @p697/clawket@3.1.11 update --backend codex --version 3.1.11`. Existing explicit project/custom configurations require their original `--project`/`--config`. No local user runtime has been upgraded or restarted by this publication task, and no acceptance App has been built.
