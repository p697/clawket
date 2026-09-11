# Tool activity and chat reconciliation — 2026-09-06

The owner approved compact, icon-led tool rows with optional consecutive-call grouping, plus independent scheduled events without the thick rail. This supersedes the old RunCard rail recipe in `05-visual-system.md`; it does not change backend capabilities or tool execution.

## Implementation

- `ToolCallRow` owns the 44-point tool row, shared category icons, localized action names, optional single-line argument preview, running/failure feedback, and detail-sheet entry.
- Consecutive calls have a stable group identity derived from the oldest call. Expanding reveals individual rows; arrivals and completion do not reset expansion. Prose, dates, scheduled results, errors, approvals, and media break groups.
- `RunCard` now presents scheduled/subagent results with category icons and no decorative rail. Full titles may wrap; time, failure text, navigation, and log actions remain available.
- Gateway history reconciliation deduplicates cached IDs and matches tool call identity independently of missing timestamps. Untimed cached activity precedes the authoritative snapshot instead of being appended after fresh messages. ISO timestamps and OpenClaw history IDs are normalized at the adapter boundary.

## Reproduction and evidence

On the installed iOS Release build, a respectful Lucy test send was visible during the run and disappeared from the viewport after completion. Read-only Gateway and simulator-cache inspection found the matching user and assistant messages still present. The cache also contained 35 old tool entries, all without timestamps, including repeated IDs. The merger appended untimed cached entries after recent chat and used a mixed timestamp/index comparator; refreshes moved old activity ahead of the latest visible conversation. This is a confirmed ordering/reconciliation defect, not evidence that every historical message reported by the owner is available in the current server snapshot.

Regression coverage verifies repeated-merge convergence, unique IDs, canonical tool identity, ISO timestamps, group boundaries, stable group identity, preserved expansion, and detail access. Native verification and final gate results are recorded below after execution.

A second native reproduction isolated the repeated jump: ThreadScreen cleared all Cron results whenever `controller.sessions` changed, including ordinary chat token/preview updates, and asynchronously inserted them again. The final implementation keeps a connection/Agent/session-scoped successful snapshot, refreshes on Cron-specific session revisions or foreground/reconnect, and preserves it on transient errors. Tests assert that ordinary main-chat updates do not refetch jobs and that failed refreshes retain results.

Paging also exposed a duplicate streamed reply: local `final_` entries used run-start time while canonical replies used completion time. The cache matcher now allows the existing 60-second same-turn grace for optimistic terminal replies, matches one-to-one, and prevents older-page hydration from resurrecting them.

## Verification checkpoint

- `npm run check:required`: pass; Mobile 229 suites / 2,101 tests, 149 UI source files, six locales / 6,324 translations, documentation and all workspace gates.
- `npm run test:compat`: pass, 35 tests, including both backend replay paths.
- Signed iOS Simulator Release: builds and installs. Final QA-only build uses the existing `EXPO_PUBLIC_UNLOCK_PRO=1` override to exercise both saved backend connections; no subscription or production setting was changed.
- Native checks completed before the Mac locked: original missing-message reproduction; recovered `Hi` plus assistant reply; test send and response (`Test received`); subsequent send and response (`Stable reply 2`) retained after completion; tool-group expansion, single-line command previews, and complete input/output detail-sheet access; duplicate reply absent after updated history reconciliation and cold re-entry.
- Remaining native acceptance: final Cron-refresh correction during streaming, dark-mode screenshot, Hermes live send/re-entry. Mac locked after installing the final build and CUA could not unlock it. Requested user unlock; do not label these checks passed.

## Navigation and expansion follow-up

- Reproduced the owner's blank Cron thread on the installed Release build. A bounded session list could overwrite the route's explicit task key with main; the screen then waited forever for the route key. Route keys now seed history synchronously and remain authoritative during bootstrap, refresh, and metadata refresh, including archived runs absent from the index.
- Blurring Thread previously passed a null adapter and reset the entire history scope. Secondary navigation now retains the mounted route's adapter/history, draft, expanded groups, and list instance. Focus reconciliation updates existing content. Global input/notification requests remain foreground-scoped.
- Changed the virtualized timeline to chronological order with older-history loading at the top. Group children follow their header. Native testing exposed FlashList's sticky pending bottom-autoscroll even after disabling its threshold; the final implementation uses explicit bottom-follow control that is synchronously suspended before expansion.
- All Cron cards open either the exact execution session or a recorded summary sheet. Task headers use a task icon/title plus owner/status. Cron execution views are read-only. An empty transcript shows its execution summary; `NO_REPLY` becomes a localized no-text-reply state rather than a raw protocol marker. No transcript is invented from the summary.

Native Release checks: Lucy read-only two-call test completed; collapsed/expanded screenshots show the same header position, with children below it and no delayed bottom jump. Task navigation and back retain the original date/card position; diary summary and tool-detail sheets open and close successfully. Evidence is under `evidence/thread-navigation/`. Automated checks and remaining cross-backend acceptance are recorded in PROGRESS.

## Final-turn orphan tool status

The owner reported five old main-session tools spinning after a final reply. Read-only inspection of the local OpenClaw store confirmed the session was done with a terminal assistant reply. History reconciliation previously retired orphan tools only before the latest user message. It now also retires all unmatched running tools when the loaded session explicitly reports `hasActiveRun=false`; results stay unknown rather than fabricated success. Active or unspecified run state preserves current-turn running tools. Six cross-backend cases cover inactive/active/unspecified metadata, cached tool rows and preserved success/error results. Native inspection of the exact five-call group confirmed the group and all children no longer spin, with the assistant reply retained.
