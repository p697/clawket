import ClawketPersistence
import ClawketRuntime
import ClawketUI
import Foundation

protocol NativeModelRuntime: Sendable {
    func modelControls(sessionKey: String?) async throws -> RuntimeModelControls
    func selectModel(reference: RuntimeModelControlsReference, modelID: String, provider: String?) async throws -> RuntimeModelControlReceipt
    func setThinkingLevel(reference: RuntimeModelControlsReference, level: String) async throws -> RuntimeModelControlReceipt
    func setFastMode(reference: RuntimeModelControlsReference, enabled: Bool) async throws -> RuntimeModelControlReceipt
    func preparePermissions(reference: RuntimeModelControlsReference, mode: RuntimeSessionPermissionMode) async throws -> RuntimeModelPermissionConfirmation
    func setPermissions(confirmation: RuntimeModelPermissionConfirmation) async throws -> RuntimeModelControlReceipt
    func prepareThinkingCommand(reference: RuntimeModelControlsReference, level: String) async throws -> RuntimeSettingCommand
    func modelSendBarrier(sessionKey: String) async -> RuntimeModelSendBarrier?
}
extension RuntimeCoordinator: NativeModelRuntime {}

/// Owns ephemeral settings authority; its UI contains only display values and frozen IDs.
@MainActor
final class NativeModelControls {
    private struct Key: Hashable { let connectionID: String; let scope: RuntimeModelControlScope }
    private struct InputKey: Hashable { let connectionID: String; let sessionKey: String }
    private struct Authority {
        let reviewID: UUID
        let route: ConversationID
        let host: NativeSessionHostContext
        let epoch: UUID
        let value: RuntimeModelControls
        var key: Key { .init(connectionID: value.connectionID, scope: value.scope) }
    }
    private struct Operation { let id: UUID; let authority: Authority; let choice: ModelControlChoice; let pausesInput: Bool }
    private struct Confirmation { let id: UUID; let authority: Authority; let value: RuntimeModelPermissionConfirmation }
    private let presentation: ClientPresentation
    private let runtime: any NativeModelRuntime
    private let context: @MainActor () -> NativeSessionHostContext
    private let selectedRoute: @MainActor () -> ConversationID?
    private let queue: @MainActor (ConversationID, RuntimeSettingCommand) async throws -> Void
    private let onSnapshot: @MainActor (ConversationID, RuntimeModelControls, [ModelPresentation]) -> Void
    private let onChange: @MainActor () -> Void
    private let preferences: NativeModelPreferences?
    private var epoch = UUID()
    private var ready = false
    private var connectionID: String?
    private var authority: Authority?
    private var confirmation: Confirmation?
    private var operations: [Key: Operation] = [:]
    private var reads: [ConversationID: UUID] = [:]
    private var legacyReads: [ConversationID: UUID] = [:]
    private var barriers: [InputKey: RuntimeModelSendBarrier] = [:]
    private var unconfirmedInputs: Set<InputKey> = []
    private var unconfirmedModels: Set<Key> = []
    private var recent: [String: [String]] = [:]
    private var configuredDefaults: [String: String] = [:]
    private var defaultReads: [String: UUID] = [:]

    init(presentation: ClientPresentation, runtime: any NativeModelRuntime, preferences: NativeModelPreferences? = nil,
         context: @escaping @MainActor () -> NativeSessionHostContext,
         selectedRoute: @escaping @MainActor () -> ConversationID?,
         queue: @escaping @MainActor (ConversationID, RuntimeSettingCommand) async throws -> Void,
         onSnapshot: @escaping @MainActor (ConversationID, RuntimeModelControls, [ModelPresentation]) -> Void,
         onChange: @escaping @MainActor () -> Void) {
        self.presentation = presentation; self.runtime = runtime; self.preferences = preferences
        self.context = context; self.selectedRoute = selectedRoute; self.queue = queue
        self.onSnapshot = onSnapshot; self.onChange = onChange
    }

