# Bridge 3.1.17 release

The owner authorized a new Bridge npm patch and public-latest Codex pairing verification on 2026-10-12. Base `0191e116` includes PR218: use the current CLI interpreter for managed snapshots, safely recover proven-dead Codex owner locks, and classify the exact native workspace-requirements health failure without exposing native content. It also includes the intervening Hermes queue and recovery safety repairs from main.

Only the public CLI manifest/lock entry and publication guard advance to 3.1.17. Internal workspace and App versions remain unchanged. No Worker deployment is part of this release. Preserve existing pairing identity, native histories, project/device scope and other backend runtimes during the selected Codex verification.

## Verification and delivery

Require publish-guard and documentation checks, fresh audits of both lockfiles with shipped-dependency assessment, v1 replay, fresh read-only Production Worker exports and the four-case/seven-phase release matrix, exact-source CI including Windows/macOS, bundle provenance, fixed-artifact dry run and isolated empty-auth installation. Publish the fixed artifact only after those gates; independently verify public version/latest, complete tarball bytes and npm integrity, public installation, and the actual interactive Codex chooser plus authenticated local and Relay readiness.

Private evidence is retained at `/Volumes/Lucy-SSD/clawket-release-evidence/bridge-3.1.17-20261012`. Publication and public-latest verification are complete. Keep public 3.1.16 available for deliberate recovery.

The fresh audit reports GHSA-8r5x-fm3f-whwj and GHSA-p8wg-vrv2-v86f in Handlebars 4.7.9 through Mobile's development-only ts-jest. This is separate from the three existing approved tool exceptions. Preserve the failing audit report; verify that Handlebars is absent from the Bridge bundle/provenance and isolated production dependency tree before publication. No new audit suppression is authorized or added.

## Fixed candidate evidence

Immutable source `25833c5d52ca69b9f52fa5f6f4849798ee395e24` passed all eleven jobs in [CI38259330340](https://github.com/p697/clawket/actions/runs/38259330340), including Windows/macOS. Local checks passed six publish-guard cases, eight instruction pairs/five documentation regressions, two complete v1 replays (five files/44 cases each), and fresh production snapshots across four cases/28 service phases. The six Production Worker source/config hashes, deployment anchors and observability settings remained unchanged across publication.

The fixed artifact is `p697-clawket-3.1.17.tgz`, 287,357 bytes, SHA-256 `402d1654391b80e52311ae53438f70ace4cde7d6ba198703bf05165d059778f3`, SHA-1 `fb8cc2d76cf81afc83464f6a7eff94d393ec70d6`. Bundle SHA-256 is `8b1e12ad228ba563821e47c4515b170cdff657bcd11b8cf40ff96cc3c9f6d865`; provenance digest is `998843575a556c1881c303b04c296406a53a5282d9df740e8b03621cd6b64222`. Verification covers three files, four runtime boundaries, 93 runtime modules and 145 source inputs. Fixed-artifact dry run and empty-auth candidate install pass identity, exact bundle bytes, update protocol and help. Delivery-record changes do not rebuild or replace the artifact.

The new Handlebars dependency is absent from the Bridge bundle, its provenance and all 147 entries in the isolated candidate installation lockfile. Its two critical advisories concern an unshipped Mobile test tool; the report remains failing with no suppression added. Existing owner-approved tool exceptions remain unchanged.

The owner completed separate npm login and publication security-key challenges. npm accepted the fixed artifact with exit zero; initial public 404 responses are distinct from upload acceptance and remain recorded.

## Public release and Codex acceptance

At `2026-10-12T14:14:58.250Z` (23:14:58 JST), unauthenticated public version/latest both report 3.1.17 and the complete tarball matches the fixed candidate byte-for-byte, SHA-256, npm SHA-1 and SHA-512 integrity. After initial distribution 404s, a new empty-auth/cache installation resolving `@p697/clawket@latest` passed identity, exact bundle bytes, update protocol and help at `2026-10-12T14:16:48.452Z`.

Actual public `npx -y @p697/clawket@latest pair choose` selected Codex, generated a six-digit code and exited zero (29.8 seconds on the completed end-to-end run). The native command, token, device/project scope, host/port and Relay identity/owner credentials were preserved. A release probe used the actual Mobile pairing resolver: secure six-digit proof/decryption, Registry claim, authenticated Relay native health, one Codex agent, all 1,138 conversation descriptors across 11 pages, saved-client-token reconnect and consumed-code rejection passed. Only fixed categories/counts were recorded; the ephemeral test client credential was not saved. An initial probe-module ESM/CommonJS packaging issue was corrected in the external test harness before the successful run; no product change was needed.

Final pairing refresh passed in 27.6 seconds and leaves a new unconsumed invitation. Local authenticated health reports modelReady=true and full catalog validation passes. The running Codex owner resolves to the public 3.1.17 bundle and exact candidate bytes. Seventeen non-Codex state files remain unchanged (the Codex updater-owner registration is correctly replaced); no other backend was restarted, no history deleted, no native inference sent, and no physical-phone UI acceptance is claimed. The refreshed invitation is intentionally not stored in release evidence. Re-run the public chooser to display a fresh code when connecting a phone.
