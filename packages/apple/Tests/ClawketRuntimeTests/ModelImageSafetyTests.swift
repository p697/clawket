import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

private func imageInput() -> RuntimePrompt {
    .init(text: "Image", attachments: [.init(type: .image, mimeType: "image/png", content: Data([1, 2]))])
}
private func textOnlySecondModel() -> JSONValue {
    var value = controlsPayload().object!, rows = value["models"]!.array!, model = rows[1].object!
    model["input"] = .array([.string("text")]); rows[1] = .object(model); value["models"] = .array(rows)
    return .object(value)
}

@Suite(.serialized)
struct ModelImageSafetyTests {
    @Test(arguments: [BackendKind.openclaw, .hermes, .pi])
    func modelWriteFirstBlocksImagesButKeepsOrdinaryTextAndStop(_ backend: BackendKind) async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(backend)
        try await runtime.activate(connection(backend))
        let value = try await runtime.modelControls(sessionKey: "owned")
        let method = backend == .openclaw ? "sessions.patch" : backend == .hermes ? "model.set" : "models.select"
        await peer.hold(method)
        let writing = Task { try await runtime.selectModel(reference: value.reference, modelID: "second") }
        try await eventually { await socket.requests(method).count == 1 }
        let route = backend == .hermes ? "another-caller" : "owned"
        await #expect(throws: RuntimeFailure.self) { try await runtime.validatePrompt(sessionKey: route, input: imageInput()) }
        await #expect(throws: RuntimeFailure.self) { try await runtime.send(sessionKey: route, input: imageInput()) }
        _ = try await runtime.send(sessionKey: route, input: .init(text: "Plain text remains supported"))
        try await runtime.abort(sessionKey: route)
        #expect(await socket.requests("chat.send").count == 1)
        #expect(await socket.requests("chat.send")[0]["params"]?["attachments"] == nil)
        try await socket.reply(await socket.requests(method)[0], payload: .object(["ok": .bool(true)]))
        #expect(try await writing.value.refreshRequired)
        // An ACK without actual current-model metadata does not release images.
        await #expect(throws: RuntimeFailure.self) { try await runtime.send(sessionKey: route, input: imageInput()) }
        await runtime.disconnect(); reader.cancel()
    }

    @Test func confirmedTextOnlyModelIsCheckedInsideRuntimeBeforeImageDispatch() async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(.hermes)
        await peer.setValue(textOnlySecondModel())
        try await runtime.activate(connection(.hermes))
        let value = try await runtime.modelControls(sessionKey: "owned")
        _ = try await runtime.selectModel(reference: value.reference, modelID: "second")
        // This is the actor hop after the host could still have cached image support.
        do { _ = try await runtime.send(sessionKey: "another-caller", input: imageInput()); Issue.record("Image reached text-only model") }
        catch let failure as RuntimeFailure { #expect(failure.code == .unsupported); #expect(failure.delivery == .notDispatched) }
        #expect(await socket.requests("chat.send").isEmpty)
        _ = try await runtime.send(sessionKey: "another-caller", input: .init(text: "Text still works"))
        #expect(await socket.requests("chat.send").count == 1)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func imageReservationFirstCannotBeOvertakenByALaterGlobalModelWrite() async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(.hermes)
        try await runtime.activate(connection(.hermes))
        let value = try await runtime.modelControls(sessionKey: "owned")
        await peer.hold("chat.send")
        let image = Task { try await runtime.send(sessionKey: "another-caller", input: imageInput()) }
        try await eventually { await socket.requests("chat.send").count == 1 }
        await #expect(throws: RuntimeFailure.self) { try await runtime.selectModel(reference: value.reference, modelID: "second") }
        await #expect(throws: RuntimeFailure.self) { try await runtime.selectModel(id: "second", sessionKey: "owned") }
        #expect(await socket.requests("model.set").isEmpty)
        try await socket.reply(await socket.requests("chat.send")[0], payload: .object(["runId": .string("image-run")]))
        _ = try await image.value
        _ = try await runtime.selectModel(reference: value.reference, modelID: "second")
        #expect(await socket.requests("model.set").count == 1)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func globalGatewayDefaultWriteRetiresEarlierSessionImageEvidence() async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(.openclaw)
        var row = lifecycleRow(.openclaw).object!
        row["model"] = .string("alias"); row["modelProvider"] = .string("provider")
        await peer.setRows([.object(row)])
        try await runtime.activate(connection(.openclaw))
        _ = try await runtime.modelControls(sessionKey: "owned")
        let global = try await runtime.modelControls()
        await peer.hold("config.patch")
        let writing = Task { try await runtime.selectModel(reference: global.reference, modelID: "second") }
        try await eventually { await socket.requests("config.patch").count == 1 }
        await #expect(throws: RuntimeFailure.self) { try await runtime.send(sessionKey: "owned", input: imageInput()) }
        try await socket.reply(await socket.requests("config.patch")[0], payload: .object(["ok": .bool(true)]))
        _ = try await writing.value
        _ = try await runtime.modelControls()
        // Reading global defaults does not manufacture a refreshed per-session model.
        await #expect(throws: RuntimeFailure.self) { try await runtime.send(sessionKey: "owned", input: imageInput()) }
        _ = try await runtime.modelControls(sessionKey: "owned")
        try await runtime.validatePrompt(sessionKey: "owned", input: imageInput())
        await runtime.disconnect(); reader.cancel()
    }

    @Test func resetAcknowledgementCannotReuseThePreviousPhysicalModelProjection() async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(.pi)
        try await runtime.activate(connection(.pi)); _ = try await runtime.refreshRoster()
        _ = try await runtime.modelControls(sessionKey: "owned")
        let action = try await runtime.sessionManagement(sessionKey: "owned")
        await peer.hold("sessions.reset")
        let reset = Task { try await runtime.resetSession(reference: action.reference) }
        try await eventually { await socket.requests("sessions.reset").count == 1 }
        try await socket.reply(await socket.requests("sessions.reset")[0], payload: .object(["ok": .bool(true)]))
        _ = try await reset.value
        await #expect(throws: RuntimeFailure.self) { try await runtime.validatePrompt(sessionKey: "owned", input: imageInput()) }
        _ = try await runtime.modelControls(sessionKey: "owned")
        try await runtime.validatePrompt(sessionKey: "owned", input: imageInput())
        await runtime.disconnect(); reader.cancel()
    }
}
