# Bridge 3.1.9 release

The owner authorized a Bridge-only npm publication on 2026-10-02 following the merged Codex Agent profile implementation. The isolated release starts from `main` at `0dc875fb`. The fixed 3.1.9 package is public with `latest=3.1.9`; public download and fresh installation verification passed. Source and delivery are tracked in [PR #101](https://github.com/p697/clawket/pull/101).

## Changes

- Negotiated Codex `profileVersion: 1` supports native default model/reasoning for new conversations, complete installed-skill management, account quota/usage, sanitized read-only MCP and installed plugins, and bounded user/project instruction-file operations. Conditional writes and confirmed readback preserve existing thread settings; custom providers stay read-only. See [profile contract](codex-profile.md).
- New Codex/Claude connection configurations preserve saved `Product · Device name` labels through pairing. Existing identities and manually chosen names remain unchanged.
- Codex/Claude/local-model expose negotiated read-only session-activity observations without acquiring a writer or changing native history. Existing OpenClaw/Hermes paths and legacy clients retain their contracts.

The CLI manifest, lock entry and release guard advance from 3.1.8 to 3.1.9; internal workspace versions stay unchanged. Profile UI and activity indicators require a compatible App update. This task does not release an App, deploy Relay/Registry, update the owner's installed Bridge, restart user runtimes or refresh pairing.

## Verification and delivery

Immutable candidate source `aaea314043d5142350b17821f6f7cd8384a6de39` passed all 11 jobs in [CI run 36925300211](https://github.com/p697/clawket/actions/runs/36925300211), including macOS and Windows. Serial local verification passed the Bridge build, six publish-guard cases, nine profile-boundary cases, 41 v1 replay cases and docs checks (seven instruction pairs / five checker cases). Explicit isolated native profile integration passed separately on Desktop 0.159.2 and CLI 0.153.3: saved model/reasoning defaults reached a new native thread, fixture skills enabled/disabled, and bounded instruction files were created/edited. No inference, credential copy or owner-runtime mutation was needed. Native phone acceptance remains separate; the previous profile task did not complete Android acceptance.

Four unchanged current Production deployment IDs matched the retained read-only Worker exports, with verified source hashes. The isolated OpenClaw/Hermes production-snapshot upgrade/recovery matrix passed four cases across 24 phases. This is local compatibility evidence, not a Worker deployment or original phone acceptance.

Package verification covered three files, four runtime boundaries, 89 runtime modules and 131 provenance inputs. The fixed `p697-clawket-3.1.9.tgz` is 252,071 bytes; SHA-256 `dc310497c68466c0cda333dd2d2a7623249682bf8a71db4718d1e49432251ee0`, SHA-1 `42d4bc2e1e95078ee98ebf4952f5e96177fcbd85`, npm integrity `sha512-Kuoga6FzJ8vev+g7IhS1kTkfdhxBqgw7eY/RyKeaLYJvDYTMAPN04EZZni5H9Ft0kdmNh3I81lsLJn6YytCgyA==`. A fixed-tarball publication dry run and isolated candidate installation passed; candidate CLI help and installed-bundle equality were verified at `2026-10-01T21:06:33Z`.

The owner completed native security-key authentication without sending credentials to the agent. npm accepted the exact tested tarball, recorded at `2026-10-01T21:09:21Z`, then processed it before public availability. At `2026-10-01T21:11:23.551Z`, unauthenticated registry reads confirmed version and `latest=3.1.9`; the public download matched the candidate byte-for-byte and by SHA-256, SHA-1 and SHA-512. At `2026-10-01T21:11:47Z`, a fresh public installation with empty user/global authentication configurations and an independent cache passed package identity, CLI help and bundle equality. The [public package](https://www.npmjs.com/package/@p697/clawket/v/3.1.9) is available. Persistent checks, artifact and screenshot remain in the maintainer's private release-evidence directory. Final documentation is gated by exact-head CI before merge; the published artifact retains the immutable candidate source above.

To receive these Bridge capabilities on a computer, install `@p697/clawket@3.1.9` globally and restart the managed Codex Bridge with its original project/config/preview options. Existing pairing is preserved. This publication did not update/restart any installed user runtime, distribute the App or deploy Workers; the new profile UI still requires a compatible App update.

Recovery retains public 3.1.8: explicitly install that version and restart the managed Bridge if needed. Changing a dist-tag alone does not replace a running process.
