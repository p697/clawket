import ClawketPersistence
import Foundation

enum NativeHistoryFault: Sendable, Equatable { case stagePrepared, intentPublished, archivePublished, metadataPublished, rollbackWritten, currentWritten, currentVerified, intentRemoved }

extension NativeConversationStore {
    /// Bind an observed first physical scope only when no transcript can be lost or reassigned.
    func establishHistoryScope(scope: NativeHistoryScope, expectedRevision: Int64, epoch: UUID,
                               physicalSessionID: String?) async throws -> NativeConversation {
        await acquireMediaSnapshot(); defer { releaseMediaSnapshot() }
        try await recoverHistory(); try scope.validate()
        guard expectedRevision >= 0, expectedRevision < 9_007_199_254_740_991,
              physicalSessionID == nil || (!physicalSessionID!.isEmpty && physicalSessionID!.utf8.count <= 2_048) else { throw NativeHistoryFailure.invalid }
        let key = try scopedKey(scope.connectionID, scope.agentID, scope.sessionID)
        let raw = try await historyCurrentBytes(key)
        var current = try raw.map(decodeHistoryConversation) ?? NativeConversation()
        if current.historyEpoch == epoch, current.physicalSessionID == physicalSessionID,
           current.revision == expectedRevision || current.revision == expectedRevision + 1 { return current }
        guard current.revision == expectedRevision, current.messages.isEmpty, current.physicalSessionID == nil,
              current.historyEpoch == nil || current.historyEpoch == epoch,
              raw != nil || expectedRevision == 0 else { throw NativeHistoryFailure.changed }
        current.historyEpoch = epoch; current.physicalSessionID = physicalSessionID; current.revision += 1
        let replacement = try historyEncode(current)
        guard replacement.count <= NativeHistoryLimits.recordBytes else { throw NativeHistoryFailure.full }
        let rollbackBytes = try await values.read(key + ".rollback")?.count ?? 0
        let oldBytes = raw?.count ?? 0
        let footprint = try historyFiles.inventory().values.reduce(0, +) + 2 * oldBytes + rollbackBytes + replacement.count + NativeHistoryLimits.metadataReserve
        guard footprint <= NativeHistoryLimits.physicalBytes else { throw NativeHistoryFailure.full }
        try Task.checkCancellation()
        do {
            if let raw {
                try await values.write(raw, for: key + ".rollback")
                guard try await values.read(key + ".rollback") == raw else { throw NativeHistoryFailure.unavailable }
                try historyFault(.rollbackWritten)
            }
            try await values.write(replacement, for: key); try historyFault(.currentWritten)
            guard try await values.read(key) == replacement else { throw NativeHistoryFailure.unavailable }
            try historyFault(.currentVerified)
            latestRevision[key] = current.revision; return current
        } catch { historyUnavailable = true; throw NativeHistoryFailure.commitUncertain }
    }

