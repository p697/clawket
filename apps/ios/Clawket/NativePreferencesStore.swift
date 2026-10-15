import ClawketPersistence
import ClawketUI
import Foundation

struct NativeAppearanceDocument: Codable, Sendable {
    var version = 1
    var revision: Int64 = 0
    var value = ClientAppearancePresentation()
    func validate() throws {
        guard version == 1, (0...9_007_199_254_740_991).contains(revision), value.isValid else { throw StoreFailure.invalidDocument }
    }
}

struct NativeStoredRoute: Hashable, Codable, Sendable {
    var connectionID: String
    var agentID: String
    var sessionID: String
    init(_ route: ConversationID) { connectionID = route.connectionID; agentID = route.agentID; sessionID = route.sessionID }
    var route: ConversationID { .init(connectionID: connectionID, agentID: agentID, sessionID: sessionID) }
    static func == (lhs: Self, rhs: Self) -> Bool {
        Data(lhs.connectionID.utf8) == Data(rhs.connectionID.utf8) && Data(lhs.agentID.utf8) == Data(rhs.agentID.utf8) && Data(lhs.sessionID.utf8) == Data(rhs.sessionID.utf8)
    }
    func hash(into hasher: inout Hasher) {
        hasher.combine(Data(connectionID.utf8)); hasher.combine(Data(agentID.utf8)); hasher.combine(Data(sessionID.utf8))
    }
    var isValid: Bool { [connectionID, agentID, sessionID].allSatisfy { !$0.isEmpty && $0.utf8.count <= 1_024 } }
}

struct NativeNavigationTarget: Hashable, Codable, Sendable {
    enum Kind: String, Codable, Sendable { case conversation, catalog }
    var kind: Kind
    var connectionID: String
    var agentID: String
    var sessionID: String?
    var isValid: Bool {
        [connectionID, agentID].allSatisfy { !$0.isEmpty && $0.utf8.count <= 1_024 } &&
        (kind == .catalog ? sessionID == nil : sessionID.map { !$0.isEmpty && $0.utf8.count <= 1_024 } == true)
    }
    init(_ route: ConversationID) {
        kind = .conversation; connectionID = route.connectionID; agentID = route.agentID; sessionID = route.sessionID
    }
    init(_ catalog: AgentCatalogID) { kind = .catalog; connectionID = catalog.connectionID; agentID = catalog.agentID; sessionID = nil }
    var route: ConversationID? { sessionID.map { .init(connectionID: connectionID, agentID: agentID, sessionID: $0) } }
    var catalog: AgentCatalogID { .init(connectionID: connectionID, agentID: agentID) }
}

struct NativeStoredReading: Codable, Sendable {
    var route: NativeStoredRoute
    var context: ConversationReadingContext
}
struct NativeNavigationDocument: Codable, Sendable {
    var version = 1
    var revision: Int64 = 0
    /// Least recently opened first. One display target per connection.
    var targets: [NativeNavigationTarget] = []
    var readings: [NativeStoredReading] = []
    func validate() throws {
        guard version == 1, (0...9_007_199_254_740_991).contains(revision), targets.count <= 128, readings.count <= 128,
              targets.allSatisfy(\.isValid), Set(targets.map { Data($0.connectionID.utf8) }).count == targets.count,
              readings.allSatisfy({ $0.route.isValid && $0.context.isValid }),
              Set(readings.map(\.route)).count == readings.count else { throw StoreFailure.invalidDocument }
    }
    mutating func advance() throws {
        guard revision < 9_007_199_254_740_991 else { throw StoreFailure.invalidDocument }; revision += 1
    }
    mutating func record(_ target: NativeNavigationTarget) throws {
        guard target.isValid else { throw StoreFailure.invalidDocument }; try advance()
        targets.removeAll { Data($0.connectionID.utf8) == Data(target.connectionID.utf8) }; targets.append(target)
        targets = Array(targets.suffix(128))
    }
    mutating func record(_ context: ConversationReadingContext, route: ConversationID) throws {
        let key = NativeStoredRoute(route)
        guard key.isValid, context.isValid else { throw StoreFailure.invalidDocument }; try advance()
        readings.removeAll { $0.route == key }; readings.append(.init(route: key, context: context))
        readings = Array(readings.suffix(128))
    }
}