    func update(_ state: RuntimeConnectionState) {
        if connectionID != state.connectionID || ready && state.phase != .ready { invalidate() }
        connectionID = state.connectionID; ready = state.phase == .ready
    }
    func invalidate() {
        epoch = UUID(); ready = false; authority = nil; confirmation = nil; reads = [:]; legacyReads = [:]; operations = [:]
        configuredDefaults = [:]; defaultReads = [:]
        // Only actual runtime observations clear a native input barrier.
        if var value = presentation.modelControls {
            value.phase = .unavailable; value.submitting = nil; value.confirmation = nil
            value.error = String(localized: "Reconnect to review model settings.")
            value.refresh = .unsupported; presentation.modelControls = value
        }
    }
    /// Retire only authority addressed to this physical session. Global model
    /// writes remain global; an in-flight native write keeps its unknown barrier.
    func retireSession(_ route: ConversationID) {
        reads.removeValue(forKey: route); legacyReads.removeValue(forKey: route)
        let affected = operations.filter { _, value in
            guard historySame(value.authority.route.connectionID, route.connectionID),
                  case let .session(sessionID) = value.authority.value.scope else { return false }
            return historySame(sessionID, route.sessionID)
        }
        for (key, operation) in affected {
            operations.removeValue(forKey: key)
            unconfirmedModels.insert(key)
            if operation.pausesInput {
                unconfirmedInputs.insert(inputKey(route)); barriers[inputKey(route)] = .unconfirmed
            }
        }
        if authority?.route == route || confirmation?.authority.route == route {
            let id = authority?.reviewID ?? confirmation?.authority.reviewID
            fail(id, text: String(localized: "Review model settings before sending."), uncertain: !affected.isEmpty)
        }
        onChange()
    }
    func permitsInput(_ route: ConversationID) -> Bool { barriers[inputKey(route)] == nil && !unconfirmedInputs.contains(inputKey(route)) && operationFor(route)?.pausesInput != true }
    func verifyInput(_ route: ConversationID) async throws {
        guard ready, route.connectionID == connectionID else { throw RuntimeFailure(.notConnected) }
        guard permitsInput(route) else { throw RuntimeFailure(barrier(route) == .permissionsRequired ? .permissionsRequired : .requestBusy) }
        let captured = epoch, host = context()
        let actual = await runtime.modelSendBarrier(sessionKey: route.sessionID)
        guard isCurrent(captured, host) else { throw RuntimeFailure(.superseded) }
        barriers[inputKey(route)] = unconfirmedInputs.contains(inputKey(route)) ? .unconfirmed : actual; onChange()
        guard permitsInput(route) else { throw RuntimeFailure(actual == .permissionsRequired ? .permissionsRequired : .requestBusy) }
    }
    func isChangingModel(_ route: ConversationID) -> Bool {
        operations.values.contains { operation in
            guard case .model = operation.choice, operation.authority.route.connectionID == route.connectionID else { return false }
            return operation.authority.value.scope == .global || operation.authority.route.sessionID == route.sessionID
        }
    }
    func barrier(_ route: ConversationID) -> RuntimeModelSendBarrier? { barriers[inputKey(route)] }
    func isImageModelUnconfirmed(_ route: ConversationID) -> Bool {
        unconfirmedModels.contains { $0.connectionID == route.connectionID &&
            ($0.scope == .global || $0.scope == .session(route.sessionID)) }
    }