    /// Called only after authoritative physical-session observation. This is local storage, never runtime authority.
    func rollover(scope: NativeHistoryScope, expectedRevision: Int64, fromEpoch: UUID?, toEpoch: UUID,
                  physicalSessionID: String?, retainingMessageIDs: Set<String>, expectedCurrentHash: String? = nil) async throws -> NativeHistoryRollover {
        await acquireMediaSnapshot(); defer { releaseMediaSnapshot() }
        try await recoverHistory()
        try scope.validate()
        guard expectedRevision >= 0, expectedRevision < 9_007_199_254_740_991, toEpoch != fromEpoch,
              expectedCurrentHash == nil || historyDigest(expectedCurrentHash!),
              physicalSessionID == nil || (!physicalSessionID!.isEmpty && physicalSessionID!.utf8.count <= 2_048) else { throw NativeHistoryFailure.invalid }
        let key = try scopedKey(scope.connectionID, scope.agentID, scope.sessionID)
        guard let original = try await historyCurrentBytes(key) else { throw NativeHistoryFailure.missing }
        let current = try decodeHistoryConversation(original)
        if current.historyEpoch == toEpoch {
            let matches = try historyManifests().filter { $0.scope == scope && $0.toEpoch == toEpoch && $0.fromEpoch == fromEpoch && $0.sourceRevision == expectedRevision }
            guard matches.count == 1, matches[0].replacementSHA256 == historyHash(original) else { throw NativeHistoryFailure.changed }
            _ = try readPhysicalBody(matches[0]); return .init(archive: matches[0], current: current)
        }
        guard current.revision == expectedRevision, current.historyEpoch == fromEpoch,
              expectedCurrentHash == nil || historyHash(original) == expectedCurrentHash else { throw NativeHistoryFailure.changed }
        let retained = current.messages.filter { retainingMessageIDs.contains($0.id) }
        guard retained.count == retainingMessageIDs.count,
              retained.allSatisfy({ $0.local && $0.role == .user && $0.idempotencyKey?.isEmpty == false &&
                  [.queued, .held, .sending, .uncertain, .failed].contains($0.delivery) }) else { throw NativeHistoryFailure.invalid }
        var next = current
        next.messages = retained; next.revision += 1; next.historyEpoch = toEpoch
        next.physicalSessionID = physicalSessionID; next.nextCursor = nil; next.hasMore = false
        let replacement = try historyEncode(next)
        guard replacement.count <= NativeHistoryLimits.recordBytes else { throw NativeHistoryFailure.full }
        let inventory = try historyFiles.inventory(), manifests = try historyManifests()
        guard manifests.count < NativeHistoryLimits.physicalRecords else { throw NativeHistoryFailure.full }
        let rollbackBytes = try await values.read(key + ".rollback")?.count ?? 0
        // Count actual archives/staging plus this scope's existing current/rollback and worst atomic replacements.
        // This deliberately makes no claim about unrelated evictable conversation-cache files.
        let footprint = inventory.values.reduce(0, +) + original.count + rollbackBytes + 2 * original.count + 2 * replacement.count + NativeHistoryLimits.metadataReserve
        guard footprint <= NativeHistoryLimits.physicalBytes else { throw NativeHistoryFailure.full }
        let archive = NativePhysicalArchive(id: UUID(), scope: scope, fromEpoch: fromEpoch, toEpoch: toEpoch,
            physicalSessionID: current.physicalSessionID, savedAt: Int64(Date().timeIntervalSince1970 * 1_000),
            byteCount: original.count, sha256: historyHash(original), replacementSHA256: historyHash(replacement),
            sourceRevision: current.revision, resourceIDs: current.mediaResourceIDs.sorted { $0.uuidString < $1.uuidString })
        try archive.validate()
        let intent = NativeHistoryIntent(archive: archive, expectedCurrentSHA256: archive.sha256, replacementBytes: replacement.count)
        let stage = NativeHistoryFiles.name(archive.id, "next")
        var intentAttempted = false
        do {
            try Task.checkCancellation()
            try historyFiles.put(replacement, name: stage); try historyFault(.stagePrepared)
            intentAttempted = true
            try historyFiles.put(try historyEncode(intent), name: "intent.json"); try historyFault(.intentPublished)
            return try await completeHistory(intent)
        } catch {
            if intentAttempted {
                historyUnavailable = true; throw NativeHistoryFailure.commitUncertain
            }
            // No current-file mutation can precede the durable intent. Preserve the source and retire only our duplicate stage.
            try? historyFiles.remove(stage)
            throw error
        }
    }

    func physicalArchives(scope: NativeHistoryScope? = nil) async throws -> [NativePhysicalArchive] {
        await acquireMediaSnapshot(); defer { releaseMediaSnapshot() }
        try await recoverHistory()
        if let scope { try scope.validate() }
        return try historyManifests().filter { scope == nil || $0.scope == scope }.sorted {
            $0.savedAt == $1.savedAt ? $0.id.uuidString < $1.id.uuidString : $0.savedAt > $1.savedAt
        }
    }

    func physicalArchive(_ id: UUID) async throws -> (NativePhysicalArchive, NativeConversation) {
        await acquireMediaSnapshot(); defer { releaseMediaSnapshot() }
        try await recoverHistory()
        guard let metadata = try historyManifests().first(where: { $0.id == id }) else { throw NativeHistoryFailure.missing }
        return (metadata, try decodeHistoryConversation(readPhysicalBody(metadata)))
    }

