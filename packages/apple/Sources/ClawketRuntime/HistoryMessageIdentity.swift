import Foundation
import CryptoKit
import ClawketTransport

struct HistoryMessageIdentity {
    struct Projection {
        let id: String
        let providedID: String?
        let source: RuntimeMessageIDSource
    }
    private let providedCounts: [String: Int]
    private var syntheticCounts: [String: Int] = [:]
    private var emitted: Set<String> = []

    init(_ values: [JSONValue]) {
        providedCounts = values.reduce(into: [:]) { counts, value in
            if let id = Self.provided(value) { counts[id, default: 0] += 1 }
        }
    }

    mutating func project(_ value: JSONValue) throws -> Projection {
        let provided = Self.provided(value)
        if let provided, providedCounts[provided] == 1 {
            emitted.insert(provided)
            return .init(id: provided, providedID: provided, source: .provided)
        }
        // A content digest provides a deterministic renderer fallback only.
        // It is never a source identity, local echo or cross-page merge key.
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let digest = SHA256.hash(data: try encoder.encode(value)).map { String(format: "%02x", $0) }.joined()
        var ordinal = syntheticCounts[digest, default: 0]
        var candidate: String
        repeat {
            candidate = "native-history:\(digest):\(ordinal)"; ordinal += 1
        } while providedCounts[candidate] != nil || emitted.contains(candidate)
        syntheticCounts[digest] = ordinal; emitted.insert(candidate)
        return .init(id: candidate, providedID: provided, source: provided == nil ? .synthetic : .ambiguousProvided)
    }

    private static func provided(_ value: JSONValue) -> String? {
        for raw in [value["id"], value["messageId"], value["__openclaw"]?["id"]] {
            if let value = MessageAttributionWire.identifier(raw, maximum: 4_096), value.utf8.count <= 4_096 { return value }
        }
        return nil
    }

    static func position(_ value: JSONValue, backend: BackendKind) -> RuntimeTranscriptPosition? {
        guard backend == .openclaw, let raw = value["__openclaw"]?["transcriptPosition"],
              let source = MessageAttributionWire.identifier(raw["source"], maximum: 4_096), source.utf8.count <= 4_096,
              let sequence = raw["rawSeq"]?.safeInteger, sequence >= 0 else { return nil }
        return .init(source: source, rawSequence: sequence)
    }

    static func boundary(_ value: JSONValue, backend: BackendKind, role: RuntimeMessage.Role) -> RuntimeTranscriptBoundary? {
        guard backend == .openclaw, role == .system else { return nil }
        return value["__openclaw"]?["kind"]?.stringValue.flatMap(RuntimeTranscriptBoundary.init(rawValue:))
    }
}