/// Read/validate/write-back local display values only. Unknown atomic outcomes
/// stop that document's future writes until it has been reopened and read again.
actor NativePreferencesStore {
    private let documents: DocumentStore
    private var revisions: [String: Int64] = [:]
    private var uncertain: Set<String> = []
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    init(directory: URL? = nil, values: (any ValueStore)? = nil) throws {
        let store: any ValueStore
        if let values { store = values }
        else {
            let directory = try directory ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true).appendingPathComponent("NativePreferences", isDirectory: true)
            store = try FileValueStore(directory: directory, maximumBytes: 256 * 1_024)
        }
        documents = try DocumentStore(values: store, maximumBytes: 256 * 1_024)
    }
    func appearance() async throws -> NativeAppearanceDocument {
        try await acquire(); defer { release() }
        let value = try await documents.read(NativeAppearanceDocument.self, key: "appearance.v1")?.value ?? .init()
        try value.validate(); revisions["appearance.v1"] = value.revision
        return value
    }
    func navigation() async throws -> NativeNavigationDocument {
        try await acquire(); defer { release() }
        let value = try await documents.read(NativeNavigationDocument.self, key: "navigation.v1")?.value ?? .init()
        try value.validate(); revisions["navigation.v1"] = value.revision
        return value
    }
    func write(_ value: NativeAppearanceDocument) async throws {
        try value.validate(); try await save(value, key: "appearance.v1", revision: value.revision)
    }
    func write(_ value: NativeNavigationDocument) async throws {
        try value.validate(); try await save(value, key: "navigation.v1", revision: value.revision)
    }
    private func save<Value: Codable & Sendable>(_ value: Value, key: String, revision: Int64) async throws {
        try await acquire(); defer { release() }
        guard !uncertain.contains(key), let previous = revisions[key] else { throw StoreFailure.verificationFailed }
        guard revision > previous else { return } // A late debounced snapshot cannot overwrite a newer one.
        do {
            try await documents.write(value, key: key)
            revisions[key] = revision
        } catch { uncertain.insert(key); throw error }
    }
    private func acquire() async throws {
        if !busy { busy = true; return }
        guard waiters.count < 16 else { throw StoreFailure.unavailable }
        await withCheckedContinuation { waiters.append($0) }
    }
    private func release() {
        if waiters.isEmpty { busy = false } else { waiters.removeFirst().resume() }
    }
}

/// Absence in a cached/partial catalog is not proof that the saved route changed.
/// A fresh missing session may show its known Agent's picker, never its main chat.
enum NativeNavigationRestoration {
    enum Decision: Equatable { case wait, home, catalog(AgentCatalogID), conversation(ConversationID) }
    static func decide(_ target: NativeNavigationTarget, connectionID: String, agents: [String],
                       sessions: [ConversationID], fresh: Bool) -> Decision {
        guard target.isValid, Data(target.connectionID.utf8) == Data(connectionID.utf8) else { return .home }
        guard agents.contains(where: { Data($0.utf8) == Data(target.agentID.utf8) }) else { return fresh ? .home : .wait }
        if target.kind == .catalog { return .catalog(target.catalog) }
        if let route = target.route, sessions.contains(where: { NativeStoredRoute($0) == NativeStoredRoute(route) }) { return .conversation(route) }
        return fresh ? .catalog(target.catalog) : .wait
    }
}

/// A stale hidden callback cannot stop a newer visible A after A → B → A.
struct NativeConversationVisibility {
    private var visible: (route: NativeStoredRoute, id: UUID)?
    mutating func update(_ route: ConversationID, viewID: UUID, isVisible: Bool) -> Bool {
        guard route.isConcrete else { return false }
        let key = NativeStoredRoute(route)
        if isVisible { visible = (key, viewID); return false }
        guard visible?.route == key, visible?.id == viewID else { return false }
        visible = nil
        return true
    }
}
