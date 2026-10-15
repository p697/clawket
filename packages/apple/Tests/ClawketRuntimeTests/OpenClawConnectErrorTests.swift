import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

// Sanitized envelope structure from installed OpenClaw 2026.10.2:
// message-handler -> errorShape(INVALID_REQUEST, ..., {details:{code,authReason,...}}).
// Pairing/policy use NOT_PAIRED; operator-access policy uses FORBIDDEN.
private func connectError(_ outer: String = "INVALID_REQUEST", detail: JSONValue? = nil,
                          message: String = "peer-owned-message") -> JSONValue {
    var error: [String: JSONValue] = ["code": .string(outer), "message": .string(message)]
    if let detail {
        error["details"] = .object(["code": detail, "authReason": .string("token_mismatch"),
            "canRetryWithDeviceToken": .bool(true), "recommendedNextStep": .string("retry_with_device_token")])
    }
    return .object(error)
}
private func rejectConnect(_ request: JSONValue, socket: ScriptSocket, error: JSONValue) async throws {
    try await socket.emit(.object(["type": .string("res"), "id": request["id"]!, "ok": .bool(false), "error": error]))
}
private func rpcError(_ error: JSONValue) -> RPCFailure { .init(.remoteRejection, delivery: .responseReceived, remoteError: error) }

// Models another writer restoring the same scoped credential during an unproven recovery.
// A successful deletion cannot authorize a second automatic repair of that activation.
private actor ReappearingTokenCredentials: DeviceCredentialProvider {
    let base: Credentials
    let key: DeviceTokenScope
    init(base: Credentials, key: DeviceTokenScope) { self.base = base; self.key = key }
    func identity() async throws -> RuntimeDeviceIdentity { try await base.identity() }
    func readToken(scope: DeviceTokenScope) async throws -> RuntimeDeviceToken? {
        scope == key ? .init(token: "reappearing-fixture", role: "operator", scopes: ["operator.read"]) : nil
    }
    func writeToken(_ token: RuntimeDeviceToken, scope: DeviceTokenScope) async throws { try await base.writeToken(token, scope: scope) }
    func deleteToken(scope: DeviceTokenScope) async throws { try await base.deleteToken(scope: scope) }
}

@Suite(.serialized)
struct OpenClawConnectErrorTests {
    @Test func actualNestedAuthProofAndPairingShapesKeepDistinctFixedCategories() throws {
        let cases: [(String, String, RuntimeFailure.Code)] = [
            ("INVALID_REQUEST", "AUTH_TOKEN_MISMATCH", .authenticationRequired),
            ("INVALID_REQUEST", "AUTH_DEVICE_TOKEN_MISMATCH", .authenticationRequired),
            ("INVALID_REQUEST", "AUTH_SCOPE_MISMATCH", .authenticationRequired),
            ("INVALID_REQUEST", "AUTH_PASSWORD_MISMATCH", .authenticationRequired),
            ("INVALID_REQUEST", "AUTH_BOOTSTRAP_TOKEN_INVALID", .authenticationRequired),
            ("INVALID_REQUEST", "AUTH_RATE_LIMITED", .authenticationRequired),
            ("INVALID_REQUEST", "DEVICE_AUTH_NONCE_MISMATCH", .authenticationRequired),
            ("INVALID_REQUEST", "DEVICE_AUTH_SIGNATURE_INVALID", .authenticationRequired),
            ("NOT_PAIRED", "PAIRING_REQUIRED", .pairingRequired),
            ("NOT_PAIRED", "AUTH_VERIFIED_USER_REQUIRED", .authenticationRequired),
            ("NOT_PAIRED", "DEVICE_IDENTITY_REQUIRED", .authenticationRequired),
            ("FORBIDDEN", "OPERATOR_ACCESS_DENIED", .authenticationRequired),
        ]
        for (outer, detail, expected) in cases {
            let rejection = OpenClawConnectRejection(rpcError(connectError(outer, detail: .string(detail))))
            #expect(rejection.hasDetailCode); #expect(rejection.failure?.code == expected)
            #expect(rejection.failure?.delivery == .responseReceived); #expect(rejection.failure?.retryable == false)
            #expect(rejection.failure?.description == "RuntimeFailure(\(expected.rawValue))")
        }
        // Generic RPCs/other backend handshakes do not acquire OpenClaw-connect classification.
        #expect(runtimeFailure(rpcError(connectError(detail: .string("AUTH_TOKEN_MISMATCH")))).code == .invalidResponse)
    }

