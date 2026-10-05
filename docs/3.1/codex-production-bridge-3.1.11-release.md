# Codex Production and Bridge 3.1.11 release

The owner authorized Codex Production service publication and a Bridge publication on 2026-10-05 for owner acceptance. Preparation starts from clean `main` at `039aac5c`. Bridge advances from public 3.1.10 to 3.1.11; internal workspace versions and the App version stay unchanged. This document records preparation until verified publication results are added.

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