    func open(_ route: ConversationID, id: UUID) {
        guard ready, route.isConcrete, route.connectionID == connectionID else { return }
        authority = nil; confirmation = nil
        presentation.modelControls = .init(id: id, route: route, refresh: .available)
        Task { await read(route, reviewID: id) }
    }
    func dismiss(_ id: UUID) {
        guard presentation.modelControls?.id == id else { return }
        presentation.modelControls = nil; authority = nil; confirmation = nil
    }
    func refresh(_ id: UUID) {
        guard let value = presentation.modelControls, value.id == id,
              value.refresh.isEnabled, !hasOperation(value.route) else { return }
        authority = nil; confirmation = nil; presentation.modelControls?.confirmation = nil
        Task { await read(value.route, reviewID: id) }
    }
    func refreshSummary(_ route: ConversationID) async {
        if let review = presentation.modelControls, let current = authority,
           current.value.scope == .global, review.route.connectionID == route.connectionID {
            await read(review.route, reviewID: review.id)
        } else { await read(route, reviewID: presentation.modelControls?.route == route ? presentation.modelControls?.id : nil) }
    }
    func refreshBarrier(_ route: ConversationID) async {
        let captured = epoch, host = context()
        let value = await runtime.modelSendBarrier(sessionKey: route.sessionID)
        guard isCurrent(captured, host), route.connectionID == connectionID else { return }
        barriers[inputKey(route)] = unconfirmedInputs.contains(inputKey(route)) ? .unconfirmed : value; onChange()
    }

    func choose(_ id: UUID, choice: ModelControlChoice) {
        guard confirmation == nil, let current = actionable(id, choice) else { return }
        if case let .permissions(mode) = choice { prepare(current, mode: mode) }
        else { submit(current, choice: choice, permission: nil) }
    }
    /// Legacy catalog events still need a fresh, scoped descriptor; they never call the old wire API.
    func chooseLegacy(_ route: ConversationID, modelID: String) {
        guard ready, route == selectedRoute(), !hasOperation(route), confirmation == nil,
              legacyReads[route] == nil, legacyReads.count < 8 else { return }
        if let current = authority, current.route == route, presentation.modelControls?.id == current.reviewID {
            choose(current.reviewID, choice: .model(modelID)); return
        }
        let host = context(), captured = epoch, requestID = UUID()
        legacyReads[route] = requestID
        Task {
            defer { if legacyReads[route] == requestID { legacyReads.removeValue(forKey: route) } }
            do {
                let value = try await runtime.modelControls(sessionKey: route.sessionID)
                guard isCurrent(captured, host), legacyReads[route] == requestID,
                      context().selection == host.selection, selectedRoute() == route,
                      value.connectionID == route.connectionID, value.sessionKey == route.sessionID,
                      value.allowedActions.contains(.selectModel), value.writeState == .available else { return }
                let rows = try Self.modelRows(value)
                guard rows.contains(where: { $0.id == modelID && $0.availability.isEnabled }) else { return }
                let transient = Authority(reviewID: UUID(), route: route, host: host, epoch: captured, value: value)
                submit(transient, choice: .model(modelID), permission: nil, legacy: true)
            } catch { await refreshBarrier(route) }
        }
    }

    func confirm(_ id: UUID) {
        guard let frozen = confirmation, frozen.id == id,
              let current = actionable(frozen.authority.reviewID, .permissions(Self.mode(frozen.value.mode))),
              current.value.reference == frozen.value.reference else { return }
        confirmation = nil; presentation.modelControls?.confirmation = nil
        submit(frozen.authority, choice: .permissions(Self.mode(frozen.value.mode)), permission: frozen.value)
    }
    func dismissConfirmation(_ id: UUID) {
        guard confirmation?.id == id else { return }
        confirmation = nil; presentation.modelControls?.confirmation = nil
    }

    private func prepare(_ value: Authority, mode: ModelPermissionMode) {
        let operation = reserve(value, choice: .permissions(mode), pauseInput: false)
        Task {
            defer { finish(operation); resumeReadAfterPreparation(operation); onChange() }
            do {
                let token = try await runtime.preparePermissions(reference: value.value.reference, mode: Self.runtimeMode(mode))
                guard current(operation), presentation.modelControls?.id == value.reviewID,
                      authority?.value.reference == value.value.reference,
                      token.reference == value.value.reference, Self.mode(token.mode) == mode else { return }
                finish(operation)
                let frozen = Confirmation(id: UUID(), authority: value, value: token)
                confirmation = frozen
                presentation.modelControls?.confirmation = .init(id: frozen.id, reviewID: value.reviewID, mode: mode)
            } catch {
                guard current(operation) else { return }
                operations.removeValue(forKey: value.key)
                fail(value.reviewID, text: String(localized: "Permissions could not be prepared. Refresh settings and try again."))
            }
        }
    }

