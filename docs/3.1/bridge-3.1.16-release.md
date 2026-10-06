# Bridge 3.1.16 release

The owner authorized a Bridge patch publication from latest main on 2026-10-06. The source base is `be4ca502` (PR208). Only the public CLI manifest/lock entry and publication guard advance to 3.1.16; internal workspace and App versions remain unchanged.

## Scope

PR204 reads Claude Code current model metadata before the first prompt, preserves newer model observations and keeps native project/owner boundaries. PR206 repairs Codex streamed paragraphs and paged history ordering, preserving native item identity and late complete snapshots. The compatible Mobile presentation changes require separate App delivery.

PR208 uses Bridge Core's official clawket.ai hostname map for defaults and saved official Relay URLs. Existing pairing identities, credentials and custom Registry URLs are preserved. Production service/domain migration was completed separately; this package distributes its Bridge consumers. The package includes all earlier updater and lifecycle repairs from 3.1.15.

Publication does not update or restart installed Bridges, refresh pairing, distribute an App or deploy Workers. Native Desktop/terminal ownership, scoped projects, OpenClaw/Hermes compatibility and saved history remain authoritative.

## Publication gates

Require six publish-guard cases, documentation checks, both lockfile dependency audits, v1 replay, fresh read-only Production Worker snapshot compatibility, exact-source CI including Windows/macOS, bundle provenance, a fixed-tarball dry run and an isolated empty-auth candidate installation. Public completion requires version/latest and a complete unauthenticated download matching the fixed candidate and npm integrity, followed by an independent public installation.

Private artifacts, snapshots and verification evidence are retained at `/Volumes/Lucy-SSD/clawket-release-evidence/bridge-3.1.16-20261006`. Candidate and public verification are pending. Retain public 3.1.15 for deliberate recovery; installed-runtime updates and phone/Desktop acceptance remain separate.
