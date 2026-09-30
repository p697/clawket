# Bridge 3.1.5 release

The owner authorized a Bridge-only release on 2026-09-30. `@p697/clawket@3.1.5` is published with npm `latest=3.1.5`; public download was verified at 2026-09-30 01:51:45 UTC. No App distribution, cloud Relay/Registry deployment or local user-service restart is included.

## Changes

- Authenticated, bounded image/file delivery for OpenClaw, Hermes, Pi, Codex and Claude Code; files stay on the user's computer and transfer over existing connections without CDN/cloud persistence. See [attachment contracts](backend-attachments.md) and [OpenClaw delivery](openclaw-attachments.md).
- Additive attachment display metadata retains original text for older clients. A matching new App enables attachment cards and image actions; publishing the Bridge alone does not update mobile UI.
- Previously merged Pi pairing reuse avoids replacing a healthy authenticated owner, and Codex/Claude Code pairing labels use product names while preserving configured scope.

## Release gates

Use the fixed release branch, v1 replay, serial affected tests, package contents/provenance verification and isolated installation smoke. Public npm version/dist-tag and downloaded tarball integrity must match the candidate before declaring publication complete. Preserve the old `3.1.4` package for recovery; never unpublish or silently change existing installations.

Local preparation and public verification results are recorded below. Private package/evidence paths must contain no committed credentials. Internal unpublished workspace versions remain unchanged; CLI manifest, lockfile and publish guard are `3.1.5`.

## Validation findings

The first candidate CI caught two Hermes recorded-health expectations missing the additive artifact capability; both were corrected without changing historical fixture payloads. The next CI passed all functional/type/documentation gates (including 382 Mobile suites / 4,644 cases), both macOS/Windows Bridge jobs and v1 replay, but its final audit blocked publication on `undici@7.29.0` in the development Miniflare toolchain. Updated Wrangler to 4.144.0 with its matching Miniflare 5.20260926.1-alpha / workerd 1.20260926.1 and patched undici 7.29.1; no transitive native override or lowered audit threshold. The [upstream advisory](https://github.com/advisories/GHSA-w293-vg96-wgc3) includes the patched version. This toolchain is not a dependency of the published CLI. Both lockfile audits and compatibility replay passed again, and the package was rebuilt to stamp the new lockfile provenance. Root audit retains 19 moderate / 1 low findings; the Mobile audit retains 16 moderate findings. Neither has high or critical findings.

## Published artifact and evidence

- Package: [@p697/clawket 3.1.5](https://www.npmjs.com/package/@p697/clawket/v/3.1.5); `latest` is 3.1.5.
- Candidate source: `de5fc93ce324a15ad14b6be38a975fa83882c6d0`. [CI run](https://github.com/p697/clawket/actions/runs/36655733072) passed required checks, macOS/Windows compatibility and secret scanning. Subsequent release-record edits do not change the artifact.
- SHA-256: `24c5b832c2228ab58ea49eefa5b79fa0cd75af9a410fe36be70b5b8473a13716`.
- npm SHA-1: `d0921e529f0dcf5359fbfec301a09278b1872e25`. The public tarball is byte-identical to the fixed candidate; npm SHA-1 and SHA-512 integrity both match.
- Build, package allowlist/provenance, publish dry-run, isolated candidate installation and public registry installation passed. CLI `help` and installed manifest version were checked; the CLI does not provide a `--version` command.
- v1 replay: 5 files / 41 cases. Fresh read-only production Worker exports: release matrix 4 cases / 24 phases. Registry/Relay integration: 4 cases. These are local integration results, not a production deployment or Cloudflare rollback exercise.
- Focused checks include delivered artifacts (8), OpenClaw artifacts/runtime (11/66), Hermes recorded packets (2), Pi service (28), Mobile attachment/history regressions (36), Mobile Pi adapter (7), Mobile types and documentation checks. Pi legacy inline image history is retained; new clients explicitly opt into artifact projection.
- Android PNG/TXT delivery, restart/history and content hashes were verified in isolated QA. Physical iOS attachment interactions and fresh native Codex image generation were not verified in this release.

Upgrade with `npm install -g @p697/clawket@3.1.5`, then restart the managed Bridge using its normal lifecycle. Existing user installations were not upgraded or restarted by this publication. Updated attachment UI still requires the matching App release. No Production Relay/Registry deployment, CDN or cloud payload storage was introduced.
