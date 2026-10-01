# Session list activity

Owner-approved 2026-10-01. Every live session tile uses the header's `PresenceRing` working arc; the two text lines, unread dot and home marker keep their existing layout. Waiting input/approval uses the existing attention dot and localized preview. Native waiting without a precise interaction type says “Needs attention”. Reduced motion holds the arc still. Cached, disconnected and unknown evidence cannot light it. Errors remain independent from activity.

Activity is presentation evidence, never proof of backend health, session ownership or permission to resume. Do not infer it from modification times, process existence, unread state or transcript previews.

| Backend | Confirmed source | Boundary |
| --- | --- | --- |
| OpenClaw | Gateway `sessions.list.hasActiveRun` and scoped live run events | Existing Gateway transport and catalog contract |
| Hermes | Clawket-managed run events and session metadata | External CLI runs without runtime evidence remain unknown |
| Pi | Clawket-owned RPC runs and session metadata | External native sessions remain unknown |
| Codex | Owned App Server runs; Desktop IPC v11 fresh snapshots for visible, authorized catalog entries | App Server `thread/list` does not prove Desktop activity; unknown/unsupported native versions remain unknown |
| Claude Code | Owned SDK runs; official read-only `claude agents --json --all` roster | Busy / idle / waiting / unknown; idle owners still own their sessions |
| Local model | Clawket conversation's live `running` state | No history download or model inference for activity reads |
| YouMind | Existing service status and scoped live run events | Preserve its existing mapping |

## Additive wire contract

Codex, Claude Code and local-model advertise `sessionActivity: 1` in authenticated health/connect. Only that exact version exposes the optional adapter `readSessionActivity(keys)`. Older Bridges retain their existing catalog/event behavior. `sessions.activity` accepts at most 32 distinct nonempty keys of at most 200 characters, scoped to already authorized/discovered sessions. It returns exactly one sanitized `SessionActivity` per key: `running`, `idle`, `waiting` or `unknown`, with optional input/approval attention. Unknown keys yield unknown. Invalid windows/replies fail closed. Codex may push a metadata-only `session_activity_update` only to an authenticated direct socket that requested the matching visible window within 45 seconds. Relay suppresses the new event because its active client can be legacy; the existing origin-routed RPC response waits at most 1.5 seconds for renewed Desktop snapshots, then returns the current evidence. No Worker contract changes are required; no message, native request or snapshot payload crosses this path.

Mobile reads the visible window only while the sheet is open, the app is foregrounded and the roster/adapter is live. The initial window is at most 12 rows until viewability is known; all windows are capped at 32. Reads are serial, have a 10-second request budget and repeat 15 seconds after settlement. Connection/window generations and per-session event revisions fence late reads. Foreground recovery starts with fresh evidence; failed reads clear their arc. Nothing is persisted in roster/history caches.

Codex catalog observations share Desktop IPC's combined 64-thread follow bound. A 45-second renewable lease expires hidden rows, checked every five seconds. Snapshot evidence independently expires after 45 seconds, even when a lease renews but its owner stops responding. Opening a chat can evict a disposable observation at capacity. Releasing an observation never releases an opened chat's permanent follow. Temporary observations cannot index records, publish chat content, load full history, resume, acquire a writer, start, interrupt or steer a turn. The existing opened-chat lifecycle remains authoritative once a session is opened.

App and Bridge updates are required for the new native observation path. Implementation, tests and merge do not publish either component or restart the owner's running Bridge.

Read-only native smoke: from `packages/bridge-runtime` in an active Codex Desktop task, run `CLAWKET_CODEX_ACTIVITY_SMOKE=1 npm run test:codex-activity-integration`. It requires the task's native thread context and observes that current running task; no history or inference request is made. Missing prerequisites fail explicitly; the native smoke is separate from the CI-safe required suite.
