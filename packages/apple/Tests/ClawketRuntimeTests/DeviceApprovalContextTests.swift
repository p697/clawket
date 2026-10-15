import Foundation
import Testing
import CryptoKit
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

private func approvalError(deviceID: String? = nil, requestID: JSONValue? = .string("qa-request"),
                           reason: String = "not-paired", outer: String = "NOT_PAIRED", detail: String = "PAIRING_REQUIRED") -> RPCFailure {
    var fields: [String: JSONValue] = ["code": .string(detail), "reason": .string(reason)]
    fields["requestId"] = requestID
    if let deviceID { fields["deviceId"] = .string(deviceID) }
    return .init(.remoteRejection, delivery: .responseReceived, remoteError: .object([
        "code": .string(outer), "message": .string("peer-owned-text"), "details": .object(fields)]))
}
private func rejectApproval(_ request: JSONValue, socket: ScriptSocket, error: RPCFailure) async throws {
    try await socket.emit(.object(["type": .string("res"), "id": request["id"]!,
        "ok": .bool(false), "error": error.remoteError!]))
}
private actor ChangingApprovalIdentity: DeviceCredentialProvider {
    private var calls = 0
    var identityCalls: Int { calls }
    func identity() throws -> RuntimeDeviceIdentity {
        calls += 1
        let key = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: UInt8(calls), count: 32))
        let publicKey = key.publicKey.rawRepresentation
        return .init(deviceID: try PairingCryptography.deviceID(publicKey: publicKey), publicKey: publicKey,
                     secretKey: key.rawRepresentation + publicKey)
    }
    func readToken(scope: DeviceTokenScope) -> RuntimeDeviceToken? { nil }
    func writeToken(_ token: RuntimeDeviceToken, scope: DeviceTokenScope) {}
    func deleteToken(scope: DeviceTokenScope) {}
}

@Suite(.serialized)
struct DeviceApprovalContextTests {
    private func snapshot(_ identity: RuntimeDeviceIdentity) -> RuntimeCoordinator.SignedConnectIdentity {
        .init(scope: .init(epoch: UUID(), attempt: UUID(), authentication: UUID(), generation: .init()),
              connectionID: "a", identity: identity)
    }

