import Foundation
import ClawketTransport

/// Catalog-only SDK reads do not select a privileged or global conversation.
public enum RuntimeModelControlScope: Sendable, Equatable, Hashable {
    case catalog
    case global
    case session(String)
}

/// Ephemeral settings authority. Never persist, log or reconstruct this reference.
public struct RuntimeModelControlsReference: Sendable, Equatable, Hashable, CustomStringConvertible {
    let token: UUID
    public var description: String { "RuntimeModelControlsReference" }
}

public enum RuntimeModelControlAction: String, Sendable, Hashable {
    case selectModel, setThinkingLevel, prepareThinkingCommand, setFastMode, setPermissions
}

public enum RuntimeModelControlWriteState: String, Sendable { case available, pending, uncertain }

public struct RuntimeModelThinking: Sendable, Equatable {
    public enum WritePath: String, Sendable { case native, command }
    public let current: String?
    public let levels: [String]
    /// A command is prepared for the ordinary persisted outbox, never dispatched here.
    public let writePath: WritePath?
}

public struct RuntimeModelFastMode: Sendable, Equatable {
    public let enabled: Bool?
    public let available: Bool
}

public enum RuntimeSessionPermissionMode: String, Sendable, CaseIterable {
    case workspace
    case readOnly = "read-only"
    case fullAccess = "full-access"
}

public enum RuntimeEffectivePermissionMode: Sendable, Equatable {
    case known(RuntimeSessionPermissionMode)
    case custom
}

public struct RuntimeModelPermissions: Sendable, Equatable {
    public let mode: RuntimeEffectivePermissionMode?
    public let available: Bool
    public let availableModes: [RuntimeSessionPermissionMode]
    /// Effective local/native requirement, not a default inferred from a known mode.
    public let requiresConfirmation: Bool
    /// Computed from the actual client transport; peer claims never set this field.
    public let unencryptedTransport: Bool
}

/// Display values plus one current settings reference. This value is intentionally not Codable.
public struct RuntimeModelControls: Sendable, Equatable {
    public let connectionID: String
    public let backendKind: BackendKind
    public let generation: ConnectionGeneration
    /// The exact caller's route, including on a global-setting backend such as Hermes.
    public let sessionKey: String?
    public let scope: RuntimeModelControlScope
    public let reference: RuntimeModelControlsReference
    public let models: [RuntimeModel]
    public let currentModel: String?
    public let currentProvider: String?
    public let configuredDefaultModel: String?
    public let thinking: RuntimeModelThinking?
    public let fastMode: RuntimeModelFastMode?
    public let permissions: RuntimeModelPermissions?
    public let allowedActions: Set<RuntimeModelControlAction>
    public let writeState: RuntimeModelControlWriteState
    /// Only a real settings/permission barrier pauses input. An unrelated failed read does not.
    /// This does not describe network readiness, ownership, or the independent Stop action.
    public let canSend: Bool
    /// Positive native settings negotiation makes a real write pause this scope.
    /// Pure command preparation and unrelated reads do not start this barrier.
    public let usesNativeSendBarrier: Bool
}

/// A single-use, thirty-second confirmation for one captured permission choice.
/// Dismissing the native dialog is inert; never persist this value.
public struct RuntimeModelPermissionConfirmation: Sendable, Equatable, CustomStringConvertible {
    let token: UUID
    public let reference: RuntimeModelControlsReference
    public let mode: RuntimeSessionPermissionMode
    public var description: String { "RuntimeModelPermissionConfirmation" }
}

public enum RuntimeModelSendBarrier: String, Sendable {
    case pending, unconfirmed, permissionsRequired
}

/// ACK and an effective native state are distinct outcomes. A later read failure cannot undo an ACK.
public struct RuntimeModelControlReceipt: Sendable, Equatable {
    public let reference: RuntimeModelControlsReference
    public let connectionID: String
    public let sessionKey: String?
    public let scope: RuntimeModelControlScope
    public let action: RuntimeModelControlAction
    public let state: RuntimeModelControls?
    public var refreshRequired: Bool { state == nil }
}

/// A pure plan for the existing draft/outbox path. It grants no send or retry authority.
/// The host supplies its own persisted outbox identity and rechecks its captured route.
public struct RuntimeSettingCommand: Sendable, Equatable {
    public let connectionID: String
    public let sessionKey: String
    public let settingsScope: RuntimeModelControlScope
    public let text: String
    public let thinkingLevel: String?
}
