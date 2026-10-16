import ClawketTransport
import Foundation
import Testing
@testable import ClawketRuntime

private final class Terminations: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    func record() { lock.lock(); count += 1; lock.unlock() }
    var value: Int { lock.lock(); defer { lock.unlock() }; return count }
}

@Suite(.serialized)
struct RuntimeEventBufferTests {
    private let context = RuntimeEventBuffer.Context(epoch: UUID(), attempt: UUID(), authentication: UUID(), generation: nil)
    private func delta(_ text: String, connection: String = "connection", session: String = "session", run: String = "run",
                       segment: String = "segment", turn: String? = "turn", inputID: String? = "input",
                       inputKey: String? = "key", mode: RuntimeTextUpdate.Mode = .delta,
                       metadata: RuntimeFinalMessageMetadata? = nil) -> RuntimeEvent {
        .update(connectionID: connection, .text(.init(sessionKey: session, runID: run, segmentID: segment, text: text,
            mode: mode, turnID: turn, inputMessageID: inputID, inputMessageKey: inputKey, snapshotMetadata: metadata)))
    }
    private func body(_ event: RuntimeEvent?) throws -> RuntimeTextUpdate {
        guard case let .update(_, .text(update)) = try #require(event) else { throw RuntimeFailure(.invalidResponse) }
        return update
    }

