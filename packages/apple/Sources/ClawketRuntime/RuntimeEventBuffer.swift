import Foundation
import ClawketTransport

/// One queue, pulled by the public stream's single consumer. The lock protects
/// short synchronous admission only; the coordinator never awaits that consumer.
final class RuntimeEventBuffer: @unchecked Sendable {
    static let maximumCount = 64
    static let maximumBytes = 16 * 1_024 * 1_024

    struct Context: Equatable, Sendable {
        let epoch: UUID
        let attempt: UUID
        let authentication: UUID
        let generation: ConnectionGeneration?
    }
    enum Admission: Equatable { case accepted, overflow, terminated }
    private enum End { case finished, failure(RuntimeFailure), cancelled }
    private struct Entry {
        let event: RuntimeEvent
        let context: Context
        var weight: Int
        var text: String?

        init(_ event: RuntimeEvent, context: Context, weight: Int) {
            self.context = context; self.weight = weight
            if case let .update(connection, .text(update)) = event,
               update.mode == .delta, update.snapshotMetadata == nil {
                // Keep an empty template, so appending does not copy the entire
                // accumulated String on every incoming fragment.
                self.event = .update(connectionID: connection, .text(Self.replacingText(update, with: "")))
                text = update.text
            } else { self.event = event }
        }

        func accepts(_ event: RuntimeEvent, context: Context) -> Bool {
            guard self.context == context, text != nil,
                  case let .update(leftConnection, .text(left)) = self.event,
                  case let .update(rightConnection, .text(right)) = event,
                  right.mode == .delta, right.snapshotMetadata == nil else { return false }
            return Self.same(leftConnection, rightConnection) && Self.same(left.sessionKey, right.sessionKey)
                && Self.same(left.runID, right.runID) && Self.same(left.segmentID, right.segmentID)
                && Self.same(left.turnID, right.turnID) && Self.same(left.inputMessageID, right.inputMessageID)
                && Self.same(left.inputMessageKey, right.inputMessageKey)
        }

        func value() -> RuntimeEvent {
            guard let text, case let .update(connection, .text(update)) = event else { return event }
            return .update(connectionID: connection, .text(Self.replacingText(update, with: text)))
        }

        private static func replacingText(_ value: RuntimeTextUpdate, with text: String) -> RuntimeTextUpdate {
            .init(sessionKey: value.sessionKey, runID: value.runID, segmentID: value.segmentID, text: text, mode: value.mode,
                  turnID: value.turnID, inputMessageID: value.inputMessageID, inputMessageKey: value.inputMessageKey,
                  snapshotMetadata: value.snapshotMetadata)
        }
        private static func same(_ left: String?, _ right: String?) -> Bool {
            switch (left, right) {
            case (nil, nil): true
            case let (left?, right?): left.utf8.elementsEqual(right.utf8)
            default: false
            }
        }
    }

    private let lock = NSLock()
    private var entries: [Entry] = []
    private var bytes = 0
    private var waiter: CheckedContinuation<RuntimeEvent?, any Error>?
    private var end: End?
    private var terminationHandler: (@Sendable () -> Void)?
    private var handlerInstalled = false
    private var terminationDelivered = false

    func onTermination(_ handler: @escaping @Sendable () -> Void) {
        lock.lock()
        precondition(!handlerInstalled)
        handlerInstalled = true; terminationHandler = handler
        let callback = takeTermination()
        lock.unlock()
        callback?()
    }

    func offer(_ event: RuntimeEvent, weight: Int, context: Context) -> Admission {
        lock.lock()
        guard end == nil else { lock.unlock(); return .terminated }
        let merges = entries.last?.accepts(event, context: context) == true
        guard weight >= 0, weight <= Self.maximumBytes - bytes,
              merges || entries.count < Self.maximumCount else {
            end = .failure(RuntimeFailure(.capacity))
            let pending = waiter; waiter = nil
            let callback = takeTermination()
            lock.unlock()
            pending?.resume(throwing: RuntimeFailure(.capacity)); callback?()
            return .overflow
        }
        if let pending = waiter {
            waiter = nil
            lock.unlock()
            pending.resume(returning: event)
            return .accepted
        }
        if merges, case let .update(_, .text(update)) = event {
            entries[entries.count - 1].text?.append(update.text)
            entries[entries.count - 1].weight += weight
        } else { entries.append(Entry(event, context: context, weight: weight)) }
        bytes += weight
        lock.unlock()
        return .accepted
    }

    func next() async throws -> RuntimeEvent? {
        try await withTaskCancellationHandler {
            if Task.isCancelled { cancel(); throw CancellationError() }
            return try await withCheckedThrowingContinuation { pull($0) }
        } onCancel: { self.cancel() }
    }

    private func pull(_ continuation: CheckedContinuation<RuntimeEvent?, any Error>) {
        lock.lock()
        if !entries.isEmpty {
            let entry = entries.removeFirst(); bytes -= entry.weight
            lock.unlock()
            continuation.resume(returning: entry.value())
        } else if let end {
            lock.unlock()
            Self.resume(continuation, end: end)
        } else if waiter == nil {
            waiter = continuation; lock.unlock()
        } else {
            // The public contract has one reader. Fail closed rather than
            // losing a second continuation or permitting concurrent reordering.
            end = .failure(RuntimeFailure(.capacity))
            let pending = waiter; waiter = nil
            let callback = takeTermination()
            lock.unlock()
            pending?.resume(throwing: RuntimeFailure(.capacity))
            continuation.resume(throwing: RuntimeFailure(.capacity)); callback?()
        }
    }

    func finish(throwing failure: RuntimeFailure? = nil) {
        lock.lock()
        guard end == nil else { lock.unlock(); return }
        let result: End = failure.map(End.failure) ?? .finished
        end = result
        let pending = waiter; waiter = nil
        let callback = takeTermination()
        lock.unlock()
        // Accepted entries remain in order and drain before the terminal result.
        if let pending { Self.resume(pending, end: result) }
        callback?()
    }

    private func cancel() {
        lock.lock()
        end = .cancelled; entries.removeAll(); bytes = 0
        let pending = waiter; waiter = nil
        let callback = takeTermination()
        lock.unlock()
        pending?.resume(throwing: CancellationError()); callback?()
    }

    /// Called only with the lock held. Callbacks themselves always run unlocked.
    private func takeTermination() -> (@Sendable () -> Void)? {
        guard end != nil, !terminationDelivered, let handler = terminationHandler else { return nil }
        terminationDelivered = true; terminationHandler = nil
        return handler
    }

    private static func resume(_ continuation: CheckedContinuation<RuntimeEvent?, any Error>, end: End) {
        switch end {
        case .finished: continuation.resume(returning: nil)
        case .failure(let failure): continuation.resume(throwing: failure)
        case .cancelled: continuation.resume(throwing: CancellationError())
        }
    }

    deinit { waiter?.resume(returning: nil) }
}
