import Foundation

public enum RuntimeSessionAction: String, Codable, Sendable, Hashable {
    case rename, reset, delete, archive, unarchive, branch
}

/// Ephemeral authority for one observed row. Never persist or reconstruct this value.
public struct RuntimeSessionReference: Sendable, Hashable, CustomStringConvertible {
    let token: UUID
    public var description: String { "RuntimeSessionReference" }
}

public struct RuntimeSessionAllowedActions: Codable, Sendable, Equatable {
    public let rename: Bool
    public let reset: Bool
    public let delete: Bool
    public let pin: Bool
    public let archive: Bool
}

/// The product ceiling still requires the exact current row's permission.
public struct RuntimeSessionManagementCapabilities: Codable, Sendable, Equatable {
    public let rename: Bool
    public let reset: Bool
    public let delete: Bool
    public let archive: Bool
    public let branch: Bool
}

public struct RuntimeSessionManagement: Sendable, Equatable {
    public enum WriteState: String, Sendable { case available, pending, uncertain }
    public let reference: RuntimeSessionReference
    public let session: RuntimeSession
    public let allowedActions: Set<RuntimeSessionAction>
    public let writeState: WriteState
}

/// A response acknowledgement for the captured target, never the currently displayed row.
/// The caller still owns its navigation/cache revision and a fresh catalog read.
public struct RuntimeSessionMutationReceipt: Sendable, Equatable {
    public let reference: RuntimeSessionReference
    public let connectionID: String
    public let sessionKey: String
    public let sessionID: String?
    public let action: RuntimeSessionAction
}
