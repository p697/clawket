import Foundation
import CryptoKit
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

actor ScriptSocket: WebSocketConnection {
    typealias Handler = @Sendable (JSONValue, ScriptSocket) async throws -> Void
    var frames: [WebSocketFrame] = []
    var receiver: CheckedContinuation<WebSocketFrame, any Error>?
    var sent: [JSONValue] = []
    var closed = false
    var opens = 0
    let handler: Handler
    init(initial: [JSONValue] = [], handler: @escaping Handler = { _, _ in }) {
        self.frames = initial.map { .text(try! FrameCodec.encode($0)) }; self.handler = handler
    }
    func open() async throws { guard !closed else { throw WebSocketFailure.closed }; opens += 1 }
    func send(_ text: String) async throws {
        guard !closed else { throw WebSocketFailure.closed }
        let value = try FrameCodec.decode(text.hasPrefix(RelayControl.prefix) ? String(text.dropFirst(RelayControl.prefix.count)) : text)
        sent.append(value); try await handler(value, self)
    }
    func receive() async throws -> WebSocketFrame {
        if !frames.isEmpty { return frames.removeFirst() }
        guard !closed else { throw WebSocketFailure.closed }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                if Task.isCancelled { continuation.resume(throwing: CancellationError()) }
                else { receiver = continuation }
            }
        } onCancel: { Task { await self.close(code: 1000) } }
    }
    func close(code: Int) async { closed = true; receiver?.resume(throwing: WebSocketFailure.closed); receiver = nil }
    func emit(_ value: JSONValue, control: Bool = false) throws {
        let frame = WebSocketFrame.text((control ? RelayControl.prefix : "") + (try FrameCodec.encode(value)))
        if let receiver { self.receiver = nil; receiver.resume(returning: frame) }
        else { frames.append(frame) }
    }
    func reply(_ request: JSONValue, payload: JSONValue, metadata: JSONValue? = nil) throws {
        var value: [String: JSONValue] = ["type": .string("res"), "id": request["id"]!, "ok": .bool(true), "payload": payload]
        value["meta"] = metadata
        try emit(.object(value))
    }
    func reject(_ request: JSONValue, code: String, message: String = "peer-owned-secret") throws {
        try emit(.object(["type": .string("res"), "id": request["id"]!, "ok": .bool(false),
                          "error": .object(["code": .string(code), "message": .string(message)])]))
    }
    func methods() -> [String] { sent.compactMap { $0["method"]?.stringValue } }
    func requests(_ method: String) -> [JSONValue] { sent.filter { $0["method"]?.stringValue == method } }
}

final class ScriptFactory: WebSocketFactory, @unchecked Sendable {
    private let lock = NSLock()
    private let sockets: [ScriptSocket]
    private var index = 0
    private var endpoints: [URL] = []
    init(_ sockets: ScriptSocket...) { self.sockets = sockets }
    func makeSocket(url: URL) throws -> any WebSocketConnection {
        lock.lock(); defer { lock.unlock() }
        guard index < sockets.count else { throw WebSocketFailure.failed }
        endpoints.append(url); let socket = sockets[index]; index += 1; return socket
    }
    var count: Int { lock.lock(); defer { lock.unlock() }; return index }
    var urls: [URL] { lock.lock(); defer { lock.unlock() }; return endpoints }
}

actor Credentials: DeviceCredentialProvider {
    let value: RuntimeDeviceIdentity
    var tokens: [DeviceTokenScope: RuntimeDeviceToken] = [:]
    var writes: [DeviceTokenScope] = []
    var deletes: [DeviceTokenScope] = []
    var rejectDelete = false
    init() throws {
        let key = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 7, count: 32))
        let publicKey = key.publicKey.rawRepresentation
        value = RuntimeDeviceIdentity(deviceID: try PairingCryptography.deviceID(publicKey: publicKey), publicKey: publicKey,
                                      secretKey: key.rawRepresentation + publicKey)
    }
    func identity() async throws -> RuntimeDeviceIdentity { value }
    func readToken(scope: DeviceTokenScope) async throws -> RuntimeDeviceToken? { tokens[scope] }
    func writeToken(_ token: RuntimeDeviceToken, scope: DeviceTokenScope) async throws { tokens[scope] = token; writes.append(scope) }
    func deleteToken(scope: DeviceTokenScope) async throws {
        if rejectDelete { throw RuntimeFailure(.credentialStorage) }
        tokens.removeValue(forKey: scope); deletes.append(scope)
    }
    func failDeletion() { rejectDelete = true }
}