    @Test func contextIsTheVerifiedPublicFingerprintAndContainsNoCredentialMaterial() async throws {
        let identity = try await Credentials().identity(), signed = snapshot(identity)
        let context = try #require(signed.approvalContext(for: approvalError(deviceID: identity.deviceID, reason: "scope-upgrade")))
        #expect(context.deviceID == (try PairingCryptography.deviceID(publicKey: identity.publicKey)))
        #expect(context.connectionID == "a"); #expect(context.requestID == "qa-request"); #expect(context.reason == .scopeUpgrade)
        let object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(context)) as? [String: Any])
        #expect(Set(object.keys) == ["id", "connectionID", "deviceID", "requestID", "reason"])
    }

    @Test func onlyExactStructuredPairingRejectionCanCreateAnIdentityReview() async throws {
        let signed = snapshot(try await Credentials().identity())
        for (outer, detail) in [("NOT_PAIRED", "DEVICE_IDENTITY_REQUIRED"), ("NOT_PAIRED", "AUTH_VERIFIED_USER_REQUIRED"),
            ("INVALID_REQUEST", "PAIRING_REQUIRED"), ("FORBIDDEN", "OPERATOR_ACCESS_DENIED"),
            ("NOT_PAIRED", "PAIRING_REQUIRED "), ("NOT_PAIRED", "AUTH_FUTURE_POLICY")] {
            #expect(signed.approvalContext(for: approvalError(outer: outer, detail: detail)) == nil)
        }
        #expect(signed.approvalContext(for: RPCFailure(.remoteRejection, remoteError: .object([
            "code": .string("NOT_PAIRED"), "message": .string("pairing required requestId: prose-only")]))) == nil)
        #expect(signed.approvalContext(for: RuntimeFailure(.pairingRequired)) == nil)
    }

    @Test func peerIdentityNeverReplacesTheActualSignedKeyOrRepairsMalformedIdentity() async throws {
        let identity = try await Credentials().identity(), signed = snapshot(identity)
        #expect(signed.approvalContext(for: approvalError(deviceID: String(repeating: "f", count: 64))) == nil)
        let corrupt = RuntimeDeviceIdentity(deviceID: String(repeating: "0", count: 64), publicKey: identity.publicKey, secretKey: identity.secretKey)
        #expect(snapshot(corrupt).approvalContext(for: approvalError()) == nil)
        let short = RuntimeDeviceIdentity(deviceID: identity.deviceID, publicKey: Data([1]), secretKey: identity.secretKey)
        #expect(snapshot(short).approvalContext(for: approvalError()) == nil)
    }

    @Test func requestMetadataIsBoundedExactAndNeverParsedFromProse() async throws {
        let signed = snapshot(try await Credentials().identity())
        for value in ["", " leading", "tail\n", "réquest", "../request", String(repeating: "a", count: 129)] {
            let context = try #require(signed.approvalContext(for: approvalError(requestID: .string(value), reason: "future-reason")))
            #expect(context.requestID == nil); #expect(context.reason == .unknown)
        }
        #expect(signed.approvalContext(for: approvalError(requestID: .number(1)))?.requestID == nil)
        #expect(signed.approvalContext(for: approvalError(requestID: .string("A_1.-:request")))?.requestID == "A_1.-:request")
    }

    @Test func failedConnectPublishesItsActualSignedIdentityWithoutReloadOrSelfApproval() async throws {
        let credentials = ChangingApprovalIdentity()
        let socket = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await rejectApproval(request, socket: socket, error: approvalError(deviceID: request["params"]?["device"]?["id"]?.stringValue))
        }
        let factory = ScriptFactory(socket), runtime = try RuntimeCoordinator(credentials: credentials, socketFactory: factory)
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        do { try await runtime.activate(connection(.openclaw)); Issue.record("Unapproved connect became ready") }
        catch let failure as RuntimeFailure { #expect(failure.code == .pairingRequired) }
        let state = await runtime.state, request = try #require(await socket.requests("connect").first)
        let context = try #require(state.deviceApproval)
        #expect(state.phase == .error); #expect(context.deviceID == request["params"]?["device"]?["id"]?.stringValue)
        #expect(await credentials.identityCalls == 1); #expect(factory.count == 1)
        #expect(await socket.methods() == ["connect"])
        await runtime.disconnect(); #expect(await runtime.state.deviceApproval == nil)
    }

    @Test func explicitReconnectMustCompleteHandshakeBeforeClearingApprovalAsConnected() async throws {
        let first = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await rejectApproval(request, socket: socket, error: approvalError())
        }
        let second = ScriptSocket(initial: [challengeFrame]) { request, socket in try await socket.reply(request, payload: hello) }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(first, second))
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        do { try await runtime.activate(connection(.openclaw)) } catch {}
        #expect(await runtime.state.deviceApproval != nil)
        try await runtime.activate(connection(.openclaw))
        #expect(await runtime.state.phase == .ready); #expect(await runtime.state.deviceApproval == nil)
        await runtime.disconnect()
    }

    @Test func aDifferentAuthenticationFailureCannotKeepTheOldApprovalReview() async throws {
        let first = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await rejectApproval(request, socket: socket, error: approvalError(reason: "scope-upgrade"))
        }
        let second = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await rejectApproval(request, socket: socket, error: approvalError(outer: "INVALID_REQUEST", detail: "AUTH_TOKEN_MISMATCH"))
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(first, second))
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        do { try await runtime.activate(connection(.openclaw)) } catch {}
        #expect(await runtime.state.deviceApproval?.reason == .scopeUpgrade)
        do { try await runtime.activate(connection(.openclaw)); Issue.record("Rejected authentication became ready") }
        catch let failure as RuntimeFailure { #expect(failure.code == .authenticationRequired) }
        #expect(await runtime.state.deviceApproval == nil); await runtime.disconnect()
    }

    @Test func delayedSignedFailureAfterSwitchingAwayAndBackCannotPublishAReview() async throws {
        let first = ScriptSocket(initial: [challengeFrame])
        let second = ScriptSocket(initial: [challengeFrame]) { request, socket in try await socket.reply(request, payload: hello) }
        let third = ScriptSocket(initial: [challengeFrame]) { request, socket in try await socket.reply(request, payload: hello) }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(first, second, third))
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        let old = Task { try await runtime.activate(connection(.openclaw)) }
        try await eventually { await first.requests("connect").count == 1 }
        let capturedScope = try await runtime.scope(requireReady: false)
        try await runtime.activate(connection(.openclaw, id: "other"))
        do { try await old.value; Issue.record("Old activation survived replacement") } catch {}
        try await runtime.activate(connection(.openclaw))
        await runtime.authenticationFailed(approvalError(), scope: capturedScope)
        #expect(await runtime.state.phase == .ready); #expect(await runtime.state.deviceApproval == nil)
        await runtime.disconnect()
    }
}
