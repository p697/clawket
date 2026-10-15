import Foundation
import Testing
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct SessionManagementPolicyTests {
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
