import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct RosterAgentEvidenceTests {
    @Test func actualDefaultAgentEvidenceSurvivesWithoutGuessingNamesOrMainSessionKeys() throws {
        let openclaw = BackendConnection(id: "c", backendKind: .openclaw, transportKind: .local, label: "Server", url: URL(string: "ws://127.0.0.1")!)
        let payload = JSONValue.object(["defaultId": .string("custom"), "agents": .array([
            .object(["id": .string("main")]), .object(["id": .string("custom")])])])
        let agents = try WireModels.agents(payload, connection: openclaw)
        #expect(agents.first?.isMain == false); #expect(agents.last?.isMain == true)
        for backend in [BackendKind.hermes, .localModel] {
            let connection = BackendConnection(id: "c", backendKind: backend, transportKind: .local, label: "Server", url: URL(string: "ws://127.0.0.1")!)
            #expect(try WireModels.agents(.object([:]), connection: connection).first?.isMain == true)
        }
        let native = BackendConnection(id: "c", backendKind: .codex, transportKind: .local, label: "Server", url: URL(string: "ws://127.0.0.1")!)
        let catalog = JSONValue.array([.object(["agentId": .string("main"), "name": .string("Main"), "mainSessionKey": .string(""), "entryMode": .string("sessions")])])
        let agent = try #require(WireModels.agents(catalog, connection: native).first)
        #expect(agent.isMain == nil); #expect(agent.mainSessionKey.isEmpty); #expect(agent.entryMode == .sessions)
        let restored = try JSONDecoder().decode(RuntimeAgent.self, from: Data(#"{"agentID":"a","connectionID":"c","name":"A","mainSessionKey":"main","entryMode":"main"}"#.utf8))
        #expect(restored.isMain == nil)
    }
}
