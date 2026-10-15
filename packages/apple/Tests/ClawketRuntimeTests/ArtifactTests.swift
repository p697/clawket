import Foundation
import Testing
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

private actor TicketHTTP: RuntimeArtifactHTTPClient {
    let body: Data
    var calls = 0
    init(_ body: Data) { self.body = body }
    func download(_ url: URL, timeout: Duration) async throws -> Data { calls += 1; return body }
}
private func artifactFile(size: Int = 3) -> JSONValue {
    .object(["id": .string("opaque-handle"), "name": .string("result.png"), "size": .number(Double(size)), "mimeType": .string("image/png")])
}
private func artifactHealth(_ backend: BackendKind, enabled: Bool = true) -> JSONValue {
    if backend == .openclaw {
        return .object(["features": .object(["methods": .array(enabled ? ["clawket.artifacts.open", "clawket.artifacts.read"].map(JSONValue.string) : [])])])
    }
    if backend == .hermes { return .object(["status": .string("ok"), "hermesApiReachable": .bool(true), "capabilities": .array(enabled ? [.string("bridge.artifacts.v1")] : [])]) }
    return .object(["backend": .string(backend.rawValue), "artifacts": .bool(enabled)])
}

@Suite(.serialized)
struct ArtifactTests {
    @Test(arguments: [BackendKind.openclaw, .hermes, .codex, .claudeCode, .pi])
    func negotiatedBridgeArtifactOpenAndExactChunks(_ backend: BackendKind) async throws {
        let body = Data(repeating: 17, count: 128 * 1_024 + 3)
        let socket = ScriptSocket(initial: backend == .openclaw ? [challengeFrame] : []) { request, socket in
            let payload: JSONValue
            switch request["method"]?.stringValue {
            case "clawket.artifacts.open": payload = artifactFile(size: body.count)
            case "clawket.artifacts.read":
                let offset = Int(request["params"]?["offset"]?.numberValue ?? -1)
                let bytes = body.subdata(in: offset..<min(offset + 128 * 1_024, body.count))
                payload = .object(["offset": .number(Double(offset)), "total": .number(Double(body.count)), "data": .string(bytes.base64EncodedString()), "done": .bool(offset + bytes.count == body.count)])
            default: payload = artifactHealth(backend)
            }
            try await socket.reply(request, payload: payload)
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        try await runtime.activate(connection(backend))
        let handle = try await runtime.openArtifact(sessionKey: "main", artifactID: "stable-result")
        #expect(handle.artifactID == "stable-result"); #expect(handle.size == body.count)
        let first = try await runtime.readArtifact(handle, offset: 0), second = try await runtime.readArtifact(handle, offset: first.count)
        #expect(first + second == body)
        await #expect(throws: RuntimeFailure(.superseded)) { try await runtime.readArtifact(handle, offset: 0) }
        await runtime.disconnect()
    }

    @Test(arguments: ["offset", "total", "done", "base64", "noncanonical", "length"])
    func malformedChunksNeverReturnBytes(_ malformed: String) async throws {
        let socket = ScriptSocket { request, socket in
            if request["method"]?.stringValue == "clawket.artifacts.open" { try await socket.reply(request, payload: artifactFile()); return }
            if request["method"]?.stringValue == "clawket.artifacts.read" {
                var chunk: [String: JSONValue] = ["offset": .number(0), "total": .number(3), "done": .bool(true), "data": .string("AQID")]
                switch malformed {
                case "offset": chunk["offset"] = .number(1)
                case "total": chunk["total"] = .number(4)
                case "done": chunk["done"] = .bool(false)
                case "base64": chunk["data"] = .string("!!!!")
                case "noncanonical": chunk["data"] = .string("AQID\n")
                default: chunk["data"] = .string("AQI=")
                }
                try await socket.reply(request, payload: .object(chunk)); return
            }
            try await socket.reply(request, payload: artifactHealth(.codex))
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        try await runtime.activate(connection(.codex))
        let handle = try await runtime.openArtifact(sessionKey: "main", artifactID: "stable-result")
        await #expect(throws: RuntimeFailure(.invalidResponse)) { try await runtime.readArtifact(handle, offset: 0) }
        await runtime.disconnect()
    }

    @Test func capabilityLossAndScopeReturnCannotReviveOldHandle() async throws {
        let socket = ScriptSocket { request, socket in
            try await socket.reply(request, payload: request["method"]?.stringValue == "clawket.artifacts.open" ? artifactFile() : artifactHealth(.hermes))
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        try await runtime.activate(connection(.hermes))
        let handle = try await runtime.openArtifact(sessionKey: "main", artifactID: "stable-result")
        try await socket.emit(event("health", artifactHealth(.hermes, enabled: false)))
        try await eventually { !(await runtime.state.capabilities.artifacts) }
        try await socket.emit(event("health", artifactHealth(.hermes)))
        try await eventually { await runtime.state.capabilities.artifacts }
        await #expect(throws: RuntimeFailure(.superseded)) { try await runtime.readArtifact(handle, offset: 0) }
        #expect(await socket.requests("clawket.artifacts.read").isEmpty)
        await runtime.disconnect()
    }

    @Test func directOpenClawTicketUsesSameGatewayAuthorityAndNoRelayFallback() async throws {
        let body = Data([1, 2, 3]), http = TicketHTTP(body)
        let socket = ScriptSocket(initial: [challengeFrame]) { request, socket in
            let payload: JSONValue
            switch request["method"]?.stringValue {
            case "connect": payload = .object(["features": .object(["methods": .array([.string("artifacts.get"), .string("artifacts.download")])])])
            case "artifacts.get": payload = .object(["artifact": .object(["id": .string("stable-result"), "sizeBytes": .number(3), "download": .object(["mode": .string("url")])])])
            default: payload = .object(["artifact": .object(["id": .string("stable-result"), "sizeBytes": .number(3), "title": .string("result.png"), "mimeType": .string("image/png")]), "url": .string("/ws/api/artifacts/download/ticket")])
            }
            try await socket.reply(request, payload: payload)
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket), artifactHTTP: http)
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        try await runtime.activate(connection(.openclaw))
        let handle = try await runtime.openArtifact(sessionKey: "main", artifactID: "stable-result")
        #expect(try await runtime.readArtifact(handle, offset: 0) == body); #expect(await http.calls == 1)
        await runtime.disconnect()
        let relaySocket = ScriptSocket(initial: [challengeFrame]) { request, socket in
            try await socket.reply(request, payload: .object(["features": .object(["methods": .array([.string("artifacts.get"), .string("artifacts.download")])])]))
        }
        let relay = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(relaySocket), artifactHTTP: http)
        let relayReader = read(relay, into: Events()); defer { relayReader.cancel() }
        try await relay.activate(connection(.openclaw, relay: true))
        #expect(!(await relay.state.capabilities.artifacts))
        await #expect(throws: RuntimeFailure(.unsupported)) { try await relay.openArtifact(sessionKey: "main", artifactID: "stable-result") }
        #expect(await http.calls == 1); await relay.disconnect()
    }

    @Test(arguments: ["https://other.invalid/ws/api/artifacts/download/t", "http://gateway.invalid/ws/api/artifacts/download/t", "/api/artifacts/download/t", "/ws/api/config", "/ws/api/artifacts/download/../secret", "https://user:password@gateway.invalid/ws/api/artifacts/download/t", "/ws/api/artifacts/download/t#secret"])
    func ticketRejectsForeignOriginCredentialsAndWrongPath(_ raw: String) throws {
        #expect(throws: RuntimeFailure(.invalidResponse)) { try artifactDownloadURL(raw, gateway: URL(string: "wss://gateway.invalid/ws")!) }
    }

    @Test func exactTicketPrefixDefaultPortAndEmptyFileBase64() throws {
        #expect(try artifactDownloadURL("HTTPS://GATEWAY.INVALID:443/ws/api/chat/media/outgoing/t", gateway: URL(string: "wss://gateway.invalid/ws")!).scheme?.lowercased() == "https")
        #expect(try artifactBase64("", length: 0, maximum: 128 * 1_024).isEmpty)
        #expect(throws: RuntimeFailure(.invalidResponse)) { try artifactMetadata(.object(["id": .string("handle"), "name": .string("../bad"), "size": .number(1), "mimeType": .string("text/plain")])) }
    }

    @Test func piHistoryRequestsArtifactsOnlyAfterNegotiationAndLocalModelHasNoOutputAPI() async throws {
        let socket = ScriptSocket { request, socket in
            try await socket.reply(request, payload: request["method"]?.stringValue == "chat.history" ? .object(["messages": .array([])]) : artifactHealth(.pi))
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        try await runtime.activate(connection(.pi)); _ = try await runtime.loadSession(key: "s")
        #expect(await socket.requests("chat.history").first?["params"]?["artifacts"] == .bool(true))
        await runtime.disconnect()
        let local = ScriptSocket { request, socket in try await socket.reply(request, payload: artifactHealth(.localModel)) }
        let model = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(local))
        let localReader = read(model, into: Events()); defer { localReader.cancel() }
        try await model.activate(connection(.localModel)); #expect(!(await model.state.capabilities.artifacts))
        await model.disconnect()
    }
}
