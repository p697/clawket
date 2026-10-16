import ClawketTransport
import Foundation
import Testing
@testable import ClawketRuntime

@Suite(.serialized)
struct RuntimeLiveBufferTests {
    private func ready(_ runtime: RuntimeCoordinator) async throws -> AsyncThrowingStream<RuntimeEvent, any Error>.Iterator {
        var reader = runtime.events.makeAsyncIterator()
        while let event = try await reader.next() {
            if case let .state(state) = event, state.phase == .ready { return reader }
        }
        throw RuntimeFailure(.notConnected)
    }

    @Test func realHermesMapperDoesNotInsertPerTokenBarriersAndRetainsWholeSingleSegmentFinal() async throws {
        let socket = ScriptSocket { request, socket in try await socket.reply(request, payload: health(.hermes)) }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        try await runtime.activate(connection(.hermes))
        var reader = try await ready(runtime)
        let scope = try await runtime.scope()
        func chat(_ text: String, state: String = "delta") -> JSONValue {
            event("chat", .object(["runId": .string("fixture-hermes"), "sessionKey": .string("main"),
                "state": .string(state), "message": .object(["role": .string("assistant"), "content": .string(text)])]))
        }
        let pieces = ["NO", "RMAL", " \r\n", "e", "\u{301}", "👩", "\u{200D}", "💻"]
        for index in 0..<1_024 {
            await runtime.receive(.backendFrame(scope.generation, chat(pieces[index % pieces.count])), epoch: scope.epoch, attempt: scope.attempt)
        }
        #expect(await runtime.state.phase == .ready)
        try await runtime.abort(sessionKey: "main", runID: "fixture-hermes")
        #expect(await socket.requests("chat.abort").count == 1)
        let full = (0..<1_024).map { pieces[$0 % pieces.count] }.joined() + " — corrected final"
        await runtime.receive(.backendFrame(scope.generation, chat(full, state: "final")), epoch: scope.epoch, attempt: scope.attempt)
        guard case let .update(_, .text(delta)) = try await reader.next(),
              case let .update(_, .text(snapshot)) = try await reader.next(),
              case .update(_, .runFinished) = try await reader.next() else {
            Issue.record("Unexpected per-token event/barrier or lost terminal"); await runtime.disconnect(); return
        }
        #expect(delta.mode == .delta && snapshot.mode == .snapshot)
        #expect(Data(delta.text.utf8) == Data((0..<1_024).map { pieces[$0 % pieces.count] }.joined().utf8))
        #expect(Data(snapshot.text.utf8) == Data(full.utf8))
        #expect(delta.segmentID == snapshot.segmentID && delta.snapshotMetadata == nil)
        #expect(await socket.requests("chat.send").isEmpty)
        await runtime.disconnect()
    }

