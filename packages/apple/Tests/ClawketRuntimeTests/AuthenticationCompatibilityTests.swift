import Foundation
import Testing
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct AuthenticationCompatibilityTests {
    @Test func hermesDirectAuthenticatesUpgradeWithSeparateToken() async throws {
        let value = BackendConnection(id: "hermes-direct", backendKind: .hermes, transportKind: .custom,
            label: "Fixture", url: URL(string: "ws://localhost:18080/v1/hermes/ws?token=stale&keep=value")!,
            auth: .init(token: "current+fixture&/="))
        let socket = ScriptSocket { request, socket in try await socket.reply(request, payload: health(.hermes)) }
        let factory = ScriptFactory(socket)
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: factory)
        let reader = read(runtime, into: Events())
        defer { reader.cancel() }
        try await runtime.activate(value)
        let endpoint = try #require(factory.urls.first)
        let query = try #require(URLComponents(url: endpoint, resolvingAgainstBaseURL: false)?.queryItems)
        #expect(query.filter { $0.name == "token" }.map(\.value) == ["current+fixture&/="])
        #expect(endpoint.absoluteString.contains("%2B"))
        #expect(query.first { $0.name == "keep" }?.value == "value")
        #expect(value.url.query?.contains("stale") == true)
        #expect(await runtime.state.phase == .ready)
        await runtime.disconnect()
    }

    @Test func hermesLegacyEmbeddedTokenAndRelayCredentialRemainSeparate() throws {
        let legacy = BackendConnection(id: "legacy", backendKind: .hermes, transportKind: .local,
            label: "Fixture", url: URL(string: "ws://localhost:18080/v1/hermes/ws?token=legacy-fixture")!)
        #expect(try BackendProfile.endpoint(legacy, deviceID: "fixture") == legacy.url)
        let relay = connection(.hermes, relay: true)
        let endpoint = try BackendProfile.endpoint(relay, deviceID: "fixture")
        let query = try #require(URLComponents(url: endpoint, resolvingAgainstBaseURL: false)?.queryItems)
        #expect(query.filter { $0.name == "token" }.map(\.value) == ["fixture-relay-token"])
    }

    @Test(arguments: [BackendKind.openclaw, .codex, .claudeCode, .pi, .localModel])
    func otherDirectBackendsNeverReceiveUpgradeQueryCredentials(_ backend: BackendKind) throws {
        let value = connection(backend)
        #expect(try BackendProfile.endpoint(value, deviceID: "fixture").query == nil)
        let oversized = BackendConnection(id: "oversized", backendKind: .hermes, transportKind: .custom,
            label: "Fixture", url: URL(string: "ws://localhost:18080/v1/hermes/ws")!,
            auth: .init(token: String(repeating: "x", count: 16_385)))
        #expect(throws: RuntimeFailure.self) { try BackendProfile.endpoint(oversized, deviceID: "fixture") }
    }

    @Test(arguments: ["INVALID_REQUEST", "BAD_REQUEST"])
    func directClosedSchemaFallsBackOnceToPreservedToken(_ code: String) async throws {
        let first = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await socket.reject(request, code: code, message: "invalid connect params: unexpected bootstrapToken")
        }
        let second = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await socket.reply(request, payload: hello)
        }
        let factory = ScriptFactory(first, second)
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: factory)
        let reader = read(runtime, into: Events())
        defer { reader.cancel() }
        try await runtime.activate(connection(.openclaw, bootstrap: .init(token: "schema-fixture", strategy: .legacyBound)))
        #expect(await first.requests("connect")[0]["params"]?["auth"]?["bootstrapToken"]?.stringValue == "schema-fixture")
        #expect(await second.requests("connect")[0]["params"]?["auth"]?["token"]?.stringValue == "fixture-token")
        #expect(factory.count == 2)
        #expect(await runtime.state.phase == .ready)
        #expect(await first.closed)
        await runtime.disconnect()
    }

    @Test func relayClosedSchemaFallsBackToPasswordWithoutRequestingAnotherBootstrap() async throws {
        let first = ScriptSocket(initial: [challengeFrame]) { request, socket in
            if request["type"]?.stringValue == "control" {
                try await socket.emit(.object(["type": .string("control"), "event": .string("bootstrap.issued"),
                    "requestId": request["requestId"]!, "payload": .object(["bootstrapToken": .string("relay-schema-fixture")])]), control: true)
            } else {
                try await socket.reject(request, code: "BAD_REQUEST", message: "unexpected property bootstrapToken")
            }
        }
        let second = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await socket.reply(request, payload: hello)
        }
        let value = BackendConnection(id: "relay-schema", backendKind: .openclaw, transportKind: .relay, label: "Fixture",
            url: URL(string: "wss://gateway.invalid/ws")!, auth: .init(password: "preserved-fixture"),
            relay: .init(serverURL: URL(string: "https://registry.invalid")!, gatewayID: "fixture-room",
                         clientToken: "fixture-relay-token", protocolVersion: 2))
        let factory = ScriptFactory(first, second)
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: factory)
        let reader = read(runtime, into: Events())
        defer { reader.cancel() }
        try await runtime.activate(value)
        #expect(await first.sent.filter { $0["event"]?.stringValue == "bootstrap.request" }.count == 1)
        #expect(await second.sent.filter { $0["event"]?.stringValue == "bootstrap.request" }.isEmpty)
        #expect(await second.requests("connect")[0]["params"]?["auth"]?["password"]?.stringValue == "preserved-fixture")
        #expect(await runtime.state.phase == .ready)
        #expect(factory.count == 2)
        await runtime.disconnect()
    }

    @Test(arguments: [
        ("AUTH_TOKEN_MISMATCH", "unexpected bootstrapToken"),
        ("AUTH_REJECTED", "invalid connect bootstrapToken"),
        ("INVALID_REQUEST", "invalid bootstrapToken credentials"),
        ("BAD_REQUEST", "unexpected client property"),
    ])
    func authenticationAndUnrelatedSchemaErrorsNeverDowngrade(_ rejection: (String, String)) async throws {
        let first = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await socket.reject(request, code: rejection.0, message: rejection.1)
        }
        let factory = ScriptFactory(first)
        let credentials = try Credentials()
        let runtime = try RuntimeCoordinator(credentials: credentials, socketFactory: factory)
        let reader = read(runtime, into: Events())
        defer { reader.cancel() }
        do {
            try await runtime.activate(connection(.openclaw, bootstrap: .init(token: "schema-fixture", strategy: .legacyBound)))
            Issue.record("Rejected authentication became ready")
        } catch {
            #expect(await runtime.state.phase == .error)
        }
        #expect(factory.count == 1)
        #expect(await credentials.deletes.isEmpty)
        await runtime.disconnect()
    }

    @Test func closedSchemaWithoutLegacyCredentialFailsInsteadOfUnauthenticatedRetry() async throws {
        let first = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await socket.reject(request, code: "INVALID_REQUEST", message: "invalid connect: bootstrapToken")
        }
        let factory = ScriptFactory(first)
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: factory)
        let reader = read(runtime, into: Events())
        defer { reader.cancel() }
        let value = BackendConnection(id: "bootstrap-only", backendKind: .openclaw, transportKind: .local,
            label: "Fixture", url: URL(string: "ws://localhost:18080/ws")!,
            bootstrap: .init(token: "schema-fixture", strategy: .legacyBound))
        do { try await runtime.activate(value); Issue.record("Missing legacy credential became ready") }
        catch { #expect(await runtime.state.phase == .error) }
        #expect(factory.count == 1)
        await runtime.disconnect()
    }

    @Test func secondSchemaRejectionCannotRecycleAgain() async throws {
        let reject: ScriptSocket.Handler = { request, socket in
            try await socket.reject(request, code: "INVALID_REQUEST", message: "unexpected bootstrapToken")
        }
        let first = ScriptSocket(initial: [challengeFrame], handler: reject)
        let second = ScriptSocket(initial: [challengeFrame], handler: reject)
        let factory = ScriptFactory(first, second)
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: factory)
        let reader = read(runtime, into: Events())
        defer { reader.cancel() }
        do {
            try await runtime.activate(connection(.openclaw, bootstrap: .init(token: "schema-fixture", strategy: .legacyBound)))
            Issue.record("Repeated rejection became ready")
        } catch { #expect(await runtime.state.phase == .error) }
        #expect(factory.count == 2)
        #expect(await second.requests("connect")[0]["params"]?["auth"]?["token"]?.stringValue == "fixture-token")
        await runtime.disconnect()
    }
}
