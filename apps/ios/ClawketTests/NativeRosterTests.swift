import ClawketPersistence
import ClawketRuntime
import ClawketTransport
import ClawketUI
import Foundation
import XCTest
@testable import Clawket

private actor RosterValues: ValueStore {
    var values: [String: Data] = [:]
    var failNext = false
    func read(_ key: String) -> Data? { values[key] }
    func write(_ data: Data, for key: String) throws {
        values[key] = data
        if failNext && key == "roster-preferences.v1" { failNext = false; throw StoreFailure.unavailable }
    }
    func remove(_ key: String) { values.removeValue(forKey: key) }
    func failAfterNextWrite() { failNext = true }
    func inject(_ data: Data, key: String) { values[key] = data }
}
private func rosterSession(_ key: String, agent: String = "a", kind: String = "main", time: Int64? = 100,
                           metadataTime: Int64 = 500, attention: String? = nil, pin: Bool = true, archived: Bool = false) throws -> RuntimeSession {
    var raw: [String: Any] = ["key": key, "connectionID": "c", "agentID": agent, "title": key, "kind": kind,
        "updatedAtMs": metadataTime, "preview": "Preview for \(key)", "hasActiveRun": false, "archived": archived,
        "allowedActions": ["rename": false, "reset": false, "delete": false, "pin": pin, "archive": false],
        "raw": attention.map { ["attention": $0] } ?? [:]]
    if let time { raw["lastActivityAtMs"] = time }
    return try JSONDecoder().decode(RuntimeSession.self, from: JSONSerialization.data(withJSONObject: raw))
}
private func rosterAgent(_ id: String = "a", main: String = "main", entry: RuntimeAgent.EntryMode = .main, isMain: Bool? = true) -> RuntimeAgent {
    .init(agentID: id, connectionID: "c", name: id, mainSessionKey: main, entryMode: entry, isMain: isMain)
}
final class NativeRosterTests: XCTestCase, @unchecked Sendable {
    @MainActor func testFirstLiveBaselineAndMonotonicReadPersistWithoutClearingAttention() async throws {
        let values = RosterValues(), state = NativeRosterState(store: try NativeRosterStore(values: values)); await state.load()
        let old = try rosterSession("main", time: 100, attention: "approval")
        state.seedIfUnset(connectionID: "c", sessions: [old]); await state.flush()
        XCTAssertFalse(NativeRosterProjection.unread(old, document: state.document, live: true))
        let fresh = try rosterSession("main", time: 200, attention: "approval")
        state.seedIfUnset(connectionID: "c", sessions: [fresh])
        XCTAssertTrue(NativeRosterProjection.unread(fresh, document: state.document, live: true))
        state.markRead([fresh]); state.markRead([old]); await state.flush()
        XCTAssertEqual(state.document.watermark(NativeRosterProjection.route(old)), 200)
        let summary = NativeRosterProjection.summaries(agents: [rosterAgent()], sessions: [fresh], document: state.document, connectionID: "c", live: true)
        XCTAssertFalse(try XCTUnwrap(summary.first).unread); XCTAssertEqual(summary.first?.attention, .approval)
        let reopened = NativeRosterState(store: try NativeRosterStore(values: values)); await reopened.load()
        XCTAssertEqual(reopened.document.watermark(NativeRosterProjection.route(old)), 200)
        let large = try (0..<10_000).map { try rosterSession("catalog-\($0)", kind: "other", time: Int64($0 + 1)) }
        state.seedIfUnset(connectionID: "new", sessions: [])
        // A real maximum-size catalog is merged once; an already tracked connection never reseeds.
        let freshState = NativeRosterState(store: try NativeRosterStore(values: RosterValues())); await freshState.load()
        freshState.seedIfUnset(connectionID: "c", sessions: large); await freshState.flush()
        XCTAssertEqual(freshState.index.watermarks.count, 10_000)
        XCTAssertFalse(NativeRosterProjection.unread(large[9_999], index: freshState.index, live: true))
    }
    @MainActor func testExplicitUnknownActivityAndBackgroundKindsNeverBecomeNowOrMetadataUnread() async throws {
        let state = NativeRosterState(store: try NativeRosterStore(values: RosterValues())); await state.load()
        let missing = try rosterSession("main", time: nil, metadataTime: 99_999)
        let cron = try rosterSession("cron", kind: "cron", time: 88_888)
        let sub = try rosterSession("sub", kind: "subagent", time: 77_777)
        state.seedIfUnset(connectionID: "c", sessions: [missing, cron, sub]); state.markRead([missing, cron, sub])
        XCTAssertTrue(state.document.watermarks.isEmpty)
        for session in [missing, cron, sub] { XCTAssertNil(NativeRosterProjection.activity(session)); XCTAssertFalse(NativeRosterProjection.unread(session, document: state.document, live: true)) }
        let summary = NativeRosterProjection.summaries(agents: [rosterAgent()], sessions: [missing, cron, sub], document: state.document, connectionID: "c", live: true)
        XCTAssertNil(summary.first?.lastActivityAtMs)
        XCTAssertEqual(summary.first?.previewSession?.preview, "Preview for main") // A null clock hides recency, not the stored preview.
        await state.flush()
    }
    func testMainBadgeAndAllSessionUnreadRemainSeparateWithTruthfulCacheSignals() throws {
        let main = try rosterSession("main", time: 100), child = try rosterSession("child", kind: "channel", time: 300, attention: "input")
        var document = NativeRosterDocument(baselines: ["c"]); document.mark(NativeRosterProjection.route(main), through: 100)
        let live = NativeRosterProjection.summaries(agents: [rosterAgent()], sessions: [main, child], document: document, connectionID: "c", live: true)
        XCTAssertFalse(try XCTUnwrap(live.first).unread)
        XCTAssertTrue(NativeRosterProjection.unread(child, document: document, live: true)); XCTAssertEqual(live.first?.attention, .input)
        let cached = NativeRosterProjection.summaries(agents: [rosterAgent()], sessions: [main, child], document: document, connectionID: "c", live: false)
        XCTAssertEqual(cached.first?.attention, AgentPresentation.Attention.none); XCTAssertFalse(try XCTUnwrap(cached.first).unread)
        XCTAssertFalse(NativeRosterProjection.unread(child, document: document, live: false))
    }
    @MainActor func testAgentPinsAndOnlyLegalHomeSessionsSurviveRestartAndKeepExplicitOrder() async throws {
        let values = RosterValues(), state = NativeRosterState(store: try NativeRosterStore(values: values)); await state.load()
        let scope = AgentCatalogID(connectionID: "c", agentID: "a")
        state.setAgentPinned(scope, pinned: true)
        XCTAssertFalse(state.document.preference(scope).pinned) // Desired edits are not a verified save.
        for key in ["one", "two", "main", "archived", "denied", "missing"] { state.setSessionOnHome(.init(connectionID: "c", agentID: "a", sessionID: key), visible: true) }
        await state.flush()
        let reopened = NativeRosterState(store: try NativeRosterStore(values: values)); await reopened.load()
        let sessions = try [rosterSession("one", kind: "channel"), rosterSession("two", kind: "other"), rosterSession("main"),
                            rosterSession("archived", archived: true), rosterSession("denied", pin: false)]
        let summaries = NativeRosterProjection.summaries(agents: [rosterAgent()], sessions: sessions, document: reopened.document, connectionID: "c", live: false)
        XCTAssertEqual(summaries.first?.home.map(\.key), ["main", "two", "one"]); XCTAssertEqual(summaries.first?.pinned, true)
        // References are retained even when not currently legal; no local preference authorizes an absent route.
        XCTAssertTrue(reopened.document.preference(scope).homeSessions.contains("missing"))
        reopened.setSessionOnHome(.init(connectionID: "c", agentID: "a", sessionID: "two"), visible: false); await reopened.flush()
        XCTAssertEqual(reopened.document.preference(scope).homeSessions.last, "one")
    }
    func testHumanActivityOrdersAgentsAfterPinsAndAttentionUnreadCannotReorder() throws {
        let a = rosterAgent(), b = rosterAgent("b"), c = rosterAgent("z")
        let sessions = try [rosterSession("main", agent: "a", time: 10, attention: "input"), rosterSession("main", agent: "b", time: 30),
                            rosterSession("main", agent: "z", time: 20), rosterSession("cron", agent: "a", kind: "cron", time: 99_999)]
        var document = NativeRosterDocument(baselines: ["c"])
        var rows = NativeRosterProjection.summaries(agents: [a, b, c], sessions: sessions, document: document, connectionID: "c", live: true)
        XCTAssertEqual(rows.map { $0.agent.agentID }, ["b", "z", "a"])
        document.preferences = [.init(scope: NativeRosterProjection.scope(a), pinned: true)]
        rows = NativeRosterProjection.summaries(agents: [a, b, c], sessions: sessions, document: document, connectionID: "c", live: true)
        XCTAssertEqual(rows.map { $0.agent.agentID }, ["a", "b", "z"])
        XCTAssertEqual(rows.first?.lastActivityAtMs, 10)
    }
    func testFreeAgentAccessNeedsActualMainEvidenceAndExactFreeConnectionWithoutInventingPro() {
        let known = rosterAgent(), unknown = rosterAgent(isMain: nil), secondary = rosterAgent("secondary", isMain: false)
        XCTAssertTrue(NativeRosterProjection.canUseLocalActions(known, freeConnectionID: "c"))
        XCTAssertFalse(NativeRosterProjection.canUseLocalActions(unknown, freeConnectionID: "c"))
        XCTAssertFalse(NativeRosterProjection.canUseLocalActions(secondary, freeConnectionID: "c"))
        XCTAssertFalse(NativeRosterProjection.canUseLocalActions(known, freeConnectionID: nil))
        XCTAssertFalse(NativeRosterProjection.canUseLocalActions(known, freeConnectionID: "c", explicitAccess: []))
        XCTAssertFalse(NativeRosterProjection.canUseLocalActions(known, freeConnectionID: "c", explicitAccess: [NativeRosterProjection.scope(secondary)]))
        XCTAssertTrue(NativeRosterProjection.canUseLocalActions(secondary, freeConnectionID: nil, explicitAccess: [NativeRosterProjection.scope(secondary)]))
        XCTAssertEqual(NativeRosterProjection.summaries(agents: [rosterAgent(main: "", entry: .sessions)], sessions: [], document: .init(), connectionID: "c", live: true).first?.agent.mainSessionKey, "")
    }
    func testReadPolicyRequiresVisibleCurrentScopeAndHistoryNotMerelyPersistedSelectedRoute() {
        let route = ConversationID(connectionID: "c", agentID: "a", sessionID: "s"), first = UUID(), reopened = UUID()
        var visibility = NativeRosterReadingVisibility()
        let firstView = UUID(), newView = UUID()
        func permitted(_ state: NativeRosterReadingVisibility, _ scope: UUID, foreground: Bool = true, live: Bool = true,
                       history: Bool = true, obscured: Bool = false, held: Bool = false) -> Bool {
            state.permitsRead(route, scope: scope, foreground: foreground, live: live, historyReady: history, obscured: obscured, held: held)
        }
        XCTAssertFalse(permitted(visibility, first)); visibility.update(route, viewID: firstView, scope: first, visible: true, currentView: true)
        XCTAssertTrue(permitted(visibility, first)); XCTAssertFalse(permitted(visibility, first, foreground: false))
        XCTAssertFalse(permitted(visibility, first, live: false)); XCTAssertFalse(permitted(visibility, first, history: false))
        XCTAssertFalse(permitted(visibility, first, obscured: true)); XCTAssertFalse(permitted(visibility, first, held: true))
        visibility.update(route, viewID: newView, scope: reopened, visible: true, currentView: true); visibility.update(route, viewID: firstView, scope: first, visible: false, currentView: false)
        XCTAssertTrue(permitted(visibility, reopened)); XCTAssertFalse(permitted(visibility, first))
        // The actual old view may accidentally observe the new global scope; its frozen view ID still cannot retire or impersonate A2.
        visibility.update(route, viewID: firstView, scope: reopened, visible: false, currentView: false)
        XCTAssertTrue(permitted(visibility, reopened))
        visibility.update(route, viewID: firstView, scope: first, visible: true, currentView: false)
        XCTAssertTrue(permitted(visibility, reopened))
        let wire = UUID(), oldSuccessfulRead = NativeRosterHistoryRead(wire: wire, readingScope: first)
        XCTAssertTrue(oldSuccessfulRead.isCurrent(wire: wire, readingScope: first))
        // A's former success cannot mark a newly visible A read while its new head is held or fails.
        XCTAssertFalse(oldSuccessfulRead.isCurrent(wire: wire, readingScope: reopened))
        XCTAssertFalse(permitted(visibility, reopened, history: oldSuccessfulRead.isCurrent(wire: wire, readingScope: reopened)))
        XCTAssertFalse(oldSuccessfulRead.isCurrent(wire: UUID(), readingScope: first))
        XCTAssertNil(NativeRosterHistoryRead.accepted(wire: wire, readingScope: reopened, earlier: true))
        XCTAssertNil(NativeRosterHistoryRead.accepted(wire: wire, readingScope: nil, earlier: false))
        XCTAssertEqual(NativeRosterHistoryRead.accepted(wire: wire, readingScope: reopened, earlier: false)?.readingScope, reopened)
        visibility.update(route, viewID: newView, scope: reopened, visible: false, currentView: false); XCTAssertFalse(permitted(visibility, reopened))
    }
    @MainActor func testOpaqueUnicodeWatermarksPinsAndRenderKeysRemainByteDistinct() async throws {
        let state = NativeRosterState(store: try NativeRosterStore(values: RosterValues())); await state.load()
        let first = try rosterSession("\u{00e9}", time: 100), second = try rosterSession("e\u{0301}", time: 200)
        state.seedIfUnset(connectionID: "c", sessions: [first, second]); state.markRead([first]); await state.flush()
        XCTAssertEqual(state.document.watermarks.count, 2); XCTAssertEqual(state.index.watermarks.count, 2)
        XCTAssertEqual(state.document.watermark(NativeRosterProjection.route(first)), 100)
        XCTAssertEqual(state.document.watermark(NativeRosterProjection.route(second)), 200)
        let a = AgentCatalogID(connectionID: "c", agentID: "\u{00e9}"), b = AgentCatalogID(connectionID: "c", agentID: "e\u{0301}")
        state.setAgentPinned(a, pinned: true); state.setAgentPinned(b, pinned: false); await state.flush()
        XCTAssertTrue(state.document.preference(a).pinned); XCTAssertFalse(state.document.preference(b).pinned)
        XCTAssertNotEqual(NativeRosterProjection.renderID(a), NativeRosterProjection.renderID(b))
    }
    func testCorruptBoundsDuplicateIdentifiersAndOverflowAreRejectedWithoutDroppingData() async throws {
        var document = NativeRosterDocument(revision: 9_007_199_254_740_991)
        XCTAssertThrowsError(try document.advance()); XCTAssertEqual(document.revision, 9_007_199_254_740_991)
        let scope = AgentCatalogID(connectionID: "c", agentID: "a")
        document = .init(preferences: [.init(scope: scope), .init(scope: scope)])
        XCTAssertThrowsError(try document.validate())
        document = .init(preferences: [.init(scope: scope, homeSessions: ["same", "same"])])
        XCTAssertThrowsError(try document.validate())
        document = .init(baselines: Array(repeating: "c", count: 129)); XCTAssertThrowsError(try document.validate())
        document = .init(watermarks: [.init(route: .init(connectionID: "c", agentID: "a", sessionID: "s"), activityAtMs: -1)])
        XCTAssertThrowsError(try document.validate())
        XCTAssertTrue(NativeRosterProjection.summaries(agents: [rosterAgent(), rosterAgent()], sessions: [], document: .init(), connectionID: "c", live: true).isEmpty)
        for bytes in [Data("{\"version\":2}".utf8), Data(repeating: 65, count: 8 * 1_024 * 1_024 + 1)] {
            let values = RosterValues(); await values.inject(bytes, key: "roster-preferences.v1")
            let store = try NativeRosterStore(values: values)
            do { _ = try await store.read(); XCTFail("Corrupt/bounded document silently became empty") }
            catch { XCTAssertEqual(error as? StoreFailure, .invalidDocument) }
        }
    }
    @MainActor func testUnknownReplacementCannotBeRetriedAndOlderSnapshotCannotOverwriteVerifiedValue() async throws {
        let values = RosterValues(), store = try NativeRosterStore(values: values)
        let initial = try await store.read(); XCTAssertEqual(initial.revision, 0)
        var latest = initial; latest.revision = 2; latest.baselines = ["c"]
        try await store.write(latest); try await store.write(.init(revision: 1))
        let verified = try await store.read(); XCTAssertEqual(verified.baselines, ["c"])
        await values.failAfterNextWrite()
        latest.revision = 3; latest.preferences = [.init(scope: .init(connectionID: "c", agentID: "a"), pinned: true)]
        do { try await store.write(latest); XCTFail("Unknown replacement reported verified") } catch { XCTAssertEqual(error as? StoreFailure, .unavailable) }
        do { try await store.write(.init(revision: 4)); XCTFail("Unknown replacement overwritten") } catch { XCTAssertEqual(error as? StoreFailure, .verificationFailed) }
        let reopened = try NativeRosterStore(values: values); let restored = try await reopened.read()
        XCTAssertEqual(restored.revision, 3); XCTAssertEqual(restored.preferences.first?.pinned, true)
        let state = NativeRosterState(store: reopened); await state.load()
        await values.failAfterNextWrite()
        state.setAgentPinned(.init(connectionID: "c", agentID: "a"), pinned: false); await state.flush()
        XCTAssertFalse(state.canSave); XCTAssertTrue(state.document.preferences.first?.pinned == true)
        let actual = try NativeRosterStore(values: values); let disk = try await actual.read()
        XCTAssertFalse(try XCTUnwrap(disk.preferences.first).pinned) // Unknown memory cannot overwrite the committed disk truth.
    }
}
