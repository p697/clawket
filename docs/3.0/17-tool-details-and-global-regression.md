# Tool details and continued global acceptance — 2026-09-06

The owner requested a more polished tool-detail sheet and continuation of the unfinished visual, functional, and three-backend connection acceptance. Native acceptance resumed after the owner returned. The ledger below records actual observations; it is not a full-app or prolonged real-device stability sign-off.

## Tool-detail implementation

- Retain the shared Sheet header, surfaces, typography, spacing, and 44-point controls. Show a readable tool title; keep its full protocol identifier selectable in Execution details.
- Separate state and duration from the header. Duration cannot wrap; zero-resolution timing displays `<1 ms`, invalid/missing timing stays absent. Running/error/empty-output states do not claim successful output.
- Input and output have section-level copy actions with copied/failure feedback. Copy always preserves the complete original payload. Initial native rendering is bounded to 6,000 characters, with explicit expansion for longer output.
- JSON uses modest indentation, selectable values, accessible nested disclosure, and 50-entry pages. Timestamps and token accounting are optional secondary details.
- Six locales include the new controls. Component regressions cover status truthfulness, duration, full-payload copy, and bounded/invalid JSON.

## Live Hermes findings and fixes

The native Skills screen failed with an ImportError. The current official Hermes installation moved frontmatter/platform helpers into `agent.skill_utils` and changed the required-environment helper signature. A Clawket-owned compatibility preamble supports both installed API generations. No external Hermes source was modified. Executable isolated Python fixtures exercise both versions; the actual installation now returns 58 skills.

Management Python execution was synchronous. Before this change, an approximately 1.3-second model listing blocked every 20 ms timer tick. The shared Hermes Python runner now uses bounded asynchronous child processes, timeouts, stop cancellation, and sanitized errors. Configuration changes are serialized; health bypasses their queue. Native-session/history reads using this runner also yield. Cancellation during history preparation or terminal tool hydration must not start a run or restore a stale final reply. The separate legacy usage-ledger SQLite subprocess path remains synchronous and is not included in this nonblocking claim.

After the change, the actual model listing took 2,038 ms with 97 timer ticks. A concurrent request against the running local Bridge returned 100 models in 978 ms, 58 skills in 144 ms, and healthy status in 2 ms. See `evidence/global-regression/hermes-concurrent-probe.json`. These are local Bridge measurements, not end-to-end phone latency. The Clawket-owned local Bridge was restarted; existing Relay runtimes reattached automatically. No production service, pairing state, or external Agent source was changed.

The external integration suite now resolves Python from the same installed source as runtime discovery, cleans up every Bridge, allows a bounded external-catalog timeout, and verifies the installed catalog rather than a retired hard-coded model. Provider discovery may add authenticated providers; configured provider inclusion and cache reuse remain asserted.

## Resumed native acceptance

The installed signed Release now includes history-only `unknown` tool status, skill-detail cleanup, and returning to an existing Thread from the Agent profile. A later user turn closes orphaned historical tool calls as result unavailable rather than leaving them spinning. Explicit current-turn running state is preserved. Cache/protocol projection preserves unknown state and no longer treats a tool summary as output. Regression cases cover both OpenClaw and Hermes.

Native Hermes Skills now loads 58 entries. The arxiv detail exposed duplicate Active labels and an internal managed/key row; it now has one Status row, description and supported actions. “Continue chat” previously pushed another Thread over the profile; it now pops to the nearest matching existing conversation, preserving task identity. Native Hermes navigation confirmed that Back then reaches the roster.

The saved Hermes QA connection uses the existing isolated Preview runtime. The timeout on resuming this session was caused by that local QA process having exited, while the managed local Bridge remained healthy. Restored the same QA pairing in a detached process; the App recovered automatically. This did not modify Production pairing, deploy services, or change external Hermes source. Subsequent real replies, pause/resume, background recovery and cold-launch history passed. The local relay log continued successful 15-second Bridge probes through the page walk; this alone is not proof of a continuously active mobile socket.

| Surface | Actually observed | Still unverified |
|---|---|---|
| Tool detail | Light/dark native sheet, readable title, copy feedback, execution metadata and dismissal; `tool-detail-light.png`, `tool-detail-dark.png` | Native long-payload expansion/scrolling and terminal timing; automated cases cover these |
| OpenClaw / Lucy | Main history recovered; latest-build independent QA send/reply; manual reconnect returned online; `openclaw-recovery-reply.png`, `openclaw-reconnected.png` | Post-reconnect return observation interrupted by lock; long idle/background cycle |
| Hermes chat | Real reconnect reply, pause/resume, background reply and latest-build cold-start history; `hermes-recovery-reply.png`, `hermes-paused.png` | Real-device network transitions and prolonged idle |
| Hermes profile/skills | 58 skills loaded; latest-build cleaned skill detail; Continue chat returns existing Thread, Back reaches roster; `hermes-skills-after.png`, `hermes-skill-detail-after.png` | Dark detail and other skill actions requiring intentional mutations |
| Hermes cron/files | Empty Cron state and creation drawer inspected, cancelled without creation; missing MEMORY/USER files shown honestly; `hermes-cron.png`, `hermes-cron-editor.png` | Actual cron execution and file editing |
| YouMind | Real send/reply, manual reconnect returned online, original reply retained after returning; `youmind-reply.png` | Latest-build background/cold chat re-entry and long idle |
| Other pages | Earlier native evidence retained in documents 13–16 | Remaining per-page ledger in document 13 is still open |
| Android | Prior native build evidence retained | No installed emulator; keyboard/visual acceptance remains unverified |

