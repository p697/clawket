import Foundation

extension RuntimeCoordinator {
    /// A caller-owned read for portable snapshots. Cancellation reaches its RPC;
    /// it does not join a UI history task or publish model/transcript state.
    public func exportHistorySnapshot(key: String, limit: Int = 100, cursor: String? = nil) async throws -> RuntimeHistory {
        try Task.checkCancellation()
        let captured = try scope()
        guard state.capabilities.history else { throw RuntimeFailure(.unsupported) }
        guard !key.isEmpty, key.utf8.count <= 1_024, (1...1_000).contains(limit),
              cursor?.utf8.count ?? 0 <= 4_096, historyExportPending < 8 else { throw RuntimeFailure(.capacity) }
        historyExportPending += 1
        defer { historyExportPending -= 1 }
        let value = try await readHistory(key: key, limit: limit, cursor: cursor, scope: captured)
        try Task.checkCancellation(); try assertCurrent(captured)
        return value
    }
}
