# Claude Desktop runtime Android acceptance — 2026-10-01

Owner requested physical Android verification after Desktop-first discovery merged in [PR #77](https://github.com/p697/clawket/pull/77). Tested Bridge source `58f903eb04cf4e16e41d5f55ca3600310b68dcec` using a local development build and the phone's existing QA app. This run did not publish a Bridge/App package or deploy a Worker.

## Setup

- Physical Samsung SM-A566B; installed `com.p697.clawket.qa`, version `3.1.0 (30100)`. The store app and the other QA package were preserved; no APK was built or installed during this run.
- macOS has both standalone CLI and Claude Desktop. Automatic configuration stayed `claude`, without an explicit executable override. It selected Desktop's unmodified Code host runtime `2.1.284`; the owned inference child was independently observed under Desktop's runtime directory.
- Official Agent SDK, native authentication and one isolated QA project/configuration. No original Desktop conversation was resumed or taken over.
- Existing, isolated Claude Preview Registry/Relay; six-digit secure invitation claimed through the phone's normal onboarding and confirmation flow. QA Debug Mode was temporarily enabled for Preview. A first attempt while still in Production failed to resolve the Preview invitation; after selecting the matching environment, pairing succeeded.

## Results

| Check | Observed result |
|---|---|
| Secure Preview pairing | Invitation confirmation, claim and online connection succeeded. |
| New conversation | Project picker listed the isolated QA project; selecting it created an owned chat. |
| Native model catalog | Phone model sheet showed 12 native models; default selection resolved to the native model. |
| First reply | Phone displayed the requested `DESKTOP_FIRST_OK`. |
| Same-session context | Second reply returned the first turn's remembered marker. |
| Cold app restart | Force-stopped and reopened only the QA app; the connection returned online, and both replies appeared on reopening the chat. |
| Continue after restart | Third phone message returned the same remembered marker. |
| Native history | Official SDK history for the sole owned session contained the first exact reply and both later marker replies. |

Private screenshots and UI evidence remain in ignored `docs/3.0/evidence/claude-desktop-android-20261001/`; native history and QA configuration remain in the private Clawket testing directory. Pairing codes and credentials are not committed. UI assertions were made on fresh hierarchy dumps; screenshots were captured on the device and pulled as complete PNG files.

## Cleanup and limits

Removed only this run's Preview connection. The QA app returned to its original 10 saved connections, and Debug Mode returned to off. The owned Bridge exited normally, its listener closed, and its owner lock was released. Existing user Bridges, native authentication/history and the store app were preserved.

No new defect was found in this acceptance scope. This proves Android pairing and owned conversations through the automatically selected Desktop runtime on a coexistence Mac. It does not prove authentication on a separate Desktop-only account profile, native Windows behavior, QR camera scanning, or round-trip control of an existing Desktop-owned conversation. Those remaining machine checks stay under `HT-CLAUDE-DESKTOP-1001`.
