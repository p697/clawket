import Foundation
import Testing
@testable import ClawketTransport

@Suite(.serialized)
struct TransportTests {
    @Test func codecPreservesValuesAndEnforcesUTF8Boundary() throws {
        let value: JSONValue = .object(["text": .string("中文 🦊"), "array": .array([.null, .bool(true), .number(42)])])
        #expect(try FrameCodec.decode(FrameCodec.encode(value)) == value)
        let exact = String(repeating: "a", count: FrameCodec.maximumFrameBytes)
        try FrameCodec.validateSize(exact)
        #expect(throws: FrameValidationError.tooLarge) { try FrameCodec.validateSize(exact + "a") }
        #expect(throws: FrameValidationError.tooLarge) {
            try FrameCodec.validateSize(String(repeating: "界", count: FrameCodec.maximumFrameBytes / 3 + 1))
        }
        #expect(throws: FrameValidationError.invalidUTF8) { try FrameCodec.text(from: .binary(Data([0xFF]))) }
    }

    @Test func malformedAndDeepJSONFailBeforeRecursiveDecode() throws {
        #expect(throws: FrameValidationError.invalidJSON) { try FrameCodec.decode("{broken}") }
        #expect(throws: FrameValidationError.nestingLimit) {
            try FrameCodec.decode(String(repeating: "[", count: 65) + "0" + String(repeating: "]", count: 65))
        }
        let quotedBraces = String(repeating: "[{\\\"", count: 100)
        let value: JSONValue = .object(["text": .string(quotedBraces)])
        #expect(try FrameCodec.decode(FrameCodec.encode(value)) == value)
        #expect(throws: FrameValidationError.invalidJSON) { try FrameCodec.encode(.number(.nan)) }
        var deep: JSONValue = .null
        for _ in 0..<65 { deep = .array([deep]) }
        #expect(throws: FrameValidationError.nestingLimit) { try FrameCodec.encode(deep) }
        #expect(throws: FrameValidationError.valueLimit) {
            try FrameCodec.decode("[" + String(repeating: "0,", count: FrameCodec.maximumJSONTokens) + "0]")
        }
        #expect(throws: FrameValidationError.valueLimit) {
            try FrameCodec.encode(.array(Array(repeating: .null, count: FrameCodec.maximumJSONTokens)))
        }
    }

    @Test func backoffIsBoundedAndOnlyConfirmedReadyResetsIt() {
        var policy = ReconnectPolicy()
        #expect(policy.nextDelay() == .milliseconds(800))
        #expect(policy.nextDelay() > .milliseconds(800))
        for _ in 0..<100 { #expect(policy.nextDelay(randomUnit: 1) <= .seconds(15)) }
        policy.confirmedBackendReady()
        #expect(policy.nextDelay() == .milliseconds(800))
    }

    @Test func socketOpenDoesNotProveBackendReadyOrResetRetry() async throws {
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]))
        #expect(await connection.nextReconnectDelay() == .milliseconds(800))
        let generation = try await connection.connect(to: endpoint)
        #expect(await connection.state == .handshaking)
        #expect(await connection.nextReconnectDelay() > .milliseconds(800))
        #expect(await connection.confirmBackendReady(generation: ConnectionGeneration()) == false)
        #expect(await connection.confirmBackendReady(generation: generation))
        #expect(await connection.state == .ready)
        #expect(await connection.nextReconnectDelay() == .milliseconds(800))
        await connection.disconnect()
    }

    @Test func requestWorksDuringHandshakeAndUsesFreshIDs() async throws {
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]))
        let generation = try await connection.connect(to: endpoint)
        let first = Task { try await connection.request(method: "health", generation: generation) }
        let frame1 = try await socket.request(at: 0)
        await socket.push(response(to: frame1, payload: .object(["status": .string("ok")])))
        #expect(try await first.value["status"] == .string("ok"))
        #expect(await connection.state == .handshaking)
        let second = Task { try await connection.request(method: "health", generation: generation) }
        let frame2 = try await socket.request(at: 1)
        #expect(frame1["id"] != frame2["id"])
        await socket.push(response(to: frame2, payload: .null))
        _ = try await second.value
        #expect(await connection.pendingRequestCount == 0)
        await connection.disconnect()
    }

    @Test func generationRetirementRejectsPendingAndFencesOldSocket() async throws {
        let old = TestSocket(retainReceiveOnClose: true)
        let replacement = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([old, replacement]))
        let firstGeneration = try await connection.connect(to: endpoint)
        let first = Task { try await connection.request(method: "chat.send") }
        let oldRequest = try await old.request(at: 0)
        await connection.disconnect()
        #expect(await failure(first).code == .retired)
        let nextGeneration = try await connection.connect(to: endpoint)
        #expect(firstGeneration != nextGeneration)
        let second = Task { try await connection.request(method: "health") }
        let newRequest = try await replacement.request(at: 0)
        #expect(oldRequest["id"] != newRequest["id"])
        // Deliver a matching successor ID on the old socket. It must have no authority.
        await old.push(response(to: newRequest, payload: .string("stale")))
        #expect(await connection.confirmBackendReady(generation: firstGeneration) == false)
        #expect(await connection.generation == nextGeneration)
        await replacement.push(response(to: newRequest, payload: .string("current")))
        #expect(try await second.value == .string("current"))
        #expect(await replacement.sentCount == 1)
        await connection.disconnect()
    }

    @Test func lateUpgradeCompletionCannotReviveRetiredGeneration() async throws {
        let old = TestSocket(stallOpen: true)
        let replacement = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([old, replacement]))
        let first = Task { try await connection.connect(to: endpoint) }
        try await eventually { await old.openStarted }
        await connection.disconnect()
        let next = try await connection.connect(to: endpoint)
        // Deliberately uncooperative test peer completes Upgrade after close/cancel.
        await old.releaseOpen()
        await #expect(throws: RPCFailure(.retired)) { try await first.value }
        #expect(await connection.generation == next)
        #expect(await connection.state == .handshaking)
        try await eventually { await old.closeCodes == [1000] }
        #expect(await old.closeCodes == [1000])
        await connection.disconnect()
    }

    @Test func overlappingConnectsJoinOneUpgradeAndBothObserveHandshakePhase() async throws {
        let socket = TestSocket(stallOpen: true)
        let connection = try RPCConnection(factory: TestFactory([socket]))
        let first = Task { try await connection.connect(to: endpoint) }
        try await eventually { await socket.openStarted }
        let second = Task { try await connection.connect(to: endpoint) }
        await socket.releaseOpen()
        let firstGeneration = try await first.value
        #expect(try await second.value == firstGeneration)
        #expect(await connection.state == .handshaking)
        await connection.disconnect()
    }

    @Test func timeoutRetiresOnlyItsRPCAndNeverReplaysWrite() async throws {
        let clock = TestClock()
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]), clock: clock)
        let generation = try await connection.connect(to: endpoint)
        #expect(await connection.confirmBackendReady(generation: generation))
        let write = Task { try await connection.request(method: "chat.send", timeout: .seconds(2)) }
        let request = try await socket.request(at: 0)
        try await clock.waitForSleepers(atLeast: 1)
        clock.advance(by: .seconds(2))
        let error = await failure(write)
        #expect(error.code == .timeout)
        #expect(error.delivery == .uncertain)
        #expect(await connection.state == .ready)
        #expect(await connection.pendingRequestCount == 0)
        await socket.push(response(to: request, payload: .string("late")))
        #expect(await socket.sentCount == 1)
        await connection.disconnect()
    }

    @Test func cancellationReleasesCapacityAndLateResponseIsIgnored() async throws {
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]), maximumPending: 1)
        _ = try await connection.connect(to: endpoint)
        let first = Task { try await connection.request(method: "chat.send") }
        let request = try await socket.request(at: 0)
        await #expect(throws: RPCFailure(.pendingLimit)) { try await connection.request(method: "health") }
        first.cancel()
        let error = await failure(first)
        #expect(error.code == .cancelled)
        #expect(error.delivery == .uncertain)
        #expect(await connection.pendingRequestCount == 0)
        let next = Task { try await connection.request(method: "health") }
        let nextRequest = try await socket.request(at: 1)
        await socket.push(response(to: request, payload: .string("late")))
        await socket.push(response(to: nextRequest, payload: .string("healthy")))
        #expect(try await next.value == .string("healthy"))
        await connection.disconnect()
    }

    @Test func timeoutCancelsDispatchWhoseNativeCompletionStalled() async throws {
        let clock = TestClock()
        let socket = TestSocket(stallSends: true)
        let connection = try RPCConnection(factory: TestFactory([socket]), clock: clock)
        let generation = try await connection.connect(to: endpoint)
        #expect(await connection.confirmBackendReady(generation: generation))
        let write = Task { try await connection.request(method: "chat.send", timeout: .seconds(2)) }
        _ = try await socket.request(at: 0)
        try await clock.waitForSleepers(atLeast: 1)
        clock.advance(by: .seconds(2))
        let error = await failure(write)
        #expect(error.code == .timeout)
        #expect(error.delivery == .uncertain)
        try await eventually { await socket.cancelledSendCount == 1 }
        #expect(await socket.sentCount == 1)
        #expect(await connection.pendingRequestCount == 0)
        await connection.disconnect()
    }

    @Test func healthReadDoesNotQueueBehindAnUnansweredWrite() async throws {
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]))
        _ = try await connection.connect(to: endpoint)
        let write = Task { try await connection.request(method: "chat.send") }
        _ = try await socket.request(at: 0)
        let health = Task { try await connection.request(method: "health", timeout: .seconds(5)) }
        let request = try await socket.request(at: 1)
        await socket.push(response(to: request, payload: .bool(true)))
        #expect(try await health.value == .bool(true))
        #expect(await connection.pendingRequestCount == 1)
        write.cancel()
        _ = await failure(write)
        await connection.disconnect()
    }

    @Test func newChallengeRetiresPendingRPCsWithoutProvingBackendHealth() async throws {
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]))
        let generation = try await connection.connect(to: endpoint)
        #expect(await connection.confirmBackendReady(generation: generation))
        let previousRead = Task { try await connection.request(method: "sessions.list") }
        let previous = try await socket.request(at: 0)
        _ = await connection.nextReconnectDelay()
        #expect(await connection.beginBackendHandshake(generation: ConnectionGeneration()) == false)
        #expect(await connection.beginBackendHandshake(generation: generation))
        #expect(await failure(previousRead).code == .retired)
        #expect(await connection.state == .handshaking)
        #expect(await connection.nextReconnectDelay() > .milliseconds(800))
        let authentication = Task { try await connection.request(method: "connect") }
        let current = try await socket.request(at: 1)
        await socket.push(response(to: previous, payload: .string("old read")))
        await socket.push(response(to: current, payload: .bool(true)))
        #expect(try await authentication.value == .bool(true))
        #expect(await connection.state == .handshaking)
        #expect(await connection.confirmBackendReady(generation: generation))
        #expect(await connection.nextReconnectDelay() == .milliseconds(800))
        await connection.disconnect()
    }

    @Test func localFrameRejectionProvesNoDispatch() async throws {
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]))
        _ = try await connection.connect(to: endpoint)
        let large: JSONValue = .object(["message": .string(String(repeating: "a", count: FrameCodec.maximumFrameBytes))])
        await #expect(throws: RPCFailure(.frameTooLarge)) { try await connection.request(method: "chat.send", params: large) }
        #expect(await socket.sentCount == 0)
        #expect(await connection.pendingRequestCount == 0)
        await connection.disconnect()
    }

    @Test func remoteErrorHasReceiptEvidenceAndFixedDiagnosticDescription() async throws {
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]))
        _ = try await connection.connect(to: endpoint)
        let pending = Task { try await connection.request(method: "chat.send") }
        let request = try await socket.request(at: 0)
        let secret = "credential-bearing-native-error"
        await socket.push(.object(["type": .string("res"), "id": request["id"]!, "ok": .bool(false),
                                   "error": .object(["message": .string(secret)])]))
        let error = await failure(pending)
        #expect(error.code == .remoteRejection)
        #expect(error.delivery == .responseReceived)
        #expect(error.remoteError?["message"] == .string(secret))
        #expect(!error.description.contains(secret))
        #expect(await socket.sentCount == 1)
        await connection.disconnect()
    }

    @Test func relayControlsRemainSeparateAndCannotEstablishReady() async throws {
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]))
        let generation = try await connection.connect(to: endpoint)
        var events = connection.events.makeAsyncIterator()
        #expect(try await events.next() == .state(generation, .connecting))
        #expect(try await events.next() == .state(generation, .handshaking))
        let control: JSONValue = .object(["type": .string("control"), "event": .string("relay.ready"),
                                          "payload": .object(["capabilities": .array([.string("relay.client-ping.v1")])])])
        await socket.pushRaw(RelayControl.prefix + (try FrameCodec.encode(control)))
        guard case .relayControl(let receivedGeneration, let received)? = try await events.next() else {
            Issue.record("Expected separate Relay control"); return
        }
        #expect(receivedGeneration == generation)
        #expect(received.event == "relay.ready")
        #expect(await connection.state == .handshaking)
        #expect(RelayHeartbeatConfiguration.advertisedCapabilities == ["relay.client-pong.v1", "relay.client-ping.v1", "relay.transfer-hint.v1"])
        await connection.disconnect()
    }

    @Test func negotiatedLegacyTickEchoesWithoutBackendHealth() async throws {
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]))
        let generation = try await connection.connect(to: endpoint, relay: RelayHeartbeatConfiguration())
        await socket.push(.object(["type": .string("tick"), "ts": .number(123), "ack": .string("relay.client-pong.v1")]))
        let pong = try await socket.request(at: 0)
        #expect(pong == .object(["type": .string("pong"), "ts": .number(123)]))
        #expect(await connection.state == .handshaking)
        #expect(await connection.generation == generation)
        await socket.push(.object(["type": .string("tick"), "ts": .number(124)]))
        await connection.disconnect()
        #expect(await socket.sentCount == 1)
    }

    @Test func heartbeatAllowsThreeIntervalsBeforeFirstTick() async throws {
        let clock = TestClock()
        let socket = TestSocket()
        let relay = try RelayHeartbeatConfiguration(interval: .seconds(10), missedIntervals: 1)
        #expect(relay.missedIntervals == 3)
        let connection = try RPCConnection(factory: TestFactory([socket]), clock: clock)
        let generation = try await connection.connect(to: endpoint, relay: relay)
        #expect(await connection.confirmBackendReady(generation: generation))
        try await clock.waitForSleepers(atLeast: 1)
        clock.advance(by: .seconds(29))
        #expect(await connection.state == .ready)
        clock.advance(by: .seconds(1))
        try await eventually { await connection.state == .offline }
        #expect(await connection.pendingRequestCount == 0)
    }

    @Test func foregroundHintsRequestProbeAndDoNotResetBackoff() async throws {
        let clock = TestClock()
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]), clock: clock)
        let generation = try await connection.connect(to: endpoint, relay: RelayHeartbeatConfiguration(interval: .seconds(1)))
        #expect(await connection.confirmBackendReady(generation: generation))
        var events = connection.events.makeAsyncIterator()
        _ = try await events.next(); _ = try await events.next(); _ = try await events.next()
        _ = await connection.nextReconnectDelay()
        await connection.setForeground(false)
        clock.advance(by: .seconds(60))
        #expect(await connection.state == .ready)
        await connection.setForeground(true)
        #expect(try await events.next() == .backendProbeRequired(generation))
        #expect(await connection.nextReconnectDelay() > .milliseconds(800))
        await connection.networkPathChanged()
        #expect(try await events.next() == .backendProbeRequired(generation))
        await connection.disconnect()
    }

    @Test func handshakeDeadlineCannotBeBypassedByLateReadiness() async throws {
        let clock = TestClock()
        let connection = try RPCConnection(factory: TestFactory([TestSocket()]), clock: clock)
        let generation = try await connection.connect(to: endpoint)
        clock.advance(by: .seconds(21))
        #expect(await connection.confirmBackendReady(generation: generation) == false)
        #expect(await connection.state == .offline)
    }

    @Test func oversizedIncomingFrameCloses1009AndRejectsPending() async throws {
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]))
        _ = try await connection.connect(to: endpoint)
        let request = Task { try await connection.request(method: "health") }
        _ = try await socket.request(at: 0)
        await socket.pushRaw(String(repeating: "a", count: FrameCodec.maximumFrameBytes + 1))
        #expect(await failure(request).code == .frameTooLarge)
        try await eventually { await socket.closeCodes.contains(1009) }
        #expect(await connection.pendingRequestCount == 0)
    }

    @Test func invalidPrefixedControlNeverFallsThroughToBackend() async throws {
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]))
        _ = try await connection.connect(to: endpoint)
        await socket.pushRaw(RelayControl.prefix + "{invalid}")
        try await eventually { await connection.state == .offline }
    }

    @Test func eventOverflowFailsClosed() async throws {
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]), eventBufferLimit: 2)
        _ = try await connection.connect(to: endpoint)
        await socket.push(.object(["type": .string("event"), "event": .string("health")]))
        try await eventually { await connection.state == .offline }
        await #expect(throws: RPCFailure(.eventBufferOverflow)) { try await connection.connect(to: endpoint) }
    }

    @Test func eventByteBudgetBoundsLargeFramesIndependentlyOfCount() async throws {
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]), eventBufferByteLimit: 256)
        _ = try await connection.connect(to: endpoint)
        await socket.push(.object(["type": .string("event"), "text": .string(String(repeating: "a", count: 512))]))
        try await eventually { await connection.state == .offline }
        #expect(await connection.pendingRequestCount == 0)
    }

    @Test(arguments: ["relay-openclaw/openclaw-v1.json", "relay-hermes/hermes-v1.json"])
    func recordedBackendsRetainEnvelopeAndPayload(_ path: String) async throws {
        let fixture = try recordedFixture(path)
        guard case .array(let frames)? = fixture["frames"] else { throw TestFailure.missingFixture }
        let reqFrame = try #require(frames.first { $0["kind"] == .string("websocket") && $0["payload"]?["method"] == .string("sessions.list") })
        let replyFrame = try #require(frames.first { $0["payload"]?["type"] == .string("res") && $0["payload"]?["id"] == reqFrame["payload"]?["id"] })
        let socket = TestSocket()
        let connection = try RPCConnection(factory: TestFactory([socket]))
        _ = try await connection.connect(to: endpoint)
        let request = Task { try await connection.request(method: "sessions.list", params: reqFrame["payload"]?["params"] ?? .object([:])) }
        let sent = try await socket.request(at: 0)
        #expect(sent["type"] == reqFrame["payload"]?["type"])
        #expect(sent["method"] == reqFrame["payload"]?["method"])
        #expect(sent["params"] == reqFrame["payload"]?["params"])
        let payload = replyFrame["payload"]?["payload"] ?? .null
        await socket.push(response(to: sent, payload: payload))
        #expect(try await request.value == payload)
        #expect(await connection.state == .handshaking)
        await connection.disconnect()
    }
}

