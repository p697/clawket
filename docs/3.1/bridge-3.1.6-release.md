# Bridge 3.1.6 release

The owner authorized a complete Bridge-only release on 2026-09-30. Preparation is in progress; this document will record the fixed candidate, gates and public verification before publication is declared complete.

## Changes

Codex can finish a native turn before the Desktop start acknowledgement reaches Bridge. Once the acknowledgement confirms the exact turn ID, reconcile an already received fresh terminal snapshot so the matching run ends and reports its failure or reply. Authentication failures retain the existing fixed sign-in notice. Stale snapshots, another turn and incomplete status cannot end the run; this never replays a request or acquires another native writer.

Six regressions cover failed/completed/interrupted completion before acknowledgement and stale/foreign/incomplete evidence. The [incident investigation](codex-silent-auth-failure-2026-09-30.md) confirms an old running Bridge omitted authentication failures from phone history; it does not prove this timing boundary triggered the afternoon incident. Existing failure-history projection from 3.1.5 remains intact. Native authentication stays on the computer and is not restored by publishing a package.

The CLI manifest, lockfile and publish guard advance to 3.1.6. Internal workspace versions remain unchanged. Mobile fallback and unrelated UI changes remain outside this release and require a separate App update. No production Worker deployment, App distribution or local user-runtime installation/start is included. The owner's freshly cleaned local environment stays clean.

## Gates and public artifact

Pending: serial affected tests, v1 replay, production-snapshot local release matrix, Registry/Relay local integration, required CI on Linux/macOS/Windows, package contents/provenance and isolated installation smoke. Publication must preserve the exact tested tarball; public version/latest and SHA-1/SHA-512 integrity must match it before declaring success.

Recovery retains published 3.1.5. Installing a prior explicit version and restarting that managed Bridge is the recovery path for an already upgraded computer; a dist-tag alone does not change a running process. No unpublish or automatic installed-client upgrade.
