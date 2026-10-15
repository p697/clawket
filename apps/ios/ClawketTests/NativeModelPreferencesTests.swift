import ClawketPersistence
import Foundation
import XCTest
@testable import Clawket

private actor ModelPreferenceValues: ValueStore {
    private var values: [String: Data] = [:]
    private var failAfterReplacement = false
    func read(_ key: String) -> Data? { values[key] }
    func write(_ value: Data, for key: String) throws {
        values[key] = value
        if failAfterReplacement && key == "recent-models.v1" {
            failAfterReplacement = false
            throw StoreFailure.unavailable
        }
    }
    func remove(_ key: String) { values.removeValue(forKey: key) }
    func failNextReplacement() { failAfterReplacement = true }
    func inject(_ value: Data) { values["recent-models.v1"] = value }
}

final class NativeModelPreferencesTests: XCTestCase, @unchecked Sendable {
    func testRecentModelsRemainConnectionScopedAndBoundedAfterReopening() async throws {
        let values = ModelPreferenceValues(), store = try NativeModelPreferences(values: values)
        for index in 0..<8 { _ = try await store.record("m\(index)", connectionID: "first") }
        _ = try await store.record("m4", connectionID: "first")
        _ = try await store.record("other", connectionID: "second")
        let reopened = try NativeModelPreferences(values: values)
        let first = try await reopened.read(connectionID: "first")
        let second = try await reopened.read(connectionID: "second")
        XCTAssertEqual(first, ["m4", "m7", "m6", "m5", "m3", "m2"])
        XCTAssertEqual(second, ["other"])
        let missing = try await reopened.read(connectionID: "absent")
        XCTAssertTrue(missing.isEmpty)
    }

    func testMalformedOrOversizedPreferencesCannotBecomeAnEmptySuccessfulRead() async throws {
        let values = ModelPreferenceValues()
        for document in [NativeModelPreferencesDocument(version: 2),
                         .init(recent: ["c": ["same", "same"]]),
                         .init(recent: ["": ["m"]]),
                         .init(recent: ["c": Array(repeating: "m", count: 7)])] {
            await values.inject(try JSONEncoder().encode(document))
            let store = try NativeModelPreferences(values: values)
            do { _ = try await store.read(connectionID: "c"); XCTFail("Accepted malformed preferences") }
            catch { XCTAssertEqual(error as? StoreFailure, .invalidDocument) }
        }
        var full = NativeModelPreferencesDocument(recent: Dictionary(uniqueKeysWithValues: (0..<128).map { ("c\($0)", ["m"]) }))
        XCTAssertThrowsError(try full.record("m", connectionID: "overflow"))
        XCTAssertEqual(full.recent.count, 128)
    }

    func testUnknownAtomicWriteCannotOverwriteItsCommittedResultFromStaleMemory() async throws {
        let values = ModelPreferenceValues(), store = try NativeModelPreferences(values: values)
        _ = try await store.record("old", connectionID: "c")
        await values.failNextReplacement()
        do { _ = try await store.record("committed", connectionID: "c"); XCTFail("Unknown commit succeeded") }
        catch { XCTAssertEqual(error as? StoreFailure, .unavailable) }
        do { _ = try await store.record("stale", connectionID: "c"); XCTFail("Stale memory overwrote unknown commit") }
        catch { XCTAssertEqual(error as? StoreFailure, .verificationFailed) }
        let reopened = try NativeModelPreferences(values: values)
        let result = try await reopened.read(connectionID: "c")
        XCTAssertEqual(result, ["committed", "old"])
    }
}