private let endpoint = URL(string: "ws://127.0.0.1:8123/ws")!
private enum TestFailure: Error { case waiting, missingFixture }

private func recordedFixture(_ path: String) throws -> JSONValue {
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { root.deleteLastPathComponent() }
    return try FrameCodec.decode(String(contentsOf: root.appendingPathComponent("tests/compat/fixtures/v1/" + path), encoding: .utf8))
}

private func response(to request: JSONValue, payload: JSONValue) -> JSONValue {
    .object(["type": .string("res"), "id": request["id"] ?? .null, "ok": .bool(true), "payload": payload])
}

private func failure(_ task: Task<JSONValue, any Error>) async -> RPCFailure {
    do { _ = try await task.value; Issue.record("Expected a fixed RPC failure"); return RPCFailure(.invalidRequest) }
    catch let failure as RPCFailure { return failure }
    catch { Issue.record("Expected a typed RPC failure"); return RPCFailure(.invalidRequest) }
}

private func eventually(_ check: () async -> Bool) async throws {
    for _ in 0..<10_000 {
        if await check() { return }
        await Task.yield()
    }
    throw TestFailure.waiting
}

private final class TestFactory: WebSocketFactory, @unchecked Sendable {
    private let lock = NSLock()
    private var sockets: [TestSocket]
    init(_ sockets: [TestSocket]) { self.sockets = sockets }
    func makeSocket(url: URL) throws -> any WebSocketConnection {
        lock.lock(); defer { lock.unlock() }
        guard !sockets.isEmpty else { throw WebSocketFailure.failed }
        return sockets.removeFirst()
    }
}

