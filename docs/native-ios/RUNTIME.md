# Native backend runtime

`packages/apple/Sources/ClawketRuntime` is the native domain and connection coordinator. `apps/ios` supplies Keychain-backed device credentials, persists scoped drafts/outbox/cache, and consumes one `RuntimeEvent` stream. Screens never read the socket stream or infer backend identity from transport.

## Connection ownership

`activate` waits for authenticated backend readiness; same-record callers join it. The coordinator keeps one active connection and one retry owner, pauses retry scheduling in the background, and probes the actual backend on foreground/network hints. A WebSocket upgrade, Relay control, local send or cached roster cannot establish ready. Healthy evidence resets backoff. Reconnect never resends a prompt; `RuntimeFailure.delivery` distinguishes local rejection, uncertain delivery, a known pre-dispatch refusal and a received response.

Every operation captures activation, socket and authentication revisions. OpenClaw can issue a new challenge on the same Relay socket: retire old pending work and history chains, then authenticate that exact backend. Events include connection scope so an application can reject already-queued updates after switching connections. The application also owns its UI/history revision; actor isolation alone is insufficient.

OpenClaw signs the current Gateway v3 preimage using its existing TweetNaCl seed-plus-public-key identity, asks for protocol3–4 and carries Bridge capability negotiation in `caps`. Outer response `meta` remains separate from the Gateway payload. Scoped saved operator tokens take precedence. Token mismatch permits one scoped cleanup before readiness; cleanup failure stops recovery. Mobile setup first receives Node/operator credentials and reconnects as operator before becoming ready. Restricted Relay bootstrap control has a cancellable send and an absolute twelve-second deadline.

Hermes uses its own `bridgeId` Relay query and real health response; degraded/unreachable API evidence fails readiness. Codex, Claude Code, Pi and local-model validate their exact `health.backend` identity. SDK direct connections authenticate using `connect`; their Relay paths use `health`, preserving OpenClaw's separate challenge lifecycle. Unavailable proven SDK backends retain the bounded short recovery sequence before slow retry.

## Native operations

The implemented surface is text send/stop/history, roster/session navigation, session creation, negotiated Codex/Claude Code projects and model selection. Hermes model selection remains global. SDK model reads retain session scope. OpenClaw global selection uses the current config hash; session selection uses `sessions.patch`. Native model switches retain their existing longer deadlines.

SDK sessions-first Agents keep an empty `mainSessionKey`; the application opens their catalog and can create a real session. A negotiated catalog is fetched completely as frozen pages, with validated revision/offset/uniqueness, 64 KiB pages, 10,000 sessions/8 MiB, 512 reads/90 seconds and one expiry restart. A failed or partial catalog never replaces the last complete roster. Delta/page-index optimizations are not advertised.

History reads for one session serialize. OpenClaw's physical transcript offset cursor stays bound to its exact session/transcript, rather than being sent as an opaque Gateway delta cursor. Explicit run/turn/idempotency fields are retained. Wire `sentLocally` cannot grant local provenance; synthetic fallback row IDs serve presentation only and never reconcile delivery. Human activity ordering stays distinct from housekeeping timestamps.

Stream text declares delta versus snapshot and a stable assistant segment identifier. Observed tool starts create a new segment; final-only or corrected final replies remain visible without replacing earlier segments. Stop acknowledgements do not invent completion. Unimplemented questions/consent/tool metadata stays raw application data, never diagnostics or advertised actions.

## Verification and limits

`ClawketRuntimeTests` uses injected sockets/monotonic time, verifies real recorded OpenClaw/Hermes contracts, and exercises authentication, bootstrap, recovery, replacement, catalog and send/history semantics. `ClawketTransportTests` separately verifies real URLSession traffic against an isolated loopback server. These checks establish native protocol behavior, not phone/Relay connectivity or successful model inference.

The runtime does not complete [the native preservation checklist](PARITY.md). Attachments/artifacts, rich task rendering, questions/consent actions, full management, voice/Node/sharing/payments/localization, legacy data import and production-backend/device acceptance remain explicitly gated work. The current mobile client remains the shipping client until those gates pass. No package distribution, service deployment or public release follows from merging this module.
