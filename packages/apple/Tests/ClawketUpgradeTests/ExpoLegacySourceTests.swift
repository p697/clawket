import CryptoKit
import Foundation
import Security
import XCTest
@testable import ClawketUpgrade

final class ExpoLegacySourceTests: XCTestCase, @unchecked Sendable {
    private func container() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("clawket-upgrade-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }

    private func store(_ root: URL, name: String = "Library/Application Support/test.bundle/RCTAsyncLocalStorage_V1", manifest: Any) throws -> URL {
        let directory = root.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try upgradeTestJSON(manifest).write(to: directory.appendingPathComponent("manifest.json"))
        return directory
    }

    func testActualInlineAndMD5FilesFilterUnrelatedKeysWithoutChangingSource() async throws {
        let root = try container(), text = "draft · 中文 · 😀"
        let key = "clawket.chatCache.msgs.connection::agent::session"
        let directory = try store(root, manifest: ["clawket.installMarker.v1": "1", "clawket.draft.v1": text, key: NSNull(), "posthog-rn-anon-id": "not imported"])
        let name = Insecure.MD5.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        try Data("[\"original chat bytes\"]".utf8).write(to: directory.appendingPathComponent(name))
        let before = try Data(contentsOf: directory.appendingPathComponent("manifest.json"))
        let source = try ExpoLegacySource(container: root, bundleIdentifier: "test.bundle", secure: UpgradeMemorySource())
        let ids = try await source.listValues()
        XCTAssertEqual(ids.count, 3)
        XCTAssertFalse(ids.contains { $0.key == "posthog-rn-anon-id" })
        let inline = try await source.readValue(.init(domain: .asyncStorage, key: "clawket.draft.v1"))
        let external = try await source.readValue(.init(domain: .asyncStorage, key: key))
        XCTAssertEqual(inline, Data(text.utf8)); XCTAssertEqual(external, Data("[\"original chat bytes\"]".utf8))
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("manifest.json")), before)
    }

    func testCurrentStoreWinsRetainedLegacyAndOldestLayoutsRemainReadable() async throws {
        let root = try container()
        _ = try store(root, name: "Documents/RCTAsyncLocalStorage", manifest: ["clawket.test": "old"])
        _ = try store(root, manifest: ["clawket.test": "current"])
        let source = try ExpoLegacySource(container: root, bundleIdentifier: "test.bundle", secure: UpgradeMemorySource())
        let value = try await source.readValue(.init(domain: .asyncStorage, key: "clawket.test"))
        XCTAssertEqual(value, Data("current".utf8))
        for name in ["Documents/RCTAsyncLocalStorage", "Documents/RCTAsyncLocalStorage_V1"] {
            let olderRoot = try container()
            _ = try store(olderRoot, name: name, manifest: ["agent_avatars": "{}"])
            let older = try ExpoLegacySource(container: olderRoot, bundleIdentifier: "test.bundle", secure: UpgradeMemorySource())
            let ids = try await older.listValues()
            XCTAssertEqual(ids, [.init(domain: .asyncStorage, key: "agent_avatars")])
        }
    }

    func testCorruptManifestMissingNullFileAndTiedConflictingStoresFailClosed() async throws {
        let root = try container()
        let directory = try store(root, manifest: ["clawket.missing": NSNull()])
        let missing = try ExpoLegacySource(container: root, bundleIdentifier: "test.bundle", secure: UpgradeMemorySource())
        do { _ = try await missing.readValue(.init(domain: .asyncStorage, key: "clawket.missing")); XCTFail("missing file became empty") }
        catch let error as UpgradeFailure { XCTAssertEqual(error, .missingResource) }
        try Data("[]".utf8).write(to: directory.appendingPathComponent("manifest.json"))
        let corrupt = try ExpoLegacySource(container: root, bundleIdentifier: "test.bundle", secure: UpgradeMemorySource())
        do { _ = try await corrupt.listValues(); XCTFail("corrupt manifest became empty") } catch { XCTAssertEqual(error as? UpgradeFailure, .malformedSource) }
        let oldRoot = try container()
        for (name, value) in [("Documents/RCTAsyncLocalStorage", "a"), ("Documents/RCTAsyncLocalStorage_V1", "b")] {
            let old = try store(oldRoot, name: name, manifest: ["clawket.test": value])
            try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: 1)], ofItemAtPath: old.appendingPathComponent("manifest.json").path)
        }
        let ambiguous = try ExpoLegacySource(container: oldRoot, bundleIdentifier: "test.bundle", secure: UpgradeMemorySource())
        do { _ = try await ambiguous.listValues(); XCTFail("ambiguous source selected") } catch { XCTAssertEqual(error as? UpgradeFailure, .ambiguousSource) }
    }

    func testSymlinkLeafAndAncestorAreRejected() async throws {
        let root = try container(), outside = try container(), key = "clawket.test"
        let directory = try store(root, manifest: [key: NSNull()])
        let target = outside.appendingPathComponent("data"); try Data("must not follow".utf8).write(to: target)
        let name = Insecure.MD5.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        try FileManager.default.createSymbolicLink(at: directory.appendingPathComponent(name), withDestinationURL: target)
        let leaf = try ExpoLegacySource(container: root, bundleIdentifier: "test.bundle", secure: UpgradeMemorySource())
        do { _ = try await leaf.readValue(.init(domain: .asyncStorage, key: key)); XCTFail("followed symlink") } catch { XCTAssertEqual(error as? UpgradeFailure, .unsafePath) }
        let other = try container()
        _ = try store(outside, name: "Application Support/test.bundle/RCTAsyncLocalStorage_V1", manifest: [key: "unsafe"])
        try FileManager.default.createSymbolicLink(at: other.appendingPathComponent("Library"), withDestinationURL: outside)
        let ancestor = try ExpoLegacySource(container: other, bundleIdentifier: "test.bundle", secure: UpgradeMemorySource())
        do { _ = try await ancestor.listValues(); XCTFail("followed ancestor symlink") } catch { XCTAssertEqual(error as? UpgradeFailure, .unsafePath) }
    }

    func testFullLengthUnsentRecordingIsStreamedAndRetainedAboveValueStoreLimit() async throws {
        let root = try container(), id = String(repeating: "a", count: 32)
        let folder = root.appendingPathComponent("Documents/voice-drafts-v1/\(id)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let audio = folder.appendingPathComponent("audio.pcm")
        XCTAssertTrue(FileManager.default.createFile(atPath: audio.path, contents: nil))
        let file = try FileHandle(forWritingTo: audio)
        var hash = SHA256(), bytes = 0
        while bytes < 19_200_000 {
            let chunk = Data(repeating: 23, count: min(64 * 1024, 19_200_000 - bytes))
            try file.write(contentsOf: chunk); hash.update(data: chunk); bytes += chunk.count
        }
        try file.close()
        let source = try ExpoLegacySource(container: root, bundleIdentifier: "test.bundle", secure: UpgradeMemorySource())
        let paths = try await source.listResourcePaths()
        let expectedPath = "Documents/voice-drafts-v1/\(id)/audio.pcm"
        XCTAssertEqual(paths, [expectedPath])
        let result = try await source.inspectResource(expectedPath)
        XCTAssertEqual(result.byteCount, 19_200_000)
        XCTAssertEqual(result.sha256, hash.finalize().map { String(format: "%02x", $0) }.joined())
        let firstBytes = try await source.readResourceChunk(expectedPath, offset: 0, maximumBytes: 10)
        XCTAssertEqual(firstBytes, Data(repeating: 23, count: 10))
        XCTAssertTrue(FileManager.default.fileExists(atPath: audio.path))
    }

    func testExpoKeychainAttributesAndWrongApplicationGuardWithoutReadingKeychain() throws {
        XCTAssertEqual(ExpoSecureStoreReader.services, ["app:no-auth", "app:auth", "app"])
        let key = "clawket.identity.v1", bytes = Data(key.utf8)
        let query = ExpoSecureStoreReader.query(service: "app:no-auth", key: key)
        XCTAssertEqual(query[kSecAttrAccount] as? Data, bytes)
        XCTAssertEqual(query[kSecAttrGeneric] as? Data, bytes)
        XCTAssertEqual(query[kSecAttrService] as? String, "app:no-auth")
        for account in [bytes as Any, key as Any] {
            XCTAssertEqual(try ExpoSecureStoreReader.legacyKey(attributes: [kSecAttrAccount: account, kSecAttrGeneric: bytes]), key)
        }
        XCTAssertThrowsError(try ExpoSecureStoreReader.legacyKey(attributes: [kSecAttrAccount: key, kSecAttrGeneric: Data("other".utf8)]))
        XCTAssertNil(try ExpoSecureStoreReader.legacyKey(attributes: [kSecAttrAccount: "unrelated-sdk-key"]))
        XCTAssertThrowsError(try ExpoLegacySource.currentApplication(expectedBundleIdentifier: "invalid.not-running-app")) { XCTAssertEqual($0 as? UpgradeFailure, .wrongApplication) }
    }
}