Screenshot paths are relative to `evidence/global-regression/`. A second Lucy QA request received “Tool detail verified.” but no tool row was emitted; this is only reply evidence, not a successful tool-execution test.

The Mac locked again at approximately 17:30 after OpenClaw reconnect. CUA explicitly reported that automatic unlock failed. No screenshots or post-lock UI checks are inferred.

## Verification

- Repository required gate: 230 Mobile suites / 2,126 tests; all workspace typechecks/tests, 151 UI sources, six locales / 6,462 translations, documentation checks passed. The final streaming cancellation changes additionally passed runtime typecheck and the complete Runtime suites.
- Historical v1 protocol replay: 35/35 passed.
- Bridge Runtime self-contained suite: 19 files / 164 tests passed. Full local suite including installed-Hermes integration: 23 files / 200 tests passed.
- Signed iPhone 17 Simulator Release build and installation succeeded. Subsequent native inspection is recorded in the resumed ledger above.
- Final Bridge build passed; the Clawket-owned service was restarted and both existing Relay clients reattached with the API healthy. No native visual pass is implied.

### Resumed verification

- Required gate passed 230 Mobile suites / 2,128 tests, workspace checks, 151 UI sources and six locales.
- Subsequent navigation change passed Mobile TypeScript and two root-stack tests, including nearest-route, cross-connection and task-session cases.
- Latest signed iPhone 17 Release build and installation passed and native Hermes skill/navigation fixes were inspected.
- Documentation gate passed after recording the historical status and navigation invariants. No new Relay/Registry/Bridge protocol deployment occurred.

## Third native walkthrough — 17:37 onward

After unlock, OpenClaw returned to the exact independent test conversation with its pre-reconnect replies intact. Walked the Advanced management menu, tool catalog, logs, channels, devices, node detail, files and file preview, Cron jobs/job detail/runs/run detail, global settings, appearance, icon picker, chat theme, Help and connection-help detail. These are observed light-mode states; no task execution, permission changes, file saves or device mutations were made.

The walkthrough exposed and corrected missing run timestamps (same-name executions could not be distinguished), squeezed schedule/timezone values, centered long execution summaries and raw millisecond durations. Reuse SettingsRow metadata, left-aligned selectable text, a bounded ScrollView and the existing duration formatter. Standard catalog profile/group labels now translate in six languages; custom labels and tool identifiers remain unchanged, and localized group labels participate in search. The latest installed signed Release visually verified schedule layout and timestamped run lists/detail.

Additional screenshots: `openclaw-logs.png`, `openclaw-devices.png`, `openclaw-files.png`, `app-icons.png`, `chat-theme.png`, `cron-plan-after.png`, `cron-runs-after.png`, under `evidence/global-regression/`. Other named pages above were inspected inline. Logs were visibly loaded, but their accessibility tree was absent in CUA; do not claim VoiceOver acceptance.

CUA drag did not produce scroll motion in either the file/run sheet or an ordinary run list (the latter opened a row instead). This is insufficient evidence of an App gesture defect. An experimental sheet gesture override was fully reverted and never installed; native scroll/drag quality remains unverified. The installed build keeps the original shared gesture behavior.

Required gate passed 230 Mobile suites / 2,129 tests, 151 UI sources, six locales / 6,510 translations. Signed Release built and installed. An additional 22 focused suites / 133 tests and TypeScript passed; docs check passed. The following experimental gesture build is not the installed acceptance build.

## Functional findings from the continued walkthrough

- Multi-Agent OpenClaw usage requests lacked an owner. The current Gateway rejects implicit `main` with multiple configured Agents. Usage and profile cost now pass the selected `agentId`; the protocol client forwards it, while Hermes removes that UI identity and preserves its native single-Agent request shape. Do not retry a failed scoped query as global usage. Recorded adapter cases cover both backends and a wire test covers both usage methods.
- Cost totals were replacing measured token totals, displaying zero above nonzero model breakdowns. Token totals now come from usage; billing amounts come from cost. Daily records merge by date without dropping usage-only dates. A zero-token billing regression covers the native failure. Latest native screenshots show Lucy 8.6M Tokens / 17 sessions and Operator 1.4M / 1 session, proving distinct owner scopes. Screenshots: `usage-lucy-after.png`, `usage-operator-after.png`.
- OpenClaw management contained implicit namespace translation keys rendered literally. The management screen/sections now use explicit namespaces; native heading reads “OpenClaw 管理.” Configuration, permissions, diagnostics and empty backups were inspected without modifying backend settings.
- Current OpenClaw doctor emits `findings` rather than legacy `checks`. Bridge normalization now preserves either format, severities and repair hints even with nonzero CLI exit. Native diagnostic detail now shows the actual MCP authorization issue instead of an empty failure summary (`diagnostics-detail-after.png`). No automatic repair or external OpenClaw changes were made.

