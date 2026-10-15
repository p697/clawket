import Foundation
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

// Sanitized shapes from codex/service.ts:modelSelection, pi/service.ts:models,
// claude-code/service.ts:models and Hermes model.get/model.set. No live service required.
func controlsPayload(model: String = "alias", confirmation: JSONValue? = .bool(false), mode: JSONValue = .string("workspace")) -> JSONValue {
    var permissions: [String: JSONValue] = ["scope": .string("session"), "mode": mode,
        "available": .bool(true), "availableModes": .array(["workspace", "read-only", "full-access"].map(JSONValue.string))]
    permissions["requiresConfirmation"] = confirmation
    return .object(["ok": .bool(true), "scope": .string("session"), "currentModel": .string(model), "currentProvider": .string("provider"),
        "thinkingLevel": .string("medium"), "permissions": .object(permissions),
        "fastMode": .object(["enabled": .bool(false), "available": .bool(true)]),
        "models": .array([.object(["id": .string("alias"), "name": .string("Native alias"), "provider": .string("provider"),
            "resolvedModel": .string("resolved"), "input": .array([.string("text"), .string("image")]),
            "reasoningLevels": .array([.string("low"), .string("medium"), .string("high")])]),
            .object(["id": .string("second"), "name": .string("Second"), "provider": .string("provider")])])])
}

actor ModelControlsPeer {
    let backend: BackendKind
    var value = controlsPayload()
    var healthPayload: JSONValue
    var rows: [JSONValue]
    var methods: [String]? = ["models.list", "sessions.patch", "config.get", "config.patch"]
    var hash = "configuration-one"
    var held: Set<String> = []
    var rejectMethods: Set<String> = []
    var ackOnly = false
    var historyThinking = "high"
    init(_ backend: BackendKind) {
        self.backend = backend; rows = [lifecycleRow(backend)]
        var metadata = health(backend).object!
        if backend == .codex { metadata["fastMode"] = .bool(true); metadata["sessionPermissions"] = .bool(true) }
        healthPayload = .object(metadata)
    }
    func setValue(_ value: JSONValue) { self.value = value }
    func setHealth(_ value: JSONValue) { healthPayload = value }
    func setRows(_ rows: [JSONValue]) { self.rows = rows }
    func setMethods(_ methods: [String]?) { self.methods = methods }
    func setHistoryThinking(_ level: String) { historyThinking = level }
    func setHash(_ hash: String) { self.hash = hash }
    func hold(_ method: String) { held.insert(method) }
    func release(_ method: String) { held.remove(method) }
    func reject(_ method: String) { rejectMethods.insert(method) }
    func setAckOnly() { ackOnly = true }
    func handle(_ request: JSONValue, socket: ScriptSocket) async throws {
        let method = request["method"]?.stringValue ?? ""
        if held.contains(method) { return }
        if rejectMethods.contains(method) { try await socket.reject(request, code: "UNKNOWN_METHOD"); return }
        let result: JSONValue
        switch method {
        case "connect":
            var hello: [String: JSONValue] = ["server": .object(["version": .string("fixture")])]
            if let methods { hello["features"] = .object(["methods": .array(methods.map(JSONValue.string))]) }
            result = backend == .openclaw ? .object(hello) : healthPayload
        case "health": result = healthPayload
        case "agents.list": result = backend == .openclaw
            ? .object(["agents": .array([.object(["id": .string(backend.rawValue)])])])
            : .array([.object(["agentId": .string(backend.rawValue), "entryMode": .string("sessions"), "mainSessionKey": .string("")])])
        case "sessions.list": result = [.openclaw, .hermes].contains(backend) ? .object(["sessions": .array(rows)]) : .array(rows)
        case "models.list", "model.get", "model.current":
            var object = value.object!
            if [.hermes, .localModel].contains(backend) { object["scope"] = .string("global") }
            result = .object(object)
        case "config.get": result = .object(["hash": .string(hash), "config": .object(["agents": .object(["defaults": .object(["model": .string("provider/alias")])])])])
        case "models.select", "models.thinking", "models.fast", "models.permissions", "model.set":
            if ackOnly { result = .object(["ok": .bool(true)]) }
            else {
                var object = value.object!
                if method == "models.select" || method == "model.set" { object["currentModel"] = request["params"]?["model"] }
                if method == "models.thinking" { object["thinkingLevel"] = request["params"]?["level"] }
                if method == "models.fast" { object["fastMode"] = .object(["enabled": (request["params"]?["enabled"])!, "available": .bool(true)]) }
                if method == "models.permissions" {
                    var permissions = object["permissions"]!.object!
                    permissions["mode"] = request["params"]?["mode"]; permissions["requiresConfirmation"] = .bool(false)
                    object["permissions"] = .object(permissions)
                }
                if [.hermes, .localModel].contains(backend) { object["scope"] = .string("global") }
                value = .object(object); result = value
            }
        case "chat.history": result = .object(["messages": .array([]), "thinkingLevel": .string(historyThinking)])
        case "chat.send": result = .object(["runId": .string("fixture-run")])
        default: result = .object(["ok": .bool(true)])
        }
        try await socket.reply(request, payload: result)
    }
}

func controlsFixture(_ backend: BackendKind, peer: ModelControlsPeer? = nil, clock: any TransportClock = MonotonicTransportClock()) throws
    -> (RuntimeCoordinator, ScriptSocket, ModelControlsPeer, Task<Void, Never>) {
    let peer = peer ?? ModelControlsPeer(backend)
    let socket = ScriptSocket(initial: backend == .openclaw ? [challengeFrame] : []) { request, socket in try await peer.handle(request, socket: socket) }
    let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket), clock: clock)
    return (runtime, socket, peer, read(runtime, into: Events()))
}
