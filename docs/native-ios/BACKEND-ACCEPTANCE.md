# Native backend acceptance

## 2026-10-16: real Direct connections on the isolated iPhone simulator

WebDriver drove the independent `com.p697.clawket.nativeqa` app on a dedicated standard iPhone simulator. The local development app was built from `90e84ce1`; merged `695ee378` changes only the explicit Optional-Bool switch syntax for the older CI compiler. This is separate from the synthetic-peer matrix in [MEDIA](MEDIA.md).

| Scenario | Observed evidence | Result |
|---|---|---|
| Hermes Direct authentication and new conversation | Actual connection form, authenticated roster, native New conversation action and persisted create receipt; the receipt identifies a separate empty physical session. | Passed; no send or model change in the main conversation. Opening the Agent initially reads its normal main history before selecting the new QA conversation. |
| Hermes text reply | One owned input delivered, one model reply containing the requested marker visible in the actual UI, completed Send/Stop presentation. | Passed for this Direct round trip. |
| Hermes cold restart | Same two render UUIDs and reply, exact independent unsent draft restored; draft then explicitly cleared. | Passed; no replay. |
| Explicit disconnection | Draft edited and saved in the same conversation; Send disabled. | Passed for local retention and dispatch gating. |
| Hermes live Stop | Actual nonempty live output and enabled Stop; pressing it produced the fixed operation-failure alert. The task subsequently completed its long reply. | **Not passed.** Do not substitute disappearance behind an alert, cold normalization of `streaming`, or a completed remote run for successful cancellation. |
| Hermes history after reconnect | Initially showed the history-readiness hint. A later protected document contains all four rows, including the full long reply. An independent authenticated read returned those exact UTF-8 rows, the same physical session and `hasActiveRun=false` in 684 ms. | Eventual content recovery confirmed. The original transition duration and cause remain unproven; this is not uninterrupted streaming or bounded recovery-time acceptance. |
| OpenClaw Direct | Actual connection form reached the credential-authentication error. No current device-approval context was produced. | Not passed; do not approve a request selected by name or assume this is the normal device-pairing gate. |

The independent history read uses only the QA route, compares its exact first owned input and physical session, and does not send, Stop, retry writes or modify the service. The private response/document copies are excluded from the repository. Two static reviews found no parser/planner rejection in that recovered input; they did not execute the Swift pipeline or establish the earlier asynchronous failure stage.

Installed Hermes Stop and the Bridge agree on POST path, Bearer authentication, empty body and returned run/status fields. The Bridge's five-second upstream budget can be shorter than synchronous database/interrupt work inside the API, but the failed attempt's error category has not been captured. Do not guess a timeout fix, alter the shared service or mark cancellation passed.

A later WebDriver check on the earlier installed `0f648ece` development app reproduced Settings → Connections → Add leaving Settings visible with no connection form. This is a confirmed embedded-navigation handoff defect. After an authentication error, the gear also temporarily failed to open Settings; one cold restart of only the QA app restored it after acknowledging the error. The transient gear failure’s cause remains unproven. The focused root-presenter regression covers authentication-notice/dismissal ordering and reopening Settings, not a claim of reproduced backend authentication or proof of that field incident’s cause.

[PR #268](https://github.com/p697/clawket/pull/268), source `48b42844`, merged as `78fbf034` after all 13 checks passed on the current mainline. Its actual app run passed 303/303 cases with no failures or skips (37.802 s test time, 47.498 s wall time); the package passed 459 cases and both localization tables matched 9,082 translated values across 19 locales. The task worktree and branch were removed after the primary checkout was fast-forwarded.

The three new cases use the production root and helpers in a real UIKit host, including actual sheet transitions and disappearance after external notice retirement. They invoke the production action/acknowledgement helpers; they do not tap the SwiftUI Add or system OK buttons, activate VoiceOver, or authenticate with a backend. These code/CI results do not establish the transient gear failure’s cause or complete the pending WebDriver checks.

These checks do not establish Relay, phone-network, owner replacement, full backend parity, VoiceOver, same-bundle migration or store acceptance. React Native remains the default; there was no shared service restart, production configuration change, distribution build or release.

## Later authentication diagnostics

On the `0f648ece` development app, a private loopback application-frame observer forwarded original frames without adding credentials or issuing RPCs. It classified OpenClaw's response as `INVALID_REQUEST` / `AUTH_TOKEN_MISMATCH`, and an in-memory comparison found that the submitted `connect.auth.token` differed from the current local operator configuration. A fresh form with explicit secure-field focus, slower WebDriver input and transition waits produced the same classification. The secure field does not expose the literal value through accessibility, so its masked value does not establish which input reached the binding. Form entry, automation and credential selection still require diagnosis; no token or service configuration was changed.

This observer terminates two WebSocket connections and uses a new local URL and credential scope. Its results diagnose those attempts only; they are not successful original-Direct, Relay or connection-stability acceptance. The private Hermes observer received no eligible Stop transaction, so it adds no cancellation evidence. Both diagnostic observers were stopped after preserving their bounded metadata results.

A separate loopback canary subsequently exercised the same native form and actual connect serialization using only a fixed, non-secret ASCII input. It always rejects authentication and never connects to a Gateway. Its initial two attempts recorded a shorter alphanumeric token after synthetic typing and a missing token after the system Paste attempt. Neither passed. Masked accessibility values and successful WebDriver commands cannot establish the submitted value; native input, binding and automation remain under investigation. No real credential was placed on the clipboard or changed, and these canary results do not establish a backend defect.
