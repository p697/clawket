import Foundation

public struct ConnectionGeneration: Sendable, Equatable, Hashable {
    public let id: UUID
    public init() { id = UUID() }
}

public enum NativeConnectionState: Sendable, Equatable {
    case idle, connecting, handshaking, ready, offline
}

/// Keep the outer metadata: OpenClaw Bridge negotiation is not part of the Gateway payload.
public struct RPCResponse: Sendable, Equatable {
    public let payload: JSONValue
    public let metadata: JSONValue?
    public let envelope: JSONValue
}

/// Response receipt describes wire evidence, never native execution or permission to replay.
public struct RPCFailure: Error, Sendable, Equatable, CustomStringConvertible {
    public enum Code: String, Sendable, Equatable {
        case invalidConfiguration, invalidEndpoint, notConnected, invalidRequest
        case frameTooLarge, invalidFrame, pendingLimit, timeout, cancelled, retired
        case socketFailure, remoteRejection, heartbeatTimeout, eventBufferOverflow
    }
    public enum Delivery: Sendable, Equatable {
        case notDispatched, uncertain, responseReceived
    }
    public let code: Code
    public let delivery: Delivery
    /// Peer-owned protocol data. Never log this field or put it in analytics.
    public let remoteError: JSONValue?
    public var description: String { "RPCFailure(\(code.rawValue))" }

    public init(_ code: Code, delivery: Delivery = .notDispatched, remoteError: JSONValue? = nil) {
        self.code = code
        self.delivery = delivery
        self.remoteError = remoteError
    }
}

public struct RelayControl: Sendable, Equatable {
    public static let prefix = "__clawket_relay_control__:"
    public let event: String
    public let requestID: String?
    public let payload: JSONValue
    public let envelope: JSONValue
}

public enum ConnectionEvent: Sendable, Equatable {
    case state(ConnectionGeneration, NativeConnectionState)
    case backendFrame(ConnectionGeneration, JSONValue)
    case relayControl(ConnectionGeneration, RelayControl)
    /// Foreground or path hints request a real adapter probe; they never establish health.
    case backendProbeRequired(ConnectionGeneration)
    case failure(ConnectionGeneration, RPCFailure.Code)
}

public struct RelayHeartbeatConfiguration: Sendable, Equatable {
    public static let clientPongCapability = "relay.client-pong.v1"
    public static let clientPingCapability = "relay.client-ping.v1"
    public static let transferHintCapability = "relay.transfer-hint.v1"
    public static let advertisedCapabilities = [clientPongCapability, clientPingCapability, transferHintCapability]
    public let interval: Duration
    public let missedIntervals: Int

    public init(interval: Duration = .seconds(30), missedIntervals: Int = 3) throws {
        guard interval > .zero, interval <= .seconds(300), missedIntervals <= 100 else {
            throw RPCFailure(.invalidConfiguration)
        }
        self.interval = interval
        self.missedIntervals = max(3, missedIntervals)
    }
}

