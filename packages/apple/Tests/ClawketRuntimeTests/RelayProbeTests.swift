import Foundation
import Testing
@testable import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct RelayProbeTests {
    @Test(arguments: [BackendKind.openclaw, .hermes])
    func actualBackendProbeJoinsKnownLargeFrameProtection(_ backend: BackendKind) async throws {
        let clock = TestClock()
        let socket = probeSocket(backend)
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket), clock: clock)
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(backend, relay: true))
        let transport = try #require(await runtime.transport)
        let generation = try #require(await transport.generation)
        try await socket.emit(probeReady, control: true)
        try await eventually { await transport.current?.liveness.transferHintNegotiated == true }
        let probe = Task { try await runtime.probe() }
        let count = backend == .hermes ? 2 : 1
        try await eventually { await socket.requests("health").count == count }
        let request = await socket.requests("health")[count - 1]
        var payload = health(backend).object ?? [:]
        payload["padding"] = .string(String(repeating: "/", count: 200_000))
        let frame: JSONValue = .object(["type": .string("res"), "id": request["id"]!,
            "ok": .bool(true), "payload": .object(payload)])
        let bytes = try FrameCodec.encode(frame).utf8.count
        try await socket.emit(.object(["type": .string("control"), "event": .string("relay.transfer-start"),
            "payload": .object(["bytes": .number(Double(bytes))])]), control: true)
        try await eventually { await transport.transferGrace(generation: generation) > .zero }
        try await eventually { clock.pendingDelays.contains(.seconds(5)) }
        clock.advance(.seconds(6))
        #expect(await runtime.state.phase == .ready)
        #expect(await runtime.probeTask != nil)
        try await socket.emit(frame)
        #expect(try await probe.value)
        #expect(await runtime.state.phase == .ready)
        #expect(await socket.requests("health").count == count)
        await runtime.disconnect(); reader.cancel()
    }

    @Test(arguments: [BackendKind.openclaw, .hermes])
    func relayEchoDoesNotCompleteOrResetAnUnansweredBackendProbe(_ backend: BackendKind) async throws {
        let clock = TestClock(), socket = probeSocket(backend)
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket), clock: clock)
        let reader = read(runtime, into: Events())
        try await runtime.activate(connection(backend, relay: true))
        let transport = try #require(await runtime.transport)
        try await socket.emit(probeReady, control: true)
        try await eventually { clock.pendingDelays.contains(.seconds(5)) }
        clock.advance(.seconds(4))
        let probe = Task { try await runtime.probe() }
        let count = backend == .hermes ? 2 : 1
        try await eventually { await socket.requests("health").count == count }
        try await eventually { clock.pendingDelays.contains(.seconds(5)) }
        clock.advance(.seconds(1))
        try await eventually { await socket.sent.contains { $0["event"] == .string("relay.client-ping") } }
        try await eventually { await transport.current?.liveness.pendingProbe == nil }
        #expect(await runtime.probeTask != nil)
        clock.advance(.seconds(4))
        #expect(try await probe.value == false)
        #expect(await runtime.state.phase != .ready)
        #expect(await socket.requests("health").count == count)
        await runtime.disconnect(); reader.cancel()
    }
}

private let probeReady: JSONValue = .object(["type": .string("control"), "event": .string("relay.ready"),
    "payload": .object(["capabilities": .array([.string("relay.client-ping.v1"), .string("relay.transfer-hint.v1")])])])

private func probeSocket(_ backend: BackendKind) -> ScriptSocket {
    ScriptSocket(initial: backend == .openclaw ? [challengeFrame] : []) { request, socket in
        if request["event"] == .string("relay.client-ping") {
            try await socket.emit(.object(["type": .string("control"), "event": .string("relay.client-pong"),
                "payload": request["payload"] ?? .null]), control: true)
        } else if request["method"] == .string("connect") {
            try await socket.reply(request, payload: hello)
        } else if backend == .hermes, await socket.requests("health").count == 1 {
            try await socket.reply(request, payload: health(backend))
        }
    }
}
