# Bridge 3.1.16 release

The owner authorized a Bridge patch publication from latest main on 2026-10-06. The source base is `be4ca502` (PR208). Only the public CLI manifest/lock entry and publication guard advance to 3.1.16; internal workspace and App versions remain unchanged.

## Scope

PR204 reads Claude Code current model metadata before the first prompt, preserves newer model observations and keeps native project/owner boundaries. PR206 repairs Codex streamed paragraphs and paged history ordering, preserving native item identity and late complete snapshots. The compatible Mobile presentation changes require separate App delivery.

PR208 uses Bridge Core's official clawket.ai hostname map for defaults and saved official Relay URLs. Existing pairing identities, credentials and custom Registry URLs are preserved. Production service/domain migration was completed separately; this package distributes its Bridge consumers. The package includes all earlier updater and lifecycle repairs from 3.1.15.

Publication does not update or restart installed Bridges, refresh pairing, distribute an App or deploy Workers. Native Desktop/terminal ownership, scoped projects, OpenClaw/Hermes compatibility and saved history remain authoritative.

## Publication gates

Require six publish-guard cases, documentation checks, both lockfile dependency audits, v1 replay, fresh read-only Production Worker snapshot compatibility, exact-source CI including Windows/macOS, bundle provenance, a fixed-tarball dry run and an isolated empty-auth candidate installation. Public completion requires version/latest and a complete unauthenticated download matching the fixed candidate and npm integrity, followed by an independent public installation.

Private artifacts, snapshots and verification evidence are retained at `/Volumes/Lucy-SSD/clawket-release-evidence/bridge-3.1.16-20261006`. Candidate and public verification are complete. Retain public 3.1.15 for deliberate recovery; installed-runtime updates and phone/Desktop acceptance remain separate.

## Verified candidate

Immutable source `ee2e35085da9e91305450f3f2dc490f8de339283` passes all eleven jobs in [CI37441584545](https://github.com/p697/clawket/actions/runs/37441584545), including Windows/macOS and v1 replay, and contains latest main `be4ca502`. Six publish-guard cases, eight instruction pairs/five documentation checker cases, local v1 five files/42 cases and fresh Production snapshot compatibility four cases/24 phases pass. The initial local v1 attempt lacked the fresh worktree's Bridge Core build; after its required prebuild, both complete replays pass. Both lockfile audits have zero blocking advisories with the two existing owner-approved exceptions.

Package verification covers three files, four runtime boundaries, 92 modules and 144 provenance inputs. The fixed-tarball dry run and a fresh empty-auth isolated candidate install pass package identity, exact bundle bytes, update protocol and CLI help. The fixed candidate is `p697-clawket-3.1.16.tgz`, 286,625 bytes, SHA-256 `7b0081e25dfeb5fe169bb21d38fa1a38a6c7d9a54a6f90bf65ae6a2c1c15367f`, SHA-1 `875acc58fed1739845b8f3571091b88b5493eb8e`. Bundle SHA-256 is `d592de9a665633d17d1d6b3e79793fa5ad9a0bc9cf1111c31199adfa5fbdbec5`, provenance digest `62941f628197cc680ecce37e48e6d287edc5421f8e6c9af8fb8967a722b7108c`. Delivery-record edits do not rebuild or replace this artifact.

Fresh read-only verification confirms all six Production Worker source hashes and deployment anchors match the completed domain migration record. Exported bytes match their recorded hashes; invocation logging/tracing remains disabled and query-string redaction remains enabled. No Worker was deployed by this publication.

## Verified publication

The owner completed npm's browser security-key verification. npm accepted the same fixed artifact for processing with exit zero. Initial public 404 responses were retained; upload acceptance and public availability were verified separately.

At `2026-10-06T09:22:43.234Z` (2026-10-06 18:22:43 JST), unauthenticated public version and `latest` both report 3.1.16. The complete public tarball matches the fixed candidate byte-for-byte, SHA-256, npm SHA-1 and SHA-512 integrity. A second fresh installation directly from public npm with empty user/global authentication configurations passes package identity, exact installed-bundle bytes, update protocol and CLI help (`2026-10-06T09:23:03.153Z`).

Read-only completion checks confirm all six Production Worker source/config hashes, deployment anchors and observability remain unchanged during this publication. The 144 packaged input hashes remain unchanged after delivery-record edits. Running Bridges have not been updated or restarted. Pairing, native history and project/environment scope remain intact; compatible Mobile delivery and phone/Desktop acceptance remain separate.

For an explicit managed runtime update, run outside the Clawket repository so npx cannot select a workspace package with an old local dist:

```bash
npx -y @p697/clawket@3.1.16 update --version 3.1.16
```

The update interrupts Bridge replies still in progress. This publication did not execute the update command.