/// The coordinator owns retry scheduling. This actor never replays writes or calls connect recursively.
public actor RPCConnection {
    public nonisolated let events: AsyncThrowingStream<ConnectionEvent, any Error>
    private let eventContinuation: AsyncThrowingStream<ConnectionEvent, any Error>.Continuation
    private let factory: any WebSocketFactory
    let clock: any TransportClock
    private let openTimeout: Duration
    private let handshakeTimeout: Duration
    private let maximumPending: Int
    private let eventBufferLimit: Int
    private let eventBufferByteLimit: Int
    private var eventBufferWeights: [Int] = []
    var current: Entry?
    private var pending: [String: Pending] = [:]
    private var dispatches: [String: Task<Void, Never>] = [:]
    private var reconnectPolicy = ReconnectPolicy()
    var foreground = true
    private var streamAvailable = true
    public private(set) var state: NativeConnectionState = .idle
    public var generation: ConnectionGeneration? { current?.generation }
    public var pendingRequestCount: Int { pending.count }

    struct Entry: Sendable {
        let generation: ConnectionGeneration
        let endpoint: URL
        let socket: any WebSocketConnection
        var relay: RelayHeartbeatConfiguration?
        let openDeadline: Duration
        var handshakeDeadline: ResponseDeadline?
        var openTask: Task<Void, any Error>?
        var receiveTask: Task<Void, Never>?
        var openTimeoutTask: Task<Void, Never>?
        var handshakeTask: Task<Void, Never>?
        var heartbeatTask: Task<Void, Never>?
        var lastTick: Duration?
        var liveness = RelayLivenessState()
    }

    private struct Pending {
        let generation: ConnectionGeneration
        let continuation: CheckedContinuation<RPCResponse, any Error>
        var deadline: ResponseDeadline
        var timeout: Task<Void, Never>?
        var delivery: RPCFailure.Delivery = .notDispatched
    }

    public init(factory: any WebSocketFactory = URLSessionWebSocketFactory(),
                clock: any TransportClock = MonotonicTransportClock(),
                openTimeout: Duration = .seconds(10), handshakeTimeout: Duration = .seconds(20),
                maximumPending: Int = 128, eventBufferLimit: Int = 256,
                eventBufferByteLimit: Int = 16 * 1_024 * 1_024) throws {
        guard openTimeout > .zero, openTimeout <= .seconds(120),
              handshakeTimeout > .zero, handshakeTimeout <= .seconds(120),
              (1...128).contains(maximumPending), (1...1_024).contains(eventBufferLimit),
              (128...(32 * 1_024 * 1_024)).contains(eventBufferByteLimit) else {
            throw RPCFailure(.invalidConfiguration)
        }
        self.factory = factory
        self.clock = clock
        self.openTimeout = openTimeout
        self.handshakeTimeout = handshakeTimeout
        self.maximumPending = maximumPending
        self.eventBufferLimit = eventBufferLimit
        self.eventBufferByteLimit = eventBufferByteLimit
        let stream = AsyncThrowingStream<ConnectionEvent, any Error>.makeStream(bufferingPolicy: .bufferingOldest(eventBufferLimit))
        events = stream.stream
        eventContinuation = stream.continuation
        eventContinuation.onTermination = { @Sendable [weak self] _ in
            Task { await self?.eventsTerminated() }
        }
    }

    /// Returns after the WebSocket upgrade. The adapter must authenticate and verify backend health.
    public func connect(to endpoint: URL, relay: RelayHeartbeatConfiguration? = nil) async throws -> ConnectionGeneration {
        guard !Task.isCancelled else { throw RPCFailure(.cancelled) }
        guard streamAvailable else { throw RPCFailure(.eventBufferOverflow) }
        guard ["ws", "wss"].contains(endpoint.scheme?.lowercased() ?? ""),
              endpoint.host?.isEmpty == false, endpoint.user == nil, endpoint.password == nil, endpoint.fragment == nil else {
            throw RPCFailure(.invalidEndpoint)
        }
        if let existing = current, existing.endpoint == endpoint, existing.relay == relay {
            if let task = existing.openTask { try await awaitOpen(task, generation: existing.generation) }
            guard current?.generation == existing.generation else { throw RPCFailure(.retired) }
            try finishOpen(existing.generation, socket: existing.socket)
            return existing.generation
        }
        retire(code: .retired, closeCode: 1000)
        let socket: any WebSocketConnection
        do { socket = try factory.makeSocket(url: endpoint) }
        catch { throw RPCFailure(.invalidEndpoint) }
        let generation = ConnectionGeneration()
        let openTask = Task { try await socket.open() }
        current = Entry(generation: generation, endpoint: endpoint, socket: socket, relay: relay,
                        openDeadline: clock.now() + openTimeout, openTask: openTask)
        state = .connecting
        guard emit(.state(generation, .connecting)) else { throw RPCFailure(.eventBufferOverflow) }
        let clock = clock
        let timeout = openTimeout
        current?.openTimeoutTask = Task { [weak self] in
            do { try await clock.sleep(for: timeout) } catch { return }
            await self?.expireOpen(generation)
        }
        try await awaitOpen(openTask, generation: generation)
        guard current?.generation == generation else { throw RPCFailure(.retired) }
        try finishOpen(generation, socket: socket)
        return generation
    }

    private func finishOpen(_ generation: ConnectionGeneration, socket: any WebSocketConnection) throws {
        guard current?.generation == generation else { throw RPCFailure(.retired) }
        if state == .connecting {
            guard let deadline = current?.openDeadline, clock.now() < deadline else {
                fail(generation, code: .timeout)
                throw RPCFailure(.timeout)
            }
            current?.openTask = nil
            current?.openTimeoutTask?.cancel()
            current?.openTimeoutTask = nil
            state = .handshaking
            current?.handshakeDeadline = ResponseDeadline(startedAt: clock.now(), timeout: handshakeTimeout)
            guard emit(.state(generation, .handshaking)) else { throw RPCFailure(.eventBufferOverflow) }
            startReceiving(generation, socket: socket)
            startHandshakeDeadline(generation)
        }
    }

    /// Only a positive, adapter-validated response from this exact socket may call this method.
    @discardableResult
    public func confirmBackendReady(generation: ConnectionGeneration) -> Bool {
        guard current?.generation == generation, state == .handshaking || state == .ready else { return false }
        if state == .handshaking, handshakeRemaining(generation) <= .zero {
            fail(generation, code: .timeout)
            return false
        }
        current?.handshakeTask?.cancel()
        current?.handshakeTask = nil
        current?.handshakeDeadline = nil
        reconnectPolicy.confirmedBackendReady()
        let changed = state != .ready
        state = .ready
        current?.lastTick = clock.now()
        startHeartbeat(generation)
        if current?.liveness.clientPingNegotiated == true {
            scheduleClientPing(generation, delay: current?.liveness.transfer.hasWindow == true ? .zero : .seconds(5))
        }
        return !changed || emit(.state(generation, .ready))
    }

    /// A new authenticated backend challenge retires earlier RPCs without claiming new health.
    /// The adapter separately fences its authentication/history revisions and ignores duplicate challenges.
    @discardableResult
    public func beginBackendHandshake(generation: ConnectionGeneration) -> Bool {
        guard current?.generation == generation, state == .handshaking || state == .ready else { return false }
        current?.handshakeTask?.cancel()
        current?.heartbeatTask?.cancel()
        current?.heartbeatTask = nil
        current?.lastTick = nil
        current?.liveness.pause() // A backend challenge does not renew the socket's transfer budget.
        rejectPending(code: .retired)
        current?.handshakeDeadline = ResponseDeadline(startedAt: clock.now(), timeout: handshakeTimeout)
        state = .handshaking
        guard emit(.state(generation, .handshaking)) else { return false }
        startHandshakeDeadline(generation)
        return true
    }

    public func nextReconnectDelay(randomUnit: Double = 0.5) -> Duration {
        reconnectPolicy.nextDelay(randomUnit: randomUnit)
    }

    /// Apply a negotiated policy without treating the policy frame as health evidence.
    @discardableResult
    public func configureHeartbeat(_ configuration: RelayHeartbeatConfiguration,
                                   generation: ConnectionGeneration) -> Bool {
        guard current?.generation == generation, current?.relay != nil else { return false }
        guard current?.relay != configuration else { return true }
        current?.relay = configuration
        if state == .ready { startHeartbeat(generation) }
        return true
    }

    public func disconnect() {
        retire(code: .retired, closeCode: 1000)
    }

    public func setForeground(_ active: Bool) {
        guard foreground != active else { return }
        foreground = active
        current?.heartbeatTask?.cancel()
        current?.heartbeatTask = nil
        current?.liveness.pause()
        guard active, let generation = current?.generation, state == .ready else { return }
        current?.lastTick = clock.now()
        startHeartbeat(generation)
        if current?.liveness.clientPingNegotiated == true {
            scheduleClientPing(generation, delay: current?.liveness.transfer.hasWindow == true ? .zero : .seconds(5))
        }
        _ = emit(.backendProbeRequired(generation))
    }

    /// Network hints are neither Relay reachability nor backend readiness evidence.
    public func networkPathChanged() {
        guard foreground, let generation = current?.generation, state == .ready else { return }
        _ = emit(.backendProbeRequired(generation))
    }

    public func request(method: String, params: JSONValue = .object([:]),
                        timeout: Duration = .seconds(20), generation: ConnectionGeneration? = nil) async throws -> JSONValue {
        try await requestEnvelope(method: method, params: params, timeout: timeout, generation: generation).payload
    }

    public func requestEnvelope(method: String, params: JSONValue = .object([:]),
                                timeout: Duration = .seconds(20), generation: ConnectionGeneration? = nil) async throws -> RPCResponse {
        guard !Task.isCancelled else { throw RPCFailure(.cancelled) }
        guard !method.isEmpty, method.utf8.count <= 128, timeout > .zero, timeout <= .seconds(300) else {
            throw RPCFailure(.invalidRequest)
        }
        guard let entry = current, state == .handshaking || state == .ready else { throw RPCFailure(.notConnected) }
        if let generation, generation != entry.generation { throw RPCFailure(.retired) }
        guard pending.count < maximumPending else { throw RPCFailure(.pendingLimit) }
        let id = UUID().uuidString.lowercased()
        let frame = try Self.requestFrame(method: method, params: params, id: id)
        let generation = entry.generation
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard !Task.isCancelled else { continuation.resume(throwing: RPCFailure(.cancelled)); return }
                pending[id] = Pending(generation: generation, continuation: continuation,
                                      deadline: ResponseDeadline(startedAt: clock.now(), timeout: timeout))
                let clock = clock
                pending[id]?.timeout = Task { [weak self] in
                    var delay = timeout
                    do {
                        while !Task.isCancelled {
                            try await clock.sleep(for: delay)
                            guard let next = await self?.requestTimeoutDelay(id, generation: generation) else { return }
                            delay = next
                        }
                    } catch { return }
                }
                // The send task never holds the actor across native I/O. Retirement and
                // expiry retain cancellation ownership even when send completion stalls.
                dispatches[id] = Task { [weak self, socket = entry.socket] in
                    guard let permit = await self?.beginDispatch(id, generation: generation, bytes: frame.utf8.count) else { return }
                    var failed = false
                    var accepted = false
                    do {
                        try Task.checkCancellation()
                        try await socket.send(frame)
                        accepted = true
                    } catch { failed = !Task.isCancelled }
                    await self?.completeDispatch(id, generation: generation, transfer: permit.transfer,
                                                 accepted: accepted, failed: failed)
                }
            }
        } onCancel: {
            Task { await self.expireRequest(id, generation: generation, code: .cancelled) }
        }
    }

    public func sendBackendFrame(_ value: JSONValue, generation: ConnectionGeneration) async throws {
        try await send(encode(value), generation: generation)
    }

    public func sendRelayControl(event: String, requestID: String? = nil, payload: JSONValue = .object([:]),
                                 generation: ConnectionGeneration) async throws {
        guard !event.isEmpty, event.utf8.count <= 128, requestID?.utf8.count ?? 0 <= 128 else { throw RPCFailure(.invalidRequest) }
        var value: [String: JSONValue] = ["type": .string("control"), "event": .string(event), "payload": payload]
        if let requestID { value["requestId"] = .string(requestID) }
        let frame = RelayControl.prefix + (try encode(.object(value)))
        do { try FrameCodec.validateSize(frame) }
        catch { throw RPCFailure(.frameTooLarge) }
        try await send(frame, generation: generation)
    }

    private func awaitOpen(_ task: Task<Void, any Error>, generation: ConnectionGeneration) async throws {
        do {
            try await withTaskCancellationHandler { try await task.value } onCancel: {
                Task { await self.fail(generation, code: .cancelled) }
            }
        } catch {
            guard current?.generation == generation else { throw RPCFailure(.retired) }
            fail(generation, code: .socketFailure)
            throw RPCFailure(.socketFailure)
        }
        guard !Task.isCancelled else { throw RPCFailure(.cancelled) }
    }

    /// Exact complete UTF-8 envelope preflight. Dispatch uses the same constructor;
    /// native request IDs always have the same 36-byte UUID representation.
    public nonisolated static func validateRequest(method: String, params: JSONValue) throws {
        _ = try requestFrame(method: method, params: params, id: "00000000-0000-0000-0000-000000000000")
    }

    private nonisolated static func requestFrame(method: String, params: JSONValue, id: String) throws -> String {
        guard !method.isEmpty, method.utf8.count <= 128 else { throw RPCFailure(.invalidRequest) }
        return try encodeFrame(.object(["type": .string("req"), "id": .string(id), "method": .string(method), "params": params]))
    }

    private func encode(_ value: JSONValue) throws -> String { try Self.encodeFrame(value) }

    private nonisolated static func encodeFrame(_ value: JSONValue) throws -> String {
        do { return try FrameCodec.encode(value) }
        catch FrameValidationError.tooLarge { throw RPCFailure(.frameTooLarge) }
        catch { throw RPCFailure(.invalidFrame) }
    }

    private func send(_ frame: String, generation: ConnectionGeneration) async throws {
        guard !Task.isCancelled else { throw RPCFailure(.cancelled) }
        guard let entry = current, entry.generation == generation,
              state == .handshaking || state == .ready else { throw RPCFailure(.retired) }
        if frame.utf8.count >= RelayTransferLease.minimumBytes,
           entry.liveness.transfer.pendingDispatchCount >= 128 { throw RPCFailure(.pendingLimit) }
        let transfer = beginOutgoingTransfer(bytes: frame.utf8.count, generation: generation)
        guard current?.generation == generation else { throw RPCFailure(.retired) }
        do { try await entry.socket.send(frame) }
        catch {
            finishOutgoingTransfer(transfer, accepted: false, generation: generation)
            fail(generation, code: .socketFailure)
            throw RPCFailure(.socketFailure, delivery: .uncertain)
        }
        finishOutgoingTransfer(transfer, accepted: true, generation: generation)
        guard current?.generation == generation else { throw RPCFailure(.retired, delivery: .uncertain) }
    }

    private struct DispatchPermit: Sendable { let transfer: UUID? }

    private func beginDispatch(_ id: String, generation: ConnectionGeneration, bytes: Int) -> DispatchPermit? {
        guard let request = pending[id], request.generation == generation,
              current?.generation == generation, !Task.isCancelled else { return nil }
        if requestRemaining(id, generation: generation) <= .zero {
            expireRequest(id, generation: generation, code: .timeout); return nil
        }
        if bytes >= RelayTransferLease.minimumBytes,
           current?.liveness.transfer.pendingDispatchCount ?? 0 >= 128 {
            expireRequest(id, generation: generation, code: .pendingLimit); return nil
        }
        // Entering a native send may dispatch even if its asynchronous completion later fails.
        pending[id]?.delivery = .uncertain
        let transfer = beginOutgoingTransfer(bytes: bytes, generation: generation)
        guard current?.generation == generation, pending[id] != nil else { return nil }
        return DispatchPermit(transfer: transfer)
    }

    private func completeDispatch(_ id: String, generation: ConnectionGeneration, transfer: UUID?, accepted: Bool, failed: Bool) {
        dispatches.removeValue(forKey: id)
        finishOutgoingTransfer(transfer, accepted: accepted, generation: generation)
        if failed { fail(generation, code: .socketFailure) }
    }

    private func expireRequest(_ id: String, generation: ConnectionGeneration, code: RPCFailure.Code) {
        guard let request = pending[id], request.generation == generation else { return }
        if code == .timeout, requestRemaining(id, generation: generation) > .zero { return }
        pending.removeValue(forKey: id)
        request.timeout?.cancel()
        dispatches.removeValue(forKey: id)?.cancel()
        request.continuation.resume(throwing: RPCFailure(code, delivery: request.delivery))
    }

    private func requestRemaining(_ id: String, generation: ConnectionGeneration) -> Duration {
        guard var request = pending[id], request.generation == generation,
              current?.generation == generation else { return .zero }
        let remaining = request.deadline.remaining(at: clock.now(), transferGrace: transferGrace(generation: generation))
        pending[id] = request
        return remaining
    }

    private func requestTimeoutDelay(_ id: String, generation: ConnectionGeneration) -> Duration? {
        guard pending[id]?.generation == generation else { return nil }
        let remaining = requestRemaining(id, generation: generation)
        if remaining > .zero { return remaining }
        expireRequest(id, generation: generation, code: .timeout)
        return nil
    }

    func handshakeRemaining(_ generation: ConnectionGeneration) -> Duration {
        guard current?.generation == generation, var deadline = current?.handshakeDeadline else { return .zero }
        let remaining = deadline.remaining(at: clock.now(), transferGrace: transferGrace(generation: generation))
        current?.handshakeDeadline = deadline
        return remaining
    }

    /// Observe protection before a frame/probe clears it, even if a timer was suspended.
    func observeTransferDeadlines(_ generation: ConnectionGeneration) {
        guard current?.generation == generation else { return }
        for id in Array(pending.keys) {
            if requestRemaining(id, generation: generation) <= .zero {
                expireRequest(id, generation: generation, code: .timeout)
            }
        }
        if state == .handshaking, handshakeRemaining(generation) <= .zero { fail(generation, code: .timeout) }
    }

    private func startReceiving(_ generation: ConnectionGeneration, socket: any WebSocketConnection) {
        current?.receiveTask = Task { [weak self] in
            do {
                while !Task.isCancelled {
                    let frame = try await socket.receive()
                    guard !Task.isCancelled else { return }
                    guard await self?.receive(frame, generation: generation) == true else { return }
                }
            } catch {
                let code: RPCFailure.Code = error as? WebSocketFailure == .frameTooLarge ? .frameTooLarge : .socketFailure
                await self?.fail(generation, code: code)
            }
        }
    }

    private func receive(_ frame: WebSocketFrame, generation: ConnectionGeneration) async -> Bool {
        guard current?.generation == generation else { return false }
        let text: String
        do { text = try FrameCodec.text(from: frame) }
        catch FrameValidationError.tooLarge { fail(generation, code: .frameTooLarge, closeCode: 1009); return false }
        catch { fail(generation, code: .invalidFrame); return false }
        guard validateLivenessDeadline(generation) else { return false }
        if text.hasPrefix(RelayControl.prefix) {
            do {
                let value = try FrameCodec.decode(String(text.dropFirst(RelayControl.prefix.count)))
                guard value["type"]?.stringValue == "control", let event = value["event"]?.stringValue,
                      !event.isEmpty, event.utf8.count <= 128 else { throw FrameValidationError.invalidJSON }
                if consumeRelayLiveness(value, bytes: text.utf8.count, generation: generation) {
                    return current?.generation == generation
                }
                completeIncomingTransfer(bytes: text.utf8.count, generation: generation)
                guard current?.generation == generation else { return false }
                let requestID = value["requestId"]?.stringValue ?? value["payload"]?["requestId"]?.stringValue
                guard requestID?.utf8.count ?? 0 <= 128 else { throw FrameValidationError.invalidJSON }
                return emit(.relayControl(generation, RelayControl(event: event, requestID: requestID,
                            payload: value["payload"] ?? .object([:]), envelope: value)), weight: text.utf8.count)
            } catch { fail(generation, code: .invalidFrame); return false }
        }
        completeIncomingTransfer(bytes: text.utf8.count, generation: generation)
        guard current?.generation == generation else { return false }
        let value: JSONValue
        do { value = try FrameCodec.decode(text) }
        catch { fail(generation, code: .invalidFrame); return false }
        guard case .object = value else { fail(generation, code: .invalidFrame); return false }
        if current?.relay != nil, value["type"]?.stringValue == "tick" {
            current?.lastTick = clock.now()
            if value["ack"]?.stringValue == RelayHeartbeatConfiguration.clientPongCapability,
               let ts = value["ts"]?.numberValue, ts.isFinite {
                do { try await send(encode(.object(["type": .string("pong"), "ts": .number(ts)])), generation: generation) }
                catch { return false }
            }
            return current?.generation == generation
        }
        if value["type"]?.stringValue == "res" {
            guard let id = value["id"]?.stringValue, id.utf8.count <= 128,
                  let ok = value["ok"]?.boolValue else { fail(generation, code: .invalidFrame); return false }
            guard let request = pending[id], request.generation == generation else { return true }
            if requestRemaining(id, generation: generation) <= .zero {
                expireRequest(id, generation: generation, code: .timeout); return true
            }
            pending.removeValue(forKey: id)
            request.timeout?.cancel()
            if ok { request.continuation.resume(returning: RPCResponse(payload: value["payload"] ?? .null, metadata: value["meta"], envelope: value)) }
            else { request.continuation.resume(throwing: RPCFailure(.remoteRejection, delivery: .responseReceived, remoteError: value["error"])) }
            return true
        }
        return emit(.backendFrame(generation, value), weight: text.utf8.count)
    }

    private func startHandshakeDeadline(_ generation: ConnectionGeneration) {
        let clock = clock
        let timeout = handshakeTimeout
        current?.handshakeTask = Task { [weak self] in
            var delay = timeout
            do {
                while !Task.isCancelled {
                    try await clock.sleep(for: delay)
                    guard let next = await self?.handshakeTimeoutDelay(generation) else { return }
                    delay = next
                }
            } catch { return }
        }
    }

    private func expireOpen(_ generation: ConnectionGeneration) {
        guard current?.generation == generation, state == .connecting,
              let deadline = current?.openDeadline, clock.now() >= deadline else { return }
        fail(generation, code: .timeout)
    }

    private func handshakeTimeoutDelay(_ generation: ConnectionGeneration) -> Duration? {
        guard current?.generation == generation, state == .handshaking else { return nil }
        let remaining = handshakeRemaining(generation)
        if remaining > .zero { return remaining }
        fail(generation, code: .timeout)
        return nil
    }

    private func startHeartbeat(_ generation: ConnectionGeneration) {
        current?.heartbeatTask?.cancel()
        guard foreground, let relay = current?.relay, current?.liveness.clientPingNegotiated != true else { return }
        let clock = clock
        let budget = relay.interval * relay.missedIntervals
        current?.heartbeatTask = Task { [weak self] in
            do {
                try await clock.sleep(for: budget)
                while !Task.isCancelled {
                    guard await self?.checkHeartbeat(generation, budget: budget) == true else { return }
                    try await clock.sleep(for: relay.interval)
                }
            } catch { return }
        }
    }

    private func checkHeartbeat(_ generation: ConnectionGeneration, budget: Duration) -> Bool {
        guard !Task.isCancelled else { return false }
        guard let entry = current, entry.generation == generation, state == .ready, foreground else { return false }
        guard let tick = entry.lastTick, clock.now() - tick < budget else {
            fail(generation, code: .heartbeatTimeout)
            return false
        }
        return true
    }

    func fail(_ generation: ConnectionGeneration, code: RPCFailure.Code, closeCode: Int = 1001) {
        guard current?.generation == generation else { return }
        _ = emit(.failure(generation, code))
        retire(code: code, closeCode: code == .frameTooLarge ? 1009 : closeCode)
    }

    /// No await before the generation and every pending request have been retired.
    private func retire(code: RPCFailure.Code, closeCode: Int) {
        guard var entry = current else { return }
        current = nil
        entry.openTask?.cancel()
        entry.openTimeoutTask?.cancel()
        entry.receiveTask?.cancel()
        entry.handshakeTask?.cancel()
        entry.heartbeatTask?.cancel()
        entry.liveness.retire()
        rejectPending(code: code)
        state = .offline
        _ = emit(.state(entry.generation, .offline))
        Task { await entry.socket.close(code: closeCode) }
    }

    private func rejectPending(code: RPCFailure.Code) {
        for dispatch in dispatches.values { dispatch.cancel() }
        dispatches.removeAll(keepingCapacity: true)
        let requests = pending
        pending.removeAll(keepingCapacity: true)
        for request in requests.values {
            request.timeout?.cancel()
            request.continuation.resume(throwing: RPCFailure(code, delivery: request.delivery))
        }
    }

    @discardableResult
    private func emit(_ event: ConnectionEvent, weight: Int = 64) -> Bool {
        guard streamAvailable else { return false }
        switch eventContinuation.yield(event) {
        case .enqueued(let remainingCapacity):
            eventBufferWeights.append(weight)
            let bufferedCount = min(eventBufferLimit, max(0, eventBufferLimit - remainingCapacity))
            if eventBufferWeights.count > bufferedCount {
                eventBufferWeights.removeFirst(eventBufferWeights.count - bufferedCount)
            }
            guard eventBufferWeights.reduce(0, +) <= eventBufferByteLimit else { return overflow() }
            return true
        case .dropped:
            return overflow()
        case .terminated:
            streamAvailable = false
            retire(code: .retired, closeCode: 1000)
            return false
        @unknown default: return false
        }
    }

    private func overflow() -> Bool {
        streamAvailable = false
        eventBufferWeights.removeAll()
        eventContinuation.finish(throwing: RPCFailure(.eventBufferOverflow))
        retire(code: .eventBufferOverflow, closeCode: 1001)
        return false
    }

    private func eventsTerminated() {
        streamAvailable = false
        retire(code: .retired, closeCode: 1000)
    }

    deinit {
        current?.openTask?.cancel()
        current?.openTimeoutTask?.cancel()
        current?.receiveTask?.cancel()
        current?.handshakeTask?.cancel()
        current?.heartbeatTask?.cancel()
        current?.liveness.retire()
        for dispatch in dispatches.values { dispatch.cancel() }
        for request in pending.values {
            request.timeout?.cancel()
            request.continuation.resume(throwing: RPCFailure(.retired, delivery: request.delivery))
        }
        if let socket = current?.socket { Task { await socket.close(code: 1000) } }
        eventContinuation.finish()
    }
}
