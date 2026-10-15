import Foundation
import CryptoKit
import Testing
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct CoordinatorTests {
    @Test(arguments: [BackendKind.hermes, .codex, .claudeCode, .pi, .localModel])
    func healthHandshakeRequiresBackendEvidence(_ backend: BackendKind) async throws {
        let socket = ScriptSocket { request, socket in try await socket.reply(request, payload: health(backend)) }
        let factory = ScriptFactory(socket), credentials = try Credentials()
        let runtime = try RuntimeCoordinator(credentials: credentials, socketFactory: factory)
        let recorder = Events(), reader = read(runtime, into: recorder)
        try await runtime.activate(connection(backend, relay: true))
        #expect(await runtime.state.phase == .ready)
        #expect(await socket.methods() == ["health"])
        #expect(await runtime.state.capabilities.modelPerSession == ![.hermes, .localModel].contains(backend))
        #expect(await runtime.state.capabilities.chat)
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: [BackendKind.codex, .claudeCode, .pi, .localModel])
    func directSDKAuthenticatesWithConnectAndRejectsWrongBackend(_ backend: BackendKind) async throws {
        let socket = ScriptSocket { request, socket in try await socket.reply(request, payload: health(.hermes)) }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        do { try await runtime.activate(connection(backend)); Issue.record("Wrong backend was accepted") }
        catch let failure as RuntimeFailure { #expect(failure.code == .wrongBackend) }
        #expect(await socket.methods() == ["connect"])
        #expect(await socket.sent.first?["params"]?["token"]?.stringValue == "fixture-token")
        #expect(await runtime.state.phase == .error)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func openClawUsesExactDevicePreimageAndOuterBridgeMetadata() async throws {
        let credentials = try Credentials(), identity = try await credentials.identity()
        let socket = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await socket.reply(request, payload: hello,
                                   metadata: .object(["capabilities": .array([.string("bridge.capabilities.v2")]), "bridgeVersion": .string("fixture-bridge")]))
        }
        let runtime = try RuntimeCoordinator(credentials: credentials, socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.openclaw, relay: true))
        let request = await socket.requests("connect")[0], params = request["params"]!
        #expect(params["minProtocol"]?.numberValue == 3); #expect(params["maxProtocol"]?.numberValue == 4)
        #expect(params["meta"] == nil); #expect(params["caps"]?.array?.contains(.string("bridge.capabilities.v2")) == true)
        let payload = PairingCryptography.deviceAuthPayload(deviceID: identity.deviceID, clientID: "openclaw-ios", clientMode: "ui",
            role: "operator", scopes: params["scopes"]!.array!.compactMap(\.stringValue), signedAtMs: 1_778_198_400_300,
            token: "fixture-token", nonce: "fixture-nonce", platform: "ios", deviceFamily: "iphone")
        let signature = try PairingCryptography.decodeBase64URL(params["device"]!["signature"]!.stringValue!)
        #expect(try Curve25519.Signing.PublicKey(rawRepresentation: identity.publicKey).isValidSignature(signature, for: Data(payload.utf8)))
        #expect(await runtime.state.bridgeVersion == "fixture-bridge")
        await runtime.disconnect(); reader.cancel()
    }

    @Test func savedTokenRepairIsScopedAndBounded() async throws {
        let credentials = try Credentials(), value = connection(.openclaw), identity = try await credentials.identity()
        let key = DeviceTokenScope(connectionID: value.id, deviceID: identity.deviceID, gatewayURL: value.url)
        let nodeKey = DeviceTokenScope(connectionID: value.id, deviceID: identity.deviceID, role: "node", gatewayURL: value.url)
        try await credentials.writeToken(.init(token: "expired", role: "operator", scopes: ["operator.read"]), scope: key)
        try await credentials.writeToken(.init(token: "node-stays", role: "node", scopes: []), scope: nodeKey)
        let first = ScriptSocket(initial: [challengeFrame]) { request, socket in try await socket.reject(request, code: "AUTH_TOKEN_MISMATCH") }
        let second = ScriptSocket(initial: [challengeFrame]) { request, socket in try await socket.reply(request, payload: hello) }
        let factory = ScriptFactory(first, second), runtime = try RuntimeCoordinator(credentials: credentials, socketFactory: factory)
        let reader = read(runtime, into: Events())
        try await runtime.activate(value)
        #expect(await first.requests("connect")[0]["params"]?["auth"]?["deviceToken"]?.stringValue == "expired")
        #expect(await second.requests("connect")[0]["params"]?["auth"]?["token"]?.stringValue == "fixture-token")
        #expect(await credentials.deletes == [key]); #expect(try await credentials.readToken(scope: nodeKey)?.token == "node-stays")
        #expect(factory.count == 2)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func failedCredentialCleanupStopsAutomaticReconnect() async throws {
        let credentials = try Credentials(), value = connection(.openclaw), identity = try await credentials.identity()
        let key = DeviceTokenScope(connectionID: value.id, deviceID: identity.deviceID, gatewayURL: value.url)
        try await credentials.writeToken(.init(token: "expired", role: "operator", scopes: []), scope: key)
        await credentials.failDeletion()
        let socket = ScriptSocket(initial: [challengeFrame]) { request, socket in try await socket.reject(request, code: "AUTH_SCOPE_MISMATCH") }
        let factory = ScriptFactory(socket), runtime = try RuntimeCoordinator(credentials: credentials, socketFactory: factory)
        let reader = read(runtime, into: Events())
        do { try await runtime.activate(value); Issue.record("Failed cleanup became ready") }
        catch let error as RuntimeFailure { #expect(error.code == .credentialStorage) }
        #expect(factory.count == 1); #expect(await runtime.state.phase == .error)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func mobileSetupPersistsOperatorTokenBeforeHandoffReadiness() async throws {
        let credentials = try Credentials()
        let first = ScriptSocket(initial: [challengeFrame]) { request, socket in
            let result: JSONValue = .object(["server": .object(["version": .string("fixture")]), "auth": .object([
                "role": .string("node"), "deviceToken": .string("node-token"), "deviceTokens": .array([
                    .object(["role": .string("operator"), "deviceToken": .string("operator-token"), "scopes": .array([.string("operator.read")])])])])])
            try await socket.reply(request, payload: result)
        }
        let second = ScriptSocket(initial: [challengeFrame]) { request, socket in try await socket.reply(request, payload: hello) }
        let runtime = try RuntimeCoordinator(credentials: credentials, socketFactory: ScriptFactory(first, second))
        let recorder = Events(), reader = read(runtime, into: recorder)
        try await runtime.activate(connection(.openclaw, bootstrap: .init(token: "setup-token", strategy: .mobileSetup)))
        #expect(await first.requests("connect")[0]["params"]?["role"]?.stringValue == "node")
        #expect(await second.requests("connect")[0]["params"]?["auth"]?["deviceToken"]?.stringValue == "operator-token")
        #expect(await credentials.writes.map(\.role) == ["node", "operator"])
        #expect(await runtime.state.phase == .ready)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func relayBootstrapControlIsSeparatedFromBackendRequests() async throws {
        let socket = ScriptSocket(initial: [challengeFrame]) { request, socket in
            if request["type"]?.stringValue == "control" {
                try await socket.emit(.object(["type": .string("control"), "event": .string("bootstrap.issued"),
                                               "requestId": request["requestId"]!, "payload": .object(["bootstrapToken": .string("bound-token"), "strategy": .string("legacy-bound")])]), control: true)
            } else { try await socket.reply(request, payload: hello) }
        }
        let ordinary = connection(.openclaw, relay: true)
        let value = BackendConnection(id: ordinary.id, backendKind: .openclaw, transportKind: .relay, label: ordinary.label, url: ordinary.url,
                                      relay: .init(serverURL: ordinary.relay!.serverURL, gatewayID: "fixture-room", clientToken: "fixture-relay-token", protocolVersion: 2))
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events())
        try await runtime.activate(value)
        #expect(await socket.sent.first?["event"]?.stringValue == "bootstrap.request")
        #expect(await socket.requests("connect")[0]["params"]?["auth"]?["bootstrapToken"]?.stringValue == "bound-token")
        await runtime.disconnect(); reader.cancel()
    }

    @Test func degradedHermesDoesNotReadyAndPositiveHealthRestoresRetry() async throws {
        let clock = TestClock()
        let first = ScriptSocket { request, socket in try await socket.reply(request, payload: .object(["status": .string("degraded"), "hermesApiReachable": .bool(false)])) }
        let second = ScriptSocket { request, socket in try await socket.reply(request, payload: health(.hermes)) }
        let factory = ScriptFactory(first, second), runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: factory, clock: clock)
        let reader = read(runtime, into: Events())
        let activation = Task { try await runtime.activate(connection(.hermes, relay: true)) }
        try await eventually { await runtime.state.phase == .offline }
        #expect(await runtime.state.capabilities.chat == false)
        try await eventually { clock.pendingDelays.contains(.seconds(30)) }
        clock.advance(.seconds(30))
        try await activation.value
        #expect(factory.count == 2); #expect(await runtime.state.phase == .ready)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func uncertainSendIsNeverAutomaticallyReplayed() async throws {
        let clock = TestClock(), socket = ScriptSocket { request, socket in
            if request["method"]?.stringValue != "chat.send" { try await socket.reply(request, payload: health(.hermes)) }
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket), clock: clock)
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(.hermes, relay: true))
        let send = Task { try await runtime.send(sessionKey: "main", input: .init(text: "hello", idempotencyKey: "stable-outbox-id")) }
        try await eventually { await socket.methods().contains("chat.send") }
        try await eventually { clock.pendingDelays.contains(.seconds(20)) }
        clock.advance(.seconds(20))
        do { _ = try await send.value; Issue.record("Missing response was acknowledged") }
        catch let failure as RuntimeFailure { #expect(failure.delivery == .uncertain); #expect(failure.code == .timeout) }
        #expect(await socket.requests("chat.send").count == 1)
        await runtime.disconnect(); reader.cancel()
    }
}
