import ClawketCommerce
import ClawketPersistence
import ClawketRuntime
import ClawketUI
import Combine
import Foundation

@MainActor
extension NativeAppModel {
    func setupPro(vault: NativeVault) async {
        let configuration = NativeProConfiguration()
        var source: NativeRevenueCatSource?
        if configuration.isConfigured, let identity = try? NativePurchaseIdentity.qa(bundleID: Bundle.main.bundleIdentifier) {
            source = try? NativeRevenueCatSource(config: configuration, identity: identity)
        }
        pro = ProController(mode: configuration.mode, source: source)
        proAttached = true; rosterExplicitAccess = []
        pro.onAccessChanged = { [weak self] in self?.proAccessChanged() }
        pro.onClosed = { [weak self] id in self?.proContinuations.removeValue(forKey: id) }
        pro.onSuccessfulDismissal = { [weak self] review in self?.completeProReview(review) }
        proObservation = pro.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
        do {
            let identity = try await vault.identity()
            proAllowances = try ProAllowanceStore(values: KeychainValueStore(service: "com.p697.clawket.nativeqa.secure.v1"), deviceID: identity.deviceID)
            let manual = try NativeManualSessions(); manualSessions = manual
            proManualSessions = try await manual.read()
            await reconcileProAllowance()
        } catch { proStorageFailed = true; notice = String(localized: "Your free connection could not be saved. Reopen Clawket before trying again.") }
        Task { await pro.refreshCustomer() }
    }
    func reconcileProAllowance() async {
        guard !proStorageFailed, let proAllowances else { return }
        guard !proAllowanceReading else { proAllowancePending = true; return }
        proAllowanceReading = true
        defer { proAllowanceReading = false }
        repeat {
            proAllowancePending = false
            let ids = connections.map(\.id), active = activeConnectionID
            do {
                let value = try await proAllowances.resolve(connectionIDs: ids, activeID: active, paid: pro.paid, now: proNow)
                guard ids.map({ Data($0.utf8) }) == connections.map({ Data($0.id.utf8) }) else { proAllowancePending = true; continue }
                if pro.allowance != value { pro.updateAllowance(value) }
            } catch {
                proStorageFailed = true
                notice = String(localized: "Your free connection could not be saved. Reopen Clawket before trying again.")
            }
        } while proAllowancePending && !proStorageFailed
    }
    var proNow: Int64 { Int64(max(0, min(9_007_199_254_740_991, pro.now.isFinite ? pro.now : 0))) }
    func proAgentAccess(_ id: AgentCatalogID) -> ProAccessDecision {
        let agent = agents.first { $0.connectionID.utf8.elementsEqual(id.connectionID.utf8) && $0.agentID.utf8.elementsEqual(id.agentID.utf8) }
        return pro.access.agent(connectionID: id.connectionID, isMain: agent?.isMain, at: pro.now)
    }
    func proConversationAccess(_ route: ConversationID) -> NativeProRoutePolicy.Access {
        let agent = agents.first { $0.connectionID.utf8.elementsEqual(route.connectionID.utf8) && $0.agentID.utf8.elementsEqual(route.agentID.utf8) }
        let session = sessions.first { $0.connectionID.utf8.elementsEqual(route.connectionID.utf8) && $0.agentID.utf8.elementsEqual(route.agentID.utf8) && $0.key.utf8.elementsEqual(route.sessionID.utf8) }
        return NativeProRoutePolicy.conversation(route, access: pro.access, now: pro.now, agentIsMain: agent?.isMain,
            entryMode: agent?.entryMode, mainSessionKey: agent?.mainSessionKey, sessionKind: session?.kind,
            source: session?.source, manual: proManualSessions)
    }
    func proPermitsInput(_ route: ConversationID) -> Bool { proConversationAccess(route) == .full }
    func proAccessChanged() {
        objectWillChange.send()
        // Inject the complete decision set; an empty resolved set must not fall back
        // to the registry's historical free-connection mirror.
        publishProRosterAccess()
        historyController?.accessChanged()
        if let review = presentation.modelControls, !proPermitsInput(review.route) { modelControls?.dismiss(review.id) }
        if let review = presentation.sessionManagement, !proPermitsInput(review.route) { sessionManager?.dismiss(review.id) }
        for route in documents.keys {
            if !proPermitsInput(route) {
                var changed = false
                for index in documents[route]?.messages.indices ?? 0..<0 where documents[route]?.messages[index].local == true && documents[route]?.messages[index].delivery == .queued {
                    documents[route]?.messages[index].delivery = .held; changed = true
                }
                if changed { self.changed(route); scheduleSave(route, immediate: true) }
            }
            updatePresentation(route)
        }
        rebuildRoster()
    }
    func publishProRosterAccess() {
        guard proAttached else { return }
        let scopes = Set(agents.filter { proAgentAccess(.init(connectionID: $0.connectionID, agentID: $0.agentID)) == .allowed }
            .map { AgentCatalogID(connectionID: $0.connectionID, agentID: $0.agentID) })
        if rosterExplicitAccess != scopes { rosterExplicitAccess = scopes }
    }
    func showPro(_ feature: ProFeature? = nil, presenterID: UUID? = nil, continuing action: NativeProContinuation.Action? = nil) {
        guard mediaPicker == nil, mediaPreview == nil, voiceSheet == nil else { return }
        let route = presentation.selectedConversation
        guard let review = pro.open(presenterID: presenterID ?? proRootPresenterID, feature: feature) else { return }
        if let action { proContinuations[review.id] = .init(action: action, activation: activationRevision, wire: wireRevision,
            selection: selectionRevision, route: route, epoch: route.flatMap { documents[$0]?.historyEpoch }) }
    }
    func completeProReview(_ review: ProReview) {
        guard pro.allFeatures, let frozen = proContinuations.removeValue(forKey: review.id) else { return }
        let route = presentation.selectedConversation
        guard frozen.matches(activation: activationRevision, wire: wireRevision, selection: selectionRevision,
            route: route, epoch: route.flatMap { documents[$0]?.historyEpoch }) else { return }
        switch frozen.action {
        case let .connection(id): activate(id)
        case .addConnection:
            showConnectAfterDismissal()
        case let .catalog(id): handle(.openAgentCatalog(id))
        case let .conversation(route): handle(.openConversation(route))
        }
    }
    var proCanAddConnection: Bool { pro.access.addingConnection(count: connections.count, at: pro.now) == .allowed }
    func switchFreeConnection(_ id: String) async {
        guard !changingConnections, !proSwitching, !proStorageFailed, let store = proAllowances, !pro.paid else { return }
        proSwitching = true; defer { proSwitching = false }
        do {
            let value = try await store.switchConnection(to: id, connectionIDs: connections.map(\.id), paid: pro.paid, now: proNow)
            pro.updateAllowance(value)
        } catch ProAllowanceFailure.cooldown { notice = String(localized: "You can change your free connection once every 24 hours.") }
        catch {
            proStorageFailed = true
            notice = String(localized: "Your free connection could not be saved. Reopen Clawket before trying again.")
        }
    }
    func proPreview(_ route: ConversationID, messages: [MessagePresentation]) -> [MessagePresentation] {
        let access = proConversationAccess(route)
        guard access != .full else { proPreviews.removeValue(forKey: route); return messages }
        let pendingIDs = Set((documents[route]?.messages ?? []).filter {
            $0.local && [.queued, .held, .failed, .sending, .uncertain].contains($0.delivery)
        }.map(\.id))
        let preserved = messages.filter { item in pendingIDs.contains(item.id) || item.content.contains { content in
            switch content { case .approval, .question: true; default: false }
        } }
        guard access == .preview else { return preserved }
        let body = documents[route]?.messages.filter { ($0.role == .user || $0.role == .assistant) && (!$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !$0.media.isEmpty) } ?? []
        let epoch = documents[route]?.historyEpoch
        let old = proPreviews[route]
        let saved = old?.epoch == epoch && old?.selection == selectionRevision ? old?.messages : nil
        let selected = (saved?.isEmpty == false ? saved : nil) ?? Array(messages.filter { item in body.contains { $0.id == item.id } }.suffix(2))
        let refreshed = selected.map { saved in messages.first { $0.id == saved.id } ?? saved }
        if route == presentation.selectedConversation {
            proPreviews = [route: .init(epoch: epoch, selection: selectionRevision, messages: refreshed)]
        }
        let selectedIDs = Set(refreshed.map(\.id)), preservedIDs = Set(preserved.map(\.id)), currentIDs = Set(messages.map(\.id))
        let missing = refreshed.filter { !currentIDs.contains($0.id) }
        return missing + messages.filter { selectedIDs.contains($0.id) || preservedIDs.contains($0.id) }
    }
    func applyProFeatures(_ route: ConversationID, features: inout [ClientFeature: ActionAvailability]) {
        guard !proPermitsInput(route) else { return }
        let reason = proConversationAccess(route) == .unresolved ? String(localized: "Checking access…") : String(localized: "Latest messages · read-only preview")
        for feature in [ClientFeature.send, .voice, .photos, .camera, .files, .paste, .newSession, .models, .modelControls, .sessionManagement, .loadEarlier, .exportConversation] {
            if features[feature]?.isVisible == true { features[feature] = .temporarilyUnavailable(reason) }
        }
        features[.pro] = .available
    }
}

struct NativeProPreview {
    let epoch: UUID?
    let selection: UUID
    let messages: [MessagePresentation]
}
