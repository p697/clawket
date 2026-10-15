import ClawketMedia
import ClawketPersistence
import ClawketRuntime
import ClawketUI
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import Clawket

final class NativeMediaHostTests: XCTestCase, @unchecked Sendable {
    private func root() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString) }

    func testExistingV1DocumentReopensWithoutMediaKeysAndUnknownVersionFails() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let values = try FileValueStore(directory: directory)
        let key = try DocumentStore.scopedKey(namespace: "conversation.v1", parts: ["c", "a", "s"])
        let old = Data(#"{"version":1,"revision":4,"draft":"preserved","messages":[{"id":"m","role":"user","text":"old","local":true,"idempotencyKey":"stable","delivery":"sending"}],"historyLimit":80,"hasMore":false}"#.utf8)
        try await values.write(old, for: key)
        let store = try NativeConversationStore(directory: directory)
        let recovered = try await store.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertEqual(recovered.draft, "preserved"); XCTAssertTrue(recovered.draftResourceIDs.isEmpty)
        XCTAssertTrue(recovered.messages[0].media.isEmpty); XCTAssertEqual(recovered.messages[0].idempotencyKey, "stable")
        XCTAssertEqual(recovered.messages[0].delivery, .uncertain)
        let corrupt = Data(String(decoding: old, as: UTF8.self).replacingOccurrences(of: "\"version\":1", with: "\"version\":2").utf8)
        let other = root(); defer { try? FileManager.default.removeItem(at: other) }
        try await FileValueStore(directory: other).write(corrupt, for: key)
        do { _ = try await NativeConversationStore(directory: other).read(connectionID: "c", agentID: "a", sessionID: "s"); XCTFail("Unknown version must fail") }
        catch { }
    }

    func testImportJournalRecoversOriginalDraftAfterAdoptionBeforeConversationCommit() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try NativeConversationStore(directory: directory.appendingPathComponent("Chats"))
        let path = directory.appendingPathComponent("Media")
        let controller = try NativeMediaController(directory: path); try await controller.recover(cache: cache)
        let staged = try controller.stager.stageData(Data("owned import".utf8), name: "notes.txt", mimeType: "text/plain")
        let resource = try await controller.adopt(staged, route: .init(connectionID: "c", agentID: "a", sessionID: "s"))
        let reopened = try NativeMediaController(directory: path); try await reopened.recover(cache: cache)
        let recovered = try await cache.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertEqual(recovered.draftResourceIDs, [resource.id]); XCTAssertTrue(recovered.messages.isEmpty)
        let url = try await reopened.library.resourceURL(resource.id)
        XCTAssertEqual(try Data(contentsOf: url), Data("owned import".utf8))
        try await reopened.recover(cache: cache)
        let again = try await cache.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertEqual(again.draftResourceIDs, [resource.id])
    }

    func testRejectedOrCancelledAdoptedImportNeverResurrectsAfterReopen() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try NativeConversationStore(directory: directory.appendingPathComponent("Chats"))
        let path = directory.appendingPathComponent("Media")
        let controller = try NativeMediaController(directory: path); try await controller.recover(cache: cache)
        let staged = try controller.stager.stageData(Data("rejected".utf8), name: "notes.txt", mimeType: "text/plain")
        let resource = try await controller.adopt(staged, route: .init(connectionID: "c", agentID: "a", sessionID: "s"))
        // The same production path follows a definite model rejection or a
        // cancelled task after its captured adoption has finished.
        try await controller.releaseWhenUnreferenced([resource.id]); try await controller.reclaim(cache: cache)
        let reopened = try NativeMediaController(directory: path); try await reopened.recover(cache: cache)
        let recovered = try await cache.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertTrue(recovered.draftResourceIDs.isEmpty)
        let drafts = try await reopened.library.draftResources(); XCTAssertTrue(drafts.isEmpty)
    }

    func testFailedConversationSaveKeepsJournaledBytesForColdRecovery() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try NativeConversationStore(directory: directory.appendingPathComponent("Chats"))
        let path = directory.appendingPathComponent("Media")
        let controller = try NativeMediaController(directory: path); try await controller.recover(cache: cache)
        let resource = try await controller.adopt(controller.stager.stageData(Data("keep".utf8), name: "notes.txt", mimeType: "text/plain"),
                                                  route: .init(connectionID: "c", agentID: "a", sessionID: "s"))
        var oversized = NativeConversation(); oversized.draftResourceIDs = [resource.id]
        oversized.draft = String(repeating: "x", count: 8 * 1_024 * 1_024 + 1)
        do { try await cache.write(oversized, connectionID: "c", agentID: "a", sessionID: "s"); XCTFail("Must reject oversized save") }
        catch { }
        let reopened = try NativeMediaController(directory: path); try await reopened.recover(cache: cache)
        let recovered = try await cache.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertEqual(recovered.draftResourceIDs, [resource.id])
        _ = try await reopened.library.resourceURL(resource.id)
    }

    func testCurrentAndRollbackReferencesProtectRemovedResourcesUntilBothAdvance() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try NativeConversationStore(directory: directory.appendingPathComponent("Chats"))
        let controller = try NativeMediaController(directory: directory.appendingPathComponent("Media")); try await controller.recover(cache: cache)
        let resource = try await controller.adopt(controller.stager.stageData(Data("keep rollback".utf8), name: "notes.txt", mimeType: "text/plain"),
                                                  route: .init(connectionID: "c", agentID: "a", sessionID: "s"))
        var conversation = NativeConversation(); conversation.draftResourceIDs = [resource.id]
        try await cache.write(conversation, connectionID: "c", agentID: "a", sessionID: "s"); try await controller.confirm(resource.id)
        try await controller.releaseWhenUnreferenced([resource.id])
        conversation.draftResourceIDs = []; conversation.revision += 1
        try await cache.write(conversation, connectionID: "c", agentID: "a", sessionID: "s"); try await controller.reclaim(cache: cache)
        _ = try await controller.library.resourceURL(resource.id)
        let referenced = try await cache.allMediaResourceIDs(); XCTAssertTrue(referenced.contains(resource.id))
        conversation.revision += 1
        try await cache.write(conversation, connectionID: "c", agentID: "a", sessionID: "s"); try await controller.reclaim(cache: cache)
        do { _ = try await controller.library.resource(resource.id); XCTFail("Unreferenced resource must retire") } catch { }
    }

    func testMediaOnlyQueueEditKeepsComposerAndExactIdempotencyAndRejectsStaleAssets() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = try NativeMediaController(directory: directory)
        let first = try await controller.library.adopt(controller.stager.stageData(Data("a".utf8), name: "a.txt", mimeType: "text/plain"))
        let second = try await controller.library.adopt(controller.stager.stageData(Data("b".utf8), name: "b.txt", mimeType: "text/plain"))
        let a = NativeMediaReference(resource: first, isImage: false), b = NativeMediaReference(resource: second, isImage: false)
        var conversation = NativeConversation(); conversation.draft = "separate"; conversation.draftResourceIDs = [second.id]
        conversation.messages = [.init(id: "pending", role: .user, local: true, text: "", idempotencyKey: "same", delivery: .queued, media: [a])]
        let edit = try conversation.holdForEditing(messageID: "pending")
        try conversation.apply(edit, text: "", media: [a])
        XCTAssertEqual(conversation.draft, "separate"); XCTAssertEqual(conversation.draftResourceIDs, [second.id])
        XCTAssertEqual(conversation.messages[0].idempotencyKey, "same"); XCTAssertEqual(conversation.messages[0].delivery, .held)
        XCTAssertThrowsError(try conversation.apply(edit, text: "", media: []))
        XCTAssertThrowsError(try conversation.apply(edit, text: "changed", media: [b]))
        var stale = conversation; stale.messages[0].media = []
        XCTAssertThrowsError(try stale.apply(edit, text: "replacement"))
    }

    func testInterruptedMediaSendKeepsResourcesAndRequestIdentityWithoutReplay() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = try NativeConversationStore(directory: directory.appendingPathComponent("Chats"))
        let controller = try NativeMediaController(directory: directory.appendingPathComponent("Media")); try await controller.recover(cache: cache)
        let resource = try await controller.adopt(controller.stager.stageData(Data("uncertain bytes".utf8), name: "notes.txt", mimeType: "text/plain"),
                                                  route: .init(connectionID: "c", agentID: "a", sessionID: "s"))
        var conversation = NativeConversation()
        conversation.messages = [.init(id: "local", role: .user, local: true, text: "", idempotencyKey: "exact-request", delivery: .sending,
                                       media: [.init(resource: resource, isImage: false)])]
        try await cache.write(conversation, connectionID: "c", agentID: "a", sessionID: "s"); try await controller.confirm(resource.id)
        let recovered = try await cache.read(connectionID: "c", agentID: "a", sessionID: "s")
        XCTAssertEqual(recovered.messages[0].delivery, .uncertain)
        XCTAssertEqual(recovered.messages[0].idempotencyKey, "exact-request")
        XCTAssertEqual(recovered.messages[0].media[0].resourceID, resource.id)
    }

    func testJournalReceiptReopensAfterProviderFileWasDeletedAndDetectsTampering() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let source = directory.appendingPathComponent("source.txt")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try Data("source".utf8).write(to: source)
        let stager = try MediaImportStager(directory: directory.appendingPathComponent("Imports"))
        let staged = try stager.stageFile(from: source, name: "source.txt", mimeType: "text/plain")
        let metadata = try JSONDecoder().decode(MediaResource.self, from: JSONEncoder().encode(staged.metadata))
        try FileManager.default.removeItem(at: source)
        let reopened = try MediaImportStager(directory: directory.appendingPathComponent("Imports"))
        let receipt = try reopened.recover(metadata)
        XCTAssertEqual(receipt.id, staged.id)
        let library = try MediaLibrary(directory: directory.appendingPathComponent("Library")); let resource = try await library.adopt(receipt)
        XCTAssertEqual(resource.sha256, metadata.sha256)
        XCTAssertThrowsError(try reopened.recover(metadata))
    }

    @MainActor func testIndependentPreviewAndShareLeasesRetainUntilEachOperationCompletes() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = try NativeMediaController(directory: directory)
        let resource = try await controller.library.adopt(controller.stager.stageData(Data("share".utf8), name: "notes.txt", mimeType: "text/plain"))
        try await controller.library.retain(resource.id); try await controller.library.retain(resource.id)
        let preview = NativeMediaLease(resourceID: resource.id, library: controller.library)
        let systemOperation = NativeMediaLease(resourceID: resource.id, library: controller.library)
        await preview.release(); await preview.release()
        do { try await controller.library.remove(resource.id); XCTFail("System share still owns the file") } catch { }
        _ = try await controller.library.resourceURL(resource.id)
        let share = NativeMediaShare(url: try await controller.library.resourceURL(resource.id), lease: systemOperation)
        share.controllerCreated()
        await share.releaseIfUnpresented()
        do { try await controller.library.remove(resource.id); XCTFail("A created controller awaits actual appearance or dismantle") } catch { }
        await share.releaseIfUnpresented(controllerDismantled: true)
        try await controller.library.remove(resource.id)

        let appeared = try await controller.library.adopt(controller.stager.stageData(Data("handed off".utf8), name: "second.txt", mimeType: "text/plain"))
        try await controller.library.retain(appeared.id)
        let handed = NativeMediaShare(url: try await controller.library.resourceURL(appeared.id),
            lease: .init(resourceID: appeared.id, library: controller.library))
        handed.controllerCreated(); handed.appeared()
        await handed.releaseIfUnpresented(controllerDismantled: true)
        do { try await controller.library.remove(appeared.id); XCTFail("Actual share handoff waits for system completion") } catch { }
        await handed.completed(); await handed.completed()
        try await controller.library.remove(appeared.id)
    }

    func testDownloadedArtifactReopensOfflineWithoutAuthorizingAnotherScopeOrExpiredCache() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = try NativeMediaController(directory: directory)
        let key = MediaArtifactKey(connectionID: "c", sessionKey: "s", artifactID: "asset")
        let bytes = Data("downloaded output".utf8)
        let resource = try await controller.library.cacheArtifact(key: key, name: "result.txt", mimeType: "text/plain", size: bytes.count) { offset in
            XCTAssertEqual(offset, 0); return bytes
        }
        var reference = NativeMediaReference(resource: resource, isImage: false)
        reference.resourceID = nil; reference.artifactID = "asset"
        let reopened = try NativeMediaController(directory: directory)
        let restored = try await reopened.resolve(reference, route: .init(connectionID: "c", agentID: "a", sessionID: "s"), runtime: nil)
        XCTAssertEqual(restored.id, resource.id)
        let url = try await reopened.library.resourceURL(restored.id)
        XCTAssertEqual(try Data(contentsOf: url), bytes)
        for route in [ConversationID(connectionID: "other", agentID: "a", sessionID: "s"),
                      ConversationID(connectionID: "c", agentID: "a", sessionID: "other")] {
            do { _ = try await reopened.resolve(reference, route: route, runtime: nil); XCTFail("Cache must stay in its exact scope") } catch { }
        }
        let expired = try await reopened.library.cachedArtifact(key: key, now: resource.createdAt.addingTimeInterval(86_401))
        XCTAssertNil(expired)
        try Data("bad".utf8).write(to: url)
        do { _ = try await reopened.resolve(reference, route: .init(connectionID: "c", agentID: "a", sessionID: "s"), runtime: nil); XCTFail("Corrupt cache must not be previewed") } catch { }
    }

    @MainActor func testOldMediaLoadCompletionCannotRemoveReplacementOperation() {
        let model = NativeAppModel(), old = UUID(), current = UUID()
        model.mediaLoadRevisions["image"] = current
        model.mediaLoads["image"] = Task { }
        model.finishMediaLoad("image", token: old)
        XCTAssertEqual(model.mediaLoadRevisions["image"], current); XCTAssertNotNil(model.mediaLoads["image"])
        model.finishMediaLoad("image", token: current)
        XCTAssertNil(model.mediaLoadRevisions["image"]); XCTAssertNil(model.mediaLoads["image"])
    }

    @MainActor func testModelGuardUsesCurrentConversationAndWireAndHermesGlobalScope() throws {
        let model = NativeAppModel(), route = ConversationID(connectionID: "c", agentID: "a", sessionID: "s")
        let other = ConversationID(connectionID: "c", agentID: "a", sessionID: "other")
        var capabilities = RuntimeCapabilities(); capabilities.modelPerSession = true
        model.state = .init(connectionID: "c", phase: .ready, capabilities: capabilities)
        model.modelChoices[route] = ["text": .init(id: "text", name: "Text", selected: true, input: ["text"])]
        model.mediaModelRevisions[route] = model.wireRevision
        XCTAssertThrowsError(try model.validateMediaModel(route, hasImages: true))
        XCTAssertNoThrow(try model.validateMediaModel(other, hasImages: true))
        XCTAssertNoThrow(try model.validateMediaModel(route, hasImages: false))
        model.wireRevision = UUID()
        XCTAssertNoThrow(try model.validateMediaModel(route, hasImages: true))
        capabilities.modelPerSession = false
        model.state = .init(connectionID: "c", phase: .ready, capabilities: capabilities, backendKind: .hermes)
        model.mediaGlobalModel = (model.wireRevision, false)
        XCTAssertThrowsError(try model.validateMediaModel(other, hasImages: true))
        model.mediaGlobalModel = (model.wireRevision, true)
        model.mediaChangingModelTokens[route] = UUID()
        XCTAssertThrowsError(try model.validateMediaModel(other, hasImages: true))
        model.mediaChangingModelTokens = [:]
        XCTAssertNoThrow(try model.validateMediaModel(other, hasImages: true))
    }

    @MainActor func testSVGAndHTMLRemainFilesAndLargeInputUsesPreparedSafePixels() async throws {
        let directory = root(); defer { try? FileManager.default.removeItem(at: directory) }
        let controller = try NativeMediaController(directory: directory)
        for (name, mime) in [("drawing.svg", "image/svg+xml"), ("page.html", "text/html")] {
            let resource = try await controller.library.adopt(controller.stager.stageData(Data("<svg/>".utf8), name: name, mimeType: mime))
            let prepared = try await controller.prepare([resource.id]); XCTAssertFalse(prepared[0].isImage)
            let display = try await controller.display(resource.id, input: true); XCTAssertNil(display.image)
            let preview = try await NativeMediaPreview.create(display: display, library: controller.library)
            XCTAssertFalse(preview.allowsFilePreview); await preview.release()
        }
        let bitmap = try XCTUnwrap(CGContext(data: nil, width: 4_001, height: 4_001, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue))
        bitmap.setFillColor(CGColor(gray: 0.5, alpha: 1)); bitmap.fill(CGRect(x: 0, y: 0, width: 4_001, height: 4_001))
        let image = try XCTUnwrap(bitmap.makeImage()), data = NSMutableData()
        let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, nil); XCTAssertTrue(CGImageDestinationFinalize(destination))
        let resource = try await controller.library.adopt(controller.stager.stageData(data as Data, name: "large.jpg", mimeType: "image/jpeg"))
        let safe = try await controller.display(resource.id, input: true); let pixels = try XCTUnwrap(safe.image)
        let source = try XCTUnwrap(CGImageSourceCreateWithData(pixels as CFData, nil))
        let metadata = try XCTUnwrap(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        XCTAssertLessThanOrEqual(try XCTUnwrap(metadata[kCGImagePropertyPixelWidth] as? Int), 1_600)
        do { _ = try await controller.display(resource.id, input: false); XCTFail("Output preview cannot bypass its16MP bound") } catch { }
    }
}
