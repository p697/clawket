import ClawketPersistence
import Foundation

public enum ProAllowanceFailure: Error, Sendable, Equatable { case invalid, uninitialized, unknownConnection, proActive, cooldown(Int64), unconfirmed }

/// Exact Mobile value schema; its presence consumes the once-per-device evaluation.
/// No paid entitlement is persisted in this record.
public struct ProAllowance: Codable, Sendable, Equatable {
    public var version = 1
    public var freeConnectionId: String?
    public var lastFreeConnectionSwitchAt: Int64?
    public let graceEvaluatedAt: Int64
    public let graceUntil: Int64?
    public init(freeConnectionId: String?, lastFreeConnectionSwitchAt: Int64? = nil,
                graceEvaluatedAt: Int64, graceUntil: Int64?) {
        self.freeConnectionId = freeConnectionId; self.lastFreeConnectionSwitchAt = lastFreeConnectionSwitchAt
        self.graceEvaluatedAt = graceEvaluatedAt; self.graceUntil = graceUntil
    }
    public static func == (lhs: Self, rhs: Self) -> Bool {
        let sameID = lhs.freeConnectionId.map { Data($0.utf8) } == rhs.freeConnectionId.map { Data($0.utf8) }
        return sameID && lhs.version == rhs.version && lhs.lastFreeConnectionSwitchAt == rhs.lastFreeConnectionSwitchAt
            && lhs.graceEvaluatedAt == rhs.graceEvaluatedAt && lhs.graceUntil == rhs.graceUntil
    }
    public func validate() throws {
        let safe: (Int64) -> Bool = { (0...9_007_199_254_740_991).contains($0) }
        guard version == 1, safe(graceEvaluatedAt), freeConnectionId.map({ !$0.isEmpty && $0.utf8.count <= 1_024 }) ?? true,
              lastFreeConnectionSwitchAt.map(safe) ?? true,
              graceUntil.map({ safe($0) && $0 >= graceEvaluatedAt }) ?? true else { throw ProAllowanceFailure.invalid }
    }
    enum CodingKeys: String, CodingKey { case version, freeConnectionId, lastFreeConnectionSwitchAt, graceEvaluatedAt, graceUntil }
    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        version = try values.decode(Int.self, forKey: .version)
        // A missing nullable field is corrupt, not an instruction to reset a one-time allowance.
        guard [.freeConnectionId, .lastFreeConnectionSwitchAt, .graceUntil].allSatisfy(values.contains) else { throw ProAllowanceFailure.invalid }
        freeConnectionId = try values.decodeIfPresent(String.self, forKey: .freeConnectionId)
        lastFreeConnectionSwitchAt = try values.decodeIfPresent(Int64.self, forKey: .lastFreeConnectionSwitchAt)
        graceEvaluatedAt = try values.decode(Int64.self, forKey: .graceEvaluatedAt)
        graceUntil = try values.decodeIfPresent(Int64.self, forKey: .graceUntil)
        try validate()
    }
    public func encode(to encoder: any Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(version, forKey: .version); try values.encode(freeConnectionId, forKey: .freeConnectionId)
        try values.encode(lastFreeConnectionSwitchAt, forKey: .lastFreeConnectionSwitchAt)
        try values.encode(graceEvaluatedAt, forKey: .graceEvaluatedAt); try values.encode(graceUntil, forKey: .graceUntil)
    }
}

public actor ProAllowanceStore {
    public static let switchInterval: Int64 = 86_400_000
    public static let graceInterval: Int64 = 14 * 86_400_000
    private let documents: DocumentStore
    private let key: String
    private var value: ProAllowance?
    private var uncertain = false
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    public init(values: any ValueStore, deviceID: String) throws {
        guard !deviceID.isEmpty, deviceID.utf8.count <= 1_024 else { throw ProAllowanceFailure.invalid }
        documents = try DocumentStore(values: values, maximumBytes: 16 * 1_024)
        key = try DocumentStore.scopedKey(namespace: "pro-allowance.v1", parts: [deviceID])
    }
    /// Imported state must already come from the validated same-bundle upgrade staging.
    /// Only that caller may supply legacy usage; a normal fresh install passes false.
    public func resolve(connectionIDs: [String], activeID: String?, paid: Bool, now: Int64,
                        legacyUsage: Bool = false, imported: ProAllowance? = nil) async throws -> ProAllowance {
        try await acquire(); defer { release() }; try ready(now: now, connections: connectionIDs)
        var next: ProAllowance
        if let stored = try await documents.read(ProAllowance.self, key: key)?.value { next = stored }
        else if let imported { try imported.validate(); next = imported }
        else {
            let eligible = !paid && legacyUsage
            guard now <= 9_007_199_254_740_991 - Self.graceInterval else { throw ProAllowanceFailure.invalid }
            next = .init(freeConnectionId: preferred(connectionIDs, active: activeID), graceEvaluatedAt: now,
                         graceUntil: eligible ? now + Self.graceInterval : nil)
        }
        if let free = next.freeConnectionId, !contains(connectionIDs, free) { next.freeConnectionId = nil }
        if next.freeConnectionId == nil && !paid { next.freeConnectionId = preferred(connectionIDs, active: activeID) }
        try await commit(next); return next
    }
    public func switchConnection(to id: String, connectionIDs: [String], paid: Bool, now: Int64) async throws -> ProAllowance {
        try await acquire(); defer { release() }; try ready(now: now, connections: connectionIDs)
        guard var next = value else { throw ProAllowanceFailure.uninitialized }
        guard !paid else { throw ProAllowanceFailure.proActive }
        guard contains(connectionIDs, id) else { throw ProAllowanceFailure.unknownConnection }
        if next.freeConnectionId.map({ $0.utf8.elementsEqual(id.utf8) }) == true { return next }
        if let previous = next.lastFreeConnectionSwitchAt {
            guard previous <= 9_007_199_254_740_991 - Self.switchInterval else { throw ProAllowanceFailure.invalid }
            if now < previous + Self.switchInterval { throw ProAllowanceFailure.cooldown(previous + Self.switchInterval) }
        }
        guard now <= 9_007_199_254_740_991 - Self.switchInterval else { throw ProAllowanceFailure.invalid }
        next.freeConnectionId = id; next.lastFreeConnectionSwitchAt = now; try await commit(next); return next
    }
    private func commit(_ next: ProAllowance) async throws {
        try next.validate()
        if value == next { return }
        do { try await documents.write(next, key: key); value = next }
        catch { uncertain = true; throw error }
    }
    private func ready(now: Int64, connections: [String]) throws {
        guard !uncertain else { throw ProAllowanceFailure.unconfirmed }
        guard (0...9_007_199_254_740_991).contains(now), connections.count <= 128,
              connections.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 1_024 }), Set(connections.map { Data($0.utf8) }).count == connections.count else { throw ProAllowanceFailure.invalid }
    }
    private func contains(_ ids: [String], _ id: String) -> Bool { ids.contains { $0.utf8.elementsEqual(id.utf8) } }
    private func preferred(_ ids: [String], active: String?) -> String? { if let active, contains(ids, active) { return active }; return ids.first }
    private func acquire() async throws {
        if !busy { busy = true; return }; guard waiters.count < 16 else { throw ProAllowanceFailure.unconfirmed }
        await withCheckedContinuation { waiters.append($0) }
    }
    private func release() { if waiters.isEmpty { busy = false } else { waiters.removeFirst().resume() } }
}
