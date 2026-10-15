import Foundation
import CryptoKit
import ClawketPairing
import ClawketTransport

extension RuntimeCoordinator {
    enum AuthSource { case deviceToken, bootstrap, legacyToken, password, none }
    struct ConnectPlan {
        let auth: JSONValue
        let signatureToken: String?
        let source: AuthSource
        let role: String
        let scopes: [String]
        let bootstrapStrategy: PairingBootstrap.Strategy?
    }
    static let defaultScopes = ["operator.admin", "operator.approvals", "operator.pairing", "operator.questions",
                                "operator.read", "operator.talk.secrets", "operator.write"]

    func challenge(_ payload: JSONValue) async {
        guard let nonce = payload["nonce"]?.nonemptyString, nonce.utf8.count <= 1_024,
              let signedAt = payload["ts"]?.safeInteger else {
            attemptFailed(RuntimeFailure(.invalidResponse), epoch: epoch, attempt: attempt); return
        }
        guard nonce != lastNonce, handshakeTask == nil, let transport else { return }
        let capturedEpoch = epoch, capturedAttempt = attempt
        authentication = UUID(); lastNonce = nonce; sessionEvents = SessionEvents()
        if state.phase == .ready {
            catalogTask?.cancel(); catalogTask = nil; probeTask?.cancel(); probeTask = nil
            for task in historyTasks.values { task.cancel() }
            historyTasks = [:]; historyTaskIDs = [:]; historyPending = 0
            periodicProbeTask?.cancel(); periodicProbeTask = nil
            guard let generation, await transport.beginBackendHandshake(generation: generation),
                  epoch == capturedEpoch, attempt == capturedAttempt else { return }
        }
        guard let scope = try? scope(requireReady: false) else { return }
        publishState(.handshaking)
        handshakeTask = Task { [weak self] in
            do { try await self?.authenticate(nonce: nonce, signedAt: signedAt, scope: scope) }
            catch { await self?.authenticationFailed(error, scope: scope) }
        }
    }

    func authenticate(nonce: String, signedAt: Int64, scope: Scope) async throws {
        try assertCurrent(scope)
        guard let identity, let transport, let connection else { throw RuntimeFailure(.credentialStorage) }
        let signingKey: Curve25519.Signing.PrivateKey
        do {
            signingKey = try PairingCryptography.importSigningKey(tweetNaClSecret: identity.secretKey, publicKey: identity.publicKey)
            guard try PairingCryptography.deviceID(publicKey: identity.publicKey) == identity.deviceID else { throw RuntimeFailure(.credentialStorage) }
        } catch { throw RuntimeFailure(.credentialStorage) }
        let publicKey = PairingCryptography.encodeBase64URL(identity.publicKey)
        let plan = try await connectPlan(identity: identity, publicKey: publicKey, scope: scope)
        try assertCurrent(scope); activeAuthSource = plan.source
        let mode = plan.role == "node" ? "node" : "ui"
        let preimage = PairingCryptography.deviceAuthPayload(deviceID: identity.deviceID, clientID: "openclaw-ios", clientMode: mode,
                                                            role: plan.role, scopes: plan.scopes, signedAtMs: signedAt,
                                                            token: plan.signatureToken, nonce: nonce, platform: "ios", deviceFamily: client.deviceFamily)
        let signature = try signingKey.signature(for: Data(preimage.utf8))
        let params: JSONValue = .object([
            "minProtocol": .number(3), "maxProtocol": .number(4),
            "client": .object(["id": .string("openclaw-ios"), "displayName": .string("Clawket"), "version": .string(client.version),
                               "platform": .string("ios"), "mode": .string(mode), "deviceFamily": .string(client.deviceFamily)]),
            "caps": .array((plan.role == "node" ? [] : ["tool-events"]).map(JSONValue.string)
                + (connection.transportKind == .relay ? [.string("bridge.capabilities.v2")] : [])),
            "commands": .array([]), "role": .string(plan.role), "scopes": .array(plan.scopes.map(JSONValue.string)),
            "device": .object(["id": .string(identity.deviceID), "publicKey": .string(publicKey),
                               "signature": .string(PairingCryptography.encodeBase64URL(signature)),
                               "signedAt": .number(Double(signedAt)), "nonce": .string(nonce)]), "auth": plan.auth,
        ])
        let response = try await transport.requestEnvelope(method: "connect", params: params, timeout: .seconds(8), generation: scope.generation)
        try assertCurrent(scope)
        guard response.payload.object != nil, response.payload["server"]?.object != nil else { throw RuntimeFailure(.invalidResponse) }
        let hello = response.payload["auth"]
        let role = hello?["role"]?.nonemptyString ?? plan.role
        if let token = hello?["deviceToken"]?.nonemptyString {
            try await persistToken(token, role: role, scopes: hello?["scopes"]?.strings ?? [], identity: identity, scope: scope)
        }
        if plan.source == .bootstrap && plan.bootstrapStrategy == .mobileSetup {
            var hasOperator = role == "operator" && hello?["deviceToken"]?.nonemptyString != nil
            for value in hello?["deviceTokens"]?.array ?? [] {
                guard let token = value["deviceToken"]?.nonemptyString, let role = value["role"]?.nonemptyString else { continue }
                try await persistToken(token, role: role, scopes: value["scopes"]?.strings ?? [], identity: identity, scope: scope)
                if role == "operator" { hasOperator = true }
            }
            guard hasOperator else { throw RuntimeFailure(.authenticationRequired) }
            recycle(scope: scope)
            return
        }
        try assertCurrent(scope)
        supportedMethods = Set(response.payload["features"]?["methods"]?.strings ?? [])
        if connection.transportKind == .relay {
            let capabilities = response.metadata?["capabilities"]?.strings ?? []
            bridgeCapabilities = capabilities.contains("bridge.capabilities.v2") ? capabilities : []
        }
        if let ms = response.payload["policy"]?["tickIntervalMs"]?.safeInteger, ms > 0, ms <= 300_000 {
            _ = await transport.configureHeartbeat(try .init(interval: .milliseconds(ms)), generation: scope.generation)
            try assertCurrent(scope)
        }
        let metadata = response.metadata?.object ?? [:]
        let health: JSONValue = .object(bridgeCapabilities.contains("bridge.capabilities.v2")
            ? ["bridgeVersion": metadata["bridgeVersion"] ?? .null] : [:])
        activeAuthSource = nil
        await markReady(health: health, scope: scope)
    }

