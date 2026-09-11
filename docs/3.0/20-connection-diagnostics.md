# Connection latency and diagnostics

## Incident and recovery

On 2026-09-07, the physical iPhone Preview pairing took 46.621 seconds from Bridge client demand to final authentication. Initial bootstrap authentication took 34 ms. Two replacement local Gateway sockets received no connect request and each reached OpenClaw's 15-second handshake timeout. After the cloud Relay owner connection recycled, device-token authentication took 24 ms. History took 71 ms. These timings identify the stalled handoff, not the original packet-loss/routing trigger.

Mobile setup deliberately connects as a node to obtain device credentials, then reconnects as an operator. Do not remove this role separation to improve apparent speed. The client now recognizes a different challenge after readiness as a backend replacement, authenticates again, and ignores duplicate challenges. The Bridge now detects a forwarded challenge with no connect request after eight seconds and recycles the complete Relay owner path, preserving backoff. Bootstrap issuance suspends this watchdog; successful request forwarding and connection disposal cancel it. This is bounded recovery, not a guarantee that all networks will connect within eight seconds.

## Evidence sources

| Source | Available evidence | Query |
|---|---|---|
| Mobile / PostHog | `connect_attempt`, `connect_phase`, `connect_ready`, `connect_failed`, `reconnect` | Filter by the reporting user's existing analytics identity, incident time, App version; sort ascending by timestamp. |
| Mobile developer diagnostics | Recent semantic analytics events, including phase timings | Existing PostHog diagnostic view; bounded in-memory history can be displaced by later events. |
| Local Clawket Bridge | Challenge forwarding, missing-connect watchdog, bootstrap duration, authentication duration, retry backoff | `node apps/bridge-cli/dist/index.js logs --last 10m --lines 2500 --json > /tmp/clawket-connection-incident.json` |
| Local OpenClaw | Independent handshake timeout and request execution timings | Read the configured OpenClaw logs; convert timestamps to UTC before comparing. Do not copy transcripts or credential files into incident reports. |
| Cloudflare Workers Logs | Registry HTTP outcomes and Relay socket/routing lifecycle | Select the exact environment's Registry/Relay Worker and incident UTC window. Filter structured `scope`, `event`, then `diagnosticId`. |

Cloudflare cannot see App-local failures before a request or local Gateway processing. App analytics and local CLI logs remain necessary. Historical cloud availability depends on configured retention; `wrangler tail` only captures new events. Do not claim a historical query was performed when only local logs were read.

`connect_phase` contains only protocol (`challenge` or `health`), route (`relay` or `direct`), phase, attempt ordinal, elapsed milliseconds since socket open, and milliseconds since the prior phase. Phases: `socket_open`, `challenge_received`, `credentials_ready`, `authenticated`, `bootstrap_handoff`, `backend_restarted`, `ready`, `reconnecting`, `closed`, `error`. Existing failure events carry normalized failure codes. The phase event has no URL, raw ID, nonce, token, payload or message. Its elapsed time excludes pre-socket DNS/TLS/Registry time; use the coordinator's `connect_ready` for broader connection duration.

Relay `diagnosticId` is a fresh server-generated UUID per accepted socket, retained in its attachment across hibernation. It links `ws_connected`, `challenge_delivered`, `connect_start_forward`, `connect_response_delivered`, and `ws_disconnected`. It is intentionally not a durable device/user identity and is not an end-to-end App/Registry/Bridge trace ID. Existing sockets from older deployments may have no marker. Raw identity fields remain filtered; malformed diagnostic markers are rejected. Deploy the Relay change before expecting this field in cloud logs.

## Triage sequence

1. Establish App version, CLI version, backend, service environment, and incident time/timezone. Debug Mode selects Preview for new official OpenClaw pairing; Hermes has isolated infrastructure. Never infer environment from “dev build”.
2. If there is no socket open, check Registry invitation resolve/claim HTTP status and App failure events. Distinguish environment rejection, expiry/single-use claim, DNS/TLS/offline, and HTTP error. Do not retry by refreshing credentials before preserving evidence.
3. Match the Relay socket by incident window and `diagnosticId`. Compare challenge delivery and connect forwarding. A delivered challenge without a forwarded connect points to client/transport recovery; no cloud challenge points toward Bridge/local Gateway or cloud routing.
4. Compare Bridge `phase=challenge_forwarded`, bootstrap `elapsedMs`, connect forwarded/response timings. `code=connect_request_missing action=relay_recycle` means the eight-second watchdog acted, not that authentication itself was slow.
5. If authentication is fast but UI remains loading, inspect session/history/model request timings and App ready events separately. Do not label all startup latency “connection time”.
6. Preserve a credential-free timeline with UTC timestamps, evidence paths, proven facts, hypotheses and deployment versions. Never attach pairing code, QR payload, bearer token, decrypted invitation, device private key or chat content.

