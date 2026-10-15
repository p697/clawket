import Foundation

public enum MediaFailure: String, Error, Sendable {
    case invalidFile, tooLarge, capacity, unsupported, corrupt, missing, cancelled, invalidChunk, commitUncertain
}

public enum MediaLimits {
    public static let sourceBytes = 32 * 1_024 * 1_024
    public static let promptBytes = 5 * 1_024 * 1_024
    public static let artifactBytes = 10 * 1_024 * 1_024
    public static let chunkBytes = 128 * 1_024
    public static let libraryBytes = 100 * 1_024 * 1_024
    public static let resources = 128
    public static let imagePixels = 16_000_000
}

/// Stable owned bytes. Persist the ID and metadata, never a picker URL.
public struct MediaResource: Codable, Sendable, Equatable, Identifiable {
    public let id: UUID
    public let name: String
    public let mimeType: String
    public let byteCount: Int
    public let sha256: String
    public let createdAt: Date
    public var hasRasterPreview: Bool { ["image/png", "image/jpeg", "image/gif", "image/webp"].contains(mimeType) }
}

public struct MediaImagePreview: Sendable {
    public let data: Data
    public let aspectRatio: Double
}

public struct PreparedMedia: Sendable {
    public let resource: MediaResource
    public let data: Data
    public let mimeType: String
    public let isImage: Bool
    public let thumbnail: Data?
    public let aspectRatio: Double?
}

/// Only a stager can create this owned-file receipt.
public struct StagedMediaFile: Sendable {
    let url: URL
    let resource: MediaResource
}

public struct MediaArtifactKey: Codable, Sendable, Hashable {
    public let connectionID: String
    public let sessionKey: String
    public let artifactID: String
    public init(connectionID: String, sessionKey: String, artifactID: String) {
        self.connectionID = connectionID; self.sessionKey = sessionKey; self.artifactID = artifactID
    }
}

func mediaName(_ name: String) throws -> String {
    guard !name.isEmpty, name.utf8.count <= 255, !name.hasPrefix("."),
          !name.contains("/"), !name.contains("\\"), !name.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else {
        throw MediaFailure.invalidFile
    }
    return name
}

func mediaMIME(_ mime: String) throws -> String {
    let mime = mime.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard mime.utf8.count <= 255,
          mime.range(of: "^[a-z0-9.+-]+/[a-z0-9.+-]+$", options: .regularExpression) != nil else { throw MediaFailure.invalidFile }
    return mime
}
