import Foundation
import Testing
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct SessionManagementPolicyTests {
    @Test func branchResponseCannotAliasAnotherKnownOwnedSession() async throws {
        let native = lifecycleRow(.codex, key: "native", source: "native", native: true)
        let peer = LifecyclePeer(.codex, rows: [native, lifecycleRow(.codex, key: "branched")])
        let (runtime, socket, _, reader) = try lifecycleFixture(.codex, peer: peer)
        try await runtime.activate(connection(.codex)); _ = try await runtime.refreshRoster()
        let context = try await runtime.sessionManagement(sessionKey: "native")
        do { _ = try await runtime.branchSession(reference: context.reference); Issue.record("Aliased create response accepted") }
        catch let failure as RuntimeFailure { #expect(failure.delivery == .responseReceived) }
        #expect(try await runtime.sessionManagement(sessionKey: "native").writeState == .uncertain)
        #expect(await socket.requests("sessions.create").count == 1)
        #expect(await socket.requests("sessions.delete").isEmpty)
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: [JSONValue.null, .array([]), .string("legacy"), .object(["methods": .null])])
    func malformedAdvertisementIsNotLegacyAbsence(_ features: JSONValue) async throws {
        let peer = LifecyclePeer(.openclaw)
        await peer.setFeatures(features)
        let (runtime, _, _, reader) = try lifecycleFixture(.openclaw, peer: peer)
        try await runtime.activate(connection(.openclaw)); _ = try await runtime.refreshRoster()
        #expect(try await runtime.sessionManagement(sessionKey: "owned").allowedActions.isEmpty)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func malformedRowChoicesAndArchiveOmissionDoNotGrantAuthority() throws {
        var raw = lifecycleRow(.codex).object!
        raw["allowedActions"] = .object(["rename": .string("true"), "reset": .bool(true), "delete": .bool(true), "pin": .bool(true)])
        #expect(throws: RuntimeFailure.self) { try WireModels.session(.object(raw), connection: connection(.codex), legacyActivity: true) }
        raw = lifecycleRow(.codex, archived: true).object!
        raw.removeValue(forKey: "hasActiveRun")
        #expect(throws: RuntimeFailure.self) { try WireModels.session(.object(raw), connection: connection(.codex), legacyActivity: true) }
        #expect(try WireModels.session(.object(raw), connection: connection(.codex), legacyActivity: true, archivedList: true).archived == true)
    }

    @Test(arguments: [0, 1, 2, 3])
    func openClawAbsentAdvertisementNeedsSuccessfulCurrentList(_ advertisement: Int) async throws {
        let peer = LifecyclePeer(.openclaw)
        let methods: [String]? = advertisement == 0 ? nil : advertisement == 1 ? []
            : advertisement == 2 ? ["sessions.patch"] : ["sessions.patch", "sessions.reset", "sessions.delete"]
        await peer.setAdvertisement(methods)
        let (runtime, _, _, reader) = try lifecycleFixture(.openclaw, peer: peer)
        try await runtime.activate(connection(.openclaw))
        #expect(await runtime.state.capabilities.sessionManagement?.rename == (advertisement >= 2))
        await #expect(throws: RuntimeFailure.self) { try await runtime.sessionManagement(sessionKey: "owned") }
        _ = try await runtime.refreshRoster()
        let context = try await runtime.sessionManagement(sessionKey: "owned")
        #expect(context.allowedActions.contains(.rename) == (advertisement != 1))
        #expect(context.allowedActions.contains(.reset) == (advertisement == 0 || advertisement == 3))
        #expect(context.allowedActions.contains(.delete) == (advertisement == 0 || advertisement == 3))
        await runtime.disconnect(); reader.cancel()
    }

    @Test func failedLegacyListAndUnknownMethodNeverGrantOrReplay() async throws {
        let peer = LifecyclePeer(.openclaw)
        await peer.setAdvertisement(nil); await peer.corrupt("sessions.list")
        let (runtime, socket, _, reader) = try lifecycleFixture(.openclaw, peer: peer)
        try await runtime.activate(connection(.openclaw))
        await #expect(throws: RuntimeFailure.self) { try await runtime.refreshRoster() }
        #expect(await runtime.state.capabilities.sessionManagement?.rename == false)
        await #expect(throws: RuntimeFailure.self) { try await runtime.sessionManagement(sessionKey: "owned") }
        #expect(await socket.requests("sessions.patch").isEmpty)
        await runtime.disconnect(); reader.cancel()

        let olderPeer = LifecyclePeer(.openclaw)
        await olderPeer.setAdvertisement(nil); await olderPeer.reject("sessions.patch")
        let (older, olderSocket, _, olderReader) = try lifecycleFixture(.openclaw, peer: olderPeer)
        try await older.activate(connection(.openclaw)); _ = try await older.refreshRoster()
        let context = try await older.sessionManagement(sessionKey: "owned")
        await #expect(throws: RuntimeFailure.self) { try await older.renameSession(reference: context.reference, title: "New") }
        _ = try await older.refreshRoster()
        #expect(try await older.sessionManagement(sessionKey: "owned").writeState == .uncertain)
        #expect(await olderSocket.requests("sessions.patch").count == 1)
        #expect(await olderSocket.requests("sessions.rename").isEmpty)
        await older.disconnect(); olderReader.cancel()
    }

    @Test(arguments: BackendKind.allCases)
    func productCeilingAndActiveActionsRemainBackendSpecific(_ backend: BackendKind) throws {
        let capabilities = SessionManagementPolicy.capabilities(backend, methods: ["sessions.patch", "sessions.reset", "sessions.delete"],
            health: .object(["sessionArchive": .bool(true)]), bridgeCapabilities: ["hermes.multi-session.v2"])
        let session = try WireModels.session(lifecycleRow(backend, active: true), connection: connection(backend), legacyActivity: true)
        let actions = SessionManagementPolicy.actions(session, backend: backend, capabilities: capabilities, active: true)
        #expect(actions.contains(.rename) == ![.localModel, .pi].contains(backend))
        #expect(actions.contains(.reset) == [.openclaw, .hermes].contains(backend))
        #expect(actions.contains(.delete) == [.openclaw, .hermes].contains(backend))
        #expect(!actions.contains(.archive)); #expect(!actions.contains(.branch))
    }

    @Test func openClawFallbackKeepsMainAndChannelDeletionOutOfApp() throws {
        let caps = SessionManagementPolicy.capabilities(.openclaw, methods: ["sessions.patch", "sessions.reset", "sessions.delete"], health: .null, bridgeCapabilities: [])
        for key in ["main", "agent:a:main", "agent:a:telegram:direct:peer"] {
            var row: [String: JSONValue] = ["key": .string(key), "kind": .string("direct")]
            if key.contains("telegram") { row["channel"] = .string("telegram") }
            let session = try WireModels.session(.object(row), connection: connection(.openclaw), legacyActivity: true)
            let actions = SessionManagementPolicy.actions(session, backend: .openclaw, capabilities: caps, active: false)
            #expect(actions.contains(.rename)); #expect(actions.contains(.reset)); #expect(!actions.contains(.delete))
        }
        let absent = SessionManagementPolicy.capabilities(.openclaw, methods: [], health: .null, bridgeCapabilities: [])
        let session = try WireModels.session(lifecycleRow(.openclaw), connection: connection(.openclaw), legacyActivity: true)
        #expect(SessionManagementPolicy.actions(session, backend: .openclaw, capabilities: absent, active: false).isEmpty)
    }

    @Test(arguments: [BackendKind.codex, .claudeCode, .pi])
    func nativeCopyAndContinuationNeverGrantDestructiveActions(_ backend: BackendKind) throws {
        let caps = SessionManagementPolicy.capabilities(backend, methods: [], health: .object(["sessionArchive": .bool(true)]), bridgeCapabilities: [])
        var row = lifecycleRow(backend, source: "native", native: true).object!
        row["allowedActions"] = .object(["rename": .bool(true), "reset": .bool(true), "delete": .bool(true), "archive": .bool(true), "pin": .bool(true)])
        func actions(_ value: [String: JSONValue]) throws -> Set<RuntimeSessionAction> {
            SessionManagementPolicy.actions(try WireModels.session(.object(value), connection: connection(backend), legacyActivity: true), backend: backend, capabilities: caps, active: false)
        }
        #expect(try actions(row).contains(.branch))
        #expect(try actions(row).contains(.rename) == (backend == .codex))
        #expect(try actions(row).contains(.archive) == (backend == .codex))
        #expect(try !actions(row).contains(.reset)); #expect(try !actions(row).contains(.delete))
        row["canContinue"] = .bool(true)
        #expect(try !actions(row).contains(.branch)); #expect(try !actions(row).contains(.delete))
        row["canContinue"] = .bool(false); row["continuationBlockedReason"] = .string("project_unavailable")
        #expect(try !actions(row).contains(.branch))
    }

    @Test func hermesMissingNegotiationAndNativeRowsFailClosed() async throws {
        let peer = LifecyclePeer(.hermes)
        await peer.setHealth(.object(["status": .string("ok"), "hermesApiReachable": .bool(true), "mode": .string("hermes")]))
        let (runtime, socket, _, reader) = try lifecycleFixture(.hermes, peer: peer)
        try await runtime.activate(connection(.hermes)); _ = try await runtime.refreshRoster()
        #expect(try await runtime.sessionManagement(sessionKey: "main").allowedActions.isEmpty)
        #expect(await socket.requests("sessions.list").isEmpty)
        let row = try WireModels.session(lifecycleRow(.hermes, source: "native"), connection: connection(.hermes), legacyActivity: true)
        #expect(row.allowedActions?.rename == false); #expect(row.allowedActions?.delete == false)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func storedSessionsAndCapabilitiesDecodeWithoutNewAuthorityFields() throws {
        let session = try WireModels.session(lifecycleRow(.codex), connection: connection(.codex), legacyActivity: true)
        var encoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(session)).object!
        for key in ["source", "sessionID", "archived", "allowedActions"] { encoded.removeValue(forKey: key) }
        let decoded = try JSONDecoder().decode(RuntimeSession.self, from: JSONEncoder().encode(JSONValue.object(encoded)))
        #expect(decoded.allowedActions == nil); #expect(decoded.source == nil)
        #expect(try JSONDecoder().decode(RuntimeCapabilities.self, from: JSONEncoder().encode(RuntimeCapabilities())).sessionManagement == nil)
    }
}
