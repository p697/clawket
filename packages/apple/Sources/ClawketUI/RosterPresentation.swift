import Foundation

/// Local display operations need explicit host availability just like wire actions.
public struct RosterActionsPresentation: Hashable, Sendable {
    public var pin: ActionAvailability
    public var markRead: ActionAvailability
    public var connectionSettings: ActionAvailability
    public init(pin: ActionAvailability = .unsupported, markRead: ActionAvailability = .unsupported,
                connectionSettings: ActionAvailability = .unsupported) {
        self.pin = pin; self.markRead = markRead; self.connectionSettings = connectionSettings
    }
}