    @Test func pausedConsumerReceivesAllFragmentsWithoutChangingBytesOrIdentity() async throws {
        let buffer = RuntimeEventBuffer()
        let chunks = ["NO", "RMAL", " \r\n", "e", "\u{301}", "👩", "\u{200D}", "💻", "\t", "中"]
        for _ in 0..<100 {
            for chunk in chunks { #expect(buffer.offer(delta(chunk), weight: 128, context: context) == .accepted) }
        }
        buffer.finish()
        let update = try body(await buffer.next())
        #expect(Data(update.text.utf8) == Data(Array(repeating: chunks.joined(), count: 100).joined().utf8))
        #expect(update.mode == .delta && update.snapshotMetadata == nil)
        #expect(update.runID == "run" && update.segmentID == "segment" && update.inputMessageKey == "key")
        #expect(try await buffer.next() == nil)
    }

    @Test func everyNonDeltaEventIsAnOrderedBarrier() async throws {
        let buffer = RuntimeEventBuffer()
        let barriers: [RuntimeEvent] = [
            .state(.init(phase: .reconnecting)), .failure(connectionID: "connection", .init(.network)),
            .update(connectionID: "connection", .runStarted(sessionKey: "session", runID: "run")),
            .update(connectionID: "connection", .tool(sessionKey: "session", runID: "run", payload: .object([:]))),
            .update(connectionID: "connection", .thought(sessionKey: "session", runID: "run", text: "thought")),
            .update(connectionID: "connection", .other(.object([:]))),
            delta("snapshot", mode: .snapshot),
            .update(connectionID: "connection", .runFinished(sessionKey: "session", runID: "run", reason: "end_turn", segmentID: "segment", raw: .null))
        ]
        for (index, barrier) in barriers.enumerated() {
            #expect(buffer.offer(delta("before-\(index)"), weight: 128, context: context) == .accepted)
            #expect(buffer.offer(barrier, weight: 128, context: context) == .accepted)
            #expect(buffer.offer(delta("after-\(index)", segment: "next-\(index)"), weight: 128, context: context) == .accepted)
        }
        buffer.finish()
        for (index, barrier) in barriers.enumerated() {
            #expect(try body(await buffer.next()).text == "before-\(index)")
            #expect(try await buffer.next() == barrier)
            #expect(try body(await buffer.next()).text == "after-\(index)")
        }
        #expect(try await buffer.next() == nil)
    }

    @Test func byteDistinctAndOptionalLineageNeverMerge() async throws {
        func scoped(_ text: String, different field: Int? = nil, absent: Int? = nil,
                    metadata: RuntimeFinalMessageMetadata? = nil) -> RuntimeEvent {
            func value(_ index: Int) -> String { field == index ? "e\u{301}" : "é" }
            return delta(text, connection: value(0), session: value(1), run: value(2), segment: value(3),
                turn: absent == 4 ? nil : value(4), inputID: absent == 5 ? nil : value(5),
                inputKey: absent == 6 ? nil : value(6), metadata: metadata)
        }
        let variants = (0..<7).map { scoped("second", different: $0) }
            + (4..<7).map { scoped("second", absent: $0) }
            + [scoped("second", metadata: .init(role: .assistant, providedID: "source"))]
        for value in variants {
            let buffer = RuntimeEventBuffer()
            let first = scoped("first")
            #expect(buffer.offer(first, weight: 128, context: context) == .accepted)
            #expect(buffer.offer(value, weight: 128, context: context) == .accepted)
            buffer.finish()
            #expect(try await buffer.next() == first)
            #expect(try await buffer.next() == value)
            #expect(try await buffer.next() == nil)
        }
    }

    @Test func anyInternalRevisionChangeSeparatesOtherwiseIdenticalFragments() async throws {
        let revisions = [
            RuntimeEventBuffer.Context(epoch: UUID(), attempt: context.attempt, authentication: context.authentication, generation: nil),
            RuntimeEventBuffer.Context(epoch: context.epoch, attempt: UUID(), authentication: context.authentication, generation: nil),
            RuntimeEventBuffer.Context(epoch: context.epoch, attempt: context.attempt, authentication: UUID(), generation: nil),
            RuntimeEventBuffer.Context(epoch: context.epoch, attempt: context.attempt, authentication: context.authentication, generation: .init())
        ]
        for revision in revisions {
            let buffer = RuntimeEventBuffer()
            #expect(buffer.offer(delta("one"), weight: 128, context: context) == .accepted)
            #expect(buffer.offer(delta("two"), weight: 128, context: revision) == .accepted)
            buffer.finish()
            #expect(try body(await buffer.next()).text == "one")
            #expect(try body(await buffer.next()).text == "two")
            #expect(try await buffer.next() == nil)
        }
    }

    @Test func sixtyFifthNonmergeableEventFailsAfterDrainingTheAcceptedPrefix() async throws {
        let buffer = RuntimeEventBuffer(), ended = Terminations()
        buffer.onTermination { ended.record() }
        for index in 0..<64 {
            #expect(buffer.offer(delta("\(index)", segment: "segment-\(index)"), weight: 128, context: context) == .accepted)
        }
        #expect(buffer.offer(delta("not admitted", segment: "another"), weight: 128, context: context) == .overflow)
        #expect(ended.value == 1)
        buffer.finish()
        #expect(buffer.offer(delta("late"), weight: 128, context: context) == .terminated)
        for index in 0..<64 { #expect(try body(await buffer.next()).text == "\(index)") }
        await #expect(throws: RuntimeFailure(.capacity)) { try await buffer.next() }
        #expect(ended.value == 1)
    }

    @Test func mergedFragmentsKeepTheirOriginalWeightAndConsumptionReleasesIt() async throws {
        let full = RuntimeEventBuffer.maximumBytes
        let buffer = RuntimeEventBuffer()
        #expect(buffer.offer(delta("one"), weight: full / 2, context: context) == .accepted)
        #expect(buffer.offer(delta("two"), weight: full / 2, context: context) == .accepted)
        #expect(try body(await buffer.next()).text == "onetwo")
        #expect(buffer.offer(delta("new"), weight: full, context: context) == .accepted)
        #expect(buffer.offer(delta("overflow"), weight: 1, context: context) == .overflow)
        #expect(try body(await buffer.next()).text == "new")
        await #expect(throws: RuntimeFailure(.capacity)) { try await buffer.next() }
    }

    @Test(arguments: [-1, RuntimeEventBuffer.maximumBytes + 1])
    func invalidOrOversizedWeightFailsWithoutAdmittingTheBody(_ weight: Int) async throws {
        let buffer = RuntimeEventBuffer(), ended = Terminations()
        buffer.onTermination { ended.record() }
        #expect(buffer.offer(delta("not admitted"), weight: weight, context: context) == .overflow)
        await #expect(throws: RuntimeFailure(.capacity)) { try await buffer.next() }
        buffer.finish(); #expect(ended.value == 1)
    }

    @Test func cancellationBeforeOrDuringPullTerminatesAndNotifiesOnlyOnce() async throws {
        for iteration in 0..<100 {
            let buffer = RuntimeEventBuffer(), ended = Terminations()
            buffer.onTermination { ended.record() }
            let task = Task { try await buffer.next() }
            if iteration.isMultiple(of: 2) { await Task.yield() }
            task.cancel()
            do { _ = try await task.value; Issue.record("Cancelled consumer returned normally") }
            catch is CancellationError { }
            buffer.finish(); task.cancel()
            #expect(ended.value == 1)
            #expect(buffer.offer(delta("late"), weight: 128, context: context) == .terminated)
        }
    }

    @Test func normalFinishWakesAPullAndRejectsLateAdmission() async throws {
        let buffer = RuntimeEventBuffer(), ended = Terminations()
        buffer.onTermination { ended.record() }
        let task = Task { try await buffer.next() }
        await Task.yield(); buffer.finish(); buffer.finish(throwing: RuntimeFailure(.capacity))
        #expect(try await task.value == nil)
        #expect(buffer.offer(delta("late"), weight: 128, context: context) == .terminated)
        #expect(ended.value == 1)
    }
}