    func connectPlan(identity: RuntimeDeviceIdentity, publicKey: String, scope: Scope) async throws -> ConnectPlan {
        guard let connection else { throw RuntimeFailure(.superseded) }
        let tokenScope = tokenScope(identity: identity, role: "operator")
        let stored: RuntimeDeviceToken?
        do { stored = try await credentials.readToken(scope: tokenScope) }
        catch { throw RuntimeFailure(.credentialStorage) }
        try assertCurrent(scope)
        if let stored, !stored.token.isEmpty, stored.role == "operator" {
            return ConnectPlan(auth: .object(["deviceToken": .string(stored.token)]), signatureToken: stored.token,
                               source: .deviceToken, role: "operator", scopes: stored.scopes.isEmpty ? Self.defaultScopes : stored.scopes,
                               bootstrapStrategy: nil)
        }
        var bootstrap: PairingBootstrap?
        let supportsBootstrap = connection.relay?.supportsBootstrap ?? ((connection.relay?.protocolVersion ?? 0) >= 2)
        if connection.transportKind == .relay, supportsBootstrap, !bootstrapDisabled {
            do {
                let control = try await requestBootstrap(publicKey: publicKey, identity: identity, scope: scope)
                try assertCurrent(scope)
                let token = control.payload["bootstrapToken"]?.nonemptyString ?? control.payload["token"]?.nonemptyString
                    ?? control.envelope["bootstrapToken"]?.nonemptyString ?? control.envelope["token"]?.nonemptyString
                guard let token else { throw RuntimeFailure(.invalidResponse) }
                let strategy = control.payload["strategy"]?.stringValue ?? control.envelope["strategy"]?.stringValue
                bootstrap = PairingBootstrap(token: token, strategy: strategy == "mobile-setup" ? .mobileSetup : .legacyBound)
            } catch {
                try assertCurrent(scope)
                if connection.auth?.token?.isEmpty == false || connection.auth?.password?.isEmpty == false { bootstrapDisabled = true }
                else { throw error }
            }
        } else if connection.transportKind != .relay, let configured = connection.bootstrap,
                  configured.expiresAtMs.map({ $0 > Int64(Date().timeIntervalSince1970 * 1_000) }) ?? true {
            bootstrap = configured
        }
        try assertCurrent(scope)
        if let bootstrap {
            let setup = bootstrap.strategy == .mobileSetup
            return ConnectPlan(auth: .object(["bootstrapToken": .string(bootstrap.token)]), signatureToken: bootstrap.token,
                               source: .bootstrap, role: setup ? "node" : "operator", scopes: setup ? [] : Self.defaultScopes,
                               bootstrapStrategy: bootstrap.strategy)
        }
        if let token = connection.auth?.token, !token.isEmpty {
            return ConnectPlan(auth: .object(["token": .string(token)]), signatureToken: token, source: .legacyToken,
                               role: "operator", scopes: Self.defaultScopes, bootstrapStrategy: nil)
        }
        if let password = connection.auth?.password, !password.isEmpty {
            return ConnectPlan(auth: .object(["password": .string(password)]), signatureToken: nil, source: .password,
                               role: "operator", scopes: Self.defaultScopes, bootstrapStrategy: nil)
        }
        return ConnectPlan(auth: .object([:]), signatureToken: nil, source: .none, role: "operator",
                           scopes: Self.defaultScopes, bootstrapStrategy: nil)
    }