    @Test func unknownMalformedAndWrongOuterDetailsNeverGrantRepairOrGuessAnAuthPrefix() {
        for detail in [JSONValue.string("AUTH_FUTURE_POLICY"), .string("AUTH_DEVICE_TOKEN_MISMATCH "),
                       .string(String(repeating: "A", count: 129)), .number(17), .null] {
            let rejection = OpenClawConnectRejection(rpcError(connectError(detail: detail)))
            #expect(rejection.hasDetailCode); #expect(!rejection.permitsScopedRepair)
            #expect(rejection.failure?.code == .invalidResponse)
        }
        for outer in ["BAD_REQUEST", "UNAVAILABLE", "UNRELATED"] {
            let rejection = OpenClawConnectRejection(rpcError(connectError(outer, detail: .string("AUTH_DEVICE_TOKEN_MISMATCH"))))
            #expect(!rejection.permitsScopedRepair)
            #expect(rejection.failure?.code != .authenticationRequired)
        }
        let policy = OpenClawConnectRejection(rpcError(connectError("NOT_PAIRED", detail: .string("AUTH_FUTURE_POLICY"))))
        #expect(policy.failure?.code == .invalidResponse)
        #expect(!OpenClawConnectRejection(RPCFailure(.timeout)).permitsScopedRepair)
    }

