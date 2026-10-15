import ClawketUI
import CryptoKit
import Foundation

enum NativeHistoryFailure: Error, Equatable { case invalid, full, changed, missing, unavailable, commitUncertain }

/// Presentation ownership only. A disappearing/reappearing view cannot adopt an
/// earlier preparation or let its old defer unlock a replacement operation.
struct NativeHistoryOperation: Sendable {
    private var id: UUID?
    var isBusy: Bool { id != nil }
    mutating func begin() -> UUID? {
        guard id == nil else { return nil }
        let value = UUID(); id = value; return value
    }
    func owns(_ value: UUID) -> Bool { id == value }
    mutating func finish(_ value: UUID) { if owns(value) { id = nil } }
    mutating func retire() { id = nil }
}

struct NativeHistoryScope: Codable, Hashable, Sendable {
    let connectionID: String
    let agentID: String
    let sessionID: String
    init(connectionID: String, agentID: String, sessionID: String) {
        self.connectionID = connectionID; self.agentID = agentID; self.sessionID = sessionID
    }
    init(_ route: ConversationID) { self.init(connectionID: route.connectionID, agentID: route.agentID, sessionID: route.sessionID) }
    var route: ConversationID { .init(connectionID: connectionID, agentID: agentID, sessionID: sessionID) }
    static func == (lhs: Self, rhs: Self) -> Bool {
        historySame(lhs.connectionID, rhs.connectionID) && historySame(lhs.agentID, rhs.agentID) && historySame(lhs.sessionID, rhs.sessionID)
    }
    func hash(into hasher: inout Hasher) {
        hasher.combine(Data(connectionID.utf8)); hasher.combine(Data(agentID.utf8)); hasher.combine(Data(sessionID.utf8))
    }
    func validate() throws {
        guard !connectionID.isEmpty, connectionID.utf16.count <= 1_000,
              !agentID.isEmpty, agentID.utf16.count <= 1_000,
              !sessionID.isEmpty, sessionID.utf16.count <= 2_000 else { throw NativeHistoryFailure.invalid }
    }
}

struct NativePhysicalArchive: Codable, Identifiable, Sendable {
    var version = 1
    let id: UUID
    let scope: NativeHistoryScope
    let fromEpoch: UUID?
    let toEpoch: UUID
    let physicalSessionID: String?
    let savedAt: Int64
    let byteCount: Int
    let sha256: String
    let replacementSHA256: String
    let sourceRevision: Int64
    let resourceIDs: [UUID]
    func validate() throws {
        try scope.validate()
        guard version == 1, toEpoch != fromEpoch, savedAt > 0,
              byteCount > 0, byteCount <= NativeHistoryLimits.recordBytes,
              historyDigest(sha256), historyDigest(replacementSHA256), sourceRevision >= 0, sourceRevision < 9_007_199_254_740_991,
              resourceIDs.count <= 128, Set(resourceIDs).count == resourceIDs.count,
              resourceIDs == resourceIDs.sorted(by: { $0.uuidString < $1.uuidString }),
              physicalSessionID == nil || (!physicalSessionID!.isEmpty && physicalSessionID!.utf8.count <= 2_048) else {
            throw NativeHistoryFailure.invalid
        }
    }
}

struct NativeHistoryRollover: Sendable {
    let archive: NativePhysicalArchive
    let current: NativeConversation
}

struct NativeHistoryIntent: Codable, Sendable {
    var version = 1
    let archive: NativePhysicalArchive
    let expectedCurrentSHA256: String
    let replacementBytes: Int
    func validate() throws {
        try archive.validate()
        guard version == 1, archive.sha256 == expectedCurrentSHA256,
              replacementBytes > 0, replacementBytes <= NativeHistoryLimits.recordBytes else { throw NativeHistoryFailure.invalid }
    }
}

enum NativeHistoryLimits {
    static let recordBytes = 8 * 1_024 * 1_024
    static let physicalBytes = 64 * 1_024 * 1_024
    static let physicalRecords = 128
    static let manifestBytes = 64 * 1_024
    static let metadataReserve = 256 * 1_024
}

func historyHash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func historySame(_ lhs: String?, _ rhs: String?) -> Bool {
    switch (lhs, rhs) {
    case (nil, nil): true
    case let (lhs?, rhs?): Data(lhs.utf8) == Data(rhs.utf8)
    default: false
    }
}
func historyDate(_ milliseconds: Double) -> Date? {
    guard milliseconds.isFinite, milliseconds > 0, milliseconds <= 253_402_300_799_999 else { return nil }
    return Date(timeIntervalSince1970: milliseconds / 1_000)
}
func historyDigest(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
}
func historyUTF16Prefix(_ value: String, maximum: Int) -> String {
    var result = String.UnicodeScalarView(), units = 0
    for scalar in value.unicodeScalars {
        let count = scalar.value > 0xFFFF ? 2 : 1
        guard units + count <= maximum else { break }
        result.append(scalar); units += count
    }
    return String(result)
}
func historyEncode<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    do { return try encoder.encode(value) } catch { throw NativeHistoryFailure.invalid }
}
