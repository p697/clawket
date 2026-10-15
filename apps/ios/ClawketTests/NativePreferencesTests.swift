import ClawketPersistence
import ClawketUI
import Foundation
import XCTest
@testable import Clawket

private actor PreferenceValues: ValueStore {
    private var values: [String: Data] = [:]
    private var failureKey: String?
    func read(_ key: String) -> Data? { values[key] }
    func write(_ value: Data, for key: String) throws {
        values[key] = value
        if failureKey == key { failureKey = nil; throw StoreFailure.unavailable }
    }
    func remove(_ key: String) { values.removeValue(forKey: key) }
    func failAfterReplacement(_ key: String) { failureKey = key }
    func inject(_ data: Data, key: String) { values[key] = data }
}

final class NativePreferencesTests: XCTestCase, @unchecked Sendable {
    private var route: ConversationID { .init(connectionID: "c", agentID: "a", sessionID: "secondary") }

    func testFreeAppearanceDefaultsAndVerifiedPersistenceRemainIndependentOfNavigation() async throws {
        let values = PreferenceValues(), store = try NativePreferencesStore(values: values)
        let initial = try await store.appearance()
        XCTAssertEqual(initial.value, .init())
        XCTAssertEqual(initial.value.theme, .system); XCTAssertFalse(initial.value.showAgentAvatar)
        var appearance = initial; appearance.revision = 1
        appearance.value = .init(theme: .dark, accent: .jadeGreen, chatFontSize: 20, showAgentAvatar: true)
        try await store.write(appearance)
        _ = try await store.navigation()
        var navigation = NativeNavigationDocument(); try navigation.record(.init(route)); try await store.write(navigation)
        let reopened = try NativePreferencesStore(values: values)
        let restored = try await reopened.appearance(), nav = try await reopened.navigation()
        XCTAssertEqual(restored.value, appearance.value)
        XCTAssertEqual(nav.targets.first?.route, route)
    }

    func testNavigationPersistsExactSecondaryAndCatalogWithIndependentReadingContext() async throws {
        let values = PreferenceValues(), store = try NativePreferencesStore(values: values)
        var document = try await store.navigation()
        try document.record(.init(route))
        try document.record(.init(followsBottom: false, messageID: "render-row", offset: -82.5), route: route)
        try document.record(.init(AgentCatalogID(connectionID: "other", agentID: "sessions-first")))
        try await store.write(document)
        let reopened = try NativePreferencesStore(values: values)
        let restored = try await reopened.navigation()
        XCTAssertEqual(restored.targets.first?.route?.sessionID, "secondary")
        XCTAssertEqual(restored.targets.last?.kind, .catalog)
        XCTAssertNil(restored.targets.last?.sessionID)
        XCTAssertEqual(restored.readings.first?.context.offset, -82.5)
        // There is no run, credentials, receipt, request, decision or RPC reference in this document.
        let data = try JSONSerialization.jsonObject(with: JSONEncoder().encode(restored)) as? [String: Any]
        XCTAssertEqual(Set(data?.keys.map { $0 } ?? []), ["version", "revision", "targets", "readings"])
    }

    func testUnknownAtomicOutcomeCannotBeOverwrittenByLatePreferenceOrNavigationSnapshot() async throws {
        for key in ["appearance.v1", "navigation.v1"] {
            let values = PreferenceValues(), store = try NativePreferencesStore(values: values)
            _ = try await store.appearance(); _ = try await store.navigation()
            await values.failAfterReplacement(key)
            do {
                if key == "appearance.v1" { try await store.write(NativeAppearanceDocument(revision: 1, value: .init(theme: .dark))) }
                else { var nav = NativeNavigationDocument(); try nav.record(.init(route)); try await store.write(nav) }
                XCTFail("Unknown replacement was reported as verified")
            } catch { XCTAssertEqual(error as? StoreFailure, .unavailable) }
            do {
                if key == "appearance.v1" { try await store.write(NativeAppearanceDocument(revision: 2)) }
                else { try await store.write(NativeNavigationDocument(revision: 2)) }
                XCTFail("Stale memory overwrote an unknown replacement")
            } catch { XCTAssertEqual(error as? StoreFailure, .verificationFailed) }
            let reopened = try NativePreferencesStore(values: values)
            if key == "appearance.v1" {
                let result = try await reopened.appearance(); XCTAssertEqual(result.value.theme, .dark)
            } else {
                let result = try await reopened.navigation(); XCTAssertEqual(result.targets.first?.route, route)
            }
        }
    }

    func testLateDebouncedNavigationSnapshotCannotReplaceNewerPosition() async throws {
        let values = PreferenceValues(), store = try NativePreferencesStore(values: values)
        var old = try await store.navigation(); try old.record(.init(route))
        var latest = old; try latest.record(.init(followsBottom: false, messageID: "latest", offset: 9), route: route)
        try await store.write(latest); try await store.write(old)
        let reopened = try NativePreferencesStore(values: values)
        let result = try await reopened.navigation()
        XCTAssertEqual(result.readings.first?.context.messageID, "latest")
        XCTAssertEqual(result.revision, latest.revision)
    }

