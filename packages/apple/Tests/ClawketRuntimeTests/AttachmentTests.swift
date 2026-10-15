import Foundation
import Testing
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

private func mediaHealth(_ backend: BackendKind, vision: Bool = true, artifacts: Bool = true) -> JSONValue {
    if backend == .hermes {
        return .object(["status": .string("ok"), "hermesApiReachable": .bool(true), "capabilities": .array([
            .string("hermes.multi-session.v2"), .string("hermes.documents.v1"), .string("bridge.artifacts.v1")])])
    }
    return .object(["backend": .string(backend.rawValue), "vision": .bool(vision), "artifacts": .bool(artifacts)])
}

@Suite(.serialized)
struct AttachmentTests {
    @Test(arguments: BackendKind.allCases)
    func promptWireAndCapabilitiesMatchAllSixBackends(_ backend: BackendKind) async throws {
        let socket = ScriptSocket(initial: backend == .openclaw ? [challengeFrame] : []) { request, socket in
            let payload: JSONValue = request["method"]?.stringValue == "chat.send" ? .object(["runId": .string("media-run")])
                : backend == .openclaw ? hello : mediaHealth(backend)
            try await socket.reply(request, payload: payload)
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        try await runtime.activate(connection(backend))
        #expect(await runtime.state.capabilities.attachments)
        let prompt = RuntimePrompt(text: "", attachments: [.init(type: .image, mimeType: " Image/PNG ", content: Data([1, 2, 3]), name: "photo.png")])
        try await runtime.validatePrompt(sessionKey: "main", input: prompt)
        #expect(await socket.requests("chat.send").isEmpty)
        _ = try await runtime.send(sessionKey: "main", input: prompt)
        let params = try #require(await socket.requests("chat.send").first?["params"])
        #expect(params["attachments"]?.array?.first?["content"]?.stringValue == "AQID")
        #expect(params["attachments"]?.array?.first?["mimeType"]?.stringValue == "image/png")
        #expect(params[[.openclaw, .hermes].contains(backend) ? "message" : "text"]?.stringValue == "Review these attachments.")
        await runtime.disconnect()
    }

    @Test(arguments: BackendKind.allCases)
    func fileAndVisionNegotiationNeverUpgradeProductMatrix(_ backend: BackendKind) async throws {
        let socket = ScriptSocket(initial: backend == .openclaw ? [challengeFrame] : []) { request, socket in
            try await socket.reply(request, payload: backend == .openclaw ? hello : mediaHealth(backend, vision: false))
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        try await runtime.activate(connection(backend))
        #expect(await runtime.state.capabilities.attachments == ![.claudeCode, .localModel].contains(backend))
        let document = RuntimePrompt(text: "review", attachments: [.init(type: .file, mimeType: "application/pdf", content: Data([1]))])
        if [.openclaw, .hermes].contains(backend) { try await runtime.validatePrompt(sessionKey: "main", input: document) }
        else { await #expect(throws: RuntimeFailure(.unsupported)) { try await runtime.validatePrompt(sessionKey: "main", input: document) } }
        let arbitrary = RuntimePrompt(text: "review", attachments: [.init(type: .file, mimeType: "application/octet-stream", content: Data([1]))])
        if backend == .openclaw { try await runtime.validatePrompt(sessionKey: "main", input: arbitrary) }
        else { await #expect(throws: RuntimeFailure(.unsupported)) { try await runtime.validatePrompt(sessionKey: "main", input: arbitrary) } }
        await runtime.disconnect()
    }

    @Test func oversizedGifPairRejectsBeforeSendWhileFiveMiBSlashHeavyImageFits() async throws {
        let socket = ScriptSocket { request, socket in
            try await socket.reply(request, payload: request["method"]?.stringValue == "chat.send" ? .object(["runId": .string("run")]) : mediaHealth(.codex))
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        try await runtime.activate(connection(.codex))
        let gif = RuntimePromptAttachment(type: .image, mimeType: "image/gif", content: Data(repeating: 255, count: 3 * 1_024 * 1_024))
        let oversized = RuntimePrompt(text: "draft 中文", attachments: [gif, gif])
        let failure = RuntimeFailure(.capacity, delivery: .rejectedBeforeDispatch)
        await #expect(throws: failure) { try await runtime.validatePrompt(sessionKey: "main", input: oversized) }
        await #expect(throws: failure) { try await runtime.send(sessionKey: "main", input: oversized) }
        #expect(await socket.requests("chat.send").isEmpty)
        let valid = RuntimePrompt(text: "image", attachments: [.init(type: .image, mimeType: "image/jpeg", content: Data(repeating: 255, count: 5 * 1_024 * 1_024))])
        try await runtime.validatePrompt(sessionKey: "main", input: valid)
        _ = try await runtime.send(sessionKey: "main", input: valid)
        #expect(await socket.requests("chat.send").count == 1)
        await runtime.disconnect()
    }

    @Test func exactUTF8EnvelopeBoundaryUsesDispatchSerializer() throws {
        let id = "00000000-0000-0000-0000-000000000000"
        let base: [String: JSONValue] = ["type": .string("req"), "id": .string(id), "method": .string("chat.send"), "params": .object(["text": .string("中文😀")])]
        let count = try FrameCodec.encode(.object(base)).utf8.count
        let text = "中文😀" + String(repeating: "x", count: FrameCodec.maximumFrameBytes - count)
        try RPCConnection.validateRequest(method: "chat.send", params: .object(["text": .string(text)]))
        #expect(throws: RPCFailure(.frameTooLarge)) { try RPCConnection.validateRequest(method: "chat.send", params: .object(["text": .string(text + "x")])) }
    }

    @Test func oldDraftPromptDecodesWithNoAttachments() throws {
        let bytes = Data("{\"text\":\"old draft\",\"idempotencyKey\":\"key\"}".utf8)
        #expect(try JSONDecoder().decode(RuntimePrompt.self, from: bytes).attachments.isEmpty)
        #expect(RuntimeModel(id: "text", name: "Text", selected: true, input: ["text"]).supportsImages == false)
        #expect(RuntimeModel(id: "vision", name: "Vision", selected: true, input: ["text", "image"]).supportsImages == true)
        #expect(RuntimeModel(id: "unknown", name: "Unknown", selected: true).supportsImages == nil)
    }

    @Test func unknownNativeSendFailureIsUncertainAndNeverReplayed() async throws {
        let socket = ScriptSocket { request, socket in
            if request["method"]?.stringValue == "chat.send" { throw WebSocketFailure.failed }
            try await socket.reply(request, payload: mediaHealth(.codex))
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        try await runtime.activate(connection(.codex))
        do { _ = try await runtime.send(sessionKey: "main", input: .init(text: "image", attachments: [.init(type: .image, mimeType: "image/png", content: Data([1]))])); Issue.record("Expected failure") }
        catch let failure as RuntimeFailure { #expect(failure.delivery == .uncertain) }
        #expect(await socket.requests("chat.send").count == 1)
        await runtime.disconnect()
    }

    @Test func stableArtifactsKeepImageOnlyFinalsAndScopedManagedHistoryDedup() throws {
        let artifact: JSONValue = .object(["type": .string("image"), "mimeType": .string("image/png"), "artifactId": .string("artifact_managed_one")])
        let raw: JSONValue = .object(["id": .string("first"), "role": .string("assistant"), "text": .string("MEDIA: /synthetic/result.png"), "attachments": .array([artifact])])
        let duplicate: JSONValue = .object(["id": .string("second"), "role": .string("assistant"), "text": .string(""), "attachments": .array([artifact])])
        let history = try WireModels.history(.object(["messages": .array([raw, duplicate])]), key: "main", backend: .openclaw, artifactsEnabled: true)
        #expect(history.messages.count == 1); #expect(history.messages[0].text.isEmpty)
        #expect(history.messages[0].attachments.first?.artifactID == "artifact_managed_one")
        var events = SessionEvents()
        let updates = try events.map(event("chat", .object(["runId": .string("r"), "sessionKey": .string("main"), "state": .string("final"),
            "message": .object(["content": .array([artifact])])])), connection: connection(.openclaw), artifactsEnabled: true)
        #expect(updates.count == 1); #expect(updates[0].finalAttachments.count == 1)
        let inline: JSONValue = .object(["type": .string("image"), "source": .object(["media_type": .string("image/png"), "data": .string("AQID")])])
        #expect(try RuntimeAttachmentProjection.inlineData(.object(["content": .array([inline])]), index: 0) == Data([1, 2, 3]))
        #expect(try RuntimeAttachmentProjection.inlineData(.object(["content": .array([artifact])]), index: 0) == nil)
        let text = "Example\n```\nMEDIA: /keep/example.png\n```\nMEDIA: /remove.png\nKeep MEDIA: /prose.png"
        #expect(RuntimeAttachmentProjection.stripMediaDirectives(text) == "Example\n```\nMEDIA: /keep/example.png\n```\nKeep MEDIA: /prose.png")
    }
}
