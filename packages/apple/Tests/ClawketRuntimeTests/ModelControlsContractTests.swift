import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

struct ModelControlsContractTests {
    @Test func nativeOrderAliasesAndReasoningRemainProducerValues() throws {
        let value = try ModelControlsWire.parse(controlsPayload(model: "resolved"), backend: .claudeCode, scope: .session("owned"), unencrypted: true)
        #expect(value.models.map(\.id) == ["alias", "second"])
        #expect(value.models.map(\.sortOrder) == [0, 1])
        #expect(value.models[0].selected); #expect(value.models[0].resolvedModel == "resolved")
        #expect(value.thinking == nil); #expect(value.permissions == nil); #expect(value.fastMode == nil)
        let codex = try ModelControlsWire.parse(controlsPayload(), backend: .codex, scope: .session("owned"), unencrypted: false)
        #expect(codex.thinking?.levels == ["low", "medium", "high"])
        #expect(codex.permissions?.unencryptedTransport == false)
        #expect(codex.permissions?.mode == .known(.workspace))
    }

    @Test(arguments: ["custom", "", "unknown"])
    func effectivePermissionsNeverDefaultToWorkspace(_ mode: String) throws {
        let payload = controlsPayload(mode: .string(mode))
        if mode == "unknown" {
            #expect(throws: RuntimeFailure.self) { try ModelControlsWire.parse(payload, backend: .codex, scope: .session("owned"), unencrypted: true) }
        } else {
            let value = try ModelControlsWire.parse(payload, backend: .codex, scope: .session("owned"), unencrypted: true)
            #expect(value.permissions?.mode == (mode == "custom" ? .custom : nil))
            #expect(value.permissions?.unencryptedTransport == true)
        }
    }

    @Test func availableModesAbsentAndExplicitEmptyHaveDifferentMeaning() throws {
        var payload = controlsPayload().object!, permissions = payload["permissions"]!.object!
        permissions.removeValue(forKey: "availableModes"); payload["permissions"] = .object(permissions)
        let legacy = try ModelControlsWire.parse(.object(payload), backend: .codex, scope: .session("owned"), unencrypted: false)
        #expect(legacy.permissions?.availableModes == RuntimeSessionPermissionMode.allCases)
        permissions["availableModes"] = .array([]); payload["permissions"] = .object(permissions)
        let empty = try ModelControlsWire.parse(.object(payload), backend: .codex, scope: .session("owned"), unencrypted: false)
        #expect(empty.permissions?.availableModes == [])
    }

    @Test func sessionThinkingOverridesModelAndLegacyFallbackIsACommandChoice() throws {
        var payload = controlsPayload().object!
        payload["thinkingLevels"] = .array([.string("high"), .string("low")])
        let explicit = try ModelControlsWire.parse(.object(payload), backend: .codex, scope: .session("owned"), unencrypted: false)
        #expect(explicit.thinking?.levels == ["high", "low"])
        let row: JSONValue = .object(["thinkingOptions": .array([.object(["id": .string(" HIGH ")]), .string("low")]), "thinkingLevel": .string("HIGH")])
        #expect(ModelControlsWire.openClawThinking(row).levels == ["low", "high"])
        #expect(ModelControlsWire.openClawThinking(row).current == "high")
        #expect(ModelControlsWire.hasOpenClawThinking(row))
        #expect(!ModelControlsWire.hasOpenClawThinking(.object([:])))
        #expect(ModelControlsWire.openClawThinking(.object([:])).levels.last == "adaptive")
    }

    @Test(arguments: ["duplicate", "oversize", "type", "confirmation", "mode-list"])
    func malformedMetadataFailsClosed(_ corruption: String) throws {
        var payload = controlsPayload().object!
        switch corruption {
        case "duplicate": payload["models"] = .array([payload["models"]!.array![0], payload["models"]!.array![0]])
        case "oversize": payload["models"] = .array([.object(["id": .string(String(repeating: "x", count: 1_025))])])
        case "type": payload["models"] = .object([:])
        default:
            var permissions = payload["permissions"]!.object!
            if corruption == "confirmation" { permissions["requiresConfirmation"] = .string("false") }
            else { permissions["availableModes"] = .array([.string("workspace"), .string("workspace")]) }
            payload["permissions"] = .object(permissions)
        }
        #expect(throws: RuntimeFailure.self) { try ModelControlsWire.parse(.object(payload), backend: .codex, scope: .session("owned"), unencrypted: false) }
    }

    @Test func oldCodableCachesDecodeWithoutNewOptionalMetadata() throws {
        let raw = Data(#"{"id":"alias","name":"Alias","selected":true}"#.utf8)
        let model = try JSONDecoder().decode(RuntimeModel.self, from: raw)
        #expect(model.reasoningLevels == nil); #expect(model.resolvedModel == nil)
        let history = RuntimeHistory(key: "owned", messages: [], nextCursor: nil, hasMore: nil, pagination: .cursor, hasActiveRun: false, activeRun: nil)
        var document = try JSONSerialization.jsonObject(with: JSONEncoder().encode(history)) as! [String: Any]
        document.removeValue(forKey: "thinkingLevel")
        #expect(try JSONDecoder().decode(RuntimeHistory.self, from: JSONSerialization.data(withJSONObject: document)).thinkingLevel == nil)
    }

    @Test func aLaterMissingCapabilityCannotEraseAnExistingPermissionBarrier() throws {
        var state = ModelControlsState()
        let key = ModelControlKey(connectionID: "saved", scope: .session("owned"))
        try state.requirePermissions(key)
        _ = try state.begin(key: key, nativeBarrier: false)
        #expect(state.holds[key]?.nativeBarrier == true)
        #expect(state.holds[key]?.permissionsRequired == true)
    }
}
