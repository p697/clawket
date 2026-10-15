import ClawketUI
import Foundation
import SwiftUI

@MainActor
final class NativePreferences: ObservableObject {
    @Published private(set) var appearance = ClientAppearancePresentation()
    @Published private(set) var isSaving = false
    @Published private(set) var canSave = false
    @Published var error: String?
    var onAppearance: ((ClientAppearancePresentation) -> Void)?
    private let store: NativePreferencesStore?
    private var appearanceDocument = NativeAppearanceDocument()
    private var navigation = NativeNavigationDocument()
    private var navigationLoaded = false
    private var navigationFailed = false
    private var saveTask: Task<Void, Never>?
    private var activeConnectionID: String?
    private var pending: NativeNavigationTarget?
    private var foreground = true

    init(store: NativePreferencesStore? = try? NativePreferencesStore()) { self.store = store }
    func load() async {
        guard let store else { failure(); return }
        do {
            appearanceDocument = try await store.appearance(); appearance = appearanceDocument.value
            canSave = true; onAppearance?(appearance)
        } catch { failure() }
        do { navigation = try await store.navigation(); navigationLoaded = true }
        catch { navigationFailed = true; failure() }
    }
    func save(_ value: ClientAppearancePresentation) async -> Bool {
        guard canSave, !isSaving, value.isValid, let store,
              appearanceDocument.revision < 9_007_199_254_740_991 else { return false }
        isSaving = true; defer { isSaving = false }
        var next = appearanceDocument; next.revision += 1; next.value = value
        do {
            try await store.write(next); appearanceDocument = next; appearance = value
            onAppearance?(value); return true
        } catch { canSave = false; failure(); return false }
    }
    func activate(_ connectionID: String) {
        guard activeConnectionID != connectionID else { return }
        activeConnectionID = connectionID
        pending = navigationLoaded ? navigation.targets.first { Data($0.connectionID.utf8) == Data(connectionID.utf8) } : nil
    }
    func restoration(connectionID: String, agents: [String], sessions: [ConversationID], fresh: Bool)
        -> NativeNavigationRestoration.Decision {
        guard activeConnectionID == connectionID, let pending else { return .wait }
        let decision = NativeNavigationRestoration.decide(pending, connectionID: connectionID,
            agents: agents, sessions: sessions, fresh: fresh)
        // A cached hit opens for reading, but remains pending until a fresh catalog
        // verifies it or routes a missing/archived target to the same Agent's picker.
        if decision != .wait && (fresh || pending.kind == .catalog) { self.pending = nil }
        return decision
    }
    func opened(_ target: NativeNavigationTarget) {
        let samePendingConversation = pending?.kind == .conversation && target.kind == .conversation &&
            pending?.route.map(NativeStoredRoute.init) == target.route.map(NativeStoredRoute.init)
        if !samePendingConversation { pending = nil }
        guard navigationLoaded, !navigationFailed else { return }
        do { try navigation.record(target); scheduleSave() }
        catch { navigationFailed = true; failure() }
    }
    func reading(for route: ConversationID) -> ConversationReadingContext? {
        navigation.readings.first { $0.route == NativeStoredRoute(route) }?.context
    }
    func recordReading(_ value: ConversationReadingContext, route: ConversationID) {
        guard navigationLoaded, !navigationFailed else { return }
        do { try navigation.record(value, route: route); scheduleSave() }
        catch { navigationFailed = true; failure() }
    }
    func setForeground(_ value: Bool) {
        foreground = value
        if !value { flush() }
    }
    func flush() { scheduleSave(immediate: true) }
    private func scheduleSave(immediate: Bool = false) {
        guard navigationLoaded, !navigationFailed, let store else { return }
        let immediate = immediate || !foreground
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            if !immediate { try? await Task.sleep(for: .milliseconds(350)) }
            guard let self, !Task.isCancelled else { return }
            let snapshot = self.navigation
            self.saveTask = nil // Only cancel a debounce, never an in-flight atomic replacement.
            do { try await store.write(snapshot) }
            catch { self.navigationFailed = true; self.failure() }
        }
    }
    private func failure() {
        error = String(localized: "Preferences are unavailable. Reopen Clawket before trying again.")
    }
}
