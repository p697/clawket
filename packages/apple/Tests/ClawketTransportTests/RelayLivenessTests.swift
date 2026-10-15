import Foundation
import Testing
@testable import ClawketTransport

@Suite(.serialized)
struct RelayLivenessTests {
    // Existing Mobile relay-ws.client-ping.test.ts cadence and nonce authority.
    @Test(arguments: [false, true])
    func capabilityFreeAndDirectPeersNeverGainClientPing(_ direct: Bool) async throws {
        let clock = RelayTestClock(), peer = RelayTestPeer()
        let connection = try RPCConnection(factory: RelayTestFactory(peer: peer), clock: clock)
        let generation = try await connection.connect(to: relayTestEndpoint, relay: direct ? nil : .init())
        #expect(await connection.confirmBackendReady(generation: generation))
        // A transfer-only advertisement cannot bootstrap independent ping support.
        try await peer.pushRaw(relayReady(ping: direct, transfer: true))
        try await relayFlush(connection, peer: peer)
        clock.advance(by: .seconds(10))
        #expect(await peer.pings.isEmpty)
        #expect(await connection.transferGrace(generation: generation) == .zero)
        #expect(await connection.state == .ready)
        await connection.disconnect()
    }

    @Test func lateNegotiationStartsOneCadenceAndTrafficCannotPostponeIt() async throws {
        let clock = RelayTestClock(), peer = RelayTestPeer()
        let connection = try RPCConnection(factory: RelayTestFactory(peer: peer), clock: clock)
        let generation = try await connection.connect(to: relayTestEndpoint, relay: .init())
        #expect(await connection.confirmBackendReady(generation: generation))
        clock.advance(by: .seconds(2))
        try await peer.pushRaw(relayReady())
        try await relayEventually { clock.hasDeadline(.seconds(7)) }
        clock.advance(by: .seconds(2))
        try await peer.pushRaw(relayReady())
        try await peer.push(.object(["type": .string("tick"), "ts": .number(1)]))
        try await peer.push(.object(["type": .string("event"), "event": .string("activity")]))
        try await relayFlush(connection, peer: peer)
        clock.advance(by: .seconds(3))
        try await relayEventually { await peer.pings.count == 1 }
        let ping = try #require(await peer.pings.first)
        let nonce = try #require(ping["payload"]?["nonce"]?.stringValue)
        #expect(nonce.utf8.count == 32)
        #expect(nonce.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) })
        try await peer.pushRaw(relayControl("relay.client-pong", .object(["nonce": .string("wrong")])) )
        try await relayFlush(connection, peer: peer)
        #expect(await connection.state == .ready)
        try await relayEventually { clock.hasDeadline(.seconds(12)) }
        clock.advance(by: .seconds(5))
        try await relayEventually { await connection.state == .offline }
        #expect(await peer.pings.count == 1)
    }

    @Test func synchronousExactEchoIsTransportEvidenceWithoutBackoffReset() async throws {
        let clock = RelayTestClock(), peer = RelayTestPeer()
        await peer.configure(echoPings: true)
        let connection = try RPCConnection(factory: RelayTestFactory(peer: peer), clock: clock)
        let generation = try await connection.connect(to: relayTestEndpoint, relay: .init())
        try await peer.pushRaw(relayReady())
        try await relayFlush(connection, peer: peer)
        #expect(await connection.state == .handshaking)
        #expect(await peer.pings.isEmpty)
        #expect(await connection.confirmBackendReady(generation: generation))
        #expect(await connection.nextReconnectDelay() == .milliseconds(800))
        try await relayEventually { clock.hasDeadline(.seconds(5)) }
        clock.advance(by: .seconds(5))
        try await relayEventually { await peer.pings.count == 1 }
        try await relayEventually { await connection.current?.liveness.pendingProbe == nil }
        #expect(await connection.nextReconnectDelay() > .milliseconds(800))
        #expect(await connection.state == .ready)
        try await relayEventually { clock.hasDeadline(.seconds(10)) }
        clock.advance(by: .seconds(5))
        try await relayEventually { await peer.pings.count == 2 }
        await connection.disconnect()
    }

    @Test func lateExactEchoCannotBeatAStalledTimeoutCallback() async throws {
        let clock = RelayTestClock(), peer = RelayTestPeer()
        let connection = try RPCConnection(factory: RelayTestFactory(peer: peer), clock: clock)
        let generation = try await connection.connect(to: relayTestEndpoint, relay: .init())
        #expect(await connection.confirmBackendReady(generation: generation))
        try await peer.pushRaw(relayReady())
        try await relayEventually { clock.hasDeadline(.seconds(5)) }
        clock.advance(by: .seconds(5))
        try await relayEventually { await peer.pings.count == 1 }
        let payload = try #require(await peer.pings.first?["payload"])
        clock.advance(by: .seconds(6), fireTimers: false)
        try await peer.pushRaw(relayControl("relay.client-pong", payload))
        try await relayEventually { await connection.state == .offline }
        #expect(await connection.pendingRequestCount == 0)
    }

    @Test func backendTrafficCannotRescueAnExpiredNonceBeforeTimerRuns() async throws {
        let clock = RelayTestClock(), peer = RelayTestPeer()
        let connection = try RPCConnection(factory: RelayTestFactory(peer: peer), clock: clock)
        let generation = try await connection.connect(to: relayTestEndpoint, relay: .init())
        #expect(await connection.confirmBackendReady(generation: generation))
        try await peer.pushRaw(relayReady())
        try await relayEventually { clock.hasDeadline(.seconds(5)) }
        clock.advance(by: .seconds(5))
        try await relayEventually { await peer.pings.count == 1 }
        clock.advance(by: .seconds(6), fireTimers: false)
        try await peer.push(.object(["type": .string("event"), "event": .string("health"),
            "payload": .object(["ok": .bool(true)])]))
        try await relayEventually { await connection.state == .offline }
    }

