import ClawketCommerce
import ClawketPersistence
import ClawketRuntime
import ClawketUI
import Foundation
import XCTest
@testable import Clawket

private actor ProHostValues: ValueStore {
    var values: [String: Data] = [:]
    var fail = false
    func read(_ key: String) -> Data? { values[key] }
    func write(_ value: Data, for key: String) throws {
        values[key] = value
        if fail && !key.hasSuffix(".rollback") { fail = false; throw StoreFailure.unavailable }
    }
    func remove(_ key: String) { values.removeValue(forKey: key) }
    func failNext() { fail = true }
    func inject(_ data: Data, key: String) { values[key] = data }
}
@MainActor private final class ProHostSource: ProStoreSource {
    let updates = AsyncStream<ProCustomer> { $0.finish() }
    func customer() -> ProCustomer { .init(active: false, verification: .verified, productID: nil, expirationMs: nil,
        originalPurchaseMs: nil, latestPurchaseMs: nil, requestMs: 100, store: nil) }
    func offerings() -> (packages: [ProPackage], defaultKind: ProPlanKind) { ([], .annual) }
    func purchase(_ id: UUID) throws -> (customer: ProCustomer, productID: String?) { throw ProStoreFailure.unavailable }
    func restore() -> ProCustomer { customer() }
    func presentRedemption() {}
    func manageSubscription() {}
}