final class TestClock: TransportClock, @unchecked Sendable {
    struct Waiter { let deadline: Duration; let continuation: CheckedContinuation<Void, any Error> }
    private let lock = NSLock()
    private var time = Duration.zero
    private var waiters: [UUID: Waiter] = [:]
    func now() -> Duration { lock.lock(); defer { lock.unlock() }; return time }
    var pendingDelays: [Duration] { lock.lock(); defer { lock.unlock() }; return waiters.values.map { $0.deadline - time } }
    func sleep(for duration: Duration) async throws {
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                lock.lock()
                if Task.isCancelled { lock.unlock(); continuation.resume(throwing: CancellationError()); return }
                waiters[id] = Waiter(deadline: time + duration, continuation: continuation); lock.unlock()
            }
        } onCancel: { self.cancel(id) }
    }
    func advance(_ duration: Duration) {
        lock.lock(); time += duration
        let ready = waiters.filter { $0.value.deadline <= time }
        for id in ready.keys { waiters.removeValue(forKey: id) }
        lock.unlock()
        for value in ready.values { value.continuation.resume() }
    }
    private func cancel(_ id: UUID) {
        lock.lock(); let waiter = waiters.removeValue(forKey: id); lock.unlock()
        waiter?.continuation.resume(throwing: CancellationError())
    }
}

actor Events {
    var values: [RuntimeEvent] = []
    func append(_ value: RuntimeEvent) { values.append(value) }
}
func read(_ coordinator: RuntimeCoordinator, into recorder: Events) -> Task<Void, Never> {
    Task { do { for try await value in coordinator.events { await recorder.append(value) } } catch {} }
}
func eventually(_ condition: @escaping () async -> Bool) async throws {
    let deadline = ContinuousClock.now + .seconds(3)
    while !(await condition()) {
        guard ContinuousClock.now < deadline else { throw RuntimeFailure(.timeout) }
        await Task.yield()
    }
}
func connection(_ backend: BackendKind, relay: Bool = false, id: String = "connection-a", bootstrap: PairingBootstrap? = nil) -> BackendConnection {
    .init(id: id, backendKind: backend, transportKind: relay ? .relay : .local, label: "Saved local label",
          url: URL(string: backend == .hermes && !relay ? "ws://localhost:18080/v1/hermes/ws" : "ws://localhost:18080/ws")!,
          createdAt: 42, auth: .init(token: "fixture-token"), bootstrap: bootstrap,
          relay: relay ? .init(serverURL: URL(string: "https://registry.invalid")!, gatewayID: "fixture-room", clientToken: "fixture-relay-token") : nil)
}
func event(_ name: String, _ payload: JSONValue) -> JSONValue { .object(["type": .string("event"), "event": .string(name), "payload": payload]) }
let challengeFrame = event("connect.challenge", .object(["nonce": .string("fixture-nonce"), "ts": .number(1_778_198_400_300)]))
let hello: JSONValue = .object(["server": .object(["version": .string("fixture-openclaw"), "connId": .string("test")]),
                               "features": .object(["methods": .array([])])])
func health(_ backend: BackendKind) -> JSONValue {
    backend == .hermes ? .object(["status": .string("ok"), "hermesApiReachable": .bool(true), "mode": .string("hermes"),
                                  "capabilities": .array([.string("hermes.multi-session.v2")])])
        : .object(["backend": .string(backend.rawValue), "bridgeVersion": .string("fixture-version")])
}