    @Test func backgroundRetiresNonceAndForegroundUsesFreshProbe() async throws {
        let clock = RelayTestClock(), peer = RelayTestPeer()
        let connection = try RPCConnection(factory: RelayTestFactory(peer: peer), clock: clock)
        let generation = try await connection.connect(to: relayTestEndpoint, relay: .init())
        #expect(await connection.confirmBackendReady(generation: generation))
        try await peer.pushRaw(relayReady())
        try await relayEventually { clock.hasDeadline(.seconds(5)) }
        clock.advance(by: .seconds(5))
        try await relayEventually { await peer.pings.count == 1 }
        let old = try #require(await peer.pings.first?["payload"])
        await connection.setForeground(false)
        clock.advance(by: .seconds(100))
        try await peer.pushRaw(relayControl("relay.client-pong", old))
        #expect(await connection.state == .ready)
        await connection.setForeground(true)
        try await relayEventually { clock.hasDeadline(.seconds(110)) }
        clock.advance(by: .seconds(5))
        try await relayEventually { await peer.pings.count == 2 }
        #expect(await peer.pings[1]["payload"] != old)
        try await peer.pushRaw(relayControl("relay.client-pong", old))
        try await relayFlush(connection, peer: peer)
        #expect(await connection.current?.liveness.pendingProbe != nil)
        await connection.disconnect()
    }

    @Test func pingSendFailureRetiresExactSocketWithoutSyntheticHealth() async throws {
        let clock = RelayTestClock(), peer = RelayTestPeer()
        let connection = try RPCConnection(factory: RelayTestFactory(peer: peer), clock: clock)
        let generation = try await connection.connect(to: relayTestEndpoint, relay: .init())
        #expect(await connection.confirmBackendReady(generation: generation))
        _ = await connection.nextReconnectDelay()
        try await peer.pushRaw(relayReady())
        try await relayEventually { clock.hasDeadline(.seconds(5)) }
        await peer.configure(failNextSend: true)
        clock.advance(by: .seconds(5))
        try await relayEventually { await connection.state == .offline }
        #expect(await connection.nextReconnectDelay() > .milliseconds(800))
    }

    @Test func replacementFencesOldNonceAndDropsOnlyOldSocketTransferState() async throws {
        let clock = RelayTestClock(), first = RelayTestPeer(), next = RelayTestPeer()
        let connection = try RPCConnection(factory: RelayReplacementFactory(first, next), clock: clock)
        let old = try await connection.connect(to: relayTestEndpoint, relay: .init())
        #expect(await connection.confirmBackendReady(generation: old))
        try await first.pushRaw(relayReady())
        try await relayEventually { clock.hasDeadline(.seconds(5)) }
        clock.advance(by: .seconds(5))
        try await relayEventually { await first.pings.count == 1 }
        let oldPayload = try #require(await first.pings.first?["payload"])
        await connection.disconnect()
        let generation = try await connection.connect(to: relayTestEndpoint, relay: .init())
        #expect(generation != old)
        #expect(await connection.confirmBackendReady(generation: generation))
        try await next.pushRaw(relayReady())
        try await relayEventually { clock.hasDeadline(.seconds(10)) }
        clock.advance(by: .seconds(5))
        try await relayEventually { await next.pings.count == 1 }
        try await first.pushRaw(relayControl("relay.client-pong", oldPayload))
        try await next.pushRaw(relayControl("relay.client-pong", oldPayload))
        try await relayFlush(connection, peer: next)
        #expect(await connection.current?.liveness.pendingProbe != nil)
        #expect(await connection.transferGrace(generation: old) == .zero)
        #expect(await connection.generation == generation)
        await connection.disconnect()
    }

    @Test func lateCancelledTimerCannotReplaceForegroundCadence() async throws {
        let clock = RelayTestClock(ignoreCancellation: true), peer = RelayTestPeer()
        let connection = try RPCConnection(factory: RelayTestFactory(peer: peer), clock: clock)
        let generation = try await connection.connect(to: relayTestEndpoint, relay: .init())
        #expect(await connection.confirmBackendReady(generation: generation))
        try await peer.pushRaw(relayReady())
        try await relayEventually { clock.hasDeadline(.seconds(5)) }
        clock.advance(by: .seconds(1))
        await connection.setForeground(false)
        clock.advance(by: .seconds(1))
        await connection.setForeground(true)
        try await relayEventually { clock.hasDeadline(.seconds(7)) }
        clock.advance(by: .seconds(3)) // The retired timer deliberately completes despite cancellation.
        #expect(await connection.state == .ready)
        #expect(await peer.pings.isEmpty)
        #expect(clock.hasDeadline(.seconds(7)))
        clock.advance(by: .seconds(2))
        try await relayEventually { await peer.pings.count == 1 }
        await connection.disconnect()
        clock.advance(by: .seconds(1_000)) // Release deliberately uncooperative test waiters.
    }
}

func relayFlush(_ connection: RPCConnection, peer: RelayTestPeer) async throws {
    let count = await peer.requests.count
    let task = Task { try await connection.request(method: "health") }
    try await relayEventually { await peer.requests.count > count }
    try await peer.push(relayResponse(peer.requests[count]))
    _ = try await task.value
}
