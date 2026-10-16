import ClawketMedia
import ClawketPersistence
import ClawketRuntime
import ClawketUI
import Foundation

struct NativeMediaDisplay: Sendable {
    let resource: MediaResource
    let image: Data?
    let aspectRatio: Double?
}

/// Files, preparation and crash-recoverable import ownership live off the main actor.
/// Every network read still requires the Runtime coordinator's current opaque handle.
actor NativeMediaController {
    nonisolated let stager: MediaImportStager
    nonisolated let library: MediaLibrary
    private let journalStore: DocumentStore
    private var journal = NativeMediaJournal()
    private var unavailable = false

    init(directory: URL? = nil) throws {
        let root = try directory ?? FileManager.default.url(for: .applicationSupportDirectory,
            in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("NativeMedia", isDirectory: true)
        stager = try MediaImportStager(directory: root.appendingPathComponent("Imports", isDirectory: true))
        library = try MediaLibrary(directory: root.appendingPathComponent("Library", isDirectory: true))
        journalStore = try DocumentStore(values: FileValueStore(directory: root.appendingPathComponent("Ownership", isDirectory: true)),
                                         maximumBytes: 256 * 1_024)
    }

    func recover(cache: NativeConversationStore) async throws {
        journal = try await journalStore.read(NativeMediaJournal.self, key: "media.v1")?.value ?? .init()
        guard journal.version == 1, journal.pending.count <= 128, journal.releases.count <= 128,
              Set(journal.pending.map(\.id)).count == journal.pending.count else { throw StoreFailure.invalidDocument }
        let referenced = try await cache.allMediaResourceIDs()
        for id in referenced { _ = try await library.recoverResource(id) }
        for pending in journal.pending {
            guard pending.route.isConcrete else { throw StoreFailure.invalidDocument }
            let resource: MediaResource
            do { resource = try await library.recoverResource(pending.id) }
            catch MediaFailure.missing { resource = try await library.adopt(stager.recover(pending.resource)) }
            guard resource == pending.resource else { throw StoreFailure.invalidDocument }
            if try await !cache.recoverImport(pending) { journal.releases.insert(resource.id) }
        }
        journal.pending.removeAll(); try await saveJournal()
        _ = try stager.removeUnreferenced(keeping: [])
        try await reclaim(cache: cache)
    }

    func adopt(_ staged: StagedMediaFile, route: ConversationID,
               messageID: String? = nil, referenceID: String? = nil) async throws -> MediaResource {
        try available()
        guard journal.pending.count < 128, !journal.pending.contains(where: { $0.id == staged.id }) else { throw MediaFailure.capacity }
        journal.pending.append(.init(resource: staged.metadata, connectionID: route.connectionID,
            agentID: route.agentID, sessionID: route.sessionID, messageID: messageID, referenceID: referenceID))
        try await saveJournal()
        return try await library.adopt(staged)
    }

    func confirm(_ id: UUID) async throws {
        try available(); journal.pending.removeAll { $0.id == id }; try await saveJournal()
    }

    /// Journal intent before committing a reference removal. A failed/unknown
    /// conversation write leaves the current or rollback reference protecting it.
    func releaseWhenUnreferenced(_ ids: Set<UUID>) async throws {
        try available()
        journal.releases.formUnion(ids)
        guard journal.releases.count <= 128 else { throw MediaFailure.capacity }
        journal.pending.removeAll { ids.contains($0.id) }
        try await saveJournal()
    }

    func reclaim(cache: NativeConversationStore) async throws {
        try available()
        let referenced = try await cache.allMediaResourceIDs().union(journal.pending.map(\.id))
        var removed: Set<UUID> = []
        for id in journal.releases where !referenced.contains(id) {
            do { try await library.remove(id); removed.insert(id) }
            catch MediaFailure.capacity { continue } // A system share still owns a retain.
        }
        if !removed.isEmpty { journal.releases.subtract(removed); try await saveJournal() }
    }

    func prepare(_ ids: [UUID]) async throws -> [PreparedMedia] {
        try available()
        guard ids.count <= 6, Set(ids).count == ids.count else { throw MediaFailure.capacity }
        var prepared: [PreparedMedia] = []
        for id in ids { try Task.checkCancellation(); prepared.append(try await library.preparePrompt(id)) }
        return prepared
    }

    func display(_ id: UUID, input: Bool = false, pixels: Int = 1_600) async throws -> NativeMediaDisplay {
        try available()
        let resource = try await library.resource(id)
        _ = try await library.resourceURL(id)
        if input, resource.mimeType.hasPrefix("image/"), resource.mimeType != "image/svg+xml" {
            let preview = try await library.previewInput(id, maximumPixels: pixels)
            return .init(resource: resource, image: preview.data, aspectRatio: preview.aspectRatio)
        }
        if resource.hasRasterPreview {
            let preview = try await library.previewImage(id, maximumPixels: pixels)
            return .init(resource: resource, image: preview.data, aspectRatio: preview.aspectRatio)
        }
        return .init(resource: resource, image: nil, aspectRatio: nil)
    }

    func stageInline(_ bytes: @Sendable () throws -> Data?, name: String, mimeType: String) throws -> StagedMediaFile? {
        try available()
        guard let data = try bytes() else { return nil }
        return try stager.stageData(data, name: name, mimeType: mimeType)
    }

    func resolve(_ reference: NativeMediaReference, route: ConversationID, runtime: RuntimeCoordinator?, historyEpoch: UUID? = nil) async throws -> MediaResource {
        try available()
        if reference.artifactID == nil, let id = reference.resourceID {
            _ = try await library.resourceURL(id); return try await library.resource(id)
        }
        guard let artifactID = reference.artifactID else { throw MediaFailure.missing }
        let key = MediaArtifactKey(connectionID: route.connectionID, sessionKey: route.sessionID, artifactID: artifactID, historyEpoch: historyEpoch)
        do { if let cached = try await library.cachedArtifact(key: key) { return cached } }
        catch { guard runtime != nil else { throw error } }
        guard let runtime else { throw MediaFailure.missing }
        let handle = try await runtime.openArtifact(sessionKey: route.sessionID, artifactID: artifactID)
        do {
            let resource = try await library.cacheArtifact(key: key, name: handle.name, mimeType: handle.mimeType, size: handle.size) {
                try await runtime.readArtifact(handle, offset: $0)
            }
            await runtime.closeArtifact(handle)
            return resource
        } catch { await runtime.closeArtifact(handle); throw error }
    }

    func invalidate(connectionID: String, sessionKey: String? = nil) async { await library.invalidateArtifacts(connectionID: connectionID, sessionKey: sessionKey) }

    private func available() throws { guard !unavailable else { throw MediaFailure.commitUncertain } }
    private func saveJournal() async throws {
        do { try await journalStore.write(journal, key: "media.v1"); try available() }
        catch is CancellationError {
            // Our concrete FileValueStore never emits CancellationError after
            // mutation; DocumentStore checks it before its first write.
            throw CancellationError()
        } catch { unavailable = true; throw error }
    }
}
