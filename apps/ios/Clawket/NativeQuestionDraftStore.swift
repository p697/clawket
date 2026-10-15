import ClawketPersistence
import ClawketUI
import Foundation

/// Local edits only, never a runtime request reference or token. Revisions increase globally
/// across this store's edits/resolutions. Keep the existing seven-day / 32-question / 256 KB policy.
actor NativeQuestionDraftStore {
    private struct Record: Codable, Sendable {
        let key: String
        let updatedAt: Int64
        let draft: QuestionResponse
    }
    private struct Table: Codable, Sendable {
        var version = 1
        var records: [Record] = []
    }
    private static let maximumBytes = 256_000
    private static let maximumAge: Int64 = 7 * 24 * 60 * 60 * 1_000
    private let documents: DocumentStore
    private let now: @Sendable () -> Int64
    private var latest: [String: UInt64] = [:]
    private var retired: [(key: String, revision: UInt64)] = []
    private var discardedThrough: UInt64 = 0
    private var locked = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(values: any ValueStore, now: @escaping @Sendable () -> Int64 = {
        Int64(Date().timeIntervalSince1970 * 1_000)
    }) throws {
        documents = try DocumentStore(values: values, maximumBytes: Self.maximumBytes)
        self.now = now
    }

    init(directory: URL? = nil) throws {
        let support = try directory ?? FileManager.default.url(for: .applicationSupportDirectory,
            in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("NativeQuestionDrafts", isDirectory: true)
        documents = try DocumentStore(values: FileValueStore(directory: support), maximumBytes: Self.maximumBytes)
        now = { Int64(Date().timeIntervalSince1970 * 1_000) }
    }

    func read(key: String) async throws -> QuestionResponse? {
        try validateKey(key)
        await acquire(); defer { release() }
        guard !retired.contains(where: { $0.key == key }) else { return nil }
        let table = try await readTable()
        guard !retired.contains(where: { $0.key == key }) else { return nil }
        return table.records.first(where: { $0.key == key })?.draft
    }

    func save(_ draft: QuestionResponse, key: String, revision: UInt64) async throws {
        try validateKey(key); try validateDraft(draft)
        await acquire(); defer { release() }
        try Task.checkCancellation()
        guard !retired.contains(where: { $0.key == key }), revision > discardedThrough,
              revision >= latest[key, default: 0] else { return }
        latest[key] = revision
        var table = try await readTable()
        table.records.removeAll { $0.key == key }
        table.records.append(.init(key: key, updatedAt: now(), draft: draft))
        while table.records.count > 32 { table.records.removeFirst() }
        while try encodedSize(table) > Self.maximumBytes {
            guard table.records.count > 1 else { throw StoreFailure.tooLarge }
            table.records.removeFirst()
        }
        try Task.checkCancellation()
        guard !retired.contains(where: { $0.key == key }), revision == latest[key] else { return }
        try await documents.write(table, key: "question-drafts.v1")
        // Older editing revisions outside the bounded retained set cannot grow bookkeeping forever.
        let retained = Set(table.records.map(\.key))
        for (key, revision) in latest where !retained.contains(key) { discardedThrough = max(discardedThrough, revision) }
        latest = latest.filter { retained.contains($0.key) }
    }

    func retire(key: String, revision: UInt64) async throws {
        try validateKey(key)
        // Fence queued/in-flight local saves before waiting for an earlier transaction.
        if !retired.contains(where: { $0.key == key }) { retired.append((key, revision)) }
        while retired.count > 128 { discardedThrough = max(discardedThrough, retired.removeFirst().revision) }
        await acquire(); defer { release() }
        var table = try await readTable()
        table.records.removeAll { $0.key == key }; latest.removeValue(forKey: key)
        try await documents.write(table, key: "question-drafts.v1")
    }

    private func readTable() async throws -> Table {
        guard var table = try await documents.read(Table.self, key: "question-drafts.v1")?.value else { return Table() }
        guard table.version == 1, table.records.count <= 32,
              Set(table.records.map(\.key)).count == table.records.count else { throw StoreFailure.invalidDocument }
        for record in table.records { try validateKey(record.key); try validateDraft(record.draft) }
        let current = now()
        guard current >= 0, current <= 9_007_199_254_740_991 else { throw StoreFailure.invalidDocument }
        table.records.removeAll { $0.updatedAt <= 0 || $0.updatedAt > current || $0.updatedAt <= current - Self.maximumAge }
        return table
    }

    private func encodedSize(_ value: Table) throws -> Int {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(value).count
    }

    private func validateKey(_ key: String) throws {
        guard key.utf8.count == 64, key.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            throw StoreFailure.invalidKey
        }
    }

    private func validateDraft(_ draft: QuestionResponse) throws {
        guard draft.fields.count <= 32 else { throw StoreFailure.tooLarge }
        for (key, field) in draft.fields {
            guard !key.isEmpty, key.utf16.count <= 512,
                  !["__proto__", "constructor", "prototype"].contains(key),
                  field.selectedOptionIDs.count <= 32,
                  Set(field.selectedOptionIDs).count == field.selectedOptionIDs.count,
                  field.text.utf16.count <= 64_000,
                  field.selectedOptionIDs.allSatisfy({ $0.utf16.count <= 64_000 }) else {
                throw StoreFailure.invalidDocument
            }
        }
    }

    private func acquire() async {
        if !locked { locked = true; return }
        await withCheckedContinuation { waiters.append($0) }
    }
    private func release() {
        if waiters.isEmpty { locked = false } else { waiters.removeFirst().resume() }
    }
}