    /// Only a pure preparation reaches this path. Actual writes retain all existing read fences.
    private func resumeReadAfterPreparation(_ operation: Operation) {
        guard let review = presentation.modelControls, review.id != operation.authority.reviewID,
              review.route == operation.authority.route, review.phase == .loading, !hasOperation(review.route),
              selectedRoute() == review.route, isCurrent(operation.authority.epoch, operation.authority.host) else { return }
        let id = review.id, route = review.route, captured = epoch, host = context()
        Task {
            guard presentation.modelControls?.id == id, presentation.modelControls?.route == route,
                  presentation.modelControls?.phase == .loading, !hasOperation(route), selectedRoute() == route,
                  isCurrent(captured, host), context() == host else { return }
            await read(route, reviewID: id)
        }
    }

    private func submit(_ value: Authority, choice: ModelControlChoice, permission: RuntimeModelPermissionConfirmation?, legacy: Bool = false) {
        guard isCurrent(value.epoch, value.host), operations[value.key] == nil else { return }
        if !legacy { guard actionable(value.reviewID, choice) != nil else { return } }
        if case .model = choice, unconfirmedModels.count >= 128, !unconfirmedModels.contains(value.key) {
            fail(value.reviewID, text: String(localized: "These settings cannot be changed right now.")); return
        }
        let command: Bool
        if case .thinking = choice { command = value.value.thinking?.writePath == .command } else { command = false }
        let operation = reserve(value, choice: choice, pauseInput: value.value.usesNativeSendBarrier && !command)
        Task {
            defer { finish(operation); onChange() }
            var acknowledged = false
            do {
                guard current(operation) else { return }
                if command, case let .thinking(level) = choice {
                    let plan = try await runtime.prepareThinkingCommand(reference: value.value.reference, level: level)
                    guard current(operation), plan.connectionID == value.route.connectionID,
                          plan.sessionKey == value.route.sessionID, plan.settingsScope == value.value.scope else {
                        throw RuntimeFailure(.superseded)
                    }
                    try await queue(value.route, plan)
                    guard current(operation) else { return }
                    finish(operation)
                    if presentation.modelControls?.id == value.reviewID {
                        presentation.modelControls?.notice = String(localized: "Thinking command added to queue.")
                    }
                } else {
                    let receipt: RuntimeModelControlReceipt
                    switch choice {
                    case let .model(id):
                        guard let model = try Self.modelMap(value.value)[id] else { throw RuntimeFailure(.invalidAnswer) }
                        receipt = try await runtime.selectModel(reference: value.value.reference, modelID: model.id, provider: model.provider)
                    case let .thinking(level): receipt = try await runtime.setThinkingLevel(reference: value.value.reference, level: level)
                    case let .fastMode(enabled): receipt = try await runtime.setFastMode(reference: value.value.reference, enabled: enabled)
                    case .permissions:
                        guard let permission else { throw RuntimeFailure(.confirmationRequired) }
                        receipt = try await runtime.setPermissions(confirmation: permission)
                    }
                    guard current(operation), receipt.reference == value.value.reference,
                          receipt.connectionID == value.route.connectionID, receipt.sessionKey == value.route.sessionID,
                          receipt.scope == value.value.scope, receipt.action == Self.action(choice) else {
                        throw RuntimeFailure(.superseded, delivery: .responseReceived)
                    }
                    acknowledged = true
                    if case let .model(modelID) = choice { await recordRecent(modelID, connectionID: value.route.connectionID) }
                    guard current(operation) else { return }
                    if let state = receipt.state {
                        guard state.generation == value.value.generation, state.scope == value.value.scope,
                              state.backendKind == value.value.backendKind else {
                            throw RuntimeFailure(.invalidResponse, delivery: .responseReceived)
                        }
                        try accept(state, route: value.route, reviewID: presentation.modelControls?.id == value.reviewID ? value.reviewID : nil,
                                   captured: value.epoch, host: value.host, confirmedAfterWrite: true)
                    }
                    if receipt.refreshRequired {
                        await read(value.route, reviewID: presentation.modelControls?.id == value.reviewID ? value.reviewID : nil,
                                   acknowledged: true)
                    }
                    finish(operation)
                    if let review = presentation.modelControls, review.id != value.reviewID,
                       review.route.connectionID == value.route.connectionID,
                       value.value.scope == .global || review.route == value.route {
                        await read(review.route, reviewID: review.id)
                    }
                }
            } catch {
                guard current(operation) else { return }
                finish(operation)
                await refreshBarrier(value.route)
                guard isCurrent(value.epoch, value.host) else { return }
                let failure = error as? RuntimeFailure
                let uncertain = !acknowledged && (failure?.delivery == .uncertain || failure?.delivery == .responseReceived)
                if value.value.usesNativeSendBarrier && (uncertain || acknowledged) {
                    unconfirmedInputs.insert(inputKey(value.route)); barriers[inputKey(value.route)] = .unconfirmed
                }
                let message: String
                if acknowledged { message = String(localized: "Setting confirmed. Refresh to see the latest state.") }
                else if failure?.code == .requestExpired || failure?.code == .confirmationRequired {
                    message = String(localized: "The confirmation expired. Review this request again.")
                } else if uncertain { message = String(localized: "The setting could not be confirmed. Refresh before trying again.") }
                else { message = String(localized: "The setting could not be changed. Refresh and try again.") }
                fail(value.reviewID, text: message, uncertain: uncertain)
            }
            onChange()
        }
    }