private actor TestSocket: WebSocketConnection {
    private let retainReceiveOnClose: Bool
    private let stallSends: Bool
    private let stallOpen: Bool
    private var openWaiter: CheckedContinuation<Void, Never>?
    private(set) var openStarted = false
    private var frames: [WebSocketFrame] = []
    private var receiveWaiter: CheckedContinuation<WebSocketFrame, any Error>?
    private var sent: [String] = []
    private var sendWaiters: [(Int, CheckedContinuation<Void, Never>)] = []
    private(set) var closeCodes: [Int] = []
    private var blockedSends: [UUID: CheckedContinuation<Void, any Error>] = [:]
    private(set) var cancelledSendCount = 0
    var sentCount: Int { sent.count }

    init(retainReceiveOnClose: Bool = false, stallSends: Bool = false, stallOpen: Bool = false) {
        self.retainReceiveOnClose = retainReceiveOnClose
        self.stallSends = stallSends
        self.stallOpen = stallOpen
    }
    func open() async {
        openStarted = true
        if stallOpen { await withCheckedContinuation { openWaiter = $0 } }
    }
    func releaseOpen() { openWaiter?.resume(); openWaiter = nil }
    func send(_ text: String) async throws {
        sent.append(text)
        let ready = sendWaiters.filter { sent.count >= $0.0 }
        sendWaiters.removeAll { sent.count >= $0.0 }
        for waiter in ready { waiter.1.resume() }
        if stallSends {
            let id = UUID()
            try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                    guard !Task.isCancelled else { cancelledSendCount += 1; continuation.resume(throwing: CancellationError()); return }
                    blockedSends[id] = continuation
                }
            } onCancel: { Task { await self.cancelSend(id) } }
        }
    }
    private func cancelSend(_ id: UUID) {
        guard let continuation = blockedSends.removeValue(forKey: id) else { return }
        cancelledSendCount += 1
        continuation.resume(throwing: CancellationError())
    }
    func receive() async throws -> WebSocketFrame {
        if !frames.isEmpty { return frames.removeFirst() }
        if !closeCodes.isEmpty, !retainReceiveOnClose { throw WebSocketFailure.closed }
        return try await withCheckedThrowingContinuation { receiveWaiter = $0 }
    }
    func close(code: Int) {
        closeCodes.append(code)
        for continuation in blockedSends.values { continuation.resume(throwing: WebSocketFailure.closed) }
        blockedSends.removeAll()
        if !retainReceiveOnClose { receiveWaiter?.resume(throwing: WebSocketFailure.closed); receiveWaiter = nil }
    }
    func push(_ value: JSONValue) async { pushRaw(try! FrameCodec.encode(value)) }
    func pushRaw(_ text: String) {
        if let waiter = receiveWaiter { receiveWaiter = nil; waiter.resume(returning: .text(text)) }
        else { frames.append(.text(text)) }
    }
    func request(at index: Int) async throws -> JSONValue {
        if sent.count <= index { await withCheckedContinuation { sendWaiters.append((index + 1, $0)) } }
        return try FrameCodec.decode(sent[index])
    }
}

private final class TestClock: TransportClock, @unchecked Sendable {
    private let lock = NSLock()
    private var instant = Duration.zero
    private var waiters: [UUID: (Duration, CheckedContinuation<Void, any Error>)] = [:]
    func now() -> Duration { lock.withLock { instant } }
    func sleep(for duration: Duration) async throws {
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                lock.lock()
                if Task.isCancelled { lock.unlock(); continuation.resume(throwing: CancellationError()); return }
                waiters[id] = (instant + duration, continuation)
                lock.unlock()
            }
        } onCancel: {
            let waiter = self.lock.withLock { self.waiters.removeValue(forKey: id) }
            waiter?.1.resume(throwing: CancellationError())
        }
    }
    func advance(by duration: Duration) {
        let ready = lock.withLock {
            instant += duration
            let ready = waiters.filter { $0.value.0 <= instant }
            for id in ready.keys { waiters.removeValue(forKey: id) }
            return ready
        }
        for waiter in ready.values { waiter.1.resume() }
    }
    func waitForSleepers(atLeast count: Int) async throws {
        try await eventually { self.lock.withLock { self.waiters.count >= count } }
    }
}
