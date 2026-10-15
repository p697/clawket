import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct ModelControlsPolicyTests {
    @Test(arguments: BackendKind.allCases)
    func sixBackendReadsPreserveScopeAndActualThinkingPaths(_ backend: BackendKind) async throws {
        let (runtime, socket, _, reader) = try controlsFixture(backend)
        try await runtime.activate(connection(backend))
        let key = backend == .localModel ? "main" : "owned"
        let value = try await runtime.modelControls(sessionKey: key)
        #expect(value.sessionKey == key)
        #expect(value.scope == ([.hermes, .localModel].contains(backend) ? .global : .session(key)))
        #expect(value.allowedActions.contains(.selectModel)); #expect(value.canSend)
        #expect((value.fastMode != nil) == (backend == .codex)); #expect((value.permissions != nil) == (backend == .codex))
        if [.openclaw, .hermes, .pi].contains(backend) {
            #expect(value.thinking?.writePath == .command)
            let plan = try await runtime.prepareThinkingCommand(reference: value.reference, level: "high")
            #expect(plan.connectionID == "connection-a"); #expect(plan.sessionKey == key)
            #expect(plan.text == "/think high"); #expect(plan.thinkingLevel == nil)
            #expect(await socket.requests("chat.send").isEmpty)
            #expect(await socket.requests("models.thinking").isEmpty)
        } else if backend == .codex { #expect(value.thinking?.writePath == .native) }
        else { #expect(value.thinking == nil) }
        let params = await socket.requests("models.list")[0]["params"]
        #expect(params?["sessionKey"]?.stringValue == ([.codex, .claudeCode, .pi].contains(backend) ? key : nil))
        if backend == .hermes { #expect(await socket.requests("model.get").count == 1) }
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: [false, true])
    func nativeControlsRequirePositiveHealthAndActualRowAvailability(_ advertised: Bool) async throws {
        let peer = ModelControlsPeer(.codex)
        await peer.setHealth(advertised ? .object(["backend": .string("codex"), "fastMode": .bool(true), "sessionPermissions": .bool(true)]) : health(.codex))
        var value = controlsPayload().object!
        if !advertised { value["permissions"] = .string("unnegotiated malformed data"); value["fastMode"] = .number(7) }
        else { value["fastMode"] = .object(["available": .bool(false), "enabled": .null]) }
        await peer.setValue(.object(value))
        let (runtime, _, _, reader) = try controlsFixture(.codex, peer: peer)
        try await runtime.activate(connection(.codex))
        let controls = try await runtime.modelControls(sessionKey: "owned")
        #expect(!controls.allowedActions.contains(.setFastMode))
        #expect(controls.allowedActions.contains(.setPermissions) == advertised)
        #expect((controls.permissions != nil) == advertised); #expect(controls.canSend)
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: [0, 1, 2])
    func openClawMethodAdvertisementDistinguishesAbsentEmptyAndSupported(_ advertisement: Int) async throws {
        let peer = ModelControlsPeer(.openclaw)
        await peer.setMethods(advertisement == 0 ? nil : advertisement == 1 ? [] : ["sessions.patch"])
        var row = lifecycleRow(.openclaw).object!
        row["thinkingOptions"] = .array([.string("off"), .string("high")])
        await peer.setRows([.object(row)])
        let (runtime, _, _, reader) = try controlsFixture(.openclaw, peer: peer)
        try await runtime.activate(connection(.openclaw))
        let value = try await runtime.modelControls(sessionKey: "owned")
        #expect(value.allowedActions.contains(.selectModel) == (advertisement != 1))
        #expect(value.allowedActions.contains(.setThinkingLevel) == (advertisement != 1))
        #expect(value.thinking?.levels == ["off", "high"])
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: [BackendKind.codex, .claudeCode, .pi])
    func catalogIsNotASyntheticMainAndReadonlyNativeCannotAcquireSettingsAuthority(_ backend: BackendKind) async throws {
        let peer = ModelControlsPeer(backend)
        await peer.setRows([lifecycleRow(backend, source: "native", native: true)])
        let (runtime, socket, _, reader) = try controlsFixture(backend, peer: peer)
        try await runtime.activate(connection(backend)); _ = try await runtime.refreshRoster()
        let catalog = try await runtime.modelControls()
        #expect(catalog.scope == .catalog); #expect(catalog.currentModel == nil); #expect(catalog.allowedActions.isEmpty)
        let native = try await runtime.modelControls(sessionKey: "owned")
        #expect(native.allowedActions.isEmpty)
        await #expect(throws: RuntimeFailure.self) { try await runtime.selectModel(id: "alias", provider: "provider", sessionKey: "owned") }
        #expect(await socket.requests("models.select").isEmpty)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func typedModelAliasUsesItsWriteIDAndLegacyWriteRetiresOpaqueReference() async throws {
        let (runtime, socket, _, reader) = try controlsFixture(.claudeCode)
        try await runtime.activate(connection(.claudeCode))
        let value = try await runtime.modelControls(sessionKey: "owned")
        let result = try await runtime.selectModel(reference: value.reference, modelID: "alias")
        #expect(result.state?.models.first?.id == "alias")
        #expect(await socket.requests("models.select")[0]["params"]?["model"]?.stringValue == "alias")
        #expect(await socket.requests("models.select")[0]["params"]?["provider"]?.stringValue == "provider")
        let fresh = try await runtime.modelControls(sessionKey: "owned")
        try await runtime.selectModel(id: "second", provider: "provider", sessionKey: "owned")
        await #expect(throws: RuntimeFailure.self) { try await runtime.selectModel(reference: fresh.reference, modelID: "alias") }
        #expect(await socket.requests("models.select").count == 2)
        await runtime.disconnect(); reader.cancel()
    }

    @Test func hermesGlobalSettingKeepsCallerRouteAndDoesNotInventFastControls() async throws {
        let (runtime, socket, _, reader) = try controlsFixture(.hermes)
        try await runtime.activate(connection(.hermes))
        let value = try await runtime.modelControls(sessionKey: "actual-conversation")
        let result = try await runtime.selectModel(reference: value.reference, modelID: "second", provider: "provider")
        #expect(result.sessionKey == "actual-conversation"); #expect(result.scope == .global)
        let params = await socket.requests("model.set")[0]["params"]
        #expect(params?["scope"]?.stringValue == "global"); #expect(params?["sessionKey"] == nil)
        #expect(!value.allowedActions.contains(.setFastMode)); #expect(!value.allowedActions.contains(.setPermissions))
        await runtime.disconnect(); reader.cancel()
    }

    @Test func freshGlobalConfigHashIsValidatedBeforeAnyWrite() async throws {
        let (runtime, socket, peer, reader) = try controlsFixture(.openclaw)
        try await runtime.activate(connection(.openclaw))
        let value = try await runtime.modelControls()
        await peer.setHash("replaced-configuration")
        do { _ = try await runtime.selectModel(reference: value.reference, modelID: "alias") ; Issue.record("Used stale config") }
        catch let failure as RuntimeFailure { #expect(failure.code == .requestUnavailable); #expect(failure.delivery == .notDispatched) }
        #expect(await socket.requests("config.patch").isEmpty)
        let fresh = try await runtime.modelControls()
        _ = try await runtime.selectModel(reference: fresh.reference, modelID: "alias")
        #expect(await socket.requests("config.patch")[0]["params"]?["baseHash"]?.stringValue == "replaced-configuration")
        await runtime.disconnect(); reader.cancel()
    }

    @Test func localModelSelectionRequiresFreshPostSelectionHealth() async throws {
        let (runtime, socket, _, reader) = try controlsFixture(.localModel)
        try await runtime.activate(connection(.localModel))
        let value = try await runtime.modelControls(sessionKey: "main")
        _ = try await runtime.selectModel(reference: value.reference, modelID: "second")
        let methods = await socket.methods()
        #expect(methods.lastIndex(of: "models.select")! < methods.lastIndex(of: "health")!)
        await runtime.disconnect(); reader.cancel()
    }
}