    func tokenScope(identity: RuntimeDeviceIdentity, role: String) -> DeviceTokenScope {
        DeviceTokenScope(connectionID: connection!.id, deviceID: identity.deviceID, role: role,
                         registryURL: connection!.relay?.serverURL, relayID: connection!.relay?.gatewayID, gatewayURL: connection!.url)
    }

    func persistToken(_ value: String, role: String, scopes: [String], identity: RuntimeDeviceIdentity, scope: Scope) async throws {
        try assertCurrent(scope)
        guard ["operator", "node"].contains(role), value.utf8.count <= 16_384, scopes.count <= 128 else { throw RuntimeFailure(.invalidResponse) }
        let key = tokenScope(identity: identity, role: role)
        do { try await credentials.writeToken(.init(token: value, role: role, scopes: scopes), scope: key) }
        catch { throw RuntimeFailure(.credentialStorage) }
        try assertCurrent(scope)
    }

    func authenticationFailed(_ error: any Error, scope: Scope) async {
        guard isCurrent(scope) else { return }
        let remoteCode = (error as? RPCFailure)?.remoteError?["code"]?.stringValue?.uppercased()
        if ["AUTH_TOKEN_MISMATCH", "AUTH_SCOPE_MISMATCH"].contains(remoteCode ?? ""), activeAuthSource == .deviceToken,
           !deviceRepairAttempted, let identity {
            deviceRepairAttempted = true
            let key = tokenScope(identity: identity, role: "operator")
            do { try await credentials.deleteToken(scope: key); try assertCurrent(scope); recycle(scope: scope) }
            catch { if isCurrent(scope) { attemptFailed(RuntimeFailure(.credentialStorage), epoch: scope.epoch, attempt: scope.attempt) } }
            return
        }
        handshakeFailed(error, scope: scope)
    }

    func recycle(scope: Scope) {
        guard isCurrent(scope) else { return }
        let old = retireAttempt()
        let captured = epoch
        Task { [weak self] in
            await old?.disconnect()
            await self?.retry(epoch: captured)
        }
    }

    func requestBootstrap(publicKey: String, identity: RuntimeDeviceIdentity, scope: Scope) async throws -> RelayControl {
        guard controlWaiter == nil, let transport else { throw RuntimeFailure(.capacity) }
        let id = UUID().uuidString.lowercased(), clock = clock, deadline = clock.now() + .seconds(12)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                let timer = Task { [weak self] in
                    do { try await clock.sleep(for: max(.zero, deadline - clock.now())) } catch { return }
                    await self?.cancelControl(id, failure: RuntimeFailure(.timeout, retryable: true))
                }
                controlWaiter = ControlWaiter(id: id, scope: scope, continuation: continuation, timeout: timer, deadline: deadline)
                controlDispatches[id] = Task { [weak self] in
                    do {
                        try await transport.sendRelayControl(event: "bootstrap.request", requestID: id,
                            payload: .object(["deviceId": .string(identity.deviceID), "publicKey": .string(publicKey),
                                              "role": .string("operator"), "scopes": .array(Self.defaultScopes.map(JSONValue.string)),
                                              "capabilities": .array([.string("openclaw.bootstrap.mobile-setup.v1")])]), generation: scope.generation)
                    } catch { await self?.cancelControl(id, failure: runtimeFailure(error)) }
                    await self?.controlSendFinished(id)
                }
            }
        } onCancel: { Task { await self.cancelControl(id, failure: RuntimeFailure(.superseded)) } }
    }

    func receiveControl(_ control: RelayControl) {
        if control.event == "relay.ready", let generation, let transport,
           let ms = (control.payload["tickIntervalMs"] ?? control.envelope["tickIntervalMs"])?.safeInteger, ms > 0, ms <= 300_000 {
            Task { _ = try? await transport.configureHeartbeat(.init(interval: .milliseconds(ms)), generation: generation) }
        }
        guard let waiter = controlWaiter, isCurrent(waiter.scope),
              control.requestID == nil || control.requestID == waiter.id,
              ["bootstrap.issued", "bootstrap.error"].contains(control.event) else { return }
        guard clock.now() < waiter.deadline else { cancelControl(waiter.id, failure: RuntimeFailure(.timeout, retryable: true)); return }
        controlWaiter = nil; waiter.timeout.cancel()
        if control.event == "bootstrap.issued" { waiter.continuation.resume(returning: control) }
        else { waiter.continuation.resume(throwing: RuntimeFailure(.authenticationRequired)) }
    }
    func cancelControl(_ id: String, failure: RuntimeFailure) {
        guard controlWaiter?.id == id else { return }
        let waiter = controlWaiter; controlWaiter = nil; waiter?.timeout.cancel(); waiter?.continuation.resume(throwing: failure)
        controlDispatches.removeValue(forKey: id)?.cancel()
    }
    func controlSendFinished(_ id: String) { controlDispatches.removeValue(forKey: id) }
}
