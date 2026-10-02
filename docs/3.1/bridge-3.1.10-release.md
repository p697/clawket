# Bridge 3.1.10 release

The owner authorized a Bridge patch publication on 2026-10-02. This release starts from `main` at `accfe2f4`. Publication is pending verification of the fixed candidate and exact-head CI.

## Changes since 3.1.9

- Codex negotiates frozen session-catalog page indexes and up to three concurrent continuation reads. Compatible Apps can load a complete catalog with fewer sequential network exchanges; legacy peers retain their existing paging behavior and bounds. See [catalog contract](session-catalog-sync.md#codex-connection-latency-2026-10-02).
- Codex pair/start/doctor/status distinguish explicit connection refusal from native-health rejection, authentication failure and uncertain transport errors. An existing owner is preserved and native-health failures give explicit restart guidance. Authenticated stop/restart remains available independently of native health.
- The shared protocol removes the owner-retired backend alongside the already merged client removal. OpenClaw, Hermes, Pi, Codex, Claude Code and local-model remain supported.

Only the CLI manifest, lock entry and publication guard advance to 3.1.10; internal workspace versions remain unchanged. Catalog acceleration requires a compatible App. Publication does not upgrade or restart installed Bridges, refresh pairing, distribute an App or deploy Workers.

## Verification and delivery

Serial local verification passed the Bridge build and package verification (three package files, four runtime boundaries, 89 modules and 131 provenance inputs), six publish-guard cases, four Codex regression files / 209 cases, 41 v1 replay cases and docs checks (seven instruction pairs / five checker cases). The four current Production deployment IDs and retained snapshot source hashes matched. Full repository checks run in CI.

Pending: isolated Production-snapshot upgrade/recovery compatibility, fixed-tarball dry run and candidate installation, exact-head CI, npm publication and unauthenticated public download/installation equality.

Recovery retains public 3.1.9: install that explicit version and restart the managed Bridge with its original scope/config/environment options if needed. Changing a dist-tag does not replace a running process.