    @Test func slowPublicConsumerKeepsMappedDeltasBarriersAndAllowsStopWithoutReplayingSend() async throws {
        let socket = ScriptSocket { request, socket in
            let payload: JSONValue = switch request["method"]?.stringValue {
            case "connect": health(.pi)
            case "chat.send": .object(["runId": .string("fixture-run")])
            default: .object(["ok": .bool(true)])
            }
            try await socket.reply(request, payload: payload)
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        try await runtime.activate(connection(.pi))
        var reader = try await ready(runtime)
        _ = try await runtime.send(sessionKey: "main", input: .init(text: "Synthetic", idempotencyKey: "one-send"))
        let scope = try await runtime.scope()
        func chunk(_ text: String, mode: String = "delta") -> JSONValue {
            event("pi.update", .object(["type": .string("agent_message_chunk"), "runId": .string("fixture-run"),
                "sessionKey": .string("main"), "textMode": .string(mode), "text": .string(text)]))
        }
        let fragments = ["前", " \r\n", "e", "\u{301}", "👩", "\u{200D}", "💻", "\t"]
        // Pause the real public consumer while the actual mapper receives far
        // more than 64 small fragments. No replacement accumulator is involved.
        for index in 0..<1_024 {
            await runtime.receive(.backendFrame(scope.generation, chunk(fragments[index % fragments.count])),
                                  epoch: scope.epoch, attempt: scope.attempt)
        }
        #expect(await runtime.state.phase == .ready)
        try await runtime.abort(sessionKey: "main", runID: "fixture-run")
        #expect(await socket.requests("chat.abort").count == 1)
        #expect(await socket.requests("chat.send").count == 1)
        let tool = event("agent", .object(["runId": .string("fixture-run"), "sessionKey": .string("main"),
            "stream": .string("tool"), "data": .object(["phase": .string("start"), "toolCallId": .string("tool-one"), "name": .string("synthetic")])]))
        await runtime.receive(.backendFrame(scope.generation, tool), epoch: scope.epoch, attempt: scope.attempt)
        await runtime.receive(.backendFrame(scope.generation, chunk("After")), epoch: scope.epoch, attempt: scope.attempt)
        await runtime.receive(.backendFrame(scope.generation, chunk("Corrected", mode: "snapshot")), epoch: scope.epoch, attempt: scope.attempt)
        let final = event("pi.update", .object(["type": .string("run_finished"), "runId": .string("fixture-run"),
            "sessionKey": .string("main"), "stopReason": .string("end_turn")]))
        await runtime.receive(.backendFrame(scope.generation, final), epoch: scope.epoch, attempt: scope.attempt)
        var texts: [RuntimeTextUpdate] = [], toolSeen = false, ended = false
        while let event = try await reader.next() {
            guard case let .update(_, update) = event else { continue }
            switch update {
            case .text(let text):
                if texts.isEmpty { #expect(!toolSeen) } else { #expect(toolSeen) }
                texts.append(text)
            case .tool: toolSeen = true
            case .runFinished: ended = true
            default: break
            }
            if ended { break }
        }
        #expect(texts.count == 3)
        #expect(Data(try #require(texts.first).text.utf8) == Data((0..<1_024).map { fragments[$0 % fragments.count] }.joined().utf8))
        if texts.count == 3 {
            #expect(texts[0].mode == .delta && texts[1].mode == .delta && texts[2].mode == .snapshot)
            #expect(texts[0].segmentID != texts[1].segmentID && texts[1].segmentID == texts[2].segmentID)
            #expect(texts[1].text == "After" && texts[2].text == "Corrected")
        }
        #expect(toolSeen && ended)
        #expect(await socket.requests("chat.send").count == 1)
        await runtime.disconnect()
    }

    @Test func realOverflowRetiresPendingWriteAndNeverReplaysOrReactivatesTheClosedStream() async throws {
        let socket = ScriptSocket { request, socket in
            if request["method"]?.stringValue == "connect" { try await socket.reply(request, payload: health(.pi)) }
        }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        try await runtime.activate(connection(.pi))
        var reader = try await ready(runtime)
        let send = Task { try await runtime.send(sessionKey: "main", input: .init(text: "Synthetic", idempotencyKey: "one-send")) }
        try await eventually { await socket.requests("chat.send").count == 1 }
        for index in 0..<65 {
            await runtime.emit(.update(connectionID: "connection-a", .other(.number(Double(index)))))
        }
        do { _ = try await send.value; Issue.record("Pending write survived retirement") }
        catch let failure as RuntimeFailure { #expect(failure.delivery == .uncertain && failure.code == .superseded) }
        try await eventually { await socket.closed }
        for index in 0..<64 {
            #expect(try await reader.next() == .update(connectionID: "connection-a", .other(.number(Double(index)))))
        }
        await #expect(throws: RuntimeFailure(.capacity)) { try await reader.next() }
        await #expect(throws: RuntimeFailure(.capacity)) { try await runtime.activate(connection(.pi)) }
        #expect(await socket.requests("chat.send").count == 1)
        #expect(await runtime.state.phase == .idle)
    }

    @Test func cancellingThePublicConsumerRetiresItsSocketAndLateEventsOnlyOnce() async throws {
        let socket = ScriptSocket { request, socket in try await socket.reply(request, payload: health(.pi)) }
        let runtime = try RuntimeCoordinator(credentials: Credentials(), socketFactory: ScriptFactory(socket))
        try await runtime.activate(connection(.pi))
        let reader = Task {
            do { for try await _ in runtime.events { try Task.checkCancellation() } }
            catch is CancellationError { }
        }
        await Task.yield(); reader.cancel(); try await reader.value
        try await eventually { await socket.closed }
        let epoch = await runtime.epoch
        for _ in 0..<10 { await runtime.emit(.state(.init(phase: .ready))) }
        #expect(await runtime.epoch == epoch)
        #expect(await runtime.state.phase == .idle)
        await #expect(throws: RuntimeFailure(.capacity)) { try await runtime.activate(connection(.pi)) }
    }

    @Test func retainedPublicStreamDoesNotRetainTheCoordinatorAndFinishesOnOwnerDeinit() async throws {
        var runtime: RuntimeCoordinator? = try RuntimeCoordinator(credentials: Credentials())
        weak var weakRuntime = runtime
        let stream = try #require(runtime).events
        let reader = Task {
            var iterator = stream.makeAsyncIterator()
            return try await iterator.next()
        }
        runtime = nil
        #expect(weakRuntime == nil)
        #expect(try await reader.value == nil)
    }
}
