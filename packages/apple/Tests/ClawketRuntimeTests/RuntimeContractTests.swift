import Foundation
import Testing
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct RuntimeContractTests {
    @Test func allBackendProfilesAndEndpointsPreserveIdentity() throws {
        #expect(Set(BackendKind.allCases.map(\.rawValue)) == Set(["openclaw", "hermes", "codex", "claude-code", "pi", "local-model"]))
        for backend in BackendKind.allCases {
            let value = connection(backend, relay: true)
            let url = try BackendProfile.endpoint(value, deviceID: "fixture-device")
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
            #expect(query.first { $0.name == (backend == .hermes ? "bridgeId" : "gatewayId") }?.value == "fixture-room")
            #expect(query.first { $0.name == "capabilities" }?.value == "relay.client-pong.v1")
            #expect(query.first { $0.name == "clientId" }?.value == (backend == .openclaw ? "fixture-device" : value.id))
            #expect(BackendProfile.profile(for: backend).modelsPerSession == ![.hermes, .localModel].contains(backend))
        }
        #expect(throws: RuntimeFailure.self) {
            try BackendProfile.endpoint(.init(backendKind: .hermes, transportKind: .relay, label: "test", url: URL(string: "https://user:password@invalid/")!), deviceID: "id")
        }
    }

    @Test func sessionsFirstNeverInventsMainConversation() throws {
        let agents = try WireModels.agents(.array([.object(["agentId": .string("codex"), "entryMode": .string("sessions"),
                                                           "mainSessionKey": .string(""), "name": .string("Remote label")])]), connection: connection(.codex))
        #expect(agents[0].entryMode == .sessions); #expect(agents[0].mainSessionKey.isEmpty)
        #expect(agents[0].name == "Saved local label")
        #expect(throws: RuntimeFailure.self) { try WireModels.agents(.array([.object(["agentId": .string("codex")])]), connection: connection(.codex)) }
    }

    @Test func assistantSegmentsAndFinalOnlyRepliesRemainVisible() throws {
        var mapper = SessionEvents()
        let value = connection(.hermes)
        let base: [String: JSONValue] = ["runId": .string("r"), "sessionKey": .string("main")]
        func chat(_ state: String, _ text: String) -> JSONValue {
            event("chat", .object(base.merging(["state": .string(state), "message": .object(["content": .string(text)])]) { _, new in new }))
        }
        let first = try mapper.map(chat("delta", "Before tool"), connection: value)
        _ = try mapper.map(event("agent", .object(base.merging(["stream": .string("tool"), "data": .object(["phase": .string("start"), "toolCallId": .string("tool-a")])]) { _, new in new })), connection: value)
        let final = try mapper.map(chat("final", "Final reply"), connection: value)
        guard case .text(let before) = first[0], case .text(let after) = final[0], case .runFinished = final[1] else {
            Issue.record("Missing assistant text or authoritative completion"); return
        }
        #expect(before.segmentID != after.segmentID); #expect(after.text == "Final reply"); #expect(after.mode == .snapshot)
        #expect(try mapper.map(chat("final", "duplicate"), connection: value).isEmpty)
        var finalOnly = SessionEvents()
        #expect(try finalOnly.map(chat("final", "No deltas needed"), connection: value).count == 2)
    }

    @Test func sdkDeltaSnapshotAndUntrustedProvenanceAreExplicit() throws {
        var mapper = SessionEvents()
        let payload: JSONValue = .object(["type": .string("agent_message_chunk"), "runId": .string("r"), "sessionKey": .string("s"),
                                          "text": .string("piece"), "textMode": .string("delta"), "turnId": .string("turn"), "inputMessageKey": .string("input")])
        let updates = try mapper.map(event("pi.update", payload), connection: connection(.pi))
        guard case .text(let text) = updates.first else { Issue.record("Missing delta"); return }
        #expect(text.mode == .delta); #expect(text.turnID == "turn"); #expect(text.inputMessageKey == "input")
        let history = try WireModels.history(.object(["messages": .array([.object(["id": .string("remote"), "role": .string("user"), "text": .string("hello"), "sentLocally": .bool(true)])])]), key: "s", backend: .pi)
        #expect(history.messages[0].sentLocally == false); #expect(history.pagination == .cursor)
    }

    @Test func openClawPaginationAndHumanActivityDoNotUseHousekeeping() throws {
        let history = try WireModels.history(.object(["messages": .array([]), "hasMore": .bool(true), "nextOffset": .number(50), "sessionId": .string("physical")]), key: "agent:main:main", backend: .openclaw)
        #expect(history.nextCursor?.hasPrefix("clawket:openclaw-offset:") == true)
        #expect(throws: RuntimeFailure.self) { try WireModels.history(.object(["messages": .array([]), "hasMore": .bool(true)]), key: "s", backend: .openclaw) }
        let raw: JSONValue = .object(["key": .string("agent:a:main"), "updatedAt": .number(999), "lastInteractionAt": .number(10), "lastActivityAt": .number(20)])
        #expect(try WireModels.session(raw, connection: connection(.openclaw), legacyActivity: false).lastActivityAtMs == 20)
        #expect(try WireModels.session(.object(["key": .string("main"), "updatedAt": .number(999)]), connection: connection(.openclaw), legacyActivity: false).lastActivityAtMs == nil)
    }

    @Test func errorsNeverExposePeerTextAndKnownRefusalIsNotUncertain() {
        let message = "Codex did not restore the conversation permissions. Select and confirm permissions before sending."
        let failure = runtimeFailure(RPCFailure(.remoteRejection, delivery: .responseReceived,
                                               remoteError: .object(["code": .string("codex_error"), "message": .string(message)])), sending: true)
        #expect(failure.code == .permissionsRequired); #expect(failure.delivery == .rejectedBeforeDispatch)
        #expect(!failure.description.contains("Codex"))
        #expect(runtimeFailure(RPCFailure(.timeout, delivery: .uncertain), sending: true).delivery == .uncertain)
    }

    @Test func gatewayHistoryPreservesToolAndUnknownSystemRows() throws {
        let payload: JSONValue = .object(["messages": .array([
            .null,
            .object(["role": .string("toolResult"), "timestamp": .number(1_700_000_000), "content": .string("tool output")]),
            .object(["role": .string("future-role"), "content": .array([.object(["type": .string("content"), "artifactDisplayText": .string("visible result")])]),
                     "__openclaw": .object(["id": .string("native-id"), "idempotencyKey": .string("exact-send")])])
        ])])
        let history = try WireModels.history(payload, key: "s", backend: .openclaw)
        #expect(history.messages.count == 2); #expect(history.messages[0].role == .tool)
        #expect(history.messages[0].timestampMs == 1_700_000_000_000)
        #expect(history.messages[1].role == .system); #expect(history.messages[1].text == "visible result")
        #expect(history.messages[1].id == "native-id"); #expect(history.messages[1].idempotencyKey == "exact-send")
    }

    @Test func openClawKnownUserKeyFormatsReconcileWithoutRewritingOpaqueKeys() throws {
        let uuid = "e03e4999-6cc9-42ce-b09f-774597d1e51b"
        let keys = ["1789650197142_ku5tbzv3:user", uuid + ":user", "external-opaque:user"]
        let payload: JSONValue = .object(["messages": .array(keys.map { .object(["role": .string("user"), "content": .string("same content"),
            "idempotencyKey": .string($0), "__openclaw": .object(["senderIsOwner": .bool(true)])]) })])
        let messages = try WireModels.history(payload, key: "s", backend: .openclaw).messages
        #expect(messages.map(\.idempotencyKey) == ["1789650197142_ku5tbzv3", uuid, "external-opaque:user"])
        #expect(try WireModels.history(payload, key: "s", backend: .hermes).messages.map(\.idempotencyKey) == keys.map(Optional.some))
        #expect(messages.allSatisfy { !$0.sentLocally })
    }

    @Test(arguments: ["relay-openclaw/openclaw-v1.json", "relay-hermes/hermes-v1.json"])
    func realHistoricalContractFramesDecode(_ path: String) throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("tests/compat/fixtures/v1/" + path))
        let fixture = try JSONDecoder().decode(JSONValue.self, from: data)
        #expect((fixture["frames"]?.array?.count ?? 0) > 5)
        if path.contains("hermes") {
            let response = fixture["frames"]!.array!.first { $0["label"]?.stringValue == "sessions-list.response" }!["payload"]!["payload"]!
            let sessions = try WireModels.sessions(response, connection: connection(.hermes), legacyActivity: true)
            #expect(sessions.count == 1); #expect(sessions[0].agentID == "hermes")
        }
    }
}
