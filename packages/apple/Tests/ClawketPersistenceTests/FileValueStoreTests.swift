import Foundation
import XCTest
@testable import ClawketPersistence

final class FileValueStoreTests: XCTestCase, @unchecked Sendable {
    func testAtomicOpaqueFileRoundTripAndLimit() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try FileValueStore(directory: directory, maximumBytes: 32)
        let key = "session/../../private-name"
        let data = Data("草稿".utf8)
        try await store.write(data, for: key)
        let read = try await store.read(key)
        XCTAssertEqual(read, data)
        let files = try FileManager.default.contentsOfDirectory(atPath: directory.path)
        XCTAssertEqual(files.count, 1)
        XCTAssertFalse(files[0].contains("session"))
        do { try await store.write(Data(repeating: 1, count: 33), for: key); XCTFail("Accepted over-limit write") }
        catch { XCTAssertEqual(error as? StoreFailure, .tooLarge) }
        let unchanged = try await store.read(key)
        XCTAssertEqual(unchanged, data)
        try await store.remove(key)
        let removed = try await store.read(key)
        XCTAssertNil(removed)
    }

    func testRejectsOversizedAndSymlinkedFiles() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try FileValueStore(directory: directory, maximumBytes: 16)
        try await store.write(Data([1]), for: "draft")
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        let file = try XCTUnwrap(files.first)
        try Data(repeating: 2, count: 17).write(to: file)
        do { _ = try await store.read("draft"); XCTFail("Accepted oversized file") }
        catch { XCTAssertEqual(error as? StoreFailure, .tooLarge) }
        try FileManager.default.removeItem(at: file)
        try FileManager.default.createSymbolicLink(at: file, withDestinationURL: directory)
        do { _ = try await store.read("draft"); XCTFail("Followed symlink") }
        catch { XCTAssertEqual(error as? StoreFailure, .unavailable) }
    }
}
