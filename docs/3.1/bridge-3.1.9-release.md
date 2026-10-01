# Bridge 3.1.9 release

The owner authorized a Bridge-only npm publication on 2026-10-02 following the merged Codex Agent profile implementation. The isolated release starts from `main` at `0dc875fb`. Preparation, publication and public verification are separate states; publication is pending until the fixed candidate passes its gates.

## Changes

- Negotiated Codex `profileVersion: 1` supports native default model/reasoning for new conversations, complete installed-skill management, account quota/usage, sanitized read-only MCP and installed plugins, and bounded user/project instruction-file operations. Conditional writes and confirmed readback preserve existing thread settings; custom providers stay read-only. See [profile contract](codex-profile.md).
- New Codex/Claude connection configurations preserve saved `Product · Device name` labels through pairing. Existing identities and manually chosen names remain unchanged.
- Codex/Claude/local-model expose negotiated read-only session-activity observations without acquiring a writer or changing native history. Existing OpenClaw/Hermes paths and legacy clients retain their contracts.

The CLI manifest, lock entry and release guard advance from 3.1.8 to 3.1.9; internal workspace versions stay unchanged. Profile UI and activity indicators require a compatible App update. This task does not release an App, deploy Relay/Registry, update the owner's installed Bridge, restart user runtimes or refresh pairing.

## Verification and delivery

Required gates: exact candidate CI including macOS/Windows, affected profile/configuration/file-boundary tests, explicit isolated native profile integration, v1 replay, the isolated production-snapshot compatibility matrix, fixed package provenance and candidate installation. Verify unchanged current production anchors before reusing retained exports. Publish the exact verified tarball; then verify unauthenticated registry metadata, public download hashes and a fresh isolated public installation. Native phone acceptance remains separate; the previous profile task did not complete Android acceptance.

Candidate source, CI run, artifact hashes and public delivery evidence will be recorded here after verification. Recovery retains public 3.1.8; changing a dist-tag alone does not replace a running process.
