import Foundation
import Testing
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct SessionLifecycleTests {
    @Test(arguments: BackendKind.allCases.filter { $0 != .localModel })
    func exactBackendRenameResetDeleteWire(_ backend: BackendKind) async throws {
        let (runtime, socket, _, reader) = try lifecycleFixture(backend)
        try await runtime.activate(connection(backend)); _ = try await runtime.refreshRoster()
        let first = try await runtime.sessionManagement(sessionKey: "owned")
        #expect(first.allowedActions.isSuperset(of: [.rename, .reset, .delete]))
        let receipt = try await runtime.renameSession(reference: first.reference, title: " Renamed ")
        #expect(receipt.connectionID == "connection-a"); #expect(receipt.sessionKey == "owned")
        #expect(receipt.sessionID == "physical-owned"); #expect(receipt.reference == first.reference)
        await #expect(throws: RuntimeFailure.self) { try await runtime.deleteSession(reference: first.reference) }
        _ = try await runtime.refreshRoster()
        let reset = try await runtime.sessionManagement(sessionKey: "owned")
        _ = try await runtime.resetSession(reference: reset.reference)
        _ = try await runtime.refreshRoster()
        let delete = try await runtime.sessionManagement(sessionKey: "owned")
        _ = try await runtime.deleteSession(reference: delete.reference)
        let gateway = [.openclaw, .hermes].contains(backend)
        let renameMethod = gateway ? "sessions.patch" : "sessions.rename"
        let key = gateway ? "key" : "sessionKey"
        let rename = await socket.requests(renameMethod)[0]["params"]!
        #expect(rename[key] == .string("owned"))
        #expect(rename[backend == .openclaw ? "label" : "title"] == .string("Renamed"))
        #expect(rename.object?.count == 2)
        let resetParams = await socket.requests("sessions.reset")[0]["params"]!
        #expect(resetParams[key] == .string("owned"))
        #expect(resetParams["reason"] == (backend == .openclaw ? .string("reset") : nil))
        #expect(await socket.requests("sessions.delete")[0]["params"] == .object([key: .string("owned")]))
        await runtime.disconnect(); reader.cancel()
    }

    @Test func recordedHermesRowsAndPacketKeepNativeReadOnly() async throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixture = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: root.appendingPathComponent("tests/fixtures/hermes/m3-multi-session-v2.json")))
        let packets = fixture["packets"]!.array!
        let native = packets.first { $0["label"] == .string("sessions.list.initial") }!["expect"]!["payload"]!["sessions"]!.array![0]
        let owned = packets.first { $0["label"] == .string("sessions.create") }!["expect"]!["payload"]!["session"]!
        let peer = LifecyclePeer(.hermes, rows: [native, owned])
        let (runtime, socket, _, reader) = try lifecycleFixture(.hermes, peer: peer)
        try await runtime.activate(connection(.hermes)); _ = try await runtime.refreshRoster()
        let viewOnly = try await runtime.sessionManagement(sessionKey: native["key"]!.stringValue!)
        #expect(viewOnly.allowedActions.isEmpty)
        await #expect(throws: RuntimeFailure.self) { try await runtime.resetSession(reference: viewOnly.reference) }
        let writable = try await runtime.sessionManagement(sessionKey: owned["key"]!.stringValue!)
        let packet = packets.first { $0["label"] == .string("sessions.patch.title") }!["request"]!
        _ = try await runtime.renameSession(reference: writable.reference, title: packet["params"]!["title"]!.stringValue!)
        #expect(await socket.requests("sessions.patch")[0]["params"] == packet["params"])
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: [BackendKind.codex, .claudeCode, .pi])
    func branchReadOnlyNativeKeepsProjectAndOriginal(_ backend: BackendKind) async throws {
        var raw = lifecycleRow(backend, key: "native", source: "native", native: true).object!
        raw["project"] = .object(["id": .string("project"), "name": .string("Project"), "path": .string("/fixture/project"), "available": .bool(true)])
        raw["continuationBlockedReason"] = .string("ownership_unknown")
        let peer = LifecyclePeer(backend, rows: [.object(raw)])
        let (runtime, socket, _, reader) = try lifecycleFixture(backend, peer: peer)
        try await runtime.activate(connection(backend)); _ = try await runtime.refreshRoster()
        let context = try await runtime.sessionManagement(sessionKey: "native")
        #expect(context.allowedActions.contains(.branch)); #expect(!context.allowedActions.contains(.reset)); #expect(!context.allowedActions.contains(.delete))
        let created = try await runtime.branchSession(reference: context.reference, title: "Copy")
        #expect(created.key == "branched"); #expect(created.source == "bridge"); #expect(created.project?.id == "project")
        #expect(await socket.requests("sessions.create")[0]["params"] == .object(["fromSession": .string("native"), "title": .string("Copy")]))
        #expect(await socket.requests("sessions.reset").isEmpty); #expect(await socket.requests("sessions.delete").isEmpty)
        await #expect(throws: RuntimeFailure.self) { try await runtime.branchSession(reference: context.reference) }
        await runtime.disconnect(); reader.cancel()
    }

    @Test func codexArchivesNeedNegotiationAndExactArchiveRowPermission() async throws {
        var archived = lifecycleRow(.codex, key: "archived", source: "native", native: true, archived: true).object!
        archived.removeValue(forKey: "hasActiveRun") // Actual native sessions.archived projection omits it.
        let peer = LifecyclePeer(.codex)
        await peer.setHealth(.object(["backend": .string("codex"), "sessionArchive": .bool(true)]))
        await peer.setArchives([.object(archived)])
        let (runtime, socket, _, reader) = try lifecycleFixture(.codex, peer: peer)
        try await runtime.activate(connection(.codex))
        #expect(try await runtime.listArchivedSessions().map(\.key) == ["archived"])
        let context = try await runtime.sessionManagement(sessionKey: "archived")
        #expect(context.allowedActions == [.unarchive])
        _ = try await runtime.archiveSession(reference: context.reference, archived: false)
        #expect(await socket.requests("sessions.archive")[0]["params"] == .object(["sessionKey": .string("archived"), "archived": .bool(false)]))
        await runtime.disconnect(); reader.cancel()
        let (legacy, legacySocket, _, legacyReader) = try lifecycleFixture(.codex)
        try await legacy.activate(connection(.codex))
        await #expect(throws: RuntimeFailure.self) { try await legacy.listArchivedSessions() }
        #expect(await legacySocket.requests("sessions.archived").isEmpty)
        await legacy.disconnect(); legacyReader.cancel()
    }

    @Test func invalidTitleDoesNotConsumeReferenceButSuccessfulWriteDoes() async throws {
        let (runtime, socket, _, reader) = try lifecycleFixture(.codex)
        try await runtime.activate(connection(.codex)); _ = try await runtime.refreshRoster()
        let context = try await runtime.sessionManagement(sessionKey: "owned")
        for invalid in ["  ", "Original", String(repeating: "😀", count: 101)] {
            await #expect(throws: RuntimeFailure.self) { try await runtime.renameSession(reference: context.reference, title: invalid) }
        }
        #expect(await socket.requests("sessions.rename").isEmpty)
        _ = try await runtime.renameSession(reference: context.reference, title: String(repeating: "😀", count: 100))
        await #expect(throws: RuntimeFailure.self) { try await runtime.renameSession(reference: context.reference, title: "Again") }
        #expect(await socket.requests("sessions.rename").count == 1)
        await runtime.disconnect(); reader.cancel()
    }
}
