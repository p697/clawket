import Foundation
import Testing
@testable import ClawketTransport

@Suite(.serialized)
struct RelayTransferTests {
    // Mobile relay-ws/transfer-lease/request-timeout tests and Relay transfer.ts
    // are the existing wire/timing oracle; these peers do not run a live Relay.
    @Test(arguments: [JSONValue.number(131_071), .number(8_388_609), .number(131_072.5), .string("200000"), .null])
    func malformedHintsCannotExtendAnOrdinaryDeadline(_ bytes: JSONValue) async throws {
        let (connection, peer, clock, generation) = try await readyRelay()
        try await peer.pushRaw(relayControl("relay.transfer-start", .object(["bytes": bytes])))
        try await relayFlush(connection, peer: peer)
        #expect(await connection.transferGrace(generation: generation) == .zero)
        let task = Task { try await connection.request(method: "health", timeout: .seconds(2)) }
        try await relayEventually { await peer.requests.count == 2 }
        try await relayEventually { clock.hasDeadline(.seconds(2)) }
        clock.advance(by: .seconds(2))
        #expect(await relayFailure(task).code == .timeout)
        await connection.disconnect()
    }

    @Test func concurrentUploadsCannotBeConfirmedByAnEarlierCompletion() async throws {
        let (connection, peer, clock, generation) = try await readyRelay()
        await peer.configure(echoPings: true, holdLarge: true)
        let params: JSONValue = .object(["data": .string(String(repeating: "/", count: 200_000))])
        let first = Task { try await connection.request(method: "chat.send", params: params, timeout: .seconds(5)) }
        let second = Task { try await connection.request(method: "chat.send", params: params, timeout: .seconds(5)) }
        try await relayEventually { await peer.heldOrder.count == 2 }
        let tokens = await peer.heldOrder
        await peer.release(tokens[0])
        try await relayEventually { await connection.current?.liveness.transfer.pendingDispatchCount == 1 }
        clock.advance(by: .seconds(6))
        try await relayEventually { clock.hasDeadline(.seconds(7)) }
        #expect(await peer.pings.isEmpty)
        #expect(await connection.pendingRequestCount == 2)
        #expect(await connection.transferGrace(generation: generation) == .seconds(84))
        await peer.release(tokens[1])
        try await relayEventually { await peer.pings.count == 1 }
        try await relayEventually { await connection.transferGrace(generation: generation) == .zero }
        let requests = await peer.requests
        for request in requests { try await peer.push(relayResponse(request)) }
        _ = try await first.value; _ = try await second.value
        #expect(await peer.requests.count == 2)
        await connection.disconnect()
    }

    @Test func completeDownloadDoesNotClearConcurrentUploadProtection() async throws {
        let (connection, peer, _, generation) = try await readyRelay()
        let task = Task { try await connection.request(method: "chat.send",
            params: .object(["text": .string(String(repeating: "a", count: 200_000))])) }
        try await relayEventually { await peer.requests.count == 1 }
        try await relayEventually { await connection.current?.liveness.transfer.pendingDispatchCount == 0 }
        let data = try FrameCodec.encode(.object(["type": .string("event"), "event": .string("artifact"),
            "text": .string(String(repeating: "界", count: 60_000))]))
        try await peer.pushRaw(relayControl("relay.transfer-start", .object(["bytes": .number(Double(data.utf8.count))])))
        await peer.pushRaw(data)
        try await relayEventually { await connection.current?.liveness.transfer.incomingBytes == nil }
        #expect(await connection.transferGrace(generation: generation) == .seconds(90))
        task.cancel(); _ = await relayFailure(task)
        await connection.disconnect()
    }

    @Test func responseBeforeNativeSendCompletionDoesNotReleaseTransferOwnership() async throws {
        let (connection, peer, _, generation) = try await readyRelay()
        await peer.configure(echoPings: true, holdLarge: true)
        let write = Task { try await connection.request(method: "chat.send",
            params: .object(["text": .string(String(repeating: "a", count: 200_000))])) }
        try await relayEventually { await peer.heldOrder.count == 1 }
        let id = await peer.heldOrder[0]
        try await peer.push(relayResponse(peer.requests[0], payload: .string("acknowledged")))
        #expect(try await write.value == .string("acknowledged"))
        #expect(await connection.pendingRequestCount == 0)
        #expect(await connection.current?.liveness.transfer.pendingDispatchCount == 1)
        #expect(await connection.transferGrace(generation: generation) == .seconds(90))
        #expect(await peer.pings.isEmpty)
        await peer.release(id)
        try await relayEventually { await peer.pings.count == 1 }
        try await relayEventually { await connection.current?.liveness.transfer.hasWindow == false }
        #expect(await peer.requests.count == 1)
        #expect(await connection.state == .ready)
        await connection.disconnect()
    }

