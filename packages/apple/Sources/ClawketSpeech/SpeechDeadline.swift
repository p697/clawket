import Foundation
import ClawketTransport

/// Cancels the losing operation without keeping its caller suspended on a
/// credential provider that does not implement cooperative cancellation.
private final class SpeechRace<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<Value, any Error>?
    private var continuation: CheckedContinuation<Value, any Error>?
    private var tasks: [Task<Void, Never>] = []
    func wait(_ continuation: CheckedContinuation<Value, any Error>) {
        lock.lock()
        if let result { lock.unlock(); continuation.resume(with: result) }
        else { self.continuation = continuation; lock.unlock() }
    }
    func install(_ tasks: [Task<Void, Never>]) {
        lock.lock()
        if result != nil { lock.unlock(); tasks.forEach { $0.cancel() } }
        else { self.tasks = tasks; lock.unlock() }
    }
    func complete(_ result: Result<Value, any Error>) {
        lock.lock()
        guard self.result == nil else { lock.unlock(); return }
        self.result = result
        let waiter = continuation; continuation = nil
        let running = tasks; tasks = []; lock.unlock()
        waiter?.resume(with: result); running.forEach { $0.cancel() }
    }
}

func speechDeadline<Value: Sendable>(seconds: Int, clock: any TransportClock,
                                    operation: @escaping @Sendable () async throws -> Value) async throws -> Value {
    let race = SpeechRace<Value>()
    return try await withTaskCancellationHandler {
        try Task.checkCancellation()
        return try await withCheckedThrowingContinuation { continuation in
            race.wait(continuation)
            let operationTask = Task {
                do { race.complete(.success(try await operation())) }
                catch { race.complete(.failure(error)) }
            }
            let deadlineTask = Task {
                do {
                    try await clock.sleep(for: .seconds(seconds)); try Task.checkCancellation()
                    race.complete(.failure(SpeechFailure(.connectTimeout)))
                } catch { /* A cancelled losing deadline cannot replace the result. */ }
            }
            race.install([operationTask, deadlineTask])
        }
    } onCancel: { race.complete(.failure(SpeechFailure(.cancelled))) }
}
