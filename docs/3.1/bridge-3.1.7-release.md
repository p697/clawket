# Bridge 3.1.7 release

The owner authorized a Bridge-only publication on 2026-09-30 after confirming a phone-created Codex conversation works with the locally selected Desktop runtime. Release gates and the immutable artifact are recorded below as they complete.

## Changes

Default macOS Codex discovery now prefers runnable known Codex.app / ChatGPT.app bundled executables over PATH CLI. Explicit executable selections remain authoritative; CLI-only installations retain fallback, and native version/protocol failure after selection never silently changes runtimes. The same Clawket-owned App Server supplies the model catalog and new threads. Existing Desktop-owned conversations retain their IPC route; this does not take over the Desktop app's stdio or copy native credentials.

Recognized, bounded native unsupported-model refusals now return fixed choose-model/update-Codex guidance in both live completion and history. Unknown failures retain generic privacy-safe copy, and authentication failures retain sign-in guidance. Native provider bodies are not forwarded or logged. See [the incident and verification](codex-desktop-runtime-2026-09-30.md).

Only the public CLI version, its lock entry and publish guard advance to 3.1.7; internal workspace versions remain unchanged. Mobile translations and the earlier first-scan fix require a separate App update. No Worker deployment, App distribution, installed-user upgrade, pairing refresh or owner-runtime restart is included.

## Release verification

Candidate CI, affected tests, v1 replay, fixed package provenance, isolated installation and public registry verification must pass before completion. Persistent evidence is stored in the maintainer's private release-evidence directory; it contains the fixed artifact, hashes and bounded check results. Publication acceptance and public availability are separate states.

Recovery retains public 3.1.6: explicitly install that version and restart the managed Bridge if recovery is needed. A dist-tag change does not replace a running process.
