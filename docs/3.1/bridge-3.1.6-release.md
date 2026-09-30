# Bridge 3.1.6 release

The owner authorized a complete Bridge-only release on 2026-09-30. The fixed artifact and release gates are recorded here; the final public verification and source merge are tracked in [PR #53](https://github.com/p697/clawket/pull/53).

## Changes

Codex can finish a native turn before the Desktop start acknowledgement reaches Bridge. Once the acknowledgement confirms the exact turn ID, reconcile an already received fresh terminal snapshot so the matching run ends and reports its failure or reply. Authentication failures retain the existing fixed sign-in notice. Stale snapshots, another turn and incomplete status cannot end the run; this never replays a request or acquires another native writer.

Six regressions cover failed/completed/interrupted completion before acknowledgement and stale/foreign/incomplete evidence. The [incident investigation](codex-silent-auth-failure-2026-09-30.md) confirms an old running Bridge omitted authentication failures from phone history; it does not prove this timing boundary triggered the afternoon incident. Existing failure-history projection from 3.1.5 remains intact. Native authentication stays on the computer and is not restored by publishing a package.

The CLI manifest, lockfile and publish guard advance to 3.1.6. Internal workspace versions remain unchanged. Mobile fallback and unrelated UI changes remain outside this release and require a separate App update. No production Worker deployment, App distribution or local user-runtime installation/start is included. The owner's freshly cleaned local environment stays clean.

## Gates and public artifact

The fixed candidate source `a1831e4a3a5096927c10ae23e92f5926bc920e53` passed all four required CI jobs in [run 36712777010](https://github.com/p697/clawket/actions/runs/36712777010). Serial verification passed: Codex service 149 cases, history nine, publish guard six, docs seven instruction pairs/five checker cases, Bridge types, v1 replay 41 cases, fresh production-snapshot local upgrade/recovery matrix 24 phases, and local Registry/Relay/model/recorded-adapter integration eight cases across five files. These local matrix results do not represent a production deployment or a new phone acceptance run.

Package verification covered three files, four required runtime boundaries, 86 runtime modules and 127 provenance inputs. Isolated candidate installation and CLI help passed. Recorded adapter replay now mocks only native analytics and supplies explicit recorded thinking, retaining real reporting and exact fixture assertions; those test-only changes do not enter the npm bundle. A concurrent Android QA change required rebasing the source PR; package provenance still matches after rebase.

The immutable `p697-clawket-3.1.6.tgz` has SHA-256 `06852c7b61e0ebaa5bb7120c00052c33755798620818a7c7b7e76a6c77cb74d3`, SHA-1 `fd032e31251cd1bd10fa1bdbe521bee8d621205f`, and npm integrity `sha512-vf8qhVRV2AHYoWoKlcImJVI8/nmwA4AxaLLhrcSiEFZtD1hIKTemenD0Ige22HrCfgn4oRVHp6EdLqW53Mq7iA==`. Native browser authentication completed and npm accepted publication on 2026-09-30 at approximately 12:22 UTC. Public registry synchronization, downloaded byte identity and public installation/CLI smoke must be verified before declaring completion; their final results are recorded on PR #53. No second upload is performed while npm processes the accepted publication.

Recovery retains published 3.1.5. Installing a prior explicit version and restarting that managed Bridge is the recovery path for an already upgraded computer; a dist-tag alone does not change a running process. No unpublish or automatic installed-client upgrade.
