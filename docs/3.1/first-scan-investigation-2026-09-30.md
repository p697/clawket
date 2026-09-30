# First QR scan failure, September 30

## Scope and evidence

The owner reports the installed Bridge is 3.1.6, and the iPhone is running TestFlight. OpenClaw and Codex both showed “这个后端不支持该功能” on the first scan, then connected on the second scan. For OpenClaw the owner explicitly reports reusing the same QR. The owner subsequently confirmed immediate errors with exactly one QR visible for both backends, and that the installed 3.1.0 was built from the current repository. Treat that as the source premise; the first failure's App-side reason was not recorded. The neighboring-QR candidate is excluded for these incidents.

Read-only investigation inspected local Bridge logs, bounded historical Production Registry/Relay application logs, the current mobile pairing implementation, and the latest local Xcode archive. The phone screenshot's 20:28 is UTC+08:00; the Mac uses UTC+09:00. Worker timestamps below are UTC. Matching local and cloud socket events differ by about nine seconds; do not compute cross-source latency from those clocks.

| Backend | Production evidence | Permissible conclusion |
| --- | --- | --- |
| OpenClaw | One observed `/v1/pair/claim` at 12:29:01.037, HTTP 200, 1,255 ms. A full client connected at 12:29:01.764; the bootstrap client closed normally with 1000 before the operator client connected at 12:29:06.259. Local Gateway connect responses were successful for both roles. | A claim and bootstrap-to-operator handshake succeeded. This does not prove that the first scan succeeded. |
| Codex | One observed `/v1/pair/claim` at 12:31:12.365, HTTP 200, 1,268 ms. A client connected at 12:31:13.190 with a Bridge present, followed by delivered RPC responses. | A claim and subsequent connection succeeded. This does not identify the first scan's local failure. |

No corresponding unsupported-feature rejection was observed in these historical cloud windows. Absence of a record is not proof that a request was never attempted. No owner runtime, pairing credential, native login or original turn was changed or replayed.

## Incident-era Mobile feedback and evidence gaps

`connectBackendPairingPayload` in `apps/mobile/src/connection/pairing/backend-pairing-profile.ts` validates the parsed QR before claiming it, validates the claimed result again, then saves/activates the connection. Its local guard uses `AdapterError('unsupported', ...)` for four distinct reasons:

- `backend_mismatch`: the detected backend differs from the selected backend.
- `invalid_backend`: backend hints are missing or conflicting.
- `preview_requires_debug_mode`: an official Preview code is scanned outside Debug Mode.
- `official_environment_mismatch`: the official service environment differs from the selected environment.

A missing or mismatched saved connection also uses `unsupported`. Onboarding discards the detailed message when converting the error to a generic code, and renders every such error as the same “backend does not support this feature” banner. The incident-era `pair_claim` diagnostic starts inside the HTTP claim helper, after the first local validation. Consequently, cloud logs cannot distinguish these local rejection reasons, and the current screenshot cannot distinguish them either.

The latest local September 30, 20:18 Xcode archive contains these guard strings. This establishes their presence in that artifact, not the exact build installed from TestFlight.

## Owner follow-up and controlled reproduction

The owner confirmed both errors were immediate and only one QR was visible. The camera's full-view behavior does not explain these incidents. Bootstrap waits for saved preferences before mounting the App content, so ordinary preference hydration alone is not established as the trigger.

Source inspection found that `OnboardingRoute` stored the environment/debug values from the render which opened the camera or image picker. In a controlled component test, start the scanner in Preview, update the context to Production before delivering the existing callback, then deliver a valid Production OpenClaw or Codex QR. The real payload assessment rejects the old callback's Preview selection with `official_environment_mismatch`, producing the generic banner; reopening captures Production and succeeds. Six camera/image/header regressions fail against the original source and pass after the callback reads the current handler. This establishes a stale-callback defect when settings change during asynchronous scan work, but does not prove such a context update happened on the owner's phone. No unexplained automatic environment change has been identified.

## Implemented remediation and its limits

- Scanner delivery and QR retry use the current pairing handler/environment; backend-specific entry points retain their explicitly selected backend, and the header still discovers the QR backend.
- Local rejection retains one of five typed reasons (the four payload reasons above plus `saved_connection_mismatch`). Onboarding shows actionable backend, environment, invalid-code or save feedback; genuine unsupported operations retain their existing capability message. All 19 locales are aligned.
- `connection_diagnostic` adds `operation=pair_validation`, phases `pair_payload`, `pair_claim_result`, `pair_saved_connection`, fixed `pairing_*` codes and optional allowlisted detected backend/environment. It reports `evidence=local_validation`, `network=not_sampled`; local rejection neither samples nor blames the OS/network. No QR, access code, URL, raw error, device label or identifier is added.
- Backend/environment admission, single-use claims, legacy QR and OpenClaw/Hermes contracts remain intact. Matching first parsed QR validation is covered for all six pairable backends with an empty saved connection state. These component/unit checks do not certify native camera behavior or real end-to-end pairing.

The installed TestFlight binary has not received these source changes. The owner needs an App update and a first-scan device check to establish the incident's exact trigger and verify recovery. No App package/build upload, OTA, version bump, Bridge reinstall or Production deployment was initiated. Bridge 3.1.6 and successful existing pairings remain unchanged.

Local verification, one file at a time: `backend-pairing-profile.test.ts` 21; `OnboardingRoute.test.tsx` 24; `OnboardingScreen.test.tsx` 31; `route-model.test.ts` 12; `gateway-scan-flow.test.ts` 6; `connection-diagnostics.test.ts` 10; `analytics/events.test.ts` 16 (120 cases). The six original-source failures were an intentional regression reproduction, not an unresolved candidate failure. Mobile types, strict 19-locale checks (eight checker cases), documentation (seven instruction pairs / five cases) and diff whitespace pass. Full suites run only in CI; no simulator or physical device was operated.