    private func reserve(_ value: Authority, choice: ModelControlChoice, pauseInput: Bool) -> Operation {
        let operation = Operation(id: UUID(), authority: value, choice: choice, pausesInput: pauseInput)
        operations[value.key] = operation
        if case .model = choice { unconfirmedModels.insert(value.key) }
        for route in Array(reads.keys) where route.connectionID == value.route.connectionID &&
            (value.value.scope == .global || route.sessionID == value.route.sessionID) { reads.removeValue(forKey: route) }
        confirmation = nil
        if presentation.modelControls?.id == value.reviewID {
            presentation.modelControls?.confirmation = nil
            presentation.modelControls?.submitting = choice; presentation.modelControls?.error = nil
            presentation.modelControls?.notice = nil; presentation.modelControls?.refresh = .unsupported
        }
        if pauseInput { barriers[inputKey(value.route)] = .pending }
        onChange(); return operation
    }
    private func finish(_ operation: Operation) {
        guard operations[operation.authority.key]?.id == operation.id else { return }
        operations.removeValue(forKey: operation.authority.key)
        if let review = presentation.modelControls,
           review.route.connectionID == operation.authority.route.connectionID,
           operation.authority.value.scope == .global || review.route == operation.authority.route,
           review.submitting == operation.choice {
            presentation.modelControls?.submitting = nil; presentation.modelControls?.refresh = .available
        }
    }
    private func read(_ route: ConversationID, reviewID: UUID?, acknowledged: Bool = false) async {
        guard ready, route.connectionID == connectionID, route.isConcrete else { return }
        guard reads.count < 32 else {
            fail(reviewID, text: String(localized: "Model settings could not be loaded. Try again.")); return
        }
        let id = UUID(), captured = epoch, host = context(), operationID = operationFor(route)?.id
        reads[route] = id
        defer { if reads[route] == id { reads.removeValue(forKey: route) } }
        if presentation.modelControls?.id == reviewID, reviewID != nil {
            presentation.modelControls?.phase = .loading; presentation.modelControls?.refresh = .unsupported
            presentation.modelControls?.confirmation = nil; confirmation = nil; authority = nil
        }
        do {
            let value = try await runtime.modelControls(sessionKey: route.sessionID)
            guard isCurrent(captured, host), reads[route] == id, operationFor(route)?.id == operationID else { return }
            if recent[route.connectionID] == nil {
                cacheRecent((try? await preferences?.read(connectionID: route.connectionID)) ?? [], connectionID: route.connectionID)
            }
            guard isCurrent(captured, host), reads[route] == id, operationFor(route)?.id == operationID else { return }
            try accept(value, route: route, reviewID: reviewID, captured: captured, host: host, confirmedAfterWrite: acknowledged)
            if value.backendKind == .openclaw, case .session = value.scope {
                loadConfiguredDefault(value, route: route, captured: captured, host: host)
            }
        } catch {
            guard isCurrent(captured, host), reads[route] == id, operationFor(route)?.id == operationID else { return }
            await refreshBarrier(route)
            guard isCurrent(captured, host), reads[route] == id, operationFor(route)?.id == operationID else { return }
            fail(reviewID, text: acknowledged ? String(localized: "Setting confirmed. Refresh to see the latest state.")
                 : String(localized: "Model settings could not be loaded. Try again."))
        }
        onChange()
    }
    private func accept(_ value: RuntimeModelControls, route: ConversationID, reviewID: UUID?, captured: UUID,
                        host: NativeSessionHostContext, confirmedAfterWrite: Bool = false) throws {
        guard isCurrent(captured, host), value.connectionID == route.connectionID, value.sessionKey == route.sessionID else {
            throw RuntimeFailure(.superseded)
        }
        let rows = try Self.modelRows(value, configuredDefault: configuredDefaults[route.connectionID])
        let key = Key(connectionID: value.connectionID, scope: value.scope)
        if value.currentModel != nil, operations[key] == nil || confirmedAfterWrite { unconfirmedModels.remove(key) }
        observeBarrier(value, route: route)
        onSnapshot(route, value, rows)
        guard let reviewID, presentation.modelControls?.id == reviewID, presentation.modelControls?.route == route else { return }
        let next = Authority(reviewID: reviewID, route: route, host: host, epoch: captured, value: value)
        authority = next
        let priorIDs = presentation.modelControls?.featuredIDs ?? []
        let knownIDs = Set(rows.map(\.id))
        let featured: [String]
        if !priorIDs.isEmpty, priorIDs.allSatisfy(knownIDs.contains), rows.filter(\.isSelected).allSatisfy({ priorIDs.contains($0.id) }) { featured = priorIDs }
        else { featured = ModelCatalogPresentation.featured(models: rows, recentIDs: recent[route.connectionID] ?? []).map(\.id) }
        let choices = value.allowedActions
        let writableThinking = choices.contains(.setThinkingLevel) || choices.contains(.prepareThinkingCommand)
        let thinking = value.thinking.map { raw in ThinkingControlPresentation(current: raw.current,
            levels: raw.levels.map { .init(id: $0, title: Self.thinkingTitle($0)) },
            availability: writableThinking ? .available : .temporarilyUnavailable(String(localized: "These settings cannot be changed right now.")),
            currentTitle: raw.current.map(Self.thinkingTitle)) }
        let fast = value.fastMode.map { raw in FastModeControlPresentation(enabled: raw.enabled,
            availability: choices.contains(.setFastMode) ? .available : raw.available
                ? .temporarilyUnavailable(String(localized: "These settings cannot be changed right now.")) : .unsupported) }
        let permissions = value.permissions.map { raw in PermissionControlPresentation(current: raw.mode.map {
            switch $0 { case let .known(mode): .mode(Self.mode(mode)); case .custom: .computerSettings }
        }, modes: raw.availableModes.map(Self.mode), availability: choices.contains(.setPermissions) ? .available : raw.available
            ? .temporarilyUnavailable(String(localized: "These settings cannot be changed right now.")) : .unsupported,
            requiresConfirmation: raw.requiresConfirmation, unencryptedTransport: raw.unencryptedTransport) }
        presentation.modelControls = .init(id: reviewID, route: route,
            scope: value.scope == .global ? .global : value.scope == .catalog ? .catalog : .conversation,
            phase: .ready, models: rows, featuredIDs: featured,
            modelSelection: choices.contains(.selectModel) && (unconfirmedModels.count < 128 || unconfirmedModels.contains(next.key))
                ? .available : operations[next.key] != nil || unconfirmedModels.count >= 128
                ? .temporarilyUnavailable(String(localized: "These settings cannot be changed right now.")) : .unsupported,
            thinking: thinking, fastMode: fast, permissions: permissions,
            submitting: operations[next.key]?.choice,
            isUncertain: value.writeState == .uncertain && value.permissions?.requiresConfirmation != true,
            refresh: operations[next.key] == nil ? .available : .unsupported)
    }
    private func observeBarrier(_ value: RuntimeModelControls, route: ConversationID) {
        if value.canSend { barriers.removeValue(forKey: inputKey(route)); unconfirmedInputs.remove(inputKey(route)) }
        else { barriers[inputKey(route)] = value.permissions?.requiresConfirmation == true ? .permissionsRequired
            : value.writeState == .pending ? .pending : .unconfirmed }
    }
    /// A default badge is an independent display-only read. Failure cannot retire
    /// the concrete session reference or prevent a model selection.
    private func loadConfiguredDefault(_ value: RuntimeModelControls, route: ConversationID, captured: UUID,
                                       host: NativeSessionHostContext) {
        guard defaultReads[route.connectionID] == nil else { return }
        let id = UUID(); defaultReads[route.connectionID] = id
        Task {
            defer { if defaultReads[route.connectionID] == id { defaultReads.removeValue(forKey: route.connectionID) } }
            guard let defaults = try? await runtime.modelControls(sessionKey: nil), isCurrent(captured, host),
                  defaultReads[route.connectionID] == id, defaults.connectionID == route.connectionID,
                  defaults.generation == value.generation, defaults.scope == .global, defaults.sessionKey == nil,
                  defaults.backendKind == .openclaw, let model = defaults.configuredDefaultModel else { return }
            configuredDefaults[route.connectionID] = model
            guard let current = authority, current.route == route, current.value.reference == value.reference,
                  operations[current.key] == nil, presentation.modelControls?.id == current.reviewID,
                  let rows = try? Self.modelRows(value, configuredDefault: model) else { return }
            presentation.modelControls?.models = rows
        }
    }
    private func actionable(_ id: UUID, _ choice: ModelControlChoice) -> Authority? {
        guard let value = authority, value.reviewID == id, isCurrent(value.epoch, value.host),
              presentation.modelControls?.id == id, presentation.modelControls?.permits(choice) == true,
              operations[value.key] == nil else { return nil }
        return value
    }
    private func fail(_ id: UUID?, text: String, uncertain: Bool = false) {
        guard let id, presentation.modelControls?.id == id else { return }
        authority = nil; confirmation = nil
        presentation.modelControls?.phase = .unavailable; presentation.modelControls?.submitting = nil
        presentation.modelControls?.confirmation = nil; presentation.modelControls?.isUncertain = uncertain
        presentation.modelControls?.error = text; presentation.modelControls?.refresh = .available
    }
    private func operationFor(_ route: ConversationID) -> Operation? {
        operations.values.first { $0.authority.route.connectionID == route.connectionID &&
            ($0.authority.value.scope == .global || $0.authority.route.sessionID == route.sessionID) }
    }
    private func hasOperation(_ route: ConversationID) -> Bool { operationFor(route) != nil }
    private func current(_ operation: Operation) -> Bool {
        isCurrent(operation.authority.epoch, operation.authority.host) && operations[operation.authority.key]?.id == operation.id
    }
    private func isCurrent(_ captured: UUID, _ host: NativeSessionHostContext) -> Bool {
        ready && captured == epoch && context().sameConnection(as: host)
    }
    private func inputKey(_ route: ConversationID) -> InputKey { .init(connectionID: route.connectionID, sessionKey: route.sessionID) }
    private func recordRecent(_ modelID: String, connectionID: String) async {
        if let stored = try? await preferences?.record(modelID, connectionID: connectionID) { cacheRecent(stored, connectionID: connectionID) }
        else { cacheRecent([modelID] + (recent[connectionID] ?? []).filter { $0 != modelID }, connectionID: connectionID) }
    }
    private func cacheRecent(_ models: [String], connectionID: String) {
        if recent[connectionID] == nil, recent.count >= 128, let old = recent.keys.first(where: { $0 != connectionID }) {
            recent.removeValue(forKey: old)
        }
        recent[connectionID] = Array(models.prefix(6))
    }

