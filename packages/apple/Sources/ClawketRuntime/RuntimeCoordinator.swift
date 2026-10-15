import Foundation
import ClawketPairing
import ClawketTransport

/// One active backend, one transport reader, and one retry owner. Writes are never replayed.
public actor RuntimeCoordinator {
    public nonisolated let events: AsyncThrowingStream<RuntimeEvent, any Error>
    let eventContinuation: AsyncThrowingStream<RuntimeEvent, any Error>.Continuation
    let credentials: any DeviceCredentialProvider
    let socketFactory: any WebSocketFactory
    let clock: any TransportClock
    let client: RuntimeClient
    let artifactHTTP: any RuntimeArtifactHTTPClient
    var artifactEntries: [UUID: RuntimeArtifactEntry] = [:]
    var artifactOpenings: Set<UUID> = []
    var artifactDownloads: [UUID: Task<Data, any Error>] = [:]
    var connection: BackendConnection?
    var transport: RPCConnection?
    var generation: ConnectionGeneration?
    var epoch = UUID()
    var attempt = UUID()
    var authentication = UUID()
    var readerTask: Task<Void, Never>?
    var openTask: Task<Void, Never>?
    var handshakeTask: Task<Void, Never>?
    var retryTask: Task<Void, Never>?
    var periodicProbeTask: Task<Void, Never>?
    var probeTask: Task<Bool, Never>?
    var waiters: [UUID: CheckedContinuation<Void, any Error>] = [:]
    var foreground = true
    var stopped = false
    var lastNonce: String?
    var identity: RuntimeDeviceIdentity?
    var signedConnectIdentity: SignedConnectIdentity?
    var deviceApproval: RuntimeDeviceApprovalContext?
    var deviceRepairAttempted = false
    var bootstrapDisabled = false
    var activeAuthSource: AuthSource?
    var bridgeCapabilities: [String] = []
    var supportedMethods: Set<String> = []
    var sessionMethodsAdvertised = true
    var backendHealth: JSONValue = .null
    var sessionEvents = SessionEvents()
    var consents = ConsentRegistry()
    var consentExpiryTask: Task<Void, Never>?
    var hasHumanActivityClock = false
    var reconnect = ReconnectPolicy()
    var previouslyReady = false
    var unavailableAttempts = 0
    var catalog: [RuntimeSession] = []
    var sessionManagementState = SessionManagementState()
    var modelControlsState = ModelControlsState()
    var historyRevisions: [String: UUID] = [:]
    var catalogTask: Task<RuntimeRoster, any Error>?
    var catalogTaskID = UUID()
    var historyTasks: [String: Task<RuntimeHistory, any Error>] = [:]
    var historyTaskIDs: [String: UUID] = [:]
    var historyPending = 0
    var controlWaiter: ControlWaiter?
    var controlDispatches: [String: Task<Void, Never>] = [:]
    var eventWeights: [Int] = []
    var streamAvailable = true
    public private(set) var state = RuntimeConnectionState()

    struct Scope: Equatable, Sendable {
        let epoch: UUID
        let attempt: UUID
        let authentication: UUID
        let generation: ConnectionGeneration
    }
    struct ControlWaiter: Sendable {
        let id: String
        let scope: Scope
        let continuation: CheckedContinuation<RelayControl, any Error>
        let timeout: Task<Void, Never>
        let deadline: Duration
    }

    public init(credentials: any DeviceCredentialProvider,
                socketFactory: any WebSocketFactory = URLSessionWebSocketFactory(),
                clock: any TransportClock = MonotonicTransportClock(), client: RuntimeClient = .init(),
                artifactHTTP: any RuntimeArtifactHTTPClient = URLSessionArtifactHTTPClient()) throws {
        guard !client.version.isEmpty, client.version.utf8.count <= 128,
              ["iphone", "ipad"].contains(client.deviceFamily) else { throw RuntimeFailure(.invalidConnection) }
        self.credentials = credentials; self.socketFactory = socketFactory; self.clock = clock; self.client = client
        self.artifactHTTP = artifactHTTP
        let stream = AsyncThrowingStream<RuntimeEvent, any Error>.makeStream(bufferingPolicy: .bufferingOldest(64))
        events = stream.stream; eventContinuation = stream.continuation
        eventContinuation.onTermination = { @Sendable [weak self] _ in Task { await self?.disconnect() } }
    }

    /// Waits for verified backend readiness. Repeated calls join the active connection.
    public func activate(_ value: BackendConnection) async throws {
        guard streamAvailable else { throw RuntimeFailure(.capacity) }
        if connection != value || stopped || state.phase == .error {
            let old = retire()
            connection = value; stopped = false; epoch = UUID(); authentication = UUID()
            identity = nil; deviceRepairAttempted = false; bootstrapDisabled = false
            reconnect = ReconnectPolicy(); previouslyReady = false; unavailableAttempts = 0
            hasHumanActivityClock = false; catalog = []
            publishState(.connecting)
            let captured = epoch
            await old?.disconnect()
            guard captured == epoch else { throw RuntimeFailure(.superseded) }
        }
        if state.phase == .ready { return }
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                guard !Task.isCancelled else { continuation.resume(throwing: RuntimeFailure(.superseded)); return }
                waiters[id] = continuation
                if transport == nil && retryTask == nil { startAttempt() }
            }
        } onCancel: { Task { await self.cancelWaiter(id) } }
    }

    public func disconnect() async {
        let old = retire(); stopped = true; connection = nil
        publishState(.idle)
        await old?.disconnect()
    }

    public func setForeground(_ value: Bool) async {
        guard foreground != value else { return }
        foreground = value
        periodicProbeTask?.cancel(); periodicProbeTask = nil
        retryTask?.cancel(); retryTask = nil
        let captured = epoch
        await transport?.setForeground(value)
        guard epoch == captured else { return }
        if value && !stopped {
            if state.phase == .ready { startPeriodicProbe(); requestProbe() }
            else if transport == nil { startAttempt() }
        }
    }

    public func networkPathChanged() async {
        guard foreground, !stopped else { return }
        if transport == nil { retryTask?.cancel(); retryTask = nil; startAttempt() }
        else { await transport?.networkPathChanged() }
    }

    func startAttempt() {
        guard !stopped, streamAvailable, let connection, transport == nil else { return }
        attempt = UUID(); authentication = UUID(); generation = nil; lastNonce = nil
        signedConnectIdentity = nil; deviceApproval = nil
        bridgeCapabilities = []; supportedMethods = []; sessionMethodsAdvertised = true; backendHealth = .null; sessionEvents = SessionEvents()
        let capturedEpoch = epoch, capturedAttempt = attempt
        do {
            let transport = try RPCConnection(factory: socketFactory, clock: clock,
                                              handshakeTimeout: connection.backendKind == .hermes ? .seconds(8) : .seconds(20))
            self.transport = transport
            publishState(previouslyReady ? .reconnecting : .connecting)
            readerTask = Task { [weak self] in
                do {
                    for try await event in transport.events {
                        guard !Task.isCancelled else { return }
                        await self?.receive(event, epoch: capturedEpoch, attempt: capturedAttempt)
                    }
                } catch { await self?.attemptFailed(RuntimeFailure(.network, retryable: true), epoch: capturedEpoch, attempt: capturedAttempt) }
            }
            let credentials = credentials
            openTask = Task { [weak self] in
                do {
                    let deviceIdentity: RuntimeDeviceIdentity?
                    do { deviceIdentity = connection.backendKind == .openclaw ? try await credentials.identity() : nil }
                    catch { throw RuntimeFailure(.credentialStorage) }
                    let endpoint = try BackendProfile.endpoint(connection, deviceID: deviceIdentity?.deviceID ?? connection.id)
                    guard await self?.prepareOpen(identity: deviceIdentity, epoch: capturedEpoch, attempt: capturedAttempt) == true else { return }
                    let generation = try await transport.connect(to: endpoint, relay: connection.transportKind == .relay ? .init() : nil)
                    await self?.opened(generation, epoch: capturedEpoch, attempt: capturedAttempt)
                } catch {
                    await self?.attemptFailed(runtimeFailure(error), epoch: capturedEpoch, attempt: capturedAttempt)
                }
            }
        } catch { attemptFailed(runtimeFailure(error), epoch: capturedEpoch, attempt: capturedAttempt) }
    }

    func prepareOpen(identity: RuntimeDeviceIdentity?, epoch: UUID, attempt: UUID) async -> Bool {
        guard self.epoch == epoch, self.attempt == attempt, !stopped else { return false }
        self.identity = identity
        await transport?.setForeground(foreground)
        return self.epoch == epoch && self.attempt == attempt && !stopped
    }

    func opened(_ generation: ConnectionGeneration, epoch: UUID, attempt: UUID) {
        guard self.epoch == epoch, self.attempt == attempt, !stopped, let connection else { return }
        self.generation = generation
        if state.phase != .ready {
            publishState(.handshaking)
            if connection.backendKind != .openclaw { launchHealthHandshake() }
        }
    }

    func receive(_ event: ConnectionEvent, epoch: UUID, attempt: UUID) async {
        guard self.epoch == epoch, self.attempt == attempt, !stopped else { return }
        switch event {
        case .state(let generation, let phase):
            if self.generation == nil { self.generation = generation }
            guard self.generation == generation else { return }
            if phase == .handshaking { publishState(.handshaking) }
            if phase == .offline { attemptFailed(RuntimeFailure(.network, retryable: true), epoch: epoch, attempt: attempt) }
        case .failure(let generation, let code):
            guard self.generation == generation else { return }
            attemptFailed(runtimeFailure(RPCFailure(code)), epoch: epoch, attempt: attempt)
        case .backendProbeRequired(let generation):
            if self.generation == generation { requestProbe() }
        case .relayControl(let generation, let control):
            guard self.generation == generation else { return }
            receiveControl(control)
        case .backendFrame(let generation, let frame):
            guard self.generation == generation, let connection else { return }
            if connection.backendKind == .openclaw, frame["event"]?.stringValue == "connect.challenge" {
                await challenge(frame["payload"] ?? .null)
            } else if connection.backendKind == .hermes, frame["event"]?.stringValue == "health" {
                do {
                    try validateHealth(frame["payload"] ?? .null)
                    await markReady(health: frame["payload"] ?? .null, scope: try scope(requireReady: false))
                } catch { attemptFailed(runtimeFailure(error), epoch: epoch, attempt: attempt, unavailable: true) }
            } else if state.phase == .ready {
                do {
                    if try receiveConsent(frame, scope: scope()) { return }
                    for update in try sessionEvents.map(frame, connection: connection, artifactsEnabled: state.capabilities.artifacts) {
                        observeSessionManagement(update)
                        emit(.update(connectionID: connection.id, update), weight: (try? FrameCodec.encode(frame).utf8.count) ?? 128)
                    }
                } catch { attemptFailed(runtimeFailure(error), epoch: epoch, attempt: attempt) }
            }
        }
    }

    func launchHealthHandshake() {
        guard handshakeTask == nil, let transport, let connection, let scope = try? scope(requireReady: false) else { return }
        let method = connection.backendKind == .hermes || connection.transportKind == .relay ? "health" : "connect"
        let params: JSONValue = connection.transportKind == .relay || connection.auth?.token == nil ? .object([:])
            : .object(["token": .string(connection.auth!.token!)])
        handshakeTask = Task { [weak self] in
            do {
                let health = try await transport.request(method: method, params: params,
                                                         timeout: connection.backendKind == .hermes ? .seconds(8) : .seconds(20), generation: scope.generation)
                await self?.healthHandshakeFinished(health, scope: scope)
            } catch { await self?.handshakeFailed(error, scope: scope) }
        }
    }

    func healthHandshakeFinished(_ health: JSONValue, scope: Scope) async {
        guard isCurrent(scope) else { return }
        do { try validateHealth(health); await markReady(health: health, scope: scope) }
        catch { attemptFailed(runtimeFailure(error), epoch: scope.epoch, attempt: scope.attempt, unavailable: true) }
    }

    func validateHealth(_ health: JSONValue) throws {
        guard health.object != nil, let connection else { throw RuntimeFailure(.invalidResponse) }
        if connection.backendKind == .hermes {
            let status = health["status"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
            guard health["hermesApiReachable"]?.boolValue != false, status.isEmpty || status == "ok" || status == "healthy" else {
                throw RuntimeFailure(.network, retryable: true)
            }
            if let backend = health["backend"]?.stringValue, backend != "hermes" { throw RuntimeFailure(.wrongBackend) }
            if let mode = health["mode"]?.stringValue, mode != "hermes" { throw RuntimeFailure(.wrongBackend) }
        } else if connection.backendKind != .openclaw {
            guard health["backend"]?.stringValue == connection.backendKind.rawValue else { throw RuntimeFailure(.wrongBackend) }
        } else if health["ok"]?.boolValue == false { throw RuntimeFailure(.network, retryable: true) }
    }

    func markReady(health: JSONValue, scope: Scope) async {
        guard isCurrent(scope), let transport else { return }
        guard await transport.confirmBackendReady(generation: scope.generation), isCurrent(scope) else { return }
        handshakeTask = nil
        backendHealth = health
        if connection?.backendKind != .openclaw { bridgeCapabilities = health["capabilities"]?.strings ?? [] }
        if connection?.backendKind == .hermes && !bridgeCapabilities.contains("hermes.run-approval.v1") { consents.evidence.remove("execution") }
        updateConsentCapabilities()
        reconnect.confirmedBackendReady(); previouslyReady = true; unavailableAttempts = 0; deviceRepairAttempted = false
        signedConnectIdentity = nil; deviceApproval = nil
        publishState(.ready)
        let pending = waiters; waiters.removeAll()
        for waiter in pending.values { waiter.resume() }
        startPeriodicProbe()
    }

    public func probe() async throws -> Bool {
        if let probeTask { return await probeTask.value }
        guard let scope = try? scope(), let transport else { return false }
        let task = Task { [weak self] in
            do {
                let health = try await transport.request(method: "health", timeout: .seconds(5), generation: scope.generation)
                return await self?.probeFinished(health, scope: scope) == true
            } catch { await self?.probeFailed(error, scope: scope); return false }
        }
        probeTask = task
        let result = await task.value
        if isCurrent(scope) { probeTask = nil }
        return result
    }

    func probeFinished(_ health: JSONValue, scope: Scope) async -> Bool {
        guard isCurrent(scope), state.phase == .ready else { return false }
        do {
            try validateHealth(health)
            await markReady(health: health, scope: scope)
            return isCurrent(scope) && state.phase == .ready
        } catch { probeFailed(error, scope: scope); return false }
    }

    func probeFailed(_ error: any Error, scope: Scope) {
        guard isCurrent(scope) else { return }
        attemptFailed(runtimeFailure(error), epoch: scope.epoch, attempt: scope.attempt, unavailable: true)
    }

    func requestProbe() {
        guard foreground, state.phase == .ready, probeTask == nil else { return }
        Task { [weak self] in _ = try? await self?.probe() }
    }

    func startPeriodicProbe() {
        periodicProbeTask?.cancel()
        guard foreground, let scope = try? scope() else { periodicProbeTask = nil; return }
        let clock = clock
        periodicProbeTask = Task { [weak self] in
            while !Task.isCancelled {
                do { try await clock.sleep(for: .seconds(20)) } catch { return }
                guard await self?.isCurrent(scope) == true else { return }
                _ = try? await self?.probe()
            }
        }
    }

    func handshakeFailed(_ error: any Error, scope: Scope) {
        guard isCurrent(scope) else { return }
        attemptFailed(runtimeFailure(error), epoch: scope.epoch, attempt: scope.attempt,
                      unavailable: (error as? RPCFailure)?.remoteError?["code"]?.stringValue == "BRIDGE_UNAVAILABLE")
    }

    func attemptFailed(_ failure: RuntimeFailure, epoch: UUID, attempt: UUID, unavailable: Bool = false) {
        guard self.epoch == epoch, self.attempt == attempt, !stopped else { return }
        if failure.code != .pairingRequired { deviceApproval = nil }
        let old = retireAttempt()
        emit(.failure(connectionID: connection?.id, failure))
        if !failure.retryable || !streamAvailable {
            stopped = true; publishState(.error)
            let pending = waiters; waiters.removeAll()
            for waiter in pending.values { waiter.resume(throwing: failure) }
        } else {
            let delay: Duration
            if unavailable && connection?.backendKind != .openclaw {
                if previouslyReady && unavailableAttempts < 4 { delay = .seconds(2 * (1 << min(unavailableAttempts, 2))) }
                else { delay = .seconds(min(120, 30 * (1 << min(max(0, unavailableAttempts - (previouslyReady ? 4 : 0)), 2)))) }
                unavailableAttempts += 1
            } else { delay = reconnect.nextDelay() }
            let milliseconds = delay.components.seconds * 1_000 + delay.components.attoseconds / 1_000_000_000_000_000
            publishState(previouslyReady ? .reconnecting : .offline, nextRetryAt: Int64(Date().timeIntervalSince1970 * 1_000) + milliseconds)
            if foreground {
                let clock = clock, captured = self.epoch
                retryTask = Task { [weak self] in
                    do { try await clock.sleep(for: delay) } catch { return }
                    await self?.retry(epoch: captured)
                }
            }
        }
        Task { await old?.disconnect() }
    }

    func retry(epoch: UUID) {
        guard self.epoch == epoch, !stopped, foreground else { return }
        retryTask = nil; startAttempt()
    }

    func scope(requireReady: Bool = true) throws -> Scope {
        guard !stopped, let generation, transport != nil, !requireReady || state.phase == .ready else {
            throw RuntimeFailure(.notConnected)
        }
        return Scope(epoch: epoch, attempt: attempt, authentication: authentication, generation: generation)
    }
    func isCurrent(_ scope: Scope) -> Bool {
        !stopped && scope.epoch == epoch && scope.attempt == attempt && scope.authentication == authentication && scope.generation == generation
    }
    func assertCurrent(_ scope: Scope) throws { if !isCurrent(scope) { throw RuntimeFailure(.superseded) } }

    func retireAttempt() -> RPCConnection? {
        attempt = UUID(); authentication = UUID(); signedConnectIdentity = nil
        modelControlsState.retire()
        resetConsents()
        clearArtifacts()
        sessionManagementState = SessionManagementState()
        historyRevisions = [:]
        readerTask?.cancel(); readerTask = nil; openTask?.cancel(); openTask = nil
        handshakeTask?.cancel(); handshakeTask = nil; retryTask?.cancel(); retryTask = nil
        periodicProbeTask?.cancel(); periodicProbeTask = nil; probeTask?.cancel(); probeTask = nil
        catalogTask?.cancel(); catalogTask = nil
        for task in historyTasks.values { task.cancel() }
        historyTasks = [:]; historyTaskIDs = [:]; historyPending = 0
        controlWaiter?.timeout.cancel(); controlWaiter?.continuation.resume(throwing: RuntimeFailure(.superseded)); controlWaiter = nil
        for task in controlDispatches.values { task.cancel() }; controlDispatches.removeAll()
        let old = transport; transport = nil; generation = nil; activeAuthSource = nil
        return old
    }
    func retire() -> RPCConnection? {
        epoch = UUID(); deviceApproval = nil
        let old = retireAttempt()
        let pending = waiters; waiters.removeAll()
        for waiter in pending.values { waiter.resume(throwing: RuntimeFailure(.superseded)) }
        return old
    }
    func cancelWaiter(_ id: UUID) { waiters.removeValue(forKey: id)?.resume(throwing: RuntimeFailure(.superseded)) }

    func publishState(_ phase: RuntimeConnectionState.Phase, nextRetryAt: Int64? = nil) {
        var capabilities = RuntimeCapabilities()
        if phase == .ready, let connection {
            capabilities.chat = true; capabilities.abort = true; capabilities.history = true; capabilities.models = true
            capabilities.sessions = connection.backendKind != .localModel && (connection.backendKind != .hermes || bridgeCapabilities.contains("hermes.multi-session.v2"))
            capabilities.sessionCreate = capabilities.sessions
            capabilities.projects = [.codex, .claudeCode].contains(connection.backendKind) && backendHealth["projects"]?.boolValue == true
            capabilities.modelPerSession = BackendProfile.profile(for: connection.backendKind).modelsPerSession
            capabilities.questions = [.codex, .claudeCode, .pi].contains(connection.backendKind) && consents.evidence.contains("questions")
            capabilities.executionApprovals = [.openclaw, .hermes, .codex, .claudeCode].contains(connection.backendKind) && consents.evidence.contains("execution")
            capabilities.pairingApprovals = connection.backendKind == .openclaw && consents.evidence.contains("pairing")
            configureAttachmentCapabilities(&capabilities)
            capabilities.sessionManagement = SessionManagementPolicy.capabilities(connection.backendKind, methods: supportedMethods,
                health: backendHealth, bridgeCapabilities: bridgeCapabilities,
                legacyGatewayEvidence: !sessionMethodsAdvertised && sessionManagementState.liveScope.map { isCurrent($0) } == true)
        }
        if !capabilities.artifacts { clearArtifacts() }
        state = RuntimeConnectionState(connectionID: connection?.id, phase: phase, capabilities: capabilities,
                                       backendKind: connection?.backendKind, bridgeVersion: backendHealth["bridgeVersion"]?.stringValue,
                                       nextRetryAt: nextRetryAt, deviceApproval: deviceApproval)
        emit(.state(state))
    }

    func emit(_ value: RuntimeEvent, weight: Int = 128) {
        guard streamAvailable else { return }
        eventWeights.append(weight)
        let result = eventContinuation.yield(value)
        if case .enqueued(let remaining) = result {
            let buffered = max(0, 64 - remaining)
            if eventWeights.count > buffered { eventWeights.removeFirst(eventWeights.count - buffered) }
            if eventWeights.reduce(0, +) <= 16 * 1_024 * 1_024 { return }
        }
        streamAvailable = false; stopped = true
        let old = retire()
        eventContinuation.finish(throwing: RuntimeFailure(.capacity))
        Task { await old?.disconnect() }
    }

    deinit {
        readerTask?.cancel(); openTask?.cancel(); handshakeTask?.cancel(); retryTask?.cancel()
        periodicProbeTask?.cancel(); probeTask?.cancel(); catalogTask?.cancel(); controlWaiter?.timeout.cancel()
        consentExpiryTask?.cancel()
        for task in controlDispatches.values { task.cancel() }
        controlWaiter?.continuation.resume(throwing: RuntimeFailure(.superseded))
        for waiter in waiters.values { waiter.resume(throwing: RuntimeFailure(.superseded)) }
        let transport = transport; Task { await transport?.disconnect() }
        eventContinuation.finish()
    }
}
