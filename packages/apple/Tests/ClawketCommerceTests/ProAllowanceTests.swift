import Foundation
import Testing
import ClawketPersistence
@testable import ClawketCommerce

private actor AllowanceValues: ValueStore {
    var values: [String: Data] = [:]
    var failure = false
    func read(_ key: String) -> Data? { values[key] }
    func write(_ value: Data, for key: String) throws {
        values[key] = value
        if failure && !key.hasSuffix(".rollback") { failure = false; throw StoreFailure.unavailable }
    }
    func remove(_ key: String) { values.removeValue(forKey: key) }
    func fail() { failure = true }
    func all() -> [String: Data] { values }
    func inject(_ value: Data, key: String) { values[key] = value }
}

struct ProAllowanceTests {
    @Test func freshInstallDoesNotGrantGraceAndFreeSlotReconcilesWithoutResettingEvaluation() async throws {
        let values = AllowanceValues(), store = try ProAllowanceStore(values: values, deviceID: "fixture-device")
        let first = try await store.resolve(connectionIDs: ["a", "b"], activeID: "b", paid: false, now: 100)
        #expect(first.freeConnectionId == "b"); #expect(first.graceUntil == nil)
        let later = try await store.resolve(connectionIDs: ["a"], activeID: "a", paid: false, now: 200, legacyUsage: true)
        #expect(later.freeConnectionId == "a"); #expect(later.graceEvaluatedAt == 100); #expect(later.graceUntil == nil)
        let reopened = try ProAllowanceStore(values: values, deviceID: "fixture-device")
        let restored = try await reopened.resolve(connectionIDs: ["a", "b"], activeID: "b", paid: false, now: 300, legacyUsage: true)
        #expect(restored == later)
    }
    @Test func validatedImportedLegacyStateWinsAndGraceIsNeverReissuedAfterReinstall() async throws {
        let imported = ProAllowance(freeConnectionId: "original", lastFreeConnectionSwitchAt: 50,
            graceEvaluatedAt: 10, graceUntil: 100)
        let values = AllowanceValues(), store = try ProAllowanceStore(values: values, deviceID: "preserved")
        let first = try await store.resolve(connectionIDs: ["original"], activeID: "original", paid: false, now: 90, imported: imported)
        #expect(first == imported)
        let expired = try await store.resolve(connectionIDs: [], activeID: nil, paid: false, now: 200, legacyUsage: true)
        #expect(expired.freeConnectionId == nil); #expect(expired.graceUntil == 100)
        let reopened = try ProAllowanceStore(values: values, deviceID: "preserved")
        let reinstalled = try await reopened.resolve(connectionIDs: ["repaired"], activeID: "repaired", paid: false, now: 500, legacyUsage: true)
        #expect(reinstalled.graceUntil == 100); #expect(reinstalled.graceEvaluatedAt == 10)
    }
    @Test func oldUsageMayGrantExactlyFourteenDaysOnceAndPaidBootstrapConsumesEvaluation() async throws {
        let values = AllowanceValues(), store = try ProAllowanceStore(values: values, deviceID: "upgraded")
        let granted = try await store.resolve(connectionIDs: ["a", "b"], activeID: "a", paid: false, now: 100, legacyUsage: true)
        let expected: Int64 = 100 + 14 * 86_400_000
        #expect(granted.graceUntil == expected)
        let paid = try ProAllowanceStore(values: values, deviceID: "paid")
        let initial = try await paid.resolve(connectionIDs: ["a"], activeID: "a", paid: true, now: 100, legacyUsage: true)
        #expect(initial.graceUntil == nil)
        let expired = try await paid.resolve(connectionIDs: ["a", "b"], activeID: "a", paid: false, now: 200, legacyUsage: true)
        #expect(expired.graceUntil == nil)
    }
    @Test func freeSlotSwitchIsSerializedAndClockRollbackCannotResetCooldown() async throws {
        let store = try ProAllowanceStore(values: AllowanceValues(), deviceID: "device")
        _ = try await store.resolve(connectionIDs: ["a", "b", "c"], activeID: "a", paid: false, now: 100)
        let switched = try await store.switchConnection(to: "b", connectionIDs: ["a", "b", "c"], paid: false, now: 200)
        #expect(switched.freeConnectionId == "b")
        for time in [Int64(0), 200, 86_400_199] {
            await #expect(throws: ProAllowanceFailure.cooldown(86_400_200)) {
                try await store.switchConnection(to: "c", connectionIDs: ["a", "b", "c"], paid: false, now: time)
            }
        }
        let unchanged = try await store.switchConnection(to: "b", connectionIDs: ["a", "b"], paid: false, now: 201)
        #expect(unchanged.lastFreeConnectionSwitchAt == 200)
        let next = try await store.switchConnection(to: "a", connectionIDs: ["a", "b"], paid: false, now: 86_400_200)
        #expect(next.freeConnectionId == "a")
        await #expect(throws: ProAllowanceFailure.proActive) { try await store.switchConnection(to: "b", connectionIDs: ["a", "b"], paid: true, now: 86_400_201) }
    }
    @Test func failedWriteNeverPublishesOrRetriesMemoryAndColdReadPreservesCommittedTruth() async throws {
        let values = AllowanceValues(), store = try ProAllowanceStore(values: values, deviceID: "d")
        _ = try await store.resolve(connectionIDs: ["a", "b"], activeID: "a", paid: false, now: 1)
        await values.fail()
        await #expect(throws: StoreFailure.unavailable) { try await store.switchConnection(to: "b", connectionIDs: ["a", "b"], paid: false, now: 2) }
        await #expect(throws: ProAllowanceFailure.unconfirmed) { try await store.resolve(connectionIDs: ["a", "b"], activeID: "a", paid: false, now: 3) }
        let cold = try ProAllowanceStore(values: values, deviceID: "d")
        let restored = try await cold.resolve(connectionIDs: ["a", "b"], activeID: "a", paid: false, now: 4)
        #expect(restored.freeConnectionId == "b"); #expect(restored.lastFreeConnectionSwitchAt == 2)
    }
    @Test func missingNullableKeysBadVersionAndCorruptStoredRecordCannotRenewGrace() async throws {
        let original = ProAllowance(freeConnectionId: nil, graceEvaluatedAt: 1, graceUntil: nil)
        let bytes = try JSONEncoder().encode(original)
        let json = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        for key in ["freeConnectionId", "graceUntil", "lastFreeConnectionSwitchAt"] {
            var corrupt = json; corrupt.removeValue(forKey: key)
            #expect(throws: (any Error).self) { try JSONDecoder().decode(ProAllowance.self, from: JSONSerialization.data(withJSONObject: corrupt)) }
        }
        let values = AllowanceValues(), store = try ProAllowanceStore(values: values, deviceID: "d")
        _ = try await store.resolve(connectionIDs: ["a"], activeID: "a", paid: false, now: 1)
        let currentKey = try #require(await values.all().keys.first { !$0.hasSuffix(".rollback") })
        await values.inject(Data("invalid".utf8), key: currentKey)
        let cold = try ProAllowanceStore(values: values, deviceID: "d")
        await #expect(throws: (any Error).self) { try await cold.resolve(connectionIDs: ["a", "b"], activeID: "b", paid: false, now: 10, legacyUsage: true) }
    }
    @Test func canonicallyEquivalentSlotReplacementIsPersistedAsExactNewOpaqueID() async throws {
        let values = AllowanceValues(), store = try ProAllowanceStore(values: values, deviceID: "d")
        let first = try await store.resolve(connectionIDs: ["caf\u{e9}"], activeID: nil, paid: false, now: 1)
        let next = try await store.resolve(connectionIDs: ["cafe\u{301}"], activeID: nil, paid: false, now: 2)
        #expect(first != next)
        let cold = try ProAllowanceStore(values: values, deviceID: "d")
        let restored = try await cold.resolve(connectionIDs: ["caf\u{e9}", "cafe\u{301}"], activeID: nil, paid: false, now: 3)
        #expect(restored.freeConnectionId?.utf8.elementsEqual("cafe\u{301}".utf8) == true)
    }
    @Test func exactOpaqueConnectionIDsAndSafeCounterCapacityDoNotAliasOrOverflow() async throws {
        let store = try ProAllowanceStore(values: AllowanceValues(), deviceID: "d")
        let first = try await store.resolve(connectionIDs: ["caf\u{e9}", "cafe\u{301}"], activeID: "cafe\u{301}", paid: false, now: 1)
        #expect(first.freeConnectionId?.utf8.elementsEqual("cafe\u{301}".utf8) == true)
        await #expect(throws: ProAllowanceFailure.invalid) { try await store.resolve(connectionIDs: Array(repeating: "same", count: 129), activeID: nil, paid: false, now: 2) }
        await #expect(throws: ProAllowanceFailure.invalid) { try await store.resolve(connectionIDs: [], activeID: nil, paid: false, now: Int64.max) }
    }
}