    nonisolated static func modelKey(_ value: RuntimeModel) throws -> String {
        try DocumentStore.scopedKey(namespace: "model", parts: [value.provider ?? "", value.id])
    }
    nonisolated private static func modelMap(_ value: RuntimeModelControls) throws -> [String: RuntimeModel] {
        var result: [String: RuntimeModel] = [:]
        for model in value.models {
            let id = try modelKey(model)
            guard result[id] == nil else { throw RuntimeFailure(.invalidResponse) }; result[id] = model
        }
        return result
    }
    nonisolated static func modelRows(_ value: RuntimeModelControls, configuredDefault: String? = nil) throws -> [ModelPresentation] {
        _ = try modelMap(value)
        let selected = value.models.first(where: \.selected)
        return try value.models.map { model in
            let full = model.id.contains("/") ? model.id : model.provider.map { "\($0)/\(model.id)" } ?? model.id
            return .init(id: try modelKey(model), title: model.name, subtitle: model.provider, group: model.provider,
                isSelected: selected?.id == model.id && selected?.provider == model.provider,
                catalogOrder: model.sortOrder, searchTerms: [model.id, model.resolvedModel].compactMap { $0 },
                isConfiguredDefault: (configuredDefault ?? value.configuredDefaultModel) == full)
        }
    }
    nonisolated private static func action(_ choice: ModelControlChoice) -> RuntimeModelControlAction {
        switch choice { case .model: .selectModel; case .thinking: .setThinkingLevel; case .fastMode: .setFastMode; case .permissions: .setPermissions }
    }
    nonisolated private static func mode(_ mode: RuntimeSessionPermissionMode) -> ModelPermissionMode {
        switch mode { case .readOnly: .readOnly; case .workspace: .workspace; case .fullAccess: .fullAccess }
    }
    nonisolated private static func runtimeMode(_ mode: ModelPermissionMode) -> RuntimeSessionPermissionMode {
        switch mode { case .readOnly: .readOnly; case .workspace: .workspace; case .fullAccess: .fullAccess }
    }
    nonisolated private static func thinkingTitle(_ level: String) -> String {
        switch level {
        case "off", "none": String(localized: "Off")
        case "minimal": String(localized: "Minimal")
        case "low": String(localized: "Low")
        case "medium": String(localized: "Medium")
        case "high": String(localized: "High")
        case "xhigh": String(localized: "Extra High")
        case "max": String(localized: "Max")
        case "ultra": String(localized: "Ultra")
        case "adaptive": String(localized: "Adaptive")
        default: level
        }
    }
}

extension NativeConversation {
    /// Ordinary durable outbox ownership. The composer and attachment draft remain separate.
    mutating func enqueueSettingCommand(_ text: String, id: String, timestampMs: Int64) throws {
        guard !text.isEmpty, text.utf8.count <= 64_000, !id.isEmpty, id.utf8.count <= 128,
              revision >= 0, revision < 9_007_199_254_740_991,
              !messages.contains(where: { $0.id == id || $0.idempotencyKey == id }),
              messages.filter({ [.queued, .held, .sending].contains($0.delivery) }).count < 32 else {
            throw StoreFailure.invalidDocument
        }
        messages.append(.init(id: id, role: .user, local: true, text: text, idempotencyKey: id,
                              timestampMs: timestampMs, delivery: .queued))
        revision += 1
    }
}