    @Test(arguments: [("AUTH_DEVICE_TOKEN_MISMATCH", false), ("AUTH_SCOPE_MISMATCH", true)])
    func nestedDeviceFailureRepairsOnlyCapturedOperatorScope(_ input: (String, Bool)) async throws {
        let base = try Credentials(), value = connection(.openclaw, relay: input.1), identity = try await base.identity()
        let key = DeviceTokenScope(connectionID: value.id, deviceID: identity.deviceID,
            registryURL: value.relay?.serverURL, relayID: value.relay?.gatewayID, gatewayURL: value.url)
        let node = DeviceTokenScope(connectionID: value.id, deviceID: identity.deviceID, role: "node",
            registryURL: value.relay?.serverURL, relayID: value.relay?.gatewayID, gatewayURL: value.url)
        let other = DeviceTokenScope(connectionID: "other-connection", deviceID: identity.deviceID, gatewayURL: value.url)
        for scope in [key, node, other] { try await base.writeToken(.init(token: "scoped-fixture", role: scope.role, scopes: ["operator.read"]), scope: scope) }
        let first = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await rejectConnect(request, socket: socket, error: connectError(detail: .string(input.0)))
        }
        let second = ScriptSocket(initial: [challengeFrame]) { request, socket in try await socket.reply(request, payload: hello) }
        let factory = ScriptFactory(first, second), runtime = try RuntimeCoordinator(credentials: base, socketFactory: factory)
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        try await runtime.activate(value)
        #expect(await base.deletes == [key]); #expect(try await base.readToken(scope: node) != nil)
        #expect(try await base.readToken(scope: other) != nil)
        #expect(await second.requests("connect")[0]["params"]?["auth"]?["token"]?.stringValue == "fixture-token")
        #expect(value.auth?.token == "fixture-token"); #expect(factory.count == 2)
        await runtime.disconnect()
    }

    @Test(arguments: ["AUTH_TOKEN_MISMATCH", "AUTH_DEVICE_TOKEN_MISMATCH", "AUTH_SCOPE_MISMATCH"])
    func legacySharedCredentialNeverGetsDeletedOrRetried(_ detail: String) async throws {
        let socket = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await rejectConnect(request, socket: socket, error: connectError(detail: .string(detail)))
        }
        let base = try Credentials(), factory = ScriptFactory(socket), value = connection(.openclaw)
        let runtime = try RuntimeCoordinator(credentials: base, socketFactory: factory)
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        do { try await runtime.activate(value); Issue.record("Rejected shared credential became ready") }
        catch let failure as RuntimeFailure { #expect(failure.code == .authenticationRequired); #expect(!failure.retryable) }
        #expect(factory.count == 1); #expect(await base.deletes.isEmpty); #expect(value.auth?.token == "fixture-token")
        #expect(await socket.requests("connect")[0]["params"]?["auth"]?["token"]?.stringValue == "fixture-token")
        await runtime.disconnect()
    }

    @Test(arguments: [
        ("INVALID_REQUEST", "AUTH_TOKEN_MISMATCH"), ("INVALID_REQUEST", "DEVICE_AUTH_SIGNATURE_INVALID"),
        ("INVALID_REQUEST", "DEVICE_AUTH_NONCE_MISMATCH"), ("INVALID_REQUEST", "AUTH_FUTURE_POLICY"),
        ("NOT_PAIRED", "AUTH_VERIFIED_USER_REQUIRED"), ("NOT_PAIRED", "PAIRING_REQUIRED"),
    ])
    func savedDeviceCredentialIsPreservedForSharedTokenProofAndPairingFailures(_ input: (String, String)) async throws {
        let base = try Credentials(), value = connection(.openclaw), identity = try await base.identity()
        let key = DeviceTokenScope(connectionID: value.id, deviceID: identity.deviceID, gatewayURL: value.url)
        try await base.writeToken(.init(token: "saved-fixture", role: "operator", scopes: []), scope: key)
        let socket = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await rejectConnect(request, socket: socket, error: connectError(input.0, detail: .string(input.1)))
        }
        let factory = ScriptFactory(socket), runtime = try RuntimeCoordinator(credentials: base, socketFactory: factory)
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        do { try await runtime.activate(value); Issue.record("Rejected saved identity became ready") }
        catch let failure as RuntimeFailure {
            let expected: RuntimeFailure.Code = input.1 == "PAIRING_REQUIRED" ? .pairingRequired
                : input.1 == "AUTH_FUTURE_POLICY" ? .invalidResponse : .authenticationRequired
            #expect(failure.code == expected); #expect(!failure.retryable)
        }
        #expect(factory.count == 1); #expect(await base.deletes.isEmpty)
        #expect(try await base.readToken(scope: key)?.token == "saved-fixture")
        await runtime.disconnect()
    }

    @Test(arguments: [JSONValue.string("AUTH_BOOTSTRAP_TOKEN_INVALID"), .string("DEVICE_AUTH_SIGNATURE_INVALID"),
                       .string("AUTH_FUTURE_POLICY"), .number(17), .null])
    func structuredDetailsVetoBootstrapSchemaProseFallback(_ detail: JSONValue) async throws {
        let socket = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await rejectConnect(request, socket: socket, error: connectError(detail: detail,
                message: "invalid connect params: unexpected bootstrapToken"))
        }
        let base = try Credentials(), factory = ScriptFactory(socket)
        let runtime = try RuntimeCoordinator(credentials: base, socketFactory: factory)
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        do { try await runtime.activate(connection(.openclaw, bootstrap: .init(token: "bootstrap-fixture", strategy: .legacyBound))); Issue.record("Structured rejection downgraded bootstrap") }
        catch let failure as RuntimeFailure { #expect(!failure.retryable) }
        #expect(factory.count == 1); #expect(await base.deletes.isEmpty); #expect(await runtime.bootstrapDisabled == false)
        #expect(await socket.requests("connect")[0]["params"]?["auth"]?["bootstrapToken"]?.stringValue == "bootstrap-fixture")
        await runtime.disconnect()
    }

    @Test func reappearingDeviceCredentialCannotTriggerASecondRepairBeforeReadiness() async throws {
        let base = try Credentials(), value = connection(.openclaw), identity = try await base.identity()
        let key = DeviceTokenScope(connectionID: value.id, deviceID: identity.deviceID, gatewayURL: value.url)
        let reject: ScriptSocket.Handler = { request, socket in
            try await rejectConnect(request, socket: socket, error: connectError(detail: .string("AUTH_DEVICE_TOKEN_MISMATCH")))
        }
        let first = ScriptSocket(initial: [challengeFrame], handler: reject), second = ScriptSocket(initial: [challengeFrame], handler: reject)
        let factory = ScriptFactory(first, second)
        let runtime = try RuntimeCoordinator(credentials: ReappearingTokenCredentials(base: base, key: key), socketFactory: factory)
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        do { try await runtime.activate(value); Issue.record("Repeated stale identity became ready") }
        catch let failure as RuntimeFailure { #expect(failure.code == .authenticationRequired) }
        #expect(factory.count == 2); #expect(await base.deletes == [key])
        #expect(await second.requests("connect")[0]["params"]?["auth"]?["deviceToken"]?.stringValue == "reappearing-fixture")
        await runtime.disconnect()
    }

    @Test func nestedRepairDeletionFailureStopsWithoutOpeningAnotherSocket() async throws {
        let base = try Credentials(), value = connection(.openclaw), identity = try await base.identity()
        let key = DeviceTokenScope(connectionID: value.id, deviceID: identity.deviceID, gatewayURL: value.url)
        try await base.writeToken(.init(token: "saved-fixture", role: "operator", scopes: []), scope: key)
        await base.failDeletion()
        let socket = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await rejectConnect(request, socket: socket, error: connectError(detail: .string("AUTH_DEVICE_TOKEN_MISMATCH")))
        }
        let factory = ScriptFactory(socket), runtime = try RuntimeCoordinator(credentials: base, socketFactory: factory)
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        do { try await runtime.activate(value); Issue.record("Failed cleanup became ready") }
        catch let failure as RuntimeFailure { #expect(failure.code == .credentialStorage) }
        #expect(factory.count == 1); #expect(try await base.readToken(scope: key)?.token == "saved-fixture")
        await runtime.disconnect()
    }
}