    /// The caller holds the same FIFO lock used by current/rollback writes and resource reclamation.
    func recoverHistory() async throws {
        guard !historyUnavailable else { throw NativeHistoryFailure.commitUncertain }
        do {
            if let raw = try historyFiles.read("intent.json", maximumBytes: NativeHistoryLimits.manifestBytes) {
                let intent = try JSONDecoder().decode(NativeHistoryIntent.self, from: raw)
                try intent.validate(); _ = try await completeHistory(intent)
            }
            let inventory = try historyFiles.inventory()
            // Unreferenced preparation files contain only a duplicate of a current replacement. No current write is allowed before an intent.
            for name in inventory.keys where name.hasPrefix("work-") || name.hasSuffix(".next.json") { try historyFiles.remove(name) }
        } catch { historyUnavailable = true; throw error }
    }

    private func completeHistory(_ intent: NativeHistoryIntent) async throws -> NativeHistoryRollover {
        try intent.validate()
        let archive = intent.archive, key = try scopedKey(archive.scope.connectionID, archive.scope.agentID, archive.scope.sessionID)
        guard let replacement = try historyFiles.read(NativeHistoryFiles.name(archive.id, "next")),
              replacement.count == intent.replacementBytes, historyHash(replacement) == archive.replacementSHA256 else { throw NativeHistoryFailure.invalid }
        let next = try decodeHistoryConversation(replacement)
        guard next.revision == archive.sourceRevision + 1, next.historyEpoch == archive.toEpoch,
              next.nextCursor == nil, !next.hasMore else { throw NativeHistoryFailure.invalid }
        guard let raw = try await historyCurrentBytes(key) else { throw NativeHistoryFailure.changed }
        let actual = historyHash(raw)
        guard actual == archive.sha256 || actual == archive.replacementSHA256 else { throw NativeHistoryFailure.changed }
        if actual == archive.sha256 {
            let old = try decodeHistoryConversation(raw)
            guard old.revision == archive.sourceRevision, old.historyEpoch == archive.fromEpoch,
                  old.physicalSessionID == archive.physicalSessionID,
                  old.mediaResourceIDs == Set(archive.resourceIDs), old.draft == next.draft,
                  old.draftResourceIDs == next.draftResourceIDs else { throw NativeHistoryFailure.invalid }
            let retainedIDs = Set(next.messages.map(\.id))
            guard old.messages.filter({ retainedIDs.contains($0.id) }).count == next.messages.count,
                  try historyEncode(old.messages.filter { retainedIDs.contains($0.id) }) == historyEncode(next.messages),
                  next.messages.allSatisfy({ $0.local && $0.role == .user && $0.idempotencyKey?.isEmpty == false &&
                      [.queued, .held, .sending, .uncertain, .failed].contains($0.delivery) }) else { throw NativeHistoryFailure.invalid }
            try historyFiles.put(raw, name: NativeHistoryFiles.name(archive.id, "body")); try historyFault(.archivePublished)
            try historyFiles.put(try historyEncode(archive), name: NativeHistoryFiles.name(archive.id, "meta")); try historyFault(.metadataPublished)
            _ = try readPhysicalBody(archive)
            try await values.write(raw, for: key + ".rollback")
            guard try await values.read(key + ".rollback") == raw else { throw NativeHistoryFailure.unavailable }
            try historyFault(.rollbackWritten)
            try await values.write(replacement, for: key); try historyFault(.currentWritten)
        }
        _ = try readPhysicalBody(archive)
        guard let metadata = try historyFiles.read(NativeHistoryFiles.name(archive.id, "meta"), maximumBytes: NativeHistoryLimits.manifestBytes),
              metadata == (try historyEncode(archive)), try await values.read(key) == replacement else { throw NativeHistoryFailure.unavailable }
        try historyFault(.currentVerified)
        latestRevision[key] = max(latestRevision[key, default: 0], next.revision)
        try historyFiles.remove("intent.json"); try historyFault(.intentRemoved)
        try historyFiles.remove(NativeHistoryFiles.name(archive.id, "next"))
        return .init(archive: archive, current: next)
    }