final class NativeProTests: XCTestCase, @unchecked Sendable {
    private var route: ConversationID { .init(connectionID: "c", agentID: "a", sessionID: "secondary") }
    private var access: ProAccess { .init(mode: .store, allowance: .init(freeConnectionId: "c", graceEvaluatedAt: 1, graceUntil: nil), resolved: true) }
    private func decision(_ route: ConversationID? = nil, main: Bool? = true, entry: RuntimeAgent.EntryMode? = .main,
                          key: String? = "main", kind: String? = "channel", source: String? = nil,
                          manual: [NativeManualSession] = []) -> NativeProRoutePolicy.Access {
        NativeProRoutePolicy.conversation(route ?? self.route, access: access, now: 100, agentIsMain: main,
            entryMode: entry, mainSessionKey: key, sessionKind: kind, source: source, manual: manual)
    }
    func testCommunityConfigurationKeepsFeaturesSeparateFromStoreOwnershipAndNoOperatorCredentials() {
        let config = NativeProConfiguration(info: [:], debug: false)
        XCTAssertEqual(config.mode, .community); XCTAssertFalse(config.isConfigured); XCTAssertFalse(config.canPurchase)
        XCTAssertTrue(ProAccess(mode: config.mode).allFeatures(at: 100)); XCTAssertFalse(ProAccess(mode: config.mode).hasPaidAccess(at: 100))
        XCTAssertEqual(NativeProConfiguration(info: ["ClawketRevenueCatKey": "  $(MISSING)  "]).mode, .community)
    }
    func testInvalidConfiguredStoreCannotFallBackToCommunityOrCheckoutWithoutLegalLinks() {
        let invalid: [[String: Any]] = [["ClawketRevenueCatKey": 3], ["ClawketRevenueCatKey": "invalid"], ["ClawketRevenueCatEntitlement": "pro"]]
        for info in invalid {
            let config = NativeProConfiguration(info: info)
            XCTAssertEqual(config.mode, .store); XCTAssertFalse(config.isConfigured); XCTAssertFalse(config.canPurchase)
        }
        let config = NativeProConfiguration(info: ["ClawketRevenueCatKey": "appl_fixture_public", "ClawketRevenueCatEntitlement": "pro"])
        XCTAssertTrue(config.isConfigured); XCTAssertFalse(config.canPurchase)
        let release = NativeProConfiguration(info: ["ClawketRevenueCatKey": "test_fixture_public", "ClawketRevenueCatEntitlement": "pro"], debug: false)
        XCTAssertEqual(release.mode, .store); XCTAssertFalse(release.isConfigured)
    }
    func testPurchaseIdentityNeverAliasesQAAndStoreAndRejectsUnknownBundle() throws {
        XCTAssertNil(try NativePurchaseIdentity.qa(bundleID: "com.p697.clawket.nativeqa").appUserID)
        XCTAssertThrowsError(try NativePurchaseIdentity.qa(bundleID: "com.p697.clawket"))
        XCTAssertThrowsError(try NativePurchaseIdentity.qa(bundleID: "other"))
    }
    func testExplicitCreateReceiptPersistsExactlyAndNoCanonicalScopeAliasing() async throws {
        let values = ProHostValues(), store = try NativeManualSessions(values: values)
        let empty = try await store.read(); XCTAssertTrue(empty.isEmpty)
        _ = try await store.rememberCreated(route)
        _ = try await store.rememberCreated(route)
        let unicode = ConversationID(connectionID: "c", agentID: "a", sessionID: "caf\u{e9}")
        _ = try await store.rememberCreated(unicode)
        let other = ConversationID(connectionID: "c", agentID: "a", sessionID: "cafe\u{301}")
        _ = try await store.rememberCreated(other)
        let reopened = try NativeManualSessions(values: values)
        let restored = try await reopened.read()
        XCTAssertEqual(restored.count, 3); XCTAssertTrue(restored.contains(NativeManualSession(route)))
        XCTAssertNotEqual(NativeManualSession(unicode), NativeManualSession(other))
    }
    func testUnknownManualReceiptSaveCannotBeRetriedFromStaleMemoryAndColdReadUsesVerifiedTruth() async throws {
        let values = ProHostValues(), store = try NativeManualSessions(values: values)
        await values.failNext()
        do { _ = try await store.rememberCreated(route); XCTFail("Unknown write reported success") } catch { }
        do { _ = try await store.rememberCreated(route); XCTFail("Unknown write replayed") } catch { }
        let cold = try NativeManualSessions(values: values)
        let restored = try await cold.read(); XCTAssertEqual(restored, [NativeManualSession(route)])
    }
    func testCorruptManualReceiptCannotMintAccessOrResetToEmpty() async throws {
        let values = ProHostValues(); await values.inject(Data("invalid".utf8), key: "manual-sessions.v1")
        let store = try NativeManualSessions(values: values)
        do { _ = try await store.read(); XCTFail("Corrupt record reset") } catch { }
        do { _ = try await store.rememberCreated(route); XCTFail("Corrupt record overwritten") } catch { }
    }
    func testActualMainAgentAndConnectionAreRequiredBeforeSessionExceptions() {
        XCTAssertEqual(decision(main: false, kind: "main"), .locked)
        XCTAssertEqual(decision(main: nil, manual: [NativeManualSession(route)]), .locked)
        let other = ConversationID(connectionID: "other", agentID: "a", sessionID: "main")
        XCTAssertEqual(decision(other, kind: "main"), .locked)
        XCTAssertEqual(decision(kind: "main"), .full)
    }
    func testKnownDescriptorKindWinsOverLegacyMainSpellingAndDoesNotGrantExtraHistory() {
        let mainKey = ConversationID(connectionID: "c", agentID: "a", sessionID: "main")
        XCTAssertEqual(decision(mainKey, kind: "channel"), .preview)
        XCTAssertEqual(decision(mainKey, kind: nil), .full)
        let prefixed = ConversationID(connectionID: "c", agentID: "a", sessionID: "agent:a:main")
        XCTAssertEqual(decision(prefixed, key: nil, kind: "global"), .full)
        XCTAssertEqual(decision(route, key: "secondary", kind: "task"), .preview)
    }
    func testBridgeOwnedSessionsFirstIsFreeButNativeSourceAndGuessedTitlesAreNotManualReceipts() {
        XCTAssertEqual(decision(entry: .sessions, source: "bridge"), .full)
        XCTAssertEqual(decision(entry: .sessions, source: "native"), .preview)
        XCTAssertEqual(decision(entry: .main, source: "bridge"), .preview)
        XCTAssertEqual(decision(manual: [NativeManualSession(route)]), .full)
        let otherAgent = ConversationID(connectionID: "c", agentID: "b", sessionID: "secondary")
        XCTAssertEqual(decision(manual: [NativeManualSession(otherAgent)]), .preview)
    }
    @MainActor func testReadOnlyPreviewFreezesTwoBodiesAndPreservesOwnedUnknownOutboxAndDraft() async throws {
        let model = NativeAppModel()
        model.pro = ProController(mode: .store, source: ProHostSource(), clock: { 100 })
        model.pro.updateAllowance(.init(freeConnectionId: "c", graceEvaluatedAt: 1, graceUntil: nil)); await model.pro.refreshCustomer()
        model.agents = [.init(agentID: "a", connectionID: "c", name: "Agent", mainSessionKey: "main", isMain: true)]
        model.presentation.selectedConversation = route
        var document = NativeConversation(); document.draft = "kept"
        document.messages = [
            .init(id: "owned", role: .user, local: true, text: "unsure", idempotencyKey: "original", delivery: .uncertain),
            .init(id: "one", role: .assistant, text: "one"), .init(id: "two", role: .assistant, text: "two"), .init(id: "three", role: .assistant, text: "three")]
        model.documents[route] = document
        let first = model.proPreview(route, messages: document.messages.map { model.present($0, agentName: "Agent") })
        XCTAssertEqual(Set(first.map(\.id)), ["owned", "two", "three"])
        document.messages.append(.init(id: "four", role: .assistant, text: "four")); model.documents[route] = document
        let next = model.proPreview(route, messages: document.messages.map { model.present($0, agentName: "Agent") })
        XCTAssertFalse(next.contains { $0.id == "four" }); XCTAssertEqual(model.documents[route]?.draft, "kept")
        XCTAssertEqual(model.documents[route]?.messages.first?.idempotencyKey, "original"); XCTAssertFalse(model.proPermitsInput(route))
        model.documents[route]?.historyEpoch = UUID()
        let replacement = model.proPreview(route, messages: document.messages.map { model.present($0, agentName: "Agent") })
        XCTAssertTrue(replacement.contains { $0.id == "four" })
    }
    @MainActor func testAccessLossHoldsOnlyUnsentOwnedItemsWithoutReplayingOrChangingResources() async throws {
        let model = NativeAppModel(); model.pro = ProController(mode: .store, source: ProHostSource(), clock: { 100 })
        await model.pro.refreshCustomer()
        var document = NativeConversation(); let resource = UUID(); document.draft = "draft"; document.draftResourceIDs = [resource]
        document.messages = [.init(id: "queued", role: .user, local: true, text: "queued", idempotencyKey: "stable", delivery: .queued),
            .init(id: "uncertain", role: .user, local: true, text: "unknown", idempotencyKey: "unknown", delivery: .uncertain)]
        model.documents[route] = document; model.proAccessChanged()
        XCTAssertEqual(model.documents[route]?.messages[0].delivery, .held)
        XCTAssertEqual(model.documents[route]?.messages[1].delivery, .uncertain)
        XCTAssertEqual(model.documents[route]?.messages[0].idempotencyKey, "stable")
        XCTAssertEqual(model.documents[route]?.draft, "draft"); XCTAssertEqual(model.documents[route]?.draftResourceIDs, [resource])
        model.saveTasks.values.forEach { $0.cancel() }
    }
    func testPurchaseContinuationNeedsExactOriginalRouteActivationSelectionAndPhysicalEpoch() {
        let activation = UUID(), wire = UUID(), selection = UUID(), epoch = UUID()
        let frozen = NativeProContinuation(action: .conversation(route), activation: activation, wire: wire, selection: selection, route: route, epoch: epoch)
        XCTAssertTrue(frozen.matches(activation: activation, wire: wire, selection: selection, route: route, epoch: epoch))
        XCTAssertFalse(frozen.matches(activation: UUID(), wire: wire, selection: selection, route: route, epoch: epoch))
        XCTAssertFalse(frozen.matches(activation: activation, wire: wire, selection: UUID(), route: route, epoch: epoch))
        XCTAssertFalse(frozen.matches(activation: activation, wire: wire, selection: selection, route: route, epoch: UUID()))
    }
}
