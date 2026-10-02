# Bridge 3.1.10 release

The owner authorized a Bridge patch publication on 2026-10-02. This release starts from `main` at `accfe2f4`; the version change merged as `6314b6c9` in [PR #115](https://github.com/p697/clawket/pull/115). npm accepted the fixed candidate after owner security-key authentication and is processing public availability.

## Changes since 3.1.9

- Codex negotiates frozen session-catalog page indexes and up to three concurrent continuation reads. Compatible Apps can load a complete catalog with fewer sequential network exchanges; legacy peers retain their existing paging behavior and bounds. See [catalog contract](session-catalog-sync.md#codex-connection-latency-2026-10-02).
- Codex pair/start/doctor/status distinguish explicit connection refusal from native-health rejection, authentication failure and uncertain transport errors. An existing owner is preserved and native-health failures give explicit restart guidance. Authenticated stop/restart remains available independently of native health.
- The shared protocol removes the owner-retired backend alongside the already merged client removal. OpenClaw, Hermes, Pi, Codex, Claude Code and local-model remain supported.

Only the CLI manifest, lock entry and publication guard advance to 3.1.10; internal workspace versions remain unchanged. Catalog acceleration requires a compatible App. Publication does not upgrade or restart installed Bridges, refresh pairing, distribute an App or deploy Workers.

## Verification and delivery

Immutable candidate source `3bafda943344fc398d7eadc34edc134e05f9b2c4` passed all 11 jobs in [CI run 36979553628](https://github.com/p697/clawket/actions/runs/36979553628), including Windows and macOS. The initial Linux v1 replay failed when a legacy socket closed during its waiting assertion; its unchanged-head retry passed, as did both desktop replay jobs and both local gated replay runs. No gate or test was relaxed.

Serial local verification passed the Bridge build and package verification (three package files, four runtime boundaries, 89 modules and 131 provenance inputs), six publish-guard cases, four Codex regression files / 209 cases, 41 v1 replay cases and docs checks (seven instruction pairs / five checker cases). Relay integration passed four files / seven cases. The four current Production deployment IDs and retained snapshot source hashes matched; the isolated OpenClaw/Hermes upgrade/recovery matrix passed four cases across 24 phases. These controlled local checks do not prove phone acceptance or a Production Worker rollout.

The fixed `p697-clawket-3.1.10.tgz` is 252,450 bytes; SHA-256 `352a0be4c2e4891cf177428fa5097a5154d57b6e5cd562fa669b40cf0b663847`, SHA-1 `a8de182a9e11c6c3d8cbcc7dd98a0ad82babf6e9`, npm integrity `sha512-edU6nPEiQTPOY5YALVQpnUSjoA8i33S1bY/1ZfK1o4gx9BBoRzEvQmckbDbckQ+5L+0iHbYX0k0KjJUEO/hxsw==`. Fixed-tarball publication dry run and a fresh candidate installation with empty npm authentication configurations passed. CLI help and installed-bundle equality passed at `2026-10-02T07:40:34Z`. The publication preparation guard independently rebuilt an identical package and passed its required v1 replay/build/package/dry-run checks.

Public registry download and fresh installation verification remain pending. The artifact, isolated installations and private logs are retained on the maintainer's external SSD under `/Volumes/Lucy-SSD/clawket-release-evidence/bridge-3.1.10`.

Recovery retains public 3.1.9: install that explicit version and restart the managed Bridge with its original scope/config/environment options if needed. Changing a dist-tag does not replace a running process.
