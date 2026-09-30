# Bridge 3.1.7 release

The owner authorized a Bridge-only publication on 2026-09-30 after confirming a phone-created Codex conversation works with the locally selected Desktop runtime. The immutable package is publicly available with `latest=3.1.7`; public download and isolated installation verification passed. Source is merged in [PR #62](https://github.com/p697/clawket/pull/62).

## Changes

Default macOS Codex discovery now prefers runnable known Codex.app / ChatGPT.app bundled executables over PATH CLI. Explicit executable selections remain authoritative; CLI-only installations retain fallback, and native version/protocol failure after selection never silently changes runtimes. The same Clawket-owned App Server supplies the model catalog and new threads. Existing Desktop-owned conversations retain their IPC route; this does not take over the Desktop app's stdio or copy native credentials.

Recognized, bounded native unsupported-model refusals now return fixed choose-model/update-Codex guidance in both live completion and history. Unknown failures retain generic privacy-safe copy, and authentication failures retain sign-in guidance. Native provider bodies are not forwarded or logged. See [the incident and verification](codex-desktop-runtime-2026-09-30.md).

Only the public CLI version, its lock entry and publish guard advance to 3.1.7; internal workspace versions remain unchanged. Mobile translations and the earlier first-scan fix require a separate App update. No Worker deployment, App distribution, installed-user upgrade, pairing refresh or owner-runtime restart is included.

## Release verification

Fixed candidate `3c76843fc1bfaa9ba45a891b89ccb682f2d3d10b` passed all 11 jobs in [CI run 36732729747](https://github.com/p697/clawket/actions/runs/36732729747). Sequential local checks passed: executable 16, history 19 and publish guard six cases; v1 replay 41; docs seven instruction pairs/five cases; a real Desktop 0.159.2 catalog/default/workspace-permission and fresh-reply integration; and the production-snapshot OpenClaw/Hermes upgrade/recovery matrix, four cases across 24 phases. The matrix reuses today's read-only production exports from the 3.1.6 release; it runs isolated local Workers and controlled model responses, not a production deployment or phone acceptance.

Package validation covered three files, four required runtime boundaries, 86 modules and 127 provenance inputs. Isolated candidate installation and CLI help passed; the installed bundle contains both Desktop-first resolution and the new model failure guidance. The immutable `p697-clawket-3.1.7.tgz` has SHA-256 `d66a0aefbecc1cefedfc0893737369d0396573c95b8ed10e71af5d6e48b88973`, SHA-1 `2157050ea1724a0dcd22d7ea43f700e466e89499` and npm integrity `sha512-hUmEDpyFxzA5uQ32+sT0WO8c36mxRHJYczuIk4Ik3q5vvel2LTwAU9e1V2puSd5y9JOj0IOrRMs/0/Pt7LmUvQ==`.

npm accepted that exact tarball on 2026-09-30, recorded at `2026-09-30T15:05:04.144Z`, after native-browser login and publish authentication. At `2026-09-30T15:06:55.437Z`, unauthenticated public registry reads confirmed version 3.1.7 and `latest=3.1.7`; the downloaded tarball matched the candidate byte-for-byte, including SHA-256, SHA-1 and npm SHA-512 integrity. A fresh installation from the public registry, with empty npm authentication configurations and an independent cache, passed at `2026-09-30T15:08:17.208Z`; the installed bundle equals the candidate and CLI help passed. The [public package](https://www.npmjs.com/package/@p697/clawket/v/3.1.7) is available. Persistent artifact and check evidence are in the maintainer's private release-evidence directory.

Initial compatibility preparation stopped because the fresh worktree had no built bridge-core entrypoint; building workspace prerequisites corrected it before the complete replay passed. No runtime source change or gate bypass was needed. Source squash commit: `92bfbceb6c6ed2e4172226bda6a1977399cc2be9`.

Recovery retains public 3.1.6: explicitly install that version and restart the managed Bridge if recovery is needed. A dist-tag change does not replace a running process.
