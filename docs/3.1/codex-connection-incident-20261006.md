# Codex connection incident · 2026-10-05/06

This investigation follows the owner's report of frequent failed connections during the preceding twenty minutes. Cloudflare integration subsequently enabled historical application-log queries. Native health rejection and recurring Relay transport loss are separate findings; the latter remains reproducible after the installed Bridge update.

## Evidence and recovery

All times below are UTC. Japan time is UTC +9 hours. The host clock is approximately 11 seconds behind the HTTP server clock: a Node HTTPS request to the configured Relay's health endpoint measured +11,208 ms at 01:37 on October 6, with 395 ms round trip and second-resolution HTTP Date. Cross-source timestamps need this correction; the difference is not evidence of an eleven-second delivery delay.

| Source / window | Observed result | Limit |
| --- | --- | --- |
| Local installed Bridge 3.1.11, around October 5 16:10 | Authenticated lifecycle control and conversation catalog worked; native `account/read` with `refreshToken:false` repeatedly rejected with an internal-error category. A separate owned, read-only Native 0.160.0 child initialized and read account/model metadata successfully. | The original child's rejection body/stderr was not retained. The trigger is unconfirmed. |
| Codex Production Relay, October 5 15:46:00–16:06:52 | Historical dry-run query returned all 565 retained application events. 54 client closes had socket age below 1,500 ms; 53 of those had a delivered RPC response before closing. Most closes were normal code 1000 while an owner remained attached. | Two rooms contributed events. Relay logs do not include RPC method, body or result, so they cannot establish the outcome of each phone handshake or bind every event to this computer. |
| Authorized local update/restart, October 5 16:15:07 | Official public Bridge 3.1.12 became the authenticated local owner. Running bundle matched the independently verified public package. Pairing configuration and session-index hashes stayed unchanged. | This was a Bridge/App Server restart; it did not restart Desktop, resume a thread or replay a prompt. It establishes recovery, not the native-error trigger. |
| Local Bridge, October 5 16:15:07 through October 6 01:38 | 24 Relay closes, including 20 negotiated heartbeat fallback timeouts. Most timeouts clustered near UTC `:00` / `:30`. Typical complete-cycle deadline was 5,000 ms, with about 4,000 ms spent waiting on the application hedge. | These counts belong to this local log. They are not all phone connection failures, and an unlogged successful probe is not continuous-health evidence. |
| Live local capture, October 6 01:29:57 | Codex heartbeat timed out, socket closed with 1006, and authenticated Relay readiness returned at 01:29:58.433, about 0.6 seconds later. Local OpenClaw and Hermes heartbeat cycles also timed out in that period. | Shared timing identifies a common connection-path investigation; it does not identify the network component or establish a Cloudflare fault. |
| Live cloud capture, October 6 01:29:30–01:33:00 | 123 retained events. Both Codex room owners closed with 1006 near 01:30:09 and reattached. Relay logged application echo sends at the old sockets' close time. Pi also had an owner close near 01:30:10 in a separate comparison query. | `echo_sent` means Relay's send call returned, not that Bridge received the response. Slow constructor logs were absent; pre-constructor queue/wakeup and output-gate delays are not measured by those logs. |
| Local read-only diagnostic, October 6 01:37:21 | Authentication 26 ms, native health 10 ms (`modelReady=true`), one agent, 1,082 catalog rows over 11 pages, zero invalid rows. | This is loopback evidence, not phone/Relay inference acceptance. |

The current Relay deployment remains version `218bc62c-3b34-4b16-b027-1b43dc0643e7`, deployed September 29 at 11:58:46. There was no new Relay deployment during the incident or this investigation.

## Code-path interpretation

Mobile's Codex adapter calls `health` during each Relay handshake and marks the connection ready only on success. A non-authentication health rejection retains the error, closes the transport and retries with existing backoff. The Bridge's health method reads native account metadata; an internal rejection from a still-running App Server does not activate the process-disconnection recovery path. This explains how an authenticated, Relay-attached Bridge can remain unusable for a new mobile handshake. The original short-socket pattern is consistent with that path, but retained cloud metadata alone does not prove it for each request.

The process-disconnection path replaces only the Clawket-owned App Server and reconciles existing runs read-only. The investigation did not extend that path to arbitrary native errors, bypass active-task admission, weaken exclusive writer locks or automatically resend operations.

The recurring transport timeout survived the 3.1.12 update and was captured again live. Relevant production Bridge/Relay source contains no identified thirty-minute disconnect timer. The available macOS records show no matching sleep/wake or selected link/DHCP transition; absence in these logs does not exclude a network disruption.

Saved Clash preferences have TUN and system proxy enabled. An initial default Python HTTP request returned 403 while Node HTTPS returned 200. A subsequent comparison using the same Python client and headers returned 200 both through and bypassing the system HTTP proxy; those samples do not establish a proxy failure or attribute the WebSocket losses. The live core's protected configuration and historical core logs were unavailable. No proxy, network, clock or production setting was changed.

## Remaining verification boundary

On October 6 the owner asked to leave a possible network issue aside. Further transport investigation is deferred; the cause remains unconfirmed. Revisit it if evidence identifies a product failure rather than extending broad connection testing now.

The native-health rejection recovered after the owned restart, but its trigger remains unknown. The common recurring transport loss is still open. A controlled comparison of the same existing socket path, with local and Relay evidence and an owner-selected network window, is needed before attributing it to proxy/network or cloud processing. Increasing heartbeat deadlines or adding writer recovery would not establish the cause.

No new package, App build, production deployment or production configuration change was performed in this investigation. No test pairing/client or native inference was created. Private evidence in the existing `bridge-3.1.12-20261005` evidence bundle contains sanitized local recovery, historical query summaries, room/short-socket aggregates and the live half-hour comparison; it excludes transcripts, request bodies, credentials, device identities, raw room IDs and native stderr.
