# Required CI checks

`.github/workflows/required-checks.yml` runs on pull requests and pushes to `main`. New PR pushes cancel obsolete runs; every main push completes. Keep all four protected check names: the aggregate gate, Windows Bridge/Relay compatibility, macOS Bridge/Relay compatibility, and the Git-history secret scan.

The aggregate gate requires typecheck/audit, three in-band Mobile test shards, the remaining self-contained tests/static checks, and v1 replay. The desktop selector fails closed and runs both platforms for desktop-affecting PRs and every main push. A shared OS matrix uses `fail-fast: false` so a Windows failure cannot hide the macOS result. No test, coverage threshold or security check is removed.

## Build and checkout costs

The CLI's standalone build and typecheck commands already compile Bridge Core and Runtime. Root wrappers delegate to them once. Ubuntu source-test and replay jobs need only Core's built entry; CLI tests build their own runtime dependencies, and historical replay builds its pinned Bridges independently. Relative to the previous desktop-affecting workflow, this removes twelve duplicate/unneeded TypeScript compiler invocations and two unused CLI bundle builds. Typecheck, Mobile and self-contained test jobs use shallow checkout; secret scanning, change detection and historical replay retain full history.

## Local test reliability

The compatibility harness defaults to `--inspector-port 0`, letting the OS bind a free inspector port atomically. Live OpenClaw/Hermes replay no longer probes and releases four inspector ports before starting parallel children. Explicit inspector ports remain available to other harness callers. Parallel backend startup and partial-start cleanup have real local-server tests.

Bridge Runtime uses at most two Vitest workers. Windows test/hook budgets are 15 seconds because native Python/SQLite process startup can exceed the previous five-second test budget; POSIX retains its existing time budgets. v1 client replay uses the normal 35-second Bridge owner deadline instead of a five-second deadline with 250-ms probes. The independent client liveness assertions retain the 300-ms tick, 1.2-second negotiated expiry and legacy idle-client exemption. Production timers are unchanged.

## Failure investigation, 2026-10-06

QQ mailbox notifications were matched to the latest 100 Clawket Actions runs: 72 successful, 19 failed, seven cancelled and two running at collection time. A failed run and its later successful replacement can both belong to the same PR; failure-only email does not show the successful replacement.

| Failed runs | Cause | Status at investigation |
|---|---|---|
| 11 | Dependency audit: six `braces` runs; five stale branches with `source-map-js` / `tinypool` advisories | Current main has patched pins and the two existing owner-approved, expiring exceptions. Both lockfile audits pass with zero blocking advisories. |
| 5 | Mobile assertion, ESM mock, missing protocol branch coverage, updater launch mock, Windows child-exit assertion race | Subsequent PR revisions pass; preserve these gates. The newest child-exit correction belongs to PR #197. |
| 3 | Windows Python/SQLite five-second timeout; Wrangler `bind(): Address already in use`; legacy replay socket closed during idle assertion | Address test startup contention, inspector allocation and replay owner timing. The closed-socket log did not establish a production connection failure or identify its close reason. |

Representative evidence: [Windows timeout](https://github.com/p697/clawket/actions/runs/37406746005), [local port conflict](https://github.com/p697/clawket/actions/runs/37336882662), [legacy idle replay](https://github.com/p697/clawket/actions/runs/37306063105), [stale dependency pins](https://github.com/p697/clawket/actions/runs/37400433775), and [successful replacement for the newest failed PR run](https://github.com/p697/clawket/actions/runs/37421230237).

Keep failure notifications enabled. Genuine regression, new vulnerability, expired exception or runner failure must remain visible. These changes reduce avoidable failures and repeated work; they cannot guarantee that future PRs never fail.
