import ClawketPersistence
import ClawketTransport
import ClawketUI
import Foundation

/// Bounds untrusted/corrupt JSON before recursive decoding. Corruption stays on disk for recovery.
private struct NativeJournalValues: ValueStore {
    let base: any ValueStore
    func read(_ key: String) async throws -> Data? {
        guard let bytes = try await base.read(key) else { return nil }
        guard bytes.count <= NativeJournalStore.maximumBytes,
              let text = String(data: bytes, encoding: .utf8), (try? FrameCodec.decode(text)) != nil,
              let document = try? JSONDecoder().decode(NativeJournalDocument.self, from: bytes),
              (try? NativeJournalStore.validate(document)) != nil else {
            // DocumentStore can still inspect its independently verified rollback.
            return Data("invalid journal".utf8)
        }
        return bytes
    }
    func write(_ value: Data, for key: String) async throws { try await base.write(value, for: key) }
    func remove(_ key: String) async throws { try await base.remove(key) }
}

/// One bounded atomic cache includes scopes in its records; it never stores action references.
actor NativeJournalStore {
    static let maximumBytes = 8 * 1_024 * 1_024
    private let documents: DocumentStore
    private var latestRevision: Int64 = -1
    private var locked = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    init(values: any ValueStore) throws {
        documents = try DocumentStore(values: NativeJournalValues(base: values), maximumBytes: Self.maximumBytes)
    }

    init(directory: URL? = nil) throws {
        let root = try directory ?? FileManager.default.url(for: .applicationSupportDirectory,
            in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("NativeTaskJournal", isDirectory: true)
        documents = try DocumentStore(values: NativeJournalValues(base: FileValueStore(directory: root)), maximumBytes: Self.maximumBytes)
    }

    func read() async throws -> StoredDocument<NativeJournalDocument>? {
        await acquire(); defer { release() }
        guard let saved = try await documents.read(NativeJournalDocument.self, key: "tasks.v1") else { return nil }
        try Self.validate(saved.value)
        latestRevision = max(latestRevision, saved.value.revision)
        return saved
    }

    func write(_ document: NativeJournalDocument) async throws {
        try Self.validate(document)
        await acquire(); defer { release() }
        try Task.checkCancellation()
        guard document.revision > latestRevision else { return }
        latestRevision = document.revision
        try await documents.write(document, key: "tasks.v1")
    }

    static func validate(_ document: NativeJournalDocument) throws {
        guard document.version == 1, document.revision >= 0, document.nextOrder >= 0,
              document.revision < NativeJournalDocument.maximumCounter,
              document.nextOrder < NativeJournalDocument.maximumCounter,
              document.runs.count <= 128, document.reviews.count <= 32,
              document.runs.reduce(0, { $0 + $1.steps.count }) <= 4_096 else { throw StoreFailure.invalidDocument }
        var identities = Set<String>()
        var orders = Set<Int64>()
        func identity(_ value: String) throws {
            guard UUID(uuidString: value) != nil, identities.insert(value).inserted else { throw StoreFailure.invalidDocument }
        }
        func order(_ value: Int64) throws {
            guard value >= 0, value < document.nextOrder, orders.insert(value).inserted else { throw StoreFailure.invalidDocument }
        }
        func text(_ value: String?, limit: Int) throws {
            guard value.map({ $0.utf8.count <= limit }) ?? true else { throw StoreFailure.tooLarge }
        }
        func clock(_ value: NativeWorkClock) throws {
            let values = [value.startedAtMs, value.finishedAtMs, value.durationMs,
                          value.observedStartedAtMs, value.observedFinishedAtMs, value.observedDurationMs].compactMap { $0 }
            guard values.allSatisfy({ $0 >= 0 && $0 <= 9_007_199_254_740_991 }) else { throw StoreFailure.invalidDocument }
        }
        for run in document.runs {
            try identity(run.id); try order(run.order); try clock(run.clock)
            for value in [run.scope.connectionID, run.scope.agentID, run.scope.sessionID] {
                guard !value.isEmpty, value.utf8.count <= 1_024 else { throw StoreFailure.invalidDocument }
            }
            for value in [run.lineage.runID, run.lineage.turnID, run.lineage.inputMessageID, run.lineage.inputMessageKey] {
                try text(value, limit: 1_024)
            }
            try text(run.inputPreview, limit: 8_192)
            try text(run.historyAnchor, limit: 4_096)
            guard run.steps.count <= 1_024 else { throw StoreFailure.tooLarge }
            var sourceIDs = Set<String>()
            for step in run.steps {
                try identity(step.id); try order(step.order); try clock(step.clock)
                if let source = step.sourceItemID {
                    guard !source.isEmpty, source.utf8.count <= 512,
                          sourceIDs.insert(step.kind.rawValue + ":" + source).inserted else { throw StoreFailure.invalidDocument }
                }
                try text(step.title, limit: 32_000); try text(step.toolName, limit: 8_192)
                try text(step.text, limit: 1_024 * 1_024)
                for raw in [step.input, step.output].compactMap({ $0 }) { _ = try FrameCodec.encode(raw) }
            }
        }
        var correlations = Set<String>()
        for review in document.reviews {
            try identity(review.id); try order(review.order)
            guard !review.connectionID.isEmpty, review.connectionID.utf8.count <= 1_024,
                  review.correlationKey.utf8.count == 64,
                  review.correlationKey.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
                  correlations.insert(review.correlationKey).inserted else { throw StoreFailure.invalidDocument }
            try text(review.sessionID, limit: 1_024)
            switch review.content {
            case let .approval(value):
                for value in [value.title, value.reason, value.cwd, value.host, value.displayName, value.platform, value.pluginID] {
                    try text(value, limit: 32_000)
                }
                try text(value.command, limit: 512_000)
                if let expiry = value.expiresAtMs, expiry < 0 || expiry > 9_007_199_254_740_991 { throw StoreFailure.invalidDocument }
            case let .question(value):
                try text(value.title, limit: 32_000); try text(value.message, limit: 64_000); try text(value.placeholder, limit: 32_000)
                guard value.options.count <= 200, value.fields.count <= 10,
                      Set(value.options).count == value.options.count,
                      Set(value.fields.map(\.id)).count == value.fields.count,
                      value.response.fields.count <= 32 else { throw StoreFailure.invalidDocument }
                for option in value.options { try text(option, limit: 32_000) }
                for field in value.fields {
                    guard !field.id.isEmpty, field.id.utf16.count <= 512,
                          !["__proto__", "constructor", "prototype"].contains(field.id), field.options.count <= 20,
                          Set(field.options.map(\.value)).count == field.options.count else { throw StoreFailure.invalidDocument }
                    try text(field.title, limit: 32_000); try text(field.header, limit: 4_000)
                    for option in field.options { try text(option.value, limit: 32_000); try text(option.detail, limit: 32_000) }
                }
                for (field, answer) in value.response.fields {
                    guard !field.isEmpty, field.utf16.count <= 512,
                          !["__proto__", "constructor", "prototype"].contains(field),
                          answer.text.utf16.count <= 64_000, answer.selectedOptionIDs.count <= 32,
                          Set(answer.selectedOptionIDs).count == answer.selectedOptionIDs.count,
                          answer.selectedOptionIDs.allSatisfy({ $0.utf16.count <= 64_000 }) else { throw StoreFailure.invalidDocument }
                }
                guard value.kind != .confirm || value.response.fields.isEmpty else { throw StoreFailure.invalidDocument }
                let allowedFields = value.kind == .form ? Set(value.fields.map(\.id)) : Set(value.kind == .confirm ? [] : ["value"])
                guard Set(value.response.fields.keys).isSubset(of: allowedFields),
                      !(review.held && value.responseIsAccepted), !(value.expired && value.responseIsAccepted) else { throw StoreFailure.invalidDocument }
                if value.responseIsAccepted {
                    guard case let .question(presentation) = NativeJournalProjection.review(review).content.first,
                          (try? QuestionResponseValidator.validate(value.response, for: presentation)) != nil else { throw StoreFailure.invalidDocument }
                }
            }
        }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let bytes = try encoder.encode(document)
        guard bytes.count <= maximumBytes else { throw StoreFailure.tooLarge }
        guard let text = String(data: bytes, encoding: .utf8) else { throw StoreFailure.invalidDocument }
        _ = try FrameCodec.decode(text)
    }

    private func acquire() async {
        if !locked { locked = true; return }
        await withCheckedContinuation { waiters.append($0) }
    }
    private func release() {
        if waiters.isEmpty { locked = false } else { waiters.removeFirst().resume() }
    }
}
