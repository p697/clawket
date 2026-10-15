import ClawketRuntime
import ClawketUI
import Foundation

extension NativeAppModel {
    func setupSavedHistory(runtime: RuntimeCoordinator) {
        guard let cache else { return }
        do {
            historyController = try NativeHistoryController(saved: NativeSavedConversations(), conversations: cache,
                media: media, runtime: runtime, exports: NativeHistoryExportCache(), current: { [weak self] context in
                    guard let self else { return false }
                    return context.activation == self.activationRevision && context.wire == self.wireRevision &&
                        context.selection == self.selectionRevision && context.route == self.presentation.selectedConversation &&
                        context.route.connectionID == self.activeConnectionID && self.state.phase == .ready &&
                        context.epoch == self.documents[context.route]?.historyEpoch
                })
            presentation.features[.savedHistory] = .available
        } catch { notice = NativeHistoryController.failureText(error) }
    }

    func addHistoryFeatures(_ route: ConversationID, features: inout [ClientFeature: ActionAvailability]) {
        guard historyController != nil else { return }
        features[.savedHistory] = .available
        features[.previousTranscripts] = .available
        if state.capabilities.history {
            features[.exportConversation] = state.phase == .ready && route.connectionID == activeConnectionID ? .available :
                .temporarilyUnavailable(String(localized: "Reconnect to load earlier messages."))
        }
    }

    func openHistory(_ destination: ClientDestination, route: ConversationID?) {
        guard historyController != nil else { return }
        switch destination {
        case .savedHistory: self.destination = .savedHistory(UUID())
        case .previousTranscripts:
            guard let route, route.isConcrete else { return }
            self.destination = .previousTranscripts(.init(route), UUID())
        case .exportConversation:
            guard let route, route.isConcrete, route == presentation.selectedConversation, route.connectionID == activeConnectionID,
                  state.phase == .ready, state.capabilities.history else { return }
            let context = NativeHistoryExportContext(route: route, activation: activationRevision, wire: wireRevision,
                selection: selectionRevision, epoch: documents[route]?.historyEpoch)
            self.destination = .exportConversation(.init(context: context,
                title: presentation.conversations[route]?.sessionTitle ?? String(localized: "Conversation")))
        default: break
        }
    }
}
