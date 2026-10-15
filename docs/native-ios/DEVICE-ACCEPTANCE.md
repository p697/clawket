# Native iOS device acceptance

This log separates physical-device evidence from compilation, fixtures and CI. Private evidence stays outside Git: device identifiers, signing identity, service addresses, credentials, WebDriver sessions and screenshots are not public diagnostics. Passing a case does not complete the corresponding six-backend parity row.

## 2026-10-16 — main `39221c3d`, isolated development app

The designated USB iPhone ran iOS 27.0.1. Before every helper session, IORegistry's single USB phone was matched against CoreDevice's wired transport. Only `com.p697.clawket.nativeqa` was built/installed/operated, beside the store app, at the existing 3.1.2 version. Tracked compiled App/package inputs matched this main commit; the task worktree's four additional history-policy/test files were absent from the Xcode project and did not enter this build. Later source edits are not part of this device result. The public speech endpoint was reused from existing ignored development configuration; no service configuration changed.

| Case | Actual evidence | Limit |
|---|---|---|
| Existing QA conversation | Original synthetic connection prompt, `native-ok`, the previously executed `printf native-tool-ok` request/result and work dock remained readable. The earlier tool request was not replayed. | Hermes Local QA, not OpenClaw or Relay. |
| Background/foreground | QA was backgrounded to SpringBoard for 185.09 wall-clock seconds. Original messages remained; after controls became available, one new synthetic request returned `native-background-ok`, observed 7.016 seconds after its single Send. | A working request after resume; this does not prove a new socket/handshake, network change, Relay expiry or a backend restart. |
| Compact layout | Input x64/width292 and primary action x364/width44 fit the 420pt window. The transcribed multi-line draft also left its 44×44 Send visible. | One phone size and Chinese UI. |
| Microphone denied | First record intent showed the actual Clawket Native microphone purpose, including cloud transcription. Denial displayed the native permission explanation and Open Settings. Recording had not started. | Other OS permission/accessibility routes remain separate. |
| Settings/grant | The app's own Settings page showed its disabled microphone switch. Enabling it caused the OS to terminate QA; a new QA WebDriver session and a new record intent reached real recording without another permission prompt. | Cold launch returned to the Agent's default conversation; exact last-conversation restoration is a follow-up implementation. |
| Capture → service → draft | A synthetic spoken sentence, “Native voice input check. The blue cat is sitting beside a window.”, passed through the phone microphone, native converter and existing signed cloud service. Tap Stop inserted that exact text into the native composer. It remained unsent. The QA voice directory then contained zero PCM/files. | No music/Bluetooth/110-second/ten-minute acceptance is implied. |
| Cancel/local retention | A second capture was explicitly cancelled. The original synthetic draft remained unchanged; one recoverable recording contained 2,787,044 PCM bytes. | This capture was about 87 seconds, below the segment boundary. |
| Process restart | Only QA was terminated/relaunched. The original draft and recording restored; PCM length and SHA-256 matched the pre-restart bytes. | Navigation required choosing the known QA conversation again. |
| Explicit recovery | One explicit Retry reached editable text review after 25.735 seconds. Done closed it without insertion or chat send; the original draft remained unchanged. | The recovery helper's exact English-phrase check did not pass; count this as recovery/review evidence, not transcription-accuracy acceptance. |
| Explicit cleanup | The single test recording was deleted through its native confirmation. Its source directory then had zero PCM/files. Only the known synthetic draft was cleared. Both temporary Mac PCM copies were removed. | No other recording, conversation, store sandbox or service was deleted. |

The QA WebDriver session was closed, its own test runner stopped, zero matching native runner processes remained, and the iOS/heavy leases were released. No archive/IPA/distribution build, upload, production deploy or store-app replacement occurred.

The local evidence index is `native-main392-{acceptance,long-state,recovery-send,voice-evidence,voice-storage-evidence}.json` under the ignored native-device tooling directory. Failed automation probes are not product passes: system alerts required WDA's global alert endpoint; iOS Settings exposed a whole-row switch frame, so the actual switch position was used and the resulting permission change was verified by real capture. No failed Send was replayed.

## Remaining physical acceptance

OpenClaw device approval and inference; both backends over real Relay; forced socket loss, network switching, long suspension and owner replacement; actual media import/send/artifact viewing/share; model/permission controls across supported backends; voice interruptions, Bluetooth/music, held-release send, segment/time bounds and controlled recovery accuracy; RTL, VoiceOver, iPad and same-bundle upgrade remain pending. See `PARITY.md`, `VOICE.md`, `MEDIA.md` and `UPGRADE.md` for the broader requirements. Continue independent implementation while owner-only upgrade/release checkpoints remain undecided.
