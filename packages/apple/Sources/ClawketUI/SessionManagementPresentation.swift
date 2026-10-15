import Foundation

public enum SessionLifecycleAction: String, Hashable, Sendable, CaseIterable {
    case rename, reset, delete, archive, restore, branch
    public var requiresConfirmation: Bool { self == .reset || self == .delete }
}

/// A host-owned display snapshot. Its ID maps to ephemeral authority outside the UI.
public struct SessionManagementPresentation: Identifiable, Hashable, Sendable {
    public enum Phase: Hashable, Sendable { case loading, ready, unavailable }
    public var id: UUID
    public var route: ConversationID
    public var title: String
    public var phase: Phase
    public var actions: Set<SessionLifecycleAction>
    public var submittingAction: SessionLifecycleAction?
    public var isUncertain: Bool
    public var error: String?
    public var maximumTitleUTF16: Int?
    public var confirmation: SessionMutationConfirmation?

    public init(id: UUID, route: ConversationID, title: String, phase: Phase = .loading,
                actions: Set<SessionLifecycleAction> = [], submittingAction: SessionLifecycleAction? = nil,
                isUncertain: Bool = false, error: String? = nil, maximumTitleUTF16: Int? = nil,
                confirmation: SessionMutationConfirmation? = nil) {
        self.id = id; self.route = route; self.title = title; self.phase = phase; self.actions = actions
        self.submittingAction = submittingAction; self.isUncertain = isUncertain; self.error = error
        self.maximumTitleUTF16 = maximumTitleUTF16; self.confirmation = confirmation
    }

    public func permits(_ action: SessionLifecycleAction) -> Bool {
        phase == .ready && route.isConcrete && actions.contains(action) && submittingAction == nil && !isUncertain
    }

    public func validatedTitle(_ value: String) -> String? {
        let title = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title != self.title, title.utf8.count <= 2_048,
              maximumTitleUTF16.map({ title.utf16.count <= $0 }) ?? true else { return nil }
        return title
    }
}

/// The host freezes action + runtime reference before presenting a destructive decision.
public struct SessionMutationConfirmation: Identifiable, Hashable, Sendable {
    public var id: UUID
    public var reviewID: UUID
    public var action: SessionLifecycleAction
    public init(id: UUID, reviewID: UUID, action: SessionLifecycleAction) {
        self.id = id; self.reviewID = reviewID; self.action = action
    }
}
