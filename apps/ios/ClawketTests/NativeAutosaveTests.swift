import ClawketMedia
import ClawketRuntime
import ClawketUI
import Foundation
import XCTest
@testable import Clawket

final class NativeAutosaveTests: XCTestCase, @unchecked Sendable {
    private let route = ConversationID(connectionID: "autosave", agentID: "agent", sessionID: "session")

    private func directory() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString) }

    @MainActor private func writing(_ model: NativeAppModel) async throws {
        let deadline = ContinuousClock.now + .seconds(5)
        while model.autosaveAttempts[route]?.write == nil {
            guard ContinuousClock.now < deadline else { XCTFail("Save never reached its actual persist call"); throw CancellationError() }
            try await Task.sleep(for: .milliseconds(1))
        }
    }

    @MainActor private func blockedSave<Value>(_ model: NativeAppModel, cache: NativeConversationStore,
                                               change: () throws -> Value) async throws -> (Task<Void, Never>, Value) {
        await cache.acquireMediaSnapshot()
        model.scheduleSave(route, immediate: true)
        let scheduled = model.saveTasks[route]
        do {
            let task = try XCTUnwrap(scheduled)
            try await writing(model)
            let value = try change()
            await cache.releaseMediaSnapshot()
            return (task, value)
        } catch {
            let latest = model.saveTasks[route]
            model.cancelScheduledSave(route)
            await cache.releaseMediaSnapshot()
            if let scheduled { await scheduled.value }
            if let latest { await latest.value }
            throw error
        }
    }

    @MainActor private func seed(_ root: URL) async throws -> (NativeAppModel, NativeConversationStore, MediaLibrary) {
        let cache = try NativeConversationStore(directory: root.appendingPathComponent("Conversations"))
        let stager = try MediaImportStager(directory: root.appendingPathComponent("Imports"))
        let library = try MediaLibrary(directory: root.appendingPathComponent("Media"))
        var resources: [UUID] = []
        for index in 0..<3 {
            let staged = try stager.stageData(Data("Synthetic attachment \(index)".utf8), name: "qa-\(index).txt", mimeType: "text/plain")
            resources.append(try await library.adopt(staged).id)
        }
        let epoch = UUID(), model = NativeAppModel()
        let document = NativeConversation(revision: 1, draft: "独立草稿", messages: [
            .init(id: "owned", role: .user, local: true, text: "Held input", idempotencyKey: "original-owned-input", delivery: .held, historyEpoch: epoch)
        ], draftResourceIDs: resources, historyEpoch: epoch, physicalSessionID: "physical")
        try await cache.write(document, connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
        model.cache = cache; model.documents[route] = document
        model.presentation.draft(for: route).text = document.draft
        return (model, cache, library)
    }

    private func blockDirectory(_ root: URL) throws {
        let folder = root.appendingPathComponent("Conversations")
        try FileManager.default.moveItem(at: folder, to: root.appendingPathComponent("Preserved"))
        try Data("Unavailable storage".utf8).write(to: folder)
    }

    private func restoreDirectory(_ root: URL) throws -> NativeConversationStore {
        let folder = root.appendingPathComponent("Conversations")
        try FileManager.default.removeItem(at: folder)
        try FileManager.default.moveItem(at: root.appendingPathComponent("Preserved"), to: folder)
        return try NativeConversationStore(directory: folder)
    }

    @MainActor private func failCurrentSave(_ model: NativeAppModel, root: URL) async throws -> String {
        try blockDirectory(root)
        model.scheduleSave(route, immediate: true)
        let task = try XCTUnwrap(model.saveTasks[route]); await task.value
        return try XCTUnwrap(model.presentation.draft(for: route).hint)
    }

    @MainActor func testReplacementCancelsAnAdmittedStoreWriteWithoutReportingDraftFailureOrLosingFiles() async throws {
        let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
        let (model, cache, library) = try await seed(root)
        let original = try XCTUnwrap(model.documents[route])
        let (old, latest) = try await blockedSave(model, cache: cache) {
            model.handle(.draftChanged(route, "后来的中文草稿"))
            return try XCTUnwrap(model.saveTasks[route])
        }
        await old.value; await latest.value
        XCTAssertNil(model.presentation.draft(for: route).hint)
        let saved = try await cache.read(connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
        XCTAssertEqual(saved.draft, "后来的中文草稿")
        XCTAssertEqual(saved.draftResourceIDs, original.draftResourceIDs)
        XCTAssertEqual(saved.messages, original.messages)
        for id in saved.draftResourceIDs { _ = try await library.resourceURL(id) }
        XCTAssertNil(model.autosaveAttempts[route])
    }

    @MainActor func testActivationChangeDuringDebounceStillPersistsTheOfflineDraft() async throws {
        let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
        let (model, cache, _) = try await seed(root)
        model.handle(.draftChanged(route, "离线切换后仍须保存的草稿"))
        let task = try XCTUnwrap(model.saveTasks[route])
        // This happens before the scheduled task can run or finish its production debounce.
        model.activationRevision = UUID(); model.activationRevision = UUID()
        await task.value
        let saved = try await cache.read(connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
        XCTAssertEqual(saved.draft, "离线切换后仍须保存的草稿")
        XCTAssertEqual(saved.draftResourceIDs.count, 3)
        XCTAssertNil(model.presentation.draft(for: route).hint)
    }

    @MainActor func testExplicitRetirementDuringStoreWaitCannotPublishFailure() async throws {
        let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
        let (model, cache, _) = try await seed(root)
        let (old, _) = try await blockedSave(model, cache: cache) { model.cancelScheduledSave(route) }
        await old.value
        XCTAssertNil(model.presentation.draft(for: route).hint)
        XCTAssertNil(model.autosaveAttempts[route])
        let saved = try await cache.read(connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
        XCTAssertEqual(saved.revision, 1); XCTAssertEqual(saved.draftResourceIDs.count, 3)
    }

    @MainActor func testCurrentStorageFailureRemainsVisibleUntilActualLatestWriteSucceeds() async throws {
        let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
        let (model, _, library) = try await seed(root)
        let original = try XCTUnwrap(model.documents[route])
        _ = try await failCurrentSave(model, root: root)
        XCTAssertEqual(model.documents[route]?.draftResourceIDs, original.draftResourceIDs)
        let cache = try restoreDirectory(root); model.cache = cache
        model.scheduleSave(route, immediate: true)
        let task = try XCTUnwrap(model.saveTasks[route]); await task.value
        XCTAssertNil(model.presentation.draft(for: route).hint)
        let saved = try await cache.read(connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
        XCTAssertEqual(try historyEncode(saved), try historyEncode(original))
        for id in saved.draftResourceIDs { _ = try await library.resourceURL(id) }
    }

    @MainActor func testSuccessfulRetryCannotClearAReplacementMediaOrVoiceHint() async throws {
        for otherHint in ["Review these attachments.", "Recording saved. Use text when ready.",
                          String(localized: "This draft could not be saved. Keep Clawket open and try again.")] {
            let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
            let (model, _, _) = try await seed(root)
            _ = try await failCurrentSave(model, root: root)
            model.presentation.draft(for: route).hint = otherHint
            model.cache = try restoreDirectory(root)
            model.scheduleSave(route, immediate: true)
            let task = try XCTUnwrap(model.saveTasks[route]); await task.value
            XCTAssertEqual(model.presentation.draft(for: route).hint, otherHint)
        }
    }

    @MainActor func testLateRealFailureCannotPublishAcrossActivationEpochOrDocumentReplacement() async throws {
        for changedContext in 0..<3 {
            let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
            let (model, cache, _) = try await seed(root)
            let (old, _) = try await blockedSave(model, cache: cache) {
                if changedContext == 0 { model.activationRevision = UUID(); model.activationRevision = UUID() }
                else if changedContext == 1 { model.documents[route]?.historyEpoch = UUID() }
                else { model.documents[route]?.revision += 1 }
                model.presentation.draft(for: route).hint = "Current independent hint"
                try blockDirectory(root)
            }
            await old.value
            XCTAssertEqual(model.presentation.draft(for: route).hint, "Current independent hint")
        }
    }

    @MainActor func testCompletedOlderRevisionCannotClearFailureForAnUnsavedNewerDraft() async throws {
        let root = directory(); defer { try? FileManager.default.removeItem(at: root) }
        let (model, _, _) = try await seed(root)
        let failureHint = try await failCurrentSave(model, root: root)
        let cache = try restoreDirectory(root); model.cache = cache
        let (old, _) = try await blockedSave(model, cache: cache) {
            model.documents[route]?.draft = "Still unsaved"; model.documents[route]?.revision += 1
        }
        await old.value
        XCTAssertEqual(model.presentation.draft(for: route).hint, failureHint)
        model.scheduleSave(route, immediate: true)
        let task = try XCTUnwrap(model.saveTasks[route]); await task.value
        XCTAssertNil(model.presentation.draft(for: route).hint)
        let saved = try await cache.read(connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID)
        XCTAssertEqual(saved.draft, "Still unsaved")
    }
}