The Clawket-owned service launcher previously used the globally installed CLI. After Bridge build and 35/35 compatibility replay, `clawket install` was run from this checkout to point the existing service at `apps/bridge-cli/dist/index.js`. Existing Production/Preview pairing files were retained; local service restart/reconnection was observed. No cloud deployment or npm publication. CLI status confirms service running, Gateway reachable and Hermes API reachable. The separate existing Hermes QA Preview relay remains running.

Final required gate: 230 Mobile suites / 2,133 tests and all workspace checks. Bridge self-contained tests: 19 files / 166 tests. Compatibility: 5 files / 35 tests. Latest signed Simulator Release installed and native usage separation verified. The earlier full Hermes integration suite remains valid for unchanged Hermes runtime code; this continuation changed only its usage query argument projection.

### Final native connection checkpoint

On the latest installed Release after the local Bridge update, Hermes retained its history and returned the exact new reply “Final recovery verified.” Its usage page loaded 80.5K tokens / 15 messages / one session (`usage-hermes-after.png`). YouMind retained the previous test exchange and returned the new reply “Final YouMind recovery verified.” The composer cleared normally and the reply remained visible in the subsequent screenshot (`youmind-final-reply.png`). These observations close the latest-build YouMind re-entry/reply gap above; OpenClaw post-reconnect history was also verified during the third walkthrough.

This is successful native recovery and request/reply evidence for the three saved QA connections, not certification of prolonged mobile idle, real-device weak-network transitions, Android keyboard animation or every page. Native long-content dragging remains unverified because the automation did not reliably produce drag gestures. Final documentation checks and `git diff --check` passed.


## Owner-reported Hermes timeout — 18:45 follow-up

Owner opened Hermes and immediately saw `first_health_timeout`, despite the earlier successful replies. This disproves any inference that those short request/reply checks established durable connection stability. The UI later recovered before manual retry during inspection; that recovery does not invalidate the reported failure.

The QA runtime log showed continued local Bridge health responses while cloud application traffic was absent, then a Relay close with code 1006 near the failure window. The runtime had no independent active cloud WebSocket probe: local health and an HTTP room-status check cannot establish that its existing cloud socket carries traffic. This is a confirmed detection gap and a plausible contributor, not a packet-level proof of the original network failure.

Hermes Relay now sends matched transport ping/pong probes every 15 seconds with a 10-second pong deadline, recycles/terminates a half-open cloud socket, ignores late frames from the replaced socket, and clears all probe timers on stop. Transport pong does not mark the backend ready or reset its handshake backoff. Application `health` requests are included in payload-free routing traces. Reconnecting the cloud leg also re-arms the independent local health schedule when the existing local socket is reused. OpenClaw protocol/deployment units are unchanged.

Regression cases cover healthy local Bridge + missing cloud pong, unrelated pong, successful repeated pong, stale frames and pending-deadline cleanup. Actual QA Preview now receives matching cloud transport pong responses; further native idle/re-entry checks are recorded below. No mobile timeout was increased and the error banner was not suppressed.


### Follow-up verification

- Final required gate passed: 230 Mobile suites / 2,133 tests; Runtime self-contained 19 files / 169 tests; all workspace checks. Focused Hermes Relay suite: 16 tests. Historical compatibility: 5 files / 35 tests. Bridge build and local service restart succeeded; no cloud deployment or App timeout change.
- Updated the existing QA process, preserving its pairing, and gave its local harness a stable instance identity for later restarts. Replacement briefly received owner-lease 409 responses before normal admission; this was during the deliberate process update, separate from the original owner-reported timeout.
- With no active Hermes App connection, 12 cloud pongs arrived over roughly three minutes. Returned from the home screen via YouMind to Hermes at 18:54:42: its fresh health request reached the runtime and obtained a local reply, then history loaded. The native App sent a fresh test message and visibly received “Idle reconnect confirmed.” without the timeout banner at 18:55. Screenshot: `hermes-idle-recovery-after.png`; privacy-minimized timing evidence: `hermes-cloud-liveness.json`.
- These checks verify this specific idle/re-entry scenario and the deterministic half-open recovery tests. They do not establish the original network failure mechanism or certify long idle/real-device network switching. The original reported failure remains valid evidence against the earlier broad stability inference.
