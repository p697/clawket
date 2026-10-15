import Foundation

public enum ModelControlChoice: Hashable, Sendable {
    case model(String)
    case thinking(String)
    case fastMode(Bool)
    case permissions(ModelPermissionMode)
}

public enum ModelPermissionMode: String, Hashable, Sendable, CaseIterable {
    case readOnly, workspace, fullAccess
}

public struct ThinkingLevelPresentation: Identifiable, Hashable, Sendable {
    public var id: String
    public var title: String
    public init(id: String, title: String) { self.id = id; self.title = title }
}

public struct ThinkingControlPresentation: Hashable, Sendable {
    public var current: String?
    public var levels: [ThinkingLevelPresentation]
    public var availability: ActionAvailability
    public var currentTitle: String?
    public init(current: String? = nil, levels: [ThinkingLevelPresentation] = [], availability: ActionAvailability = .unsupported,
                currentTitle: String? = nil) {
        self.current = current; self.levels = levels; self.availability = availability
        self.currentTitle = currentTitle
    }
    public var currentDisplayTitle: String? {
        guard let current else { return nil }
        return currentTitle ?? levels.first(where: { $0.id == current })?.title ?? current
    }
}

public struct FastModeControlPresentation: Hashable, Sendable {
    public var enabled: Bool?
    public var availability: ActionAvailability
    public init(enabled: Bool? = nil, availability: ActionAvailability = .unsupported) {
        self.enabled = enabled; self.availability = availability
    }
}

public struct PermissionControlPresentation: Hashable, Sendable {
    public enum Current: Hashable, Sendable { case mode(ModelPermissionMode), computerSettings }
    public var current: Current?
    public var modes: [ModelPermissionMode]
    public var availability: ActionAvailability
    public var requiresConfirmation: Bool
    public var unencryptedTransport: Bool
    public init(current: Current? = nil, modes: [ModelPermissionMode] = [], availability: ActionAvailability = .unsupported,
                requiresConfirmation: Bool = false, unencryptedTransport: Bool = false) {
        self.current = current; self.modes = modes; self.availability = availability
        self.requiresConfirmation = requiresConfirmation; self.unencryptedTransport = unencryptedTransport
    }
}

/// A frozen display identity. The host owns the runtime confirmation and its expiry.
public struct ModelPermissionConfirmationPresentation: Identifiable, Hashable, Sendable {
    public var id: UUID
    public var reviewID: UUID
    public var mode: ModelPermissionMode
    public init(id: UUID, reviewID: UUID, mode: ModelPermissionMode) {
        self.id = id; self.reviewID = reviewID; self.mode = mode
    }
}

public struct ModelControlsPresentation: Identifiable, Hashable, Sendable {
    public enum Scope: Hashable, Sendable { case catalog, global, conversation }
    public enum Phase: Hashable, Sendable { case loading, ready, unavailable }
    public var id: UUID
    public var route: ConversationID
    public var scope: Scope
    public var phase: Phase
    public var models: [ModelPresentation]
    /// Chosen by the host when this review opens; checks may move without reordering these rows.
    public var featuredIDs: [String]
    public var modelSelection: ActionAvailability
    public var thinking: ThinkingControlPresentation?
    public var fastMode: FastModeControlPresentation?
    public var permissions: PermissionControlPresentation?
    public var submitting: ModelControlChoice?
    public var isUncertain: Bool
    public var error: String?
    public var notice: String?
    public var refresh: ActionAvailability
    public var confirmation: ModelPermissionConfirmationPresentation?

    public init(id: UUID, route: ConversationID, scope: Scope = .catalog, phase: Phase = .loading,
                models: [ModelPresentation] = [], featuredIDs: [String] = [], modelSelection: ActionAvailability = .unsupported,
                thinking: ThinkingControlPresentation? = nil, fastMode: FastModeControlPresentation? = nil,
                permissions: PermissionControlPresentation? = nil, submitting: ModelControlChoice? = nil,
                isUncertain: Bool = false, error: String? = nil, notice: String? = nil,
                refresh: ActionAvailability = .unsupported, confirmation: ModelPermissionConfirmationPresentation? = nil) {
        self.id = id; self.route = route; self.scope = scope; self.phase = phase
        self.models = models; self.featuredIDs = featuredIDs; self.modelSelection = modelSelection
        self.thinking = thinking; self.fastMode = fastMode; self.permissions = permissions
        self.submitting = submitting; self.isUncertain = isUncertain; self.error = error; self.notice = notice
        self.refresh = refresh; self.confirmation = confirmation
    }