    func historyResourceIDs() throws -> Set<UUID> {
        var result: Set<UUID> = []
        for archive in try historyManifests() {
            _ = try readPhysicalBody(archive); result.formUnion(archive.resourceIDs)
            guard result.count <= 128 else { throw NativeHistoryFailure.full }
        }
        if let raw = try historyFiles.read("intent.json", maximumBytes: NativeHistoryLimits.manifestBytes) {
            let intent = try JSONDecoder().decode(NativeHistoryIntent.self, from: raw); try intent.validate()
            result.formUnion(intent.archive.resourceIDs)
            if let next = try historyFiles.read(NativeHistoryFiles.name(intent.archive.id, "next")) {
                guard historyHash(next) == intent.archive.replacementSHA256 else { throw NativeHistoryFailure.invalid }
                result.formUnion(try decodeHistoryConversation(next).mediaResourceIDs)
            } else { throw NativeHistoryFailure.invalid }
        }
        guard result.count <= 128 else { throw NativeHistoryFailure.full }; return result
    }

    private func historyManifests() throws -> [NativePhysicalArchive] {
        let inventory = try historyFiles.inventory()
        guard inventory.values.reduce(0, +) <= NativeHistoryLimits.physicalBytes else { throw NativeHistoryFailure.full }
        let names = inventory.keys.filter { $0.hasSuffix(".meta.json") }
        guard names.count <= NativeHistoryLimits.physicalRecords else { throw NativeHistoryFailure.full }
        var result: [NativePhysicalArchive] = []
        for name in names {
            guard let raw = try historyFiles.read(name, maximumBytes: NativeHistoryLimits.manifestBytes) else { throw NativeHistoryFailure.invalid }
            let metadata = try JSONDecoder().decode(NativePhysicalArchive.self, from: raw); try metadata.validate()
            guard name == NativeHistoryFiles.name(metadata.id, "meta"), inventory[NativeHistoryFiles.name(metadata.id, "body")] == metadata.byteCount else { throw NativeHistoryFailure.invalid }
            result.append(metadata)
        }
        let pending = try historyFiles.read("intent.json", maximumBytes: NativeHistoryLimits.manifestBytes).map { try JSONDecoder().decode(NativeHistoryIntent.self, from: $0).archive.id }
        let known = Set(result.map { NativeHistoryFiles.name($0.id, "body") })
        for name in inventory.keys where name.hasSuffix(".body.json") && !known.contains(name) {
            guard pending.map({ NativeHistoryFiles.name($0, "body") }) == name else { throw NativeHistoryFailure.invalid }
        }
        return result
    }

    private func readPhysicalBody(_ metadata: NativePhysicalArchive) throws -> Data {
        guard let raw = try historyFiles.read(NativeHistoryFiles.name(metadata.id, "body")),
              raw.count == metadata.byteCount, historyHash(raw) == metadata.sha256 else { throw NativeHistoryFailure.invalid }
        let value = try decodeHistoryConversation(raw)
        guard value.revision == metadata.sourceRevision, value.historyEpoch == metadata.fromEpoch,
              value.physicalSessionID == metadata.physicalSessionID, value.mediaResourceIDs == Set(metadata.resourceIDs) else { throw NativeHistoryFailure.invalid }
        return raw
    }

    private func decodeHistoryConversation(_ raw: Data) throws -> NativeConversation {
        guard !raw.isEmpty, raw.count <= NativeHistoryLimits.recordBytes else { throw NativeHistoryFailure.invalid }
        let value = try JSONDecoder().decode(NativeConversation.self, from: raw)
        try value.validateMedia()
        guard value.revision >= 0, value.revision < 9_007_199_254_740_991 else { throw NativeHistoryFailure.invalid }
        return value
    }

    private func historyCurrentBytes(_ key: String) async throws -> Data? {
        // A missing current is not a fresh install when a verified rollback exists.
        // A present malformed/unknown current is never overwritten by guessing at its backup.
        if let raw = try await values.read(key) { _ = try decodeHistoryConversation(raw); return raw }
        if let raw = try await values.read(key + ".rollback") { _ = try decodeHistoryConversation(raw); return raw }
        return nil
    }
}