    func testCorruptPreferencesBoundsAndCounterCannotBecomeSuccessfulDefaults() async throws {
        for value in [NativeAppearanceDocument(version: 2), .init(value: .init(chatFontSize: 11)), .init(revision: Int64.max)] {
            let values = PreferenceValues()
            await values.inject(try JSONEncoder().encode(value), key: "appearance.v1")
            let store = try NativePreferencesStore(values: values)
            do { _ = try await store.appearance(); XCTFail("Malformed appearance accepted") }
            catch { XCTAssertEqual(error as? StoreFailure, .invalidDocument) }
        }
        var nav = NativeNavigationDocument(revision: 9_007_199_254_740_991)
        XCTAssertThrowsError(try nav.record(.init(route)))
        XCTAssertEqual(nav.revision, 9_007_199_254_740_991)
        let corrupt = NativeNavigationDocument(readings: [.init(route: .init(route), context: .init(followsBottom: false))])
        XCTAssertThrowsError(try corrupt.validate())
        let values = PreferenceValues(); await values.inject(Data(repeating: 65, count: 256 * 1_024 + 1), key: "navigation.v1")
        let store = try NativePreferencesStore(values: values)
        do { _ = try await store.navigation(); XCTFail("Oversize navigation accepted") }
        catch { XCTAssertEqual(error as? StoreFailure, .invalidDocument) }
    }

    func testNavigationBoundsEvictOldDisplayContextsWithoutChangingOtherConnections() throws {
        var document = NativeNavigationDocument()
        for index in 0..<130 {
            let route = ConversationID(connectionID: "c\(index)", agentID: "a", sessionID: "s")
            try document.record(.init(route)); try document.record(.init(), route: route)
        }
        try document.validate()
        XCTAssertEqual(document.targets.count, 128); XCTAssertEqual(document.readings.count, 128)
        XCTAssertEqual(document.targets.first?.connectionID, "c2")
        XCTAssertEqual(document.targets.last?.connectionID, "c129")
    }

    func testRestorationWaitsForExactEvidenceAndNeverFallsBackToMainConversation() {
        let target = NativeNavigationTarget(route), main = ConversationID(connectionID: "c", agentID: "a", sessionID: "main")
        XCTAssertEqual(NativeNavigationRestoration.decide(target, connectionID: "c", agents: [], sessions: [], fresh: false), .wait)
        XCTAssertEqual(NativeNavigationRestoration.decide(target, connectionID: "c", agents: ["a"], sessions: [main], fresh: false), .wait)
        XCTAssertEqual(NativeNavigationRestoration.decide(target, connectionID: "c", agents: ["a"], sessions: [main], fresh: true), .catalog(target.catalog))
        XCTAssertEqual(NativeNavigationRestoration.decide(target, connectionID: "c", agents: ["a"], sessions: [route], fresh: false), .conversation(route))
        XCTAssertEqual(NativeNavigationRestoration.decide(target, connectionID: "different", agents: ["a"], sessions: [route], fresh: true), .home)
        XCTAssertEqual(NativeNavigationRestoration.decide(target, connectionID: "c", agents: [], sessions: [route], fresh: true), .home)
        let catalog = NativeNavigationTarget(AgentCatalogID(connectionID: "c", agentID: "a"))
        XCTAssertEqual(NativeNavigationRestoration.decide(catalog, connectionID: "c", agents: ["a"], sessions: [], fresh: true), .catalog(catalog.catalog))
    }

    func testOpaqueUnicodeIDsRequireExactBytesRatherThanCanonicalEquivalence() throws {
        let first = ConversationID(connectionID: "c", agentID: "a", sessionID: "\u{e9}")
        let second = ConversationID(connectionID: "c", agentID: "a", sessionID: "e\u{301}")
        XCTAssertNotEqual(NativeStoredRoute(first), NativeStoredRoute(second))
        XCTAssertEqual(NativeNavigationRestoration.decide(.init(first), connectionID: "c", agents: ["a"], sessions: [second], fresh: true), .catalog(.init(connectionID: "c", agentID: "a")))
        var doc = NativeNavigationDocument()
        try doc.record(.init(followsBottom: false, messageID: "one"), route: first)
        try doc.record(.init(followsBottom: false, messageID: "two"), route: second)
        try doc.validate(); XCTAssertEqual(doc.readings.count, 2)
    }
    @MainActor func testCachedOpenRemainsPendingUntilFreshMissingArchivedOrExactCatalogEvidence() async throws {
        for freshHasSession in [false, true] {
            let values = PreferenceValues(), store = try NativePreferencesStore(values: values)
            var document = try await store.navigation(); try document.record(.init(route)); try await store.write(document)
            let controller = NativePreferences(store: store); await controller.load(); controller.activate("c")
            XCTAssertEqual(controller.restoration(connectionID: "c", agents: ["a"], sessions: [route], fresh: false), .conversation(route))
            // This is the real open hook that follows programmatic selection.
            controller.opened(.init(route))
            let decision = controller.restoration(connectionID: "c", agents: ["a"], sessions: freshHasSession ? [route] : [], fresh: true)
            XCTAssertEqual(decision, freshHasSession ? .conversation(route) : .catalog(.init(connectionID: "c", agentID: "a")))
            XCTAssertEqual(controller.restoration(connectionID: "c", agents: ["a"], sessions: [route], fresh: true), .wait)
        }
    }
}
