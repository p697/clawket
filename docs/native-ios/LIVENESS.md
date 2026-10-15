# Native Relay liveness

The native client keeps Relay reachability, backend readiness and successful execution separate. `ClawketTransport` owns the current socket's liveness; `ClawketRuntime` authenticates and validates actual backend health. A nonce echo, tick, local send or transfer hint cannot establish backend readiness or reset reconnect backoff.

## Negotiation and cadence

Full-client Relay URLs use `RelayHeartbeatConfiguration.advertisedCapabilities`. Only the authenticated current socket's `relay.ready` capability list enables client ping; transfer protection additionally requires its independent hint capability. Direct connections and pairing sockets do not acquire those modes. Reserved ping/pong/transfer controls are consumed before backend routing, including unnegotiated or malformed variants.

After verified backend readiness, foreground clients send one fresh 32-lowercase-hex nonce every five seconds and allow five seconds for its exact same-socket echo. Repeated ready frames, ticks and application traffic do not postpone that cadence. Pending state is published before sending to handle immediate echoes. A delayed timer cannot accept an already-expired echo or let an unrelated backend frame bypass its deadline. Timer identity and socket generation fence retired callbacks.

The legacy tick/pong acknowledgment remains independent. Capability-free peers retain the negotiated tick interval and at least three missed intervals, including before the first tick. Only modern negotiated clients use the short nonce watchdog. Relay's existing four-frame burst and one-per-second refill remain unchanged; native confirmation probes respect the sustained floor.

## Large frames and ownership

Application frames remain bounded to 8 MiB of actual UTF-8 bytes. A Relay-authored `relay.transfer-start` names an integral size from 128 KiB through 8 MiB and protects only that incoming frame. A native outgoing frame reserves bounded protection at dispatch because asynchronous send completion can lag delivery. Rejected local sends leave no surviving grace and do not restart the prior ping cadence. Dispatch failure/cancellation still preserves uncertain-write semantics; nothing is replayed.

One absolute ninety-second budget covers concurrent upload and download protection on a socket. New hints, larger frames, foreground changes and a backend challenge on that same socket cannot renew it. Receiving the complete matching frame clears only incoming head-of-line protection. It does not clear a concurrent upload, establish health or unlock the budget for another transfer.

A matching nonce may clear the budget only when initiated after the latest transfer generation, every covered outgoing dispatch has completed, and incoming delivery is complete. An earlier upload's completion cannot put its confirmation ahead of a later suspended native send. A write response arriving before its native send completion does not lose dispatch ownership. Old-generation echoes request a new bounded confirmation instead of renewing time.

Background pauses nonce checks and retires their pending authority, while the socket budget remains. Foreground uses a fresh nonce; an expired incomplete frame fails rather than receiving a new allowance. An expired completed transfer remains locked until that fresh proof succeeds. `ContinuousClock` keeps elapsed time through system sleep; deadlines are checked again on receipt and foreground rather than relying on a timer having executed. Expiry remains latched through an injected clock rollback.

## Request deadlines

RPC and backend handshake waits retain their ordinary deadlines unless a known current transfer protects them. Their absolute cap is the greater of the existing timeout and ninety seconds from that wait's start. Completing protection allows one ordinary response window within that cap; later traffic cannot restart it. The existing 190-second model-switch bound stays 190 seconds. A real five-second backend health probe uses this same RPC policy, without treating Relay echoes as health.

Observe waits immediately before and after protection ends. This fixes the response window at that boundary even when a timer has been suspended; the first later business frame must not start another ordinary window.

WebSocket Upgrade retains its ordinary open timeout. Bootstrap control waits retain their separate absolute twelve seconds, matching Mobile's `requestRelayControl`; restricted pairing keeps its independent fifteen-second whole-exchange deadline. Neither gains an unrelated transfer timeout extension.

## Sources and acceptance

The behavior oracle is Mobile `connection/transports/{relay-ws,transfer-lease,request-timeout}.ts` and their liveness/transfer regressions, plus Relay `relay/{client-heartbeat,transfer,control}.ts`. This is a native-only implementation; Workers, Bridge, authentication and raw application envelopes remain unchanged.

Focused verification includes injected-clock nonce/deadline/race cases, OpenClaw and Hermes health-probe semantics, existing transport regressions and real URLSession loopback Upgrade/nonce/nominal 5 MiB traffic. These checks establish native protocol behavior. Actual phone-to-Relay large-media throughput, long background suspension, network changes and owner replacement still require the device acceptance matrix.
