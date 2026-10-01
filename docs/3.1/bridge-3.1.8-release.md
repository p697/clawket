# Bridge 3.1.8 release

The owner authorized a new Bridge publication from the latest code on 2026-10-01 after the affected Mac's diagnostic confirmed a Codex catalog descriptor failure. This release starts from `main` at `d36e76af`; publication and public artifact verification are recorded below when complete.

## Changes

Codex catalogs now omit non-string optional model metadata while retaining all conversations and exact valid model names. The affected Mac had 2,823 conversations and 24 wrong-type `model` fields; both sync and legacy listing failed Mobile validation after successful authentication, health and Agent reads. The fix covers native discovery, older indexed sessions, live/archive descriptors and newly indexed native metadata without changing native model selection, ownership or history. [Diagnostic evidence](../3.0/20-connection-diagnostics.md#2026-10-01-codex-ready-connection-missing-from-the-roster).

The latest merged Bridge also includes Desktop-first Claude executable discovery on supported macOS/Windows layouts, retaining CLI-only fallback and explicit executable overrides. Native startup failures never silently switch executables, and selected-runtime model discovery and SDK sessions use the same executable. This is independent of Codex pairing. Latest shared protocol metadata remains additive; OpenClaw, Hermes and Pi contracts stay intact.

Only the CLI manifest, its lock entry and publish guard advance from 3.1.7 to 3.1.8; internal workspace versions stay unchanged. This publication does not deploy Workers or distribute the Mobile app. The earlier Agent-first/Retry-list UI fix needs a separate App update; this catalog fix can serve the existing TestFlight contract after the affected computer updates and restarts its Bridge.

## Verification and delivery

The release uses a fixed tarball with source/build provenance, serial affected tests, v1 replay, an isolated local production-snapshot upgrade/recovery matrix and exact-head CI. Candidate/public installation and download equality are checked before reporting delivery. These tests do not substitute for the original phone's acceptance or imply an installed computer has upgraded.

Recovery retains public 3.1.7: explicitly install that version and restart the managed Bridge if needed. Changing a dist-tag alone does not replace a running process.
