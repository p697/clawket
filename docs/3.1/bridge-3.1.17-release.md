# Bridge 3.1.17 release

The owner authorized a new Bridge npm patch and public-latest Codex pairing verification on 2026-10-12. Base `0191e116` includes PR218: use the current CLI interpreter for managed snapshots, safely recover proven-dead Codex owner locks, and classify the exact native workspace-requirements health failure without exposing native content. It also includes the intervening Hermes queue and recovery safety repairs from main.

Only the public CLI manifest/lock entry and publication guard advance to 3.1.17. Internal workspace and App versions remain unchanged. No Worker deployment is part of this release. Preserve existing pairing identity, native histories, project/device scope and other backend runtimes during the selected Codex verification.

## Verification and delivery

Require publish-guard and documentation checks, fresh audits of both lockfiles with shipped-dependency assessment, v1 replay, fresh read-only Production Worker exports and the four-case/seven-phase release matrix, exact-source CI including Windows/macOS, bundle provenance, fixed-artifact dry run and isolated empty-auth installation. Publish the fixed artifact only after those gates; independently verify public version/latest, complete tarball bytes and npm integrity, public installation, and the actual interactive Codex chooser plus authenticated local and Relay readiness.

Private evidence is retained at `/Volumes/Lucy-SSD/clawket-release-evidence/bridge-3.1.17-20261012`. Publication and latest verification are pending. Keep public 3.1.16 available for deliberate recovery.

The fresh audit reports GHSA-8r5x-fm3f-whwj and GHSA-p8wg-vrv2-v86f in Handlebars 4.7.9 through Mobile's development-only ts-jest. This is separate from the three existing approved tool exceptions. Preserve the failing audit report; verify that Handlebars is absent from the Bridge bundle/provenance and isolated production dependency tree before publication. No new audit suppression is authorized or added.
