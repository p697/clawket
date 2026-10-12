# Bridge 3.1.17 release

The owner authorized a new Bridge npm patch and public-latest Codex pairing verification on 2026-10-12. Base `0191e116` includes PR218: use the current CLI interpreter for managed snapshots, safely recover proven-dead Codex owner locks, and classify the exact native workspace-requirements health failure without exposing native content. It also includes the intervening Hermes queue and recovery safety repairs from main.

Only the public CLI manifest/lock entry and publication guard advance to 3.1.17. Internal workspace and App versions remain unchanged. No Worker deployment is part of this release. Preserve existing pairing identity, native histories, project/device scope and other backend runtimes during the selected Codex verification.

## Verification and delivery

Require publish-guard and documentation checks, fresh audits of both lockfiles with shipped-dependency assessment, v1 replay, fresh read-only Production Worker exports and the four-case/seven-phase release matrix, exact-source CI including Windows/macOS, bundle provenance, fixed-artifact dry run and isolated empty-auth installation. Publish the fixed artifact only after those gates; independently verify public version/latest, complete tarball bytes and npm integrity, public installation, and the actual interactive Codex chooser plus authenticated local and Relay readiness.

Private evidence is retained at `/Volumes/Lucy-SSD/clawket-release-evidence/bridge-3.1.17-20261012`. Publication and latest verification are pending. Keep public 3.1.16 available for deliberate recovery.

The fresh audit reports GHSA-8r5x-fm3f-whwj and GHSA-p8wg-vrv2-v86f in Handlebars 4.7.9 through Mobile's development-only ts-jest. This is separate from the three existing approved tool exceptions. Preserve the failing audit report; verify that Handlebars is absent from the Bridge bundle/provenance and isolated production dependency tree before publication. No new audit suppression is authorized or added.

## Fixed candidate evidence

Immutable source `25833c5d52ca69b9f52fa5f6f4849798ee395e24` passed all eleven jobs in [CI38259330340](https://github.com/p697/clawket/actions/runs/38259330340), including Windows/macOS. Local checks passed six publish-guard cases, eight instruction pairs/five documentation regressions, two complete v1 replays (five files/44 cases each), and fresh production snapshots across four cases/28 service phases. The six Production Worker source/config hashes, deployment anchors and observability settings remained unchanged across publication.

The fixed artifact is `p697-clawket-3.1.17.tgz`, 287,357 bytes, SHA-256 `402d1654391b80e52311ae53438f70ace4cde7d6ba198703bf05165d059778f3`, SHA-1 `fb8cc2d76cf81afc83464f6a7eff94d393ec70d6`. Bundle SHA-256 is `8b1e12ad228ba563821e47c4515b170cdff657bcd11b8cf40ff96cc3c9f6d865`; provenance digest is `998843575a556c1881c303b04c296406a53a5282d9df740e8b03621cd6b64222`. Verification covers three files, four runtime boundaries, 93 runtime modules and 145 source inputs. Fixed-artifact dry run and empty-auth candidate install pass identity, exact bundle bytes, update protocol and help. Delivery-record changes do not rebuild or replace the artifact.

The new Handlebars dependency is absent from the Bridge bundle, its provenance and all 147 entries in the isolated candidate installation lockfile. Its two critical advisories concern an unshipped Mobile test tool; the report remains failing with no suppression added. Existing owner-approved tool exceptions remain unchanged.

The owner completed separate npm login and publication security-key challenges. npm accepted the fixed artifact with exit zero; initial public 404 responses are distinct from upload acceptance and remain recorded.
