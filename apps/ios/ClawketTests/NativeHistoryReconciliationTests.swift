import Foundation
import XCTest
@testable import Clawket

final class NativeHistoryReconciliationTests: XCTestCase {
    private func identity(_ source: String? = nil, key: String? = nil, local: Bool = false) -> NativeHistoryIdentity.Row {
        .init(role: .user, sourceID: source, position: nil, sendKey: key,
              locallyOwned: local, author: .direct, epoch: nil)
    }
    private func stored(_ id: String, source: String? = nil, key: String? = nil, local: Bool = false,
                        preserve: Bool = false, changed: Bool = false) -> NativeHistoryReconciliation.Stored {
        .init(id: id, identity: identity(source, key: key, local: local),
              preserveWhenAbsent: preserve, changedAfterRead: changed)
    }

    func testCanonicalOrderKeepsIndependentExistingIDsAndAllocatesNewUUIDs() throws {
        let plan = try NativeHistoryReconciliation.plan(incoming: [identity("a"), identity("b")],
            stored: [stored("independent-a", source: "a")], earlier: false, retainOlderPrefix: false,
            newID: { "independent-b" })
        XCTAssertEqual(plan.entries, [.history(index: 0, previous: 0, id: "independent-a"),
                                      .history(index: 1, previous: nil, id: "independent-b")])
        XCTAssertEqual(plan.acceptedHistoryIDs, [0: "independent-a", 1: "independent-b"])
    }

    func testDuplicateProducerIDsKeepEveryRowAndNeverDuplicateDisplayIDs() throws {
        var count = 0
        let plan = try NativeHistoryReconciliation.plan(incoming: [identity("duplicate"), identity("duplicate")],
            stored: [], earlier: false, retainOlderPrefix: false, newID: { count += 1; return "display-\(count)" })
        XCTAssertEqual(plan.entries.map(\.id), ["display-1", "display-2"])
        XCTAssertEqual(plan.acceptedHistoryIDs, [0: "display-1", 1: "display-2"])
    }

    func testOwnedAndNewLiveRowsKeepTheirSourceNeighborPositions() throws {
        let old = [stored("a", source: "a"), stored("held", key: "send", local: true),
                   stored("live-one", preserve: true), stored("live-two", changed: true), stored("b", source: "b")]
        let plan = try NativeHistoryReconciliation.plan(incoming: [identity("a"), identity("b")], stored: old,
            earlier: false, retainOlderPrefix: false)
        XCTAssertEqual(plan.entries.map(\.id), ["a", "held", "live-one", "live-two", "b"])
    }

    func testMatchedRowChangedDuringReadCannotBeOverwrittenOrHydratedFromStaleSnapshot() throws {
        let plan = try NativeHistoryReconciliation.plan(incoming: [identity("a")],
            stored: [stored("display", source: "a", changed: true)], earlier: false, retainOlderPrefix: false)
        XCTAssertEqual(plan.entries, [.preserved(index: 0, id: "display")])
        XCTAssertTrue(plan.acceptedHistoryIDs.isEmpty)
    }

    func testEarlierCursorPagePrependsOnlyNewRowsAndNeverReplacesCurrentCopies() throws {
        let plan = try NativeHistoryReconciliation.plan(incoming: [identity("older"), identity("overlap")],
            stored: [stored("current", source: "overlap"), stored("latest", source: "latest")],
            earlier: true, retainOlderPrefix: false, newID: { "older-display" })
        XCTAssertEqual(plan.entries, [.history(index: 0, previous: nil, id: "older-display"),
            .preserved(index: 0, id: "current"), .preserved(index: 1, id: "latest")])
        XCTAssertEqual(plan.acceptedHistoryIDs, [0: "older-display"])
        var count = 0
        let interleaved = try NativeHistoryReconciliation.plan(incoming: [identity("a"), identity("b"), identity("c")],
            stored: [stored("current-b", source: "b"), stored("current-d", source: "d")],
            earlier: true, retainOlderPrefix: false, newID: { count += 1; return "new-\(count)" })
        XCTAssertEqual(interleaved.entries.map(\.id), ["new-1", "current-b", "new-2", "current-d"])
        XCTAssertEqual(interleaved.acceptedHistoryIDs, [0: "new-1", 2: "new-2"])
        XCTAssertThrowsError(try NativeHistoryReconciliation.plan(incoming: [identity("d"), identity("b")],
            stored: [stored("b", source: "b"), stored("d", source: "d")], earlier: true, retainOlderPrefix: false))
    }

    func testOlderLoadedPrefixNeedsExplicitPartialHeadAndConsistentAnchors() throws {
        let old = [stored("older", source: "older"), stored("a", source: "a"), stored("b", source: "b")]
        for retain in [false, true] {
            let plan = try NativeHistoryReconciliation.plan(incoming: [identity("a"), identity("b")], stored: old,
                earlier: false, retainOlderPrefix: retain)
            XCTAssertEqual(plan.entries.map(\.id), retain ? ["older", "a", "b"] : ["a", "b"])
        }
        let reversed = try NativeHistoryReconciliation.plan(incoming: [identity("b"), identity("a")], stored: old,
            earlier: false, retainOlderPrefix: true)
        XCTAssertEqual(reversed.entries.map(\.id), ["b", "a"])
    }

    func testUniqueLocalEchoKeepsOriginalRenderIdentityWithoutChangingSourceInput() throws {
        let old = [stored("own-render-id", key: "original-key", local: true)]
        let plan = try NativeHistoryReconciliation.plan(incoming: [identity("producer", key: "original-key")],
            stored: old, earlier: false, retainOlderPrefix: false)
        XCTAssertEqual(plan.entries, [.history(index: 0, previous: 0, id: "own-render-id")])
        XCTAssertNil(old[0].identity.sourceID); XCTAssertEqual(old[0].identity.sendKey, "original-key")
    }

    func testCorruptStoredIDsAllocatorCollisionsAndOwnedWireRowsFailClosed() {
        for old in [[stored("duplicate"), stored("duplicate")], [stored("")]] {
            XCTAssertThrowsError(try NativeHistoryReconciliation.plan(incoming: [], stored: old,
                earlier: false, retainOlderPrefix: false))
        }
        XCTAssertThrowsError(try NativeHistoryReconciliation.plan(incoming: [identity("new")],
            stored: [stored("collision")], earlier: false, retainOlderPrefix: false, newID: { "collision" }))
        XCTAssertThrowsError(try NativeHistoryReconciliation.plan(incoming: [identity(local: true)],
            stored: [], earlier: false, retainOlderPrefix: false))
    }
}
