import Foundation
import XCTest
@testable import ClawketPersistence

private struct Document: Codable, Equatable, Sendable {
    var revision: Int
    var draft: String
}

private actor MemoryValues: ValueStore {
    var values: [String: Data] = [:]
    var corruptNextWrite = false
    var unavailable = false
    func read(_ key: String) throws -> Data? {
        if unavailable { throw StoreFailure.unavailable }
        return values[key]
    }
    func write(_ value: Data, for key: String) {
        values[key] = corruptNextWrite ? Data("corrupted".utf8) : value
        corruptNextWrite = false
    }
    func remove(_ key: String) { values.removeValue(forKey: key) }
    func inject(_ value: Data, key: String) { values[key] = value }
    func corruptNext() { corruptNextWrite = true }
    func failReads() { unavailable = true }
}

final class DocumentStoreTests: XCTestCase, @unchecked Sendable {
    func testReadBackAndRecoverCorruptPrimaryWithoutErasingSource() async throws {
        let values = MemoryValues()
        let store = try DocumentStore(values: values)
        let first = Document(revision: 1, draft: "未发送的草稿")
        try await store.write(first, key: "registry")
        try await store.write(Document(revision: 2, draft: "new"), key: "registry")
        await values.inject(Data("broken".utf8), key: "registry")
        let result = try await store.read(Document.self, key: "registry")
        XCTAssertEqual(result?.value, first)
        XCTAssertEqual(result?.recoveredFromRollback, true)
        let source = try await values.read("registry")
        XCTAssertEqual(source, Data("broken".utf8))
    }

    func testUnreadableRegistryNeverBecomesEmptyState() async throws {
        let values = MemoryValues()
        let store = try DocumentStore(values: values)
        await values.inject(Data("{}".utf8), key: "registry")
        do { _ = try await store.read(Document.self, key: "registry"); XCTFail("Accepted corrupt source") }
        catch { XCTAssertEqual(error as? StoreFailure, .invalidDocument) }
        await values.failReads()
        do { _ = try await store.read(Document.self, key: "registry"); XCTFail("Ignored inaccessible storage") }
        catch { XCTAssertEqual(error as? StoreFailure, .unavailable) }
    }

    func testBackupVerificationFailureDoesNotOverwriteCurrent() async throws {
        let values = MemoryValues()
        let store = try DocumentStore(values: values)
        let original = Document(revision: 1, draft: "keep")
        try await store.write(original, key: "registry")
        await values.corruptNext()
        do { try await store.write(Document(revision: 2, draft: "next"), key: "registry"); XCTFail("Ignored corrupt backup") }
        catch { XCTAssertEqual(error as? StoreFailure, .verificationFailed) }
        let read = try await store.read(Document.self, key: "registry")
        XCTAssertEqual(read?.value, original)
        XCTAssertEqual(read?.recoveredFromRollback, false)
    }

    func testPrimaryVerificationFailureIsExplicit() async throws {
        let values = MemoryValues()
        let store = try DocumentStore(values: values)
        await values.corruptNext()
        do { try await store.write(Document(revision: 1, draft: "draft"), key: "registry"); XCTFail("Ignored corrupt write") }
        catch { XCTAssertEqual(error as? StoreFailure, .verificationFailed) }
    }

    func testWritesRemainSerialAcrossAwaitedValueOperations() async throws {
        let values = MemoryValues()
        let store = try DocumentStore(values: values)
        try await withThrowingTaskGroup(of: Void.self) { group in
            for revision in 1...40 {
                group.addTask { try await store.write(Document(revision: revision, draft: String(revision)), key: "registry") }
            }
            try await group.waitForAll()
        }
        let result = try await store.read(Document.self, key: "registry")
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.value.draft, result.map { String($0.value.revision) })
        XCTAssertEqual(result?.recoveredFromRollback, false)
        let backup = try await values.read("registry.rollback")
        XCTAssertNotNil(backup.flatMap { try? JSONDecoder().decode(Document.self, from: $0) })
    }

    func testRemoveCannotResurrectRollback() async throws {
        let values = MemoryValues()
        let store = try DocumentStore(values: values)
        try await store.write(Document(revision: 1, draft: "one"), key: "draft")
        try await store.write(Document(revision: 2, draft: "two"), key: "draft")
        try await store.remove(key: "draft")
        let read = try await store.read(Document.self, key: "draft")
        XCTAssertNil(read)
    }

    func testScopeEncodingDoesNotCollideOrExposeRoute() throws {
        let first = try DocumentStore.scopedKey(namespace: "draft", parts: ["a::b", "c"])
        let second = try DocumentStore.scopedKey(namespace: "draft", parts: ["a", "b::c"])
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(first, try DocumentStore.scopedKey(namespace: "draft", parts: ["a::b", "c"]))
        XCTAssertEqual(first.count, 70)
        XCTAssertFalse(first.contains("a::b"))
    }

    func testLimitsRejectBeforeWriting() async throws {
        let values = MemoryValues()
        let store = try DocumentStore(values: values, maximumBytes: 32)
        do { try await store.write(Document(revision: 1, draft: String(repeating: "a", count: 33)), key: "draft"); XCTFail("Accepted oversized document") }
        catch { XCTAssertEqual(error as? StoreFailure, .tooLarge) }
        let read = try await values.read("draft")
        XCTAssertNil(read)
        do { _ = try await store.read(Document.self, key: "draft.rollback"); XCTFail("Accepted reserved key") }
        catch { XCTAssertEqual(error as? StoreFailure, .invalidKey) }
    }
}
