# Hermes connection safety · 2026-10-07

## Evidence and scope

The owner's request covers connection stability, unnecessary Cloudflare usage and resource safety. Production deployment, package publication and App distribution remain separate owner decisions.

The account audit found no runaway DO alarm loop. The 96.6% figure was Hermes's share of raw DO invocations over 30 days, not its share of the invoice. The current cycle's usage was $8.95 excluding the $5 base fee; DO duration/storage were within the allowance. October 6 included 533,270 Hermes HTTP invocations; 22 of 60 rooms showed the old five-second status polling pattern and accounted for 359,917 HTTP invocations. Approximately 44,916 owner replacements with code 4001, averaging 5.87 seconds apart, exposed repeated legacy process contention. October 7's read-only log sample still showed that pattern before this change. Old published Bridge behavior was inspected; replay tests reproduce the recorded behavior rather than executing that package.

Modern Bridge releases already poll status every 90 seconds, suppress idle application forwarding after authoritative zero-client presence, and yield after explicit owner replacement. Installed older versions can continue issuing five-second polls and idle frames. Server changes cannot prevent a valid request which the old client already sent; reducing those remaining invocations requires installed Bridge updates.

## Changes

- The legacy Hermes status route verifies the owner before resolving a room. Missing/invalid/client credentials cannot create a DO via that route. Verified internal forwarding is inaccessible through the public Worker, and room status reads do not write metadata. Registry verification has a ten-second abort and cancels unused response bodies.
- Ordinary Hermes owner replacement remains immediate. Repeated capability-free replacement of the same saved instance within 60 seconds sends the existing `gateway_ping` to the current owner and returns 409 while it responds. The socket attachment preserves the absolute 12-second probe deadline across retries and hibernation; a silent owner can be replaced after it. Modern owner-pong/transfer peers keep their existing liveness and transfer policy. Successful takeover still retires the phone generation with 4011 so it handshakes again.
- Mobile foreground/recovery probes validate their fresh `health` payload through the backend profile. An RPC `ok` envelope with `degraded` or `hermesApiReachable: false` no longer certifies Hermes ready. Negative evidence returns to the coordinator without changing its phase first, allowing its reconnect action to run. Transport epochs and adapter health revisions fence late results. Payload-free old healthy replies retain compatibility; OpenClaw follows its existing profile.
- The Hermes cloud-to-local queue is limited to 256 frames and 8 MiB total UTF-8/binary bytes. Frames belong to their captured cloud socket and are cleared on retirement/stop. Overflow or flush-send failure recycles that generation rather than silently dropping or replaying writes. Initial ordering, exactly-8-MiB frames and successor work created by synchronous diagnostic callbacks are preserved.

A reachable local Bridge reporting degraded native health is not automatically restarted. Transport reachability and native readiness remain distinct; reconnect backoff prevents a degraded backend from creating a tight retry loop. No timers, recurring DO alarms, frame payload storage or credential-derived diagnostic identities were added.

## Validation

Local verification ran one affected file at a time: 274 Relay assertions across status authorization, auth timeout, owner contention/replacement, hibernation, owner heartbeat and both index suites; 36 Bridge assertions across runtime/queue suites; 460 Mobile assertions across recorded protocol/adapters, lifecycle, coordinator, real health recovery and legacy parity. The live Wrangler v1 replay passed all ten tests, including a silent OPEN legacy owner: retries remained 409, takeover succeeded after the original 12-second deadline, and the old phone closed with 4011. Mobile, Relay Worker and Bridge Runtime typechecks passed. Documentation verified eight instruction pairs and five checker regressions. Fresh audits of both lockfiles had zero blocking advisories, retaining the three existing, owner-approved tooling exceptions. Full repository gates run in PR CI.

Android used the USB Samsung device's existing 3.1.2/30103 QA native shell with candidate Hermes bytecode; its signing certificate matched and data was preserved. The Gradle build failed while the internal Mac disk had under 400 MiB free, so this is JS/transport evidence, not a new native-build validation. QA-only fixture setup called the actual QR parser, backend-aware Registry claim and saved-connection path. Photo selection returned to onboarding without completing pairing; first-scan UI acceptance is not claimed. The temporary fixture/Pro override is excluded from repository changes.

The phone connected through isolated local candidate Registry/Relay/Bridge runtime to the owner's already-running, authenticated real Hermes Bridge 3.1.16. It performed health and session/catalog reads, without sending inference or changing native sessions. The following passed without manual reconnect:

- Background for 77 seconds, then automatic foreground recovery and catalog reads.
- Three more background/reopen cycles and owner transport restart during background.
- Fresh degraded health: visible unavailable state, progressively increasing retries (approximately 1, 1.5, 3, 4, 6.9, 11.5, then 15 seconds), and automatic readiness/catalog recovery after the fault cleared. The owner and local Bridge each stayed on one connection during this scenario.
- Dropped health replies: the candidate recycled its local Bridge WebSocket, then automatically restored the phone and catalog after replies resumed.

Sanitized local Relay logs recorded zero owner replacements with 4001 across these scenarios and one expected phone generation retirement with 4011 during the deliberate owner restart. This is controlled recovery evidence, not a claim that every historical user failure is resolved. Production billing savings and physical iOS behavior remain unmeasured.

## Delivery and remaining limits

Relay protections require an authorized Hermes Relay deployment. Queue changes require a new Bridge publication and installed updates. Foreground health validation requires an App update. This task does not change versions, production bindings, live admission rules or the owner's running Bridge.

Invalid status traffic can still consume Worker/KV/Registry verification resources; the change prevents the corresponding room creation. Existing edge admission and notification-only billing alerts remain unchanged. Cost savings must be measured after rollout, separately from local correctness evidence.
