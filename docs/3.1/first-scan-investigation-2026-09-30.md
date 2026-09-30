# First QR scan failure, September 30

## Scope and evidence

The owner reports the installed Bridge is 3.1.6, and the iPhone is running TestFlight. OpenClaw and Codex both showed “这个后端不支持该功能” on the first scan, then connected on the second scan. For OpenClaw the owner explicitly reports reusing the same QR. The actual installed TestFlight build number and the first failure's App-side reason are not yet available. No root cause or fix is certified by this record.

Read-only investigation inspected local Bridge logs, bounded historical Production Registry/Relay application logs, the current mobile pairing implementation, and the latest local Xcode archive. The phone screenshot's 20:28 is UTC+08:00; the Mac uses UTC+09:00. Worker timestamps below are UTC. Matching local and cloud socket events differ by about nine seconds; do not compute cross-source latency from those clocks.

| Backend | Production evidence | Permissible conclusion |
| --- | --- | --- |
| OpenClaw | One observed `/v1/pair/claim` at 12:29:01.037, HTTP 200, 1,255 ms. A full client connected at 12:29:01.764; the bootstrap client closed normally with 1000 before the operator client connected at 12:29:06.259. Local Gateway connect responses were successful for both roles. | A claim and bootstrap-to-operator handshake succeeded. This does not prove that the first scan succeeded. |
| Codex | One observed `/v1/pair/claim` at 12:31:12.365, HTTP 200, 1,268 ms. A client connected at 12:31:13.190 with a Bridge present, followed by delivered RPC responses. | A claim and subsequent connection succeeded. This does not identify the first scan's local failure. |

No corresponding unsupported-feature rejection was observed in these historical cloud windows. Absence of a record is not proof that a request was never attempted. No owner runtime, pairing credential, native login or original turn was changed or replayed.

## Established Mobile feedback and evidence gaps

`connectBackendPairingPayload` in `apps/mobile/src/connection/pairing/backend-pairing-profile.ts` validates the parsed QR before claiming it, validates the claimed result again, then saves/activates the connection. Its local guard uses `AdapterError('unsupported', ...)` for four distinct reasons:

- `backend_mismatch`: the detected backend differs from the selected backend.
- `invalid_backend`: backend hints are missing or conflicting.
- `preview_requires_debug_mode`: an official Preview code is scanned outside Debug Mode.
- `official_environment_mismatch`: the official service environment differs from the selected environment.

A missing or mismatched saved connection also uses `unsupported`. Onboarding discards the detailed message when converting the error to a generic code, and renders every such error as the same “backend does not support this feature” banner. The existing `pair_claim` diagnostic starts inside the HTTP claim helper, after the first local validation. Consequently, cloud logs cannot distinguish these local rejection reasons, and the current screenshot cannot distinguish them either.

The latest local September 30, 20:18 Xcode archive contains these guard strings. This establishes their presence in that artifact, not the exact build installed from TestFlight.

## Candidate requiring confirmation

The camera accepts any recognized QR in its camera view; the drawn scan rectangle is an overlay, without a corresponding recognition-area filter. A valid neighboring backend QR can therefore reach the selected backend's validation first if multiple codes are visible. Backend-specific onboarding would reject it before claim with the same generic banner. This is a concrete behavior in the source, but is not established as the trigger of either reported incident. Confirm whether multiple codes were visible and whether the error appeared immediately or after a connection wait.

Other candidates, including stale scanner callbacks or environment state, remain unproven. The inspected callbacks capture the selected backend explicitly; no deterministic first-scan-only defect was found by source inspection. Do not weaken backend/environment checks or add automatic retries to single-use claims as a speculative fix.

## Next evidence and scoped remediation

1. Establish the installed TestFlight version/build and whether the failure is immediate, with one code visible at a time. Do not reset the phone or regenerate existing successful pairings merely to collect evidence.
2. Record an allowlisted App-side validation outcome before the claim, distinguishing validation stage and the four fixed reasons. Do not log QR text, credentials, URLs, device labels or new stable identifiers; local validation must not be labeled as a network failure.
3. Preserve that typed reason through Onboarding and show actionable backend/environment/invalid-code feedback instead of the generic capability error. Keep the actual unsupported-operation error distinct.
4. If the neighboring-code condition is confirmed, keep the scanner open for unrelated backend codes or enforce a tested scan area; preserve the backend-neutral header scanner, image import, legacy QR and Hermes behavior.
5. Verify first/repeated scans and guard behavior with narrow tests, then owner device testing on an App update. A Bridge reinstall or Relay redeploy alone cannot deliver a Mobile-only fix. No App packaging, upload or production deployment is authorized by this investigation.