    public var orderedModels: [ModelPresentation] { ModelCatalogPresentation.ordered(models) }
    public var featuredModels: [ModelPresentation] {
        let ordered = orderedModels
        if ordered.count <= 4 { return ordered }
        let ids = Set(featuredIDs)
        let visible = ordered.filter { ids.contains($0.id) }
        guard !visible.isEmpty else { return ModelCatalogPresentation.featured(models: ordered) }
        // Explicit host order, not catalog order, keeps current/recent/default priorities.
        return featuredIDs.compactMap { id in visible.first(where: { $0.id == id }) }
            .filterUniqueIDs()
    }
    public var thinkingLevels: [ThinkingLevelPresentation] {
        let levels = thinking?.levels ?? []
        let counts = Dictionary(grouping: levels, by: \.id).mapValues(\.count)
        return levels.filter { !$0.id.isEmpty && counts[$0.id] == 1 }
    }

    public func permits(_ choice: ModelControlChoice) -> Bool {
        guard route.isConcrete, phase == .ready, submitting == nil else { return false }
        // A real advertised permission preset can repair unknown effective
        // permissions. Other writes remain held until the runtime allows them.
        if isUncertain {
            guard case .permissions = choice else { return false }
        }
        switch choice {
        case let .model(id): return modelSelection.isEnabled && orderedModels.contains { $0.id == id && $0.availability.isEnabled }
        case let .thinking(level): return thinking?.availability.isEnabled == true && thinkingLevels.contains { $0.id == level }
        case .fastMode: return fastMode?.availability.isEnabled == true
        case let .permissions(mode): return permissions?.availability.isEnabled == true && permissions?.modes.contains(mode) == true
        }
    }
}

public enum ModelCatalogPresentation {
    /// Reject all ambiguous identities; never let a duplicate row select a different write target.
    public static func ordered(_ models: [ModelPresentation], query: String = "") -> [ModelPresentation] {
        let counts = Dictionary(grouping: models, by: \.id).mapValues(\.count)
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return models.enumerated().filter { _, row in
            !row.id.isEmpty && counts[row.id] == 1 && row.availability.isVisible &&
                (query.isEmpty || ([row.title, row.subtitle, row.group].compactMap { $0 } + row.searchTerms)
                    .contains { $0.localizedStandardContains(query) })
        }.sorted { left, right in
            let a = left.element.catalogOrder.flatMap { $0.isFinite ? $0 : nil } ?? .infinity
            let b = right.element.catalogOrder.flatMap { $0.isFinite ? $0 : nil } ?? .infinity
            if a != b { return a < b }
            let title = left.element.title.localizedStandardCompare(right.element.title)
            return title == .orderedSame ? left.offset < right.offset : title == .orderedAscending
        }.map(\.element)
    }

    public static func featured(models: [ModelPresentation], recentIDs: [String] = [], limit: Int = 3) -> [ModelPresentation] {
        let ordered = ordered(models)
        if ordered.count <= 4 { return ordered }
        guard limit > 0 else { return [] }
        var result: [ModelPresentation] = []
        let priorities = ordered.filter(\.isSelected).map(\.id) + recentIDs + ordered.filter(\.isConfiguredDefault).map(\.id) + ordered.map(\.id)
        for id in priorities where result.count < min(limit, 4) {
            if !result.contains(where: { $0.id == id }), let row = ordered.first(where: { $0.id == id }) { result.append(row) }
        }
        return result
    }
}

private extension Array where Element == ModelPresentation {
    func filterUniqueIDs() -> Self {
        var seen = Set<String>()
        return filter { seen.insert($0.id).inserted }
    }
}