For live Preview capture use `npm run relay:tail:preview-worker` or `npm run relay:tail:preview-registry`. Hermes Preview has separate `relay:tail:hermes-preview-worker` / `relay:tail:hermes-preview-registry` commands. Read the Wrangler skill before CLI use and inspect the resolved config; never substitute Production bindings.

## Verification and rollout

Run `npm run check:required` and `npm run test:compat` before service deployment. Relevant regression coverage includes bootstrap-to-operator handoff, duplicate/replacement challenges, watchdog cancellation, a lost-challenge test over real loopback WebSockets, both backend routing policies, hibernation attachments and diagnostic redaction. Loopback fault injection establishes recovery behavior, not phone-network latency. The phone needs the updated App, and the managed Bridge must load the rebuilt CLI. Preview Relay deployment is separate from Production and Hermes deployment.

Measured acceptance on 2026-09-07: two isolated real Preview/OpenClaw runs took 5.284 s and 8.800 s for bootstrap plus operator handoff; subsequent operator reconnections took 0.816 s and 1.242 s. The second run overlapped native compilation. These are desktop socket checks, not phone-network guarantees. Joining the owner's already-active room from an additional QA client timed out waiting for a challenge; concurrent-device challenge allocation remains a separate unresolved case. Preview Relay diagnostic deployment: `abc624c5-df9e-4963-92a5-1170c376b8ca`.

## Simulator follow-up: concurrent devices

The owner's active Preview room reproduced a fresh simulator client waiting about 17 seconds without receiving a challenge. Client count increased while the single local Gateway was already authenticated. This differs from slow bootstrap issuance. `bridge.client-sockets.v1` now negotiates a dedicated raw-frame Relay channel and local Gateway runtime per full-client socket incarnation. The primary owner distributes lifecycle snapshots; diagnostic IDs connect channel logs to cloud socket logs. Secondary channels use the owner credential and cannot target restricted pairing sockets. Old Relays/runtime consumers and Hermes keep their existing paths. Preview rollout and simulator timing results are recorded in PROGRESS.

Hermes simulator QA uses an isolated custom Preview pairing. Its temporary process had exited; managed Production Hermes status is not evidence that this QA room is healthy. Verify the exact room's runtime and local health probes, and keep the QA process supervised for subsequent acceptance.

The follow-up also reproduced a mobile probe-disposal race: `probeConnection()` caught rejection caused by disposal and unconditionally called `reconnect()`. The retired adapter then competed with the active adapter using the same Relay client ID; Hermes cloud logs showed `client_socket_replaced` every 1–2 seconds despite successful local health probes. Probe completion now requires an unchanged protocol epoch, handshake generation and transport, and a non-disposed client. Check repeated replacement events before attributing this pattern to network latency.


## Model execution failures after successful connection

A successful `chat.send` followed by a run-scoped error is distinct from pairing/Relay failure. Compare the same session/time with local Gateway `cli terminal failure`, `model_fallback_decision` and `message processed` records, normalizing their timezone first. On 2026-09-11, phone 16:03/16:04 JST corresponded to Gateway 15:03/15:04 +08:00: Claude Opus 5 returned OAuth refresh failure / 401 after 8.4/5.3 seconds. Telegram independently reported the same expired login. These are local-log findings, not a historical Cloudflare query.

Inspect `claude auth status` without exporting credentials. When Claude CLI is logged out, complete `claude auth login` with the existing account, then run `openclaw models auth login --agent main --provider anthropic --method cli`; the explicit Agent is required on multi-Agent installs. Do not switch accounts/models or force-remove auth profiles to conceal the failure. Verify a real Gateway turn with the current model; login status alone is insufficient. Do not use `--deliver` unless external channel delivery is requested.

