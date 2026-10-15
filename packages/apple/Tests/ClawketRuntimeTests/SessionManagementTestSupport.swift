import Foundation
import ClawketPairing
import ClawketTransport
@testable import ClawketRuntime

// Sanitized descriptor shapes from current codex/service.ts:descriptor,
// claude-code/service.ts:descriptor and pi/service.ts:descriptor/listSessions.
func lifecycleRow(_ backend: BackendKind, key: String = "owned", source: String? = "bridge",
                  active: Bool = false, native: Bool = false, archived: Bool = false) -> JSONValue {
    let agent = backend == .hermes ? "hermes" : backend.rawValue
    var row: [String: JSONValue] = ["key": .string(key), "agentId": .string(agent), "title": .string("Original"),
        "kind": .string("direct"), "updatedAt": .number(1_700_000_000_000), "hasActiveRun": .bool(active),
        "sessionId": .string("physical-" + key), "archived": .bool(archived),
        "allowedActions": .object(["rename": .bool(!native || backend == .codex), "reset": .bool(!native),
            "delete": .bool(!native), "pin": .bool(!archived), "archive": .bool(backend == .codex)])]
    if let source { row["source"] = .string(source) }
    if native { row["canContinue"] = .bool(false) }
    return .object(row)
}

actor LifecyclePeer {
    let backend: BackendKind
    var rows: [JSONValue]
    var archives: [JSONValue] = []
    var healthPayload: JSONValue
    var methods = ["sessions.patch", "sessions.reset", "sessions.delete"]
    var held: Set<String> = []
    var malformed: Set<String> = []
    init(_ backend: BackendKind, rows: [JSONValue]? = nil) {
        self.backend = backend; self.rows = rows ?? [lifecycleRow(backend)]
        healthPayload = health(backend)
    }
    func setHealth(_ value: JSONValue) { healthPayload = value }
    func setRows(_ values: [JSONValue]) { rows = values }
    func setArchives(_ values: [JSONValue]) { archives = values }
    func setMethods(_ values: [String]) { methods = values }
    func hold(_ method: String) { held.insert(method) }
    func corrupt(_ method: String) { malformed.insert(method) }
    func handle(_ request: JSONValue, socket: ScriptSocket) async throws {
        let method = request["method"]?.stringValue ?? ""
        if held.contains(method) { return }
        if malformed.contains(method) { try await socket.reply(request, payload: .object(["ok": .string("true")])); return }
        let payload: JSONValue
        switch method {
        case "connect": payload = backend == .openclaw ? .object(["server": .object(["version": .string("fixture")]),
            "features": .object(["methods": .array(methods.map(JSONValue.string))])]) : healthPayload
        case "health": payload = healthPayload
        case "agents.list": payload = backend == .openclaw ? .object(["agents": .array([.object(["id": .string(backend.rawValue)])])])
            : .array([.object(["agentId": .string(backend.rawValue), "mainSessionKey": .string(""), "entryMode": .string("sessions")])])
        case "sessions.list": payload = [.openclaw, .hermes].contains(backend) ? .object(["sessions": .array(rows)]) : .array(rows)
        case "sessions.archived": payload = .array(archives)
        case "sessions.create":
            var result = lifecycleRow(backend, key: "branched").object!
            if let title = request["params"]?["title"] { result["title"] = title }
            if let from = request["params"]?["fromSession"]?.stringValue,
               let project = rows.first(where: { $0["key"]?.stringValue == from })?["project"] { result["project"] = project }
            rows.append(.object(result)); payload = .object(result)
        default: payload = .object(["ok": .bool(true)])
        }
        try await socket.reply(request, payload: payload)
    }
}

func lifecycleFixture(_ backend: BackendKind, peer: LifecyclePeer? = nil, clock: any TransportClock = MonotonicTransportClock()) throws
    -> (RuntimeCoordinator, ScriptSocket, LifecyclePeer, Task<Void, Never>) {
    let peer = peer ?? LifecyclePeer(backend)
    let socket = ScriptSocket(initial: backend == .openclaw ? [challengeFrame] : []) { request, socket in
        try await peer.handle(request, socket: socket)
    }
    let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket), clock: clock)
    return (runtime, socket, peer, read(runtime, into: Events()))
}
