import Foundation
import Testing
@testable import ClawketTransport

let relayTestEndpoint = URL(string: "ws://127.0.0.1:8123/ws")!

func relayControl(_ event: String, _ payload: JSONValue = .object([:])) throws -> String {
    RelayControl.prefix + (try FrameCodec.encode(.object(["type": .string("control"),
        "event": .string(event), "payload": payload])))
}

func relayReady(ping: Bool = true, transfer: Bool = true) throws -> String {
    var caps: [JSONValue] = [.string("relay.frame-limit.v2")]
    if ping { caps.append(.string("relay.client-ping.v1")) }
    if transfer { caps.append(.string("relay.transfer-hint.v1")) }
    return try relayControl("relay.ready", .object(["capabilities": .array(caps)]))
}

func relayResponse(_ request: JSONValue, payload: JSONValue = .null) -> JSONValue {
    .object(["type": .string("res"), "id": request["id"] ?? .null, "ok": .bool(true), "payload": payload])
}

func relayEventually(_ check: () async -> Bool) async throws {
    for _ in 0..<20_000 {
        if await check() { return }
        await Task.yield()
    }
    throw RelayTestFailure.waiting
}

enum RelayTestFailure: Error { case waiting }

func relayFailure(_ task: Task<JSONValue, any Error>) async -> RPCFailure {
    do { _ = try await task.value; Issue.record("Expected RPC failure"); return RPCFailure(.invalidRequest) }
    catch let error as RPCFailure { return error }
    catch { Issue.record("Expected fixed RPC failure"); return RPCFailure(.invalidRequest) }
}

struct RelayTestFactory: WebSocketFactory {
    let peer: RelayTestPeer
    func makeSocket(url: URL) throws -> any WebSocketConnection { peer }
}

final class RelayReplacementFactory: WebSocketFactory, @unchecked Sendable {
    private let lock = NSLock()
    private var peers: [RelayTestPeer]
    init(_ peers: RelayTestPeer...) { self.peers = peers }
    func makeSocket(url: URL) throws -> any WebSocketConnection {
        try lock.withLock {
            guard !peers.isEmpty else { throw WebSocketFailure.failed }
            return peers.removeFirst()
        }
    }
}

actor RelayTestPeer: WebSocketConnection {
    var echoPings = false
    var holdLarge = false
    var failNextSend = false
    private var frames: [WebSocketFrame] = []
    private var waiter: CheckedContinuation<WebSocketFrame, any Error>?
    private var held: [UUID: CheckedContinuation<Void, any Error>] = [:]
    private(set) var heldOrder: [UUID] = []
    private(set) var requests: [JSONValue] = []
    private(set) var pings: [JSONValue] = []
    private(set) var closeCodes: [Int] = []
    private(set) var sentCount = 0

    func configure(echoPings: Bool? = nil, holdLarge: Bool? = nil, failNextSend: Bool? = nil) {
        if let echoPings { self.echoPings = echoPings }
        if let holdLarge { self.holdLarge = holdLarge }
        if let failNextSend { self.failNextSend = failNextSend }
    }
    func open() {}
    func send(_ text: String) async throws {
        try Task.checkCancellation()
        if failNextSend { failNextSend = false; throw WebSocketFailure.failed }
        sentCount += 1
        if text.hasPrefix(RelayControl.prefix) {
            let value = try FrameCodec.decode(String(text.dropFirst(RelayControl.prefix.count)))
            if value["event"] == .string("relay.client-ping") {
                pings.append(value)
                if echoPings { pushRaw(try relayControl("relay.client-pong", value["payload"] ?? .null)) }
            }
        } else {
            let value = try FrameCodec.decode(text)
            if value["type"] == .string("req") { requests.append(value) }
        }
        if holdLarge, text.utf8.count >= RelayTransferLease.minimumBytes {
            let id = UUID()
            try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                    guard !Task.isCancelled else { continuation.resume(throwing: CancellationError()); return }
                    held[id] = continuation; heldOrder.append(id)
                }
            } onCancel: { Task { await self.release(id, cancelled: true) } }
        }
    }
    func release(_ id: UUID, cancelled: Bool = false) {
        let continuation = held.removeValue(forKey: id)
        if cancelled { continuation?.resume(throwing: CancellationError()) }
        else { continuation?.resume() }
    }
    func receive() async throws -> WebSocketFrame {
        if !frames.isEmpty { return frames.removeFirst() }
        if !closeCodes.isEmpty { throw WebSocketFailure.closed }
        return try await withCheckedThrowingContinuation { waiter = $0 }
    }
    func close(code: Int) {
        closeCodes.append(code)
        waiter?.resume(throwing: WebSocketFailure.closed); waiter = nil
        let pending = held; held.removeAll()
        for continuation in pending.values { continuation.resume(throwing: WebSocketFailure.closed) }
    }
    func push(_ value: JSONValue) throws { pushRaw(try FrameCodec.encode(value)) }
    func pushRaw(_ text: String) {
        if let waiter { self.waiter = nil; waiter.resume(returning: .text(text)) }
        else { frames.append(.text(text)) }
    }
}

final class RelayTestClock: TransportClock, @unchecked Sendable {
    private let ignoreCancellation: Bool
    private let lock = NSLock()
    private var instant: Duration = .zero
    private var waiters: [UUID: (Duration, CheckedContinuation<Void, any Error>)] = [:]
    init(ignoreCancellation: Bool = false) { self.ignoreCancellation = ignoreCancellation }
    func now() -> Duration { lock.withLock { instant } }
    func sleep(for duration: Duration) async throws {
        try Task.checkCancellation()
        guard duration > .zero else { return }
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                lock.lock()
                if Task.isCancelled { lock.unlock(); continuation.resume(throwing: CancellationError()); return }
                waiters[id] = (instant + duration, continuation)
                lock.unlock()
            }
        } onCancel: {
            if self.ignoreCancellation { return }
            let value = self.lock.withLock { self.waiters.removeValue(forKey: id) }
            value?.1.resume(throwing: CancellationError())
        }
    }
    func advance(by duration: Duration, fireTimers: Bool = true) {
        let ready = lock.withLock {
            instant += duration
            guard fireTimers else { return [UUID: (Duration, CheckedContinuation<Void, any Error>)]() }
            let ready = waiters.filter { $0.value.0 <= instant }
            for id in ready.keys { waiters.removeValue(forKey: id) }
            return ready
        }
        for value in ready.values { value.1.resume() }
    }
    func hasDeadline(_ deadline: Duration) -> Bool { lock.withLock { waiters.values.contains { $0.0 == deadline } } }
}