Mobile preserves the Gateway chat error through protocol → adapter → chat controller. A localized summary links to ReplyFailureSheet with bounded sanitized details and copy. Known authentication/quota/rate-limit issues receive actionable summaries; unknown errors retain detail. Copy/display remove bearer credentials, common token fields, API keys and URL credentials/query/fragment. Backend diagnostic strings remain local and must never become analytics properties. The design-system gallery contains a synthetic expired-login example for visual regression without invalidating real credentials.

## History loading while billing is already resolved

September 11, ~20:44 JST: Lucy's Slack channel session remained on `Loading history`. Historical Preview Cloudflare logs (11:40–11:48 UTC) showed live client channels, no pending handshake and no dead-client removal. Local Gateway history responses near the report took 58 ms and 471 ms; those timings alone did not identify the phone's selected session. Read-only inspection of the attached physical-device JS runtime then established the cause: at 20:44:02 it had parsed 23 history messages into 21 UI entries for the selected channel, with `historyLoaded=true` and connection `ready`, while the rendered Thread was `loading` with zero visible messages because Pro context still had `isLoading=true` despite an available snapshot.

The RevenueCat listener invalidated an in-flight refresh by incrementing its request generation but did not clear loading; the invalidated request correctly skipped its finalizer, leaving the flag stuck. The listener now settles loading with its authoritative snapshot. Safe two-message session previews render independently of billing lookup and still hide older content/disable sending until entitlement permits it. `thread_load_state` provides the corresponding App-side phase evidence in PostHog; Cloudflare cannot report this UI state.

When querying historical Cloudflare logs, the Observability connector may reject the valid `hibernatableWebSocket` event type because of its response schema. Use the read-only `POST /accounts/{account_id}/workers/observability/telemetry/query` API with `dry=true`, the verified Preview service filter and a bounded UTC window. The API takes millisecond timestamps; custom structured fields are under each event's `source`. Return only lifecycle fields, not full HTTP headers, query strings or credentials. This is a connector parsing limitation, not a Relay error. For development phones attached to Metro, runtime logs/state can be inspected read-only without a simulator or new Gateway connection; retain only scoped phase/count evidence, never whole props, snapshots or transcripts.

## Repeated replacement after Fast Refresh

September 11, ~20:53 JST: the phone alternated ready/reconnecting and a send reported `replaced_by_new_client_socket`. Cloudflare confirmed repeated `client_socket_replaced` events, often 1–2 seconds apart; a four-minute query around the end of the incident returned 128 replacement records. Phone inspection found two coordinator subscriptions in the same connection store, one belonging to a superseded module. Updating the analytics dependency had reevaluated the module-local default coordinator without stopping the previous owner. Both continued connecting with the same device identity. This was distinct from the already-fixed pending-probe disposal race and did not require a simulator or another physical device to reproduce.

The default coordinator now claims a process-wide owner slot. Claiming a replacement permanently retires the previous coordinator: stop its adapter, timers and store subscription synchronously, invalidate pending startup and prevent stale effects from starting it again. A development process already containing unregistered old owners needs one full App quit/reopen after installing this fix; subsequent module replacement performs cleanup. Preserve unsent drafts before that one-time recovery. A normal component rerender must not create a new runtime. Release builds do not run Metro Fast Refresh, but they retain the same single-owner contract.

At 21:05:54 JST the owner reopened the App. Phone state then showed one store subscription, the current process owner, `ready`, and no recovery presentation. Historical Preview queries from 12:06 UTC onward showed no recurring replacements before deployment. A reply can still complete during one of the brief ready intervals in a replacement storm; a lost send acknowledgement remains ambiguous and must not be automatically resent.

Server review also found two independent handoff weaknesses. Buffered messages from replaced sockets could enter legacy routing/liveness/rate-limit handling, and a late Hermes owner close could reset the replacement owner's watchdog. Every frame now requires the currently mapped socket incarnation; late owner close only clears that owner's watchdog. Regression tests cover both policies and late client close after rehydration. Existing independent-channel, hibernation, restricted pairing and raw-frame compatibility tests remain required.

New Relay diagnostics distinguish `socketKind=owner|channel|client`; `ws_disconnected` includes numeric `closeCode` and socket age, and includes secondary channels previously omitted by their early return. `client_socket_replaced` includes current `diagnosticId` plus `previousDiagnosticId`, both validated server-generated UUIDs. Do not add raw client identity or peer-supplied close text. Preview deployment: `8c863a2c-5cf9-4391-9eae-e437704300f2`. Production and Hermes deployments remain separate; this deployment updates only the official OpenClaw Preview Worker.