    @Test(arguments: [4, 6])
    func incomingCompletionGrantsOneResponseWindowWithoutManufacturingHealth(_ delay: Int) async throws {
        let (connection, peer, clock, generation) = try await readyRelay()
        await peer.configure(echoPings: true)
        let task = Task { try await connection.request(method: "health", timeout: .seconds(5)) }
        try await relayEventually { await peer.requests.count == 1 }
        let frame = try FrameCodec.encode(.object(["type": .string("event"), "event": .string("update"),
            "text": .string(String(repeating: "a", count: 200_000))]))
        try await peer.pushRaw(relayControl("relay.transfer-start", .object(["bytes": .number(Double(frame.utf8.count))])))
        try await relayEventually { await connection.transferGrace(generation: generation) > .zero }
        clock.advance(by: .seconds(30), fireTimers: false)
        await peer.pushRaw(frame)
        try await relayEventually { await connection.current?.liveness.transfer.incomingBytes == nil }
        try await relayEventually { await connection.current?.liveness.transfer.hasWindow == false }
        #expect(await connection.transferGrace(generation: generation) == .zero)
        #expect(await connection.pendingRequestCount == 1)
        clock.advance(by: .seconds(delay), fireTimers: false)
        try await peer.push(relayResponse(peer.requests[0], payload: .object(["ok": .bool(true)])))
        if delay == 4 { #expect(try await task.value["ok"] == .bool(true)) }
        else {
            let error = await relayFailure(task)
            #expect(error.code == .timeout)
            #expect(error.delivery == .uncertain)
        }
        #expect(await connection.state == .ready)
        await connection.disconnect()
    }

    @Test func uploadConfirmationStartsResponseWindowBeforeDelayedTimerRuns() async throws {
        let (connection, peer, clock, generation) = try await readyRelay()
        let health = Task { try await connection.request(method: "health", timeout: .seconds(5)) }
        try await relayEventually { await peer.requests.count == 1 }
        try await connection.sendBackendFrame(.object(["type": .string("event"),
            "text": .string(String(repeating: "a", count: 200_000))]), generation: generation)
        try await relayEventually { await peer.pings.count == 1 }
        let payload = try #require(await peer.pings.first?["payload"])
        clock.advance(by: .seconds(30), fireTimers: false)
        try await peer.pushRaw(relayControl("relay.client-pong", payload))
        try await relayEventually { await connection.current?.liveness.transfer.hasWindow == false }
        #expect(await connection.pendingRequestCount == 1)
        clock.advance(by: .seconds(6), fireTimers: false)
        try await peer.push(relayResponse(peer.requests[0], payload: .object(["ok": .bool(true)])))
        let error = await relayFailure(health)
        #expect(error.code == .timeout)
        #expect(error.delivery == .uncertain)
        #expect(await connection.state == .ready)
        await connection.disconnect()
    }

    @Test func sameSocketChallengesAndRepeatedHintsNeverRenewNinetySeconds() async throws {
        let (connection, peer, clock, generation) = try await readyRelay()
        try await peer.pushRaw(relayControl("relay.transfer-start", .object(["bytes": .number(200_000)])))
        try await relayEventually { await connection.transferGrace(generation: generation) > .zero }
        clock.advance(by: .seconds(70), fireTimers: false)
        #expect(await connection.beginBackendHandshake(generation: generation))
        try await peer.pushRaw(relayControl("relay.transfer-start", .object(["bytes": .number(300_000)])))
        try await relayEventually { await connection.current?.liveness.transfer.incomingBytes == 300_000 }
        #expect(await connection.transferGrace(generation: generation) == .seconds(20))
        clock.advance(by: .seconds(21), fireTimers: false)
        #expect(await connection.transferGrace(generation: generation) == .zero)
        #expect(await connection.confirmBackendReady(generation: generation) == false)
        #expect(await connection.state == .offline)
    }

    @Test func largeHandshakeResponseOutlivesOrdinaryTimerWithinAbsoluteBudget() async throws {
        let clock = RelayTestClock(), peer = RelayTestPeer()
        let connection = try RPCConnection(factory: RelayTestFactory(peer: peer), clock: clock)
        let generation = try await connection.connect(to: relayTestEndpoint, relay: .init())
        try await peer.pushRaw(relayReady())
        try await relayFlush(connection, peer: peer)
        let health = Task { try await connection.request(method: "health", timeout: .seconds(8)) }
        try await relayEventually { await peer.requests.count == 2 }
        let request = await peer.requests[1]
        let frame = try FrameCodec.encode(relayResponse(request, payload:
            .object(["backend": .string("hermes"), "value": .string(String(repeating: "/", count: 200_000))])))
        try await peer.pushRaw(relayControl("relay.transfer-start", .object(["bytes": .number(Double(frame.utf8.count))])))
        try await relayEventually { await connection.transferGrace(generation: generation) > .zero }
        clock.advance(by: .seconds(30), fireTimers: false)
        await peer.pushRaw(frame)
        #expect(try await health.value["backend"] == .string("hermes"))
        #expect(await connection.state == .handshaking)
        #expect(await connection.confirmBackendReady(generation: generation))
        await connection.disconnect()
    }

    @Test func backgroundBudgetExpiryNeedsFreshSameSocketConfirmation() async throws {
        let (connection, peer, clock, generation) = try await readyRelay()
        try await peer.pushRaw(relayControl("relay.transfer-start", .object(["bytes": .number(200_000)])))
        try await relayEventually { await connection.transferGrace(generation: generation) > .zero }
        await connection.setForeground(false)
        clock.advance(by: .seconds(100))
        #expect(await connection.transferGrace(generation: generation) == .zero)
        // An incomplete download cannot be unlocked by an echo after foreground.
        await peer.configure(echoPings: true)
        await connection.setForeground(true)
        try await relayEventually { await connection.state == .offline }
        #expect(await peer.pings.isEmpty)
    }

    @Test func cancelledUnacceptedLargeSendLeavesNoSurvivingGraceOrReplay() async throws {
        let (connection, peer, clock, generation) = try await readyRelay()
        await peer.configure(holdLarge: true)
        try await relayEventually { clock.hasDeadline(.seconds(5)) }
        clock.advance(by: .seconds(4))
        let write = Task { try await connection.request(method: "chat.send",
            params: .object(["text": .string(String(repeating: "a", count: 200_000))])) }
        try await relayEventually { await peer.heldOrder.count == 1 }
        #expect(await connection.transferGrace(generation: generation) == .seconds(90))
        write.cancel()
        let failure = await relayFailure(write)
        #expect(failure.code == .cancelled)
        #expect(failure.delivery == .uncertain)
        try await relayEventually { await connection.transferGrace(generation: generation) == .zero }
        #expect(await connection.state == .ready)
        #expect(await peer.requests.count == 1)
        clock.advance(by: .seconds(1))
        try await relayEventually { await peer.pings.count == 1 }
        await connection.disconnect()
    }

    @Test func expiredCompletedUploadRequiresFreshForegroundNonceBeforeNewBudget() async throws {
        let (connection, peer, clock, generation) = try await readyRelay()
        let write = Task { try await connection.request(method: "chat.send",
            params: .object(["text": .string(String(repeating: "/", count: 200_000))])) }
        try await relayEventually { await peer.requests.count == 1 }
        try await relayEventually { await peer.pings.count == 1 }
        try await peer.push(relayResponse(peer.requests[0]))
        _ = try await write.value
        await connection.setForeground(false)
        clock.advance(by: .seconds(100))
        #expect(await connection.transferGrace(generation: generation) == .zero)
        await peer.configure(echoPings: true)
        await connection.setForeground(true)
        try await relayEventually { await peer.pings.count == 2 }
        try await relayEventually { await connection.current?.liveness.transfer.hasWindow == false }
        #expect(await connection.state == .ready)
        try await peer.pushRaw(relayControl("relay.transfer-start", .object(["bytes": .number(200_000)])))
        try await relayEventually { await connection.transferGrace(generation: generation) == .seconds(90) }
        await connection.disconnect()
    }

    @Test func repeatedHintCannotRescueUnknownWriteAtAbsoluteDeadline() async throws {
        let (connection, peer, clock, _) = try await readyRelay()
        let write = Task { try await connection.request(method: "chat.send", params:
            .object(["text": .string(String(repeating: "a", count: 200_000))]), timeout: .seconds(5)) }
        try await relayEventually { await peer.requests.count == 1 }
        try await relayEventually { await peer.pings.count == 1 }
        clock.advance(by: .seconds(89), fireTimers: false)
        let frame = try FrameCodec.encode(.object(["type": .string("event"), "event": .string("update"),
            "text": .string(String(repeating: "a", count: 300_000))]))
        try await peer.pushRaw(relayControl("relay.transfer-start", .object(["bytes": .number(Double(frame.utf8.count))])))
        try await relayEventually { await connection.current?.liveness.transfer.incomingBytes == frame.utf8.count }
        clock.advance(by: .seconds(1), fireTimers: false)
        await peer.pushRaw(frame)
        let failure = await relayFailure(write)
        #expect(failure.code == .heartbeatTimeout)
        #expect(failure.delivery == .uncertain)
        #expect(await connection.state == .offline)
        #expect(await connection.pendingRequestCount == 0)
        #expect(await peer.requests.count == 1)
    }
}

func readyRelay() async throws -> (RPCConnection, RelayTestPeer, RelayTestClock, ConnectionGeneration) {
    let clock = RelayTestClock(), peer = RelayTestPeer()
    let connection = try RPCConnection(factory: RelayTestFactory(peer: peer), clock: clock)
    let generation = try await connection.connect(to: relayTestEndpoint, relay: .init())
    #expect(await connection.confirmBackendReady(generation: generation))
    try await peer.pushRaw(relayReady())
    try await relayEventually { await connection.current?.liveness.transferHintNegotiated == true }
    return (connection, peer, clock, generation)
}
