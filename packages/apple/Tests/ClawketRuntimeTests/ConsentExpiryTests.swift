import Foundation
import Testing
import ClawketTransport
@testable import ClawketRuntime

@Suite(.serialized)
struct ConsentExpiryTests {
    @Test func finiteMillisecondsFloorConservativelyAndAbsentExpiryStaysAbsent() throws {
        // Hermes run-control forwards finite expires_at_ms, including fractions.
        for (time, expected) in [(0.0, Int64(0)), (0.999, 0), (1_000.75, 1_000),
                                 (1_792_080_000_000.75, 1_792_080_000_000),
                                 (9_007_199_254_740_991.0, 9_007_199_254_740_991)] {
            guard let parsed = try ConsentWire.expiry(.number(time)) else { Issue.record("Missing numeric deadline"); continue }
            #expect(parsed == expected); #expect(Double(parsed) <= time)
        }
        #expect(try ConsentWire.expiry(nil) == nil); #expect(try ConsentWire.expiry(.null) == nil)
        var raw = execution().object!
        raw["expiresAtMs"] = .number(1_792_080_000_000.75); raw["receivedAtMs"] = .number(1_792_079_999_999.75)
        let (_, parsed) = try ConsentWire.approval(.object(raw), sessionKey: "s", connection: connection(.hermes))
        guard case .approval(let value) = parsed else { Issue.record("Missing fractional approval"); return }
        #expect(value.expiresAtMs == 1_792_080_000_000); #expect(value.receivedAtMs == 1_792_079_999_999)
        #expect(value.raw["expiresAtMs"] == raw["expiresAtMs"])
    }

    @Test func negativeNonfiniteUnsafeAndNonnumericDeadlinesRemainInvalid() {
        let values: [JSONValue] = [.number(-0.001), .number(-1), .number(.nan), .number(.infinity), .number(-.infinity),
            .number(9_007_199_254_740_992), .string("1000.75"), .bool(true), .object([:]), .array([])]
        for value in values {
            #expect(throws: RuntimeFailure(.invalidResponse)) { try ConsentWire.expiry(value) }
        }
    }

    @Test func fractionalHermesRequestRemainsConnectedThenExpiresWithoutDispatch() async throws {
        let clock = TestClock(), now = Int64(Date().timeIntervalSince1970 * 1_000)
        let socket = ScriptSocket { request, socket in
            try await socket.reply(request, payload: request["method"]?.stringValue == "connect" ? health(.hermes) : .object(["ok": .bool(true)]))
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket), clock: clock)
        let reader = read(runtime, into: Events()); defer { reader.cancel() }
        try await runtime.activate(connection(.hermes))
        try await socket.emit(event("exec.approval.requested", .object(["id": .string("fractional"),
            "expiresAtMs": .number(Double(now + 300_000) + 0.75),
            "request": .object(["command": .string("git status"), "sessionKey": .string("s"),
                "decisions": .array([.string("allow-once"), .string("deny")])])])))
        try await eventually { (try? await runtime.pendingRequests().approvals.count) == 1 }
        let approval = try await runtime.pendingRequests().approvals[0]
        #expect(approval.expiresAtMs == now + 300_000); #expect(await runtime.state.phase == .ready)
        await runtime.setForeground(false)
        clock.advance(.seconds(301))
        #expect(try await runtime.pendingRequests().approvals.isEmpty)
        do { try await runtime.resolve(approval.reference, decision: .allowOnce); Issue.record("Expired fractional request dispatched") }
        catch let failure as RuntimeFailure { #expect(failure.code == .requestUnavailable) }
        #expect(await socket.requests("exec.approval.resolve").isEmpty)
        await runtime.disconnect()
    }
}
