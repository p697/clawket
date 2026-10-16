import ClawketMedia
import ClawketPersistence
import ClawketRuntime
import ClawketUI
import Foundation
import UIKit

@MainActor
extension NativeAppModel {
    func mediaScope(_ route: ConversationID) -> NativeMediaScope {
        if mediaDraftRevisions[route] == nil { mediaDraftRevisions[route] = UUID() }
        return .init(route: route, activation: activationRevision, selection: selectionRevision, draft: mediaDraftRevisions[route]!)
    }

    func ownsMedia(_ scope: NativeMediaScope) -> Bool {
        physicalPermitsLocalChanges(scope.route) && scope.route == presentation.selectedConversation && scope.route.connectionID == activeConnectionID &&
            scope == mediaScope(scope.route) && documents[scope.route] != nil
    }

    func validateMediaModel(_ route: ConversationID, hasImages: Bool) throws {
        guard hasImages else { return }
        guard modelControls?.isImageModelUnconfirmed(route) != true, modelControls?.isChangingModel(route) != true, !mediaChangingModels.contains(route),
              state.capabilities.modelPerSession || mediaChangingModels.isEmpty else { throw NativeMediaIssue.modelChanging }
        let supportsImages: Bool?
        if state.capabilities.modelPerSession {
            supportsImages = mediaModelRevisions[route] == wireRevision ? modelChoices[route]?.values.first(where: \.selected)?.supportsImages : nil
        } else { supportsImages = mediaGlobalModel?.wire == wireRevision ? mediaGlobalModel?.supportsImages : nil }
        guard supportsImages != false else { throw NativeMediaIssue.textOnly }
    }

    func addMediaFeatures(_ route: ConversationID, features: inout [ClientFeature: ActionAvailability]) {
        guard media != nil, route.connectionID == activeConnectionID else { return }
        let connected = state.phase == .ready
        let available: ActionAvailability = connected ? .available : .temporarilyUnavailable(String(localized: "Reconnect to use attachments."))
        if state.capabilities.attachments {
            var imageAccess: ActionAvailability = (try? validateMediaModel(route, hasImages: true)) != nil
                ? available : .temporarilyUnavailable(String(localized: "This model accepts text only."))
            if modelControls?.isImageModelUnconfirmed(route) == true || modelControls?.isChangingModel(route) == true || mediaChangingModels.contains(route) || !state.capabilities.modelPerSession && !mediaChangingModels.isEmpty {
                imageAccess = .temporarilyUnavailable(modelControls?.isImageModelUnconfirmed(route) == true
                    ? String(localized: "Review model settings before adding images.") : String(localized: "Preparing attachments…"))
            }
            features[.photos] = imageAccess
            features[.camera] = UIImagePickerController.isSourceTypeAvailable(.camera) ? imageAccess : .unsupported
        }
        if state.capabilities.attachments || state.capabilities.fileAttachments || state.capabilities.documentAttachments {
            features[.files] = state.capabilities.fileAttachments || state.capabilities.documentAttachments ? available : features[.photos]
        }
        if state.capabilities.chat { features[.paste] = available }
        if mediaSendPreparations.contains(route) || mediaImports.values.contains(where: { $0.scope.route == route }) {
            let failed = mediaImports.values.contains { request in
                guard request.scope.route == route else { return false }
                if case .failed? = mediaDisplays[request.id.uuidString]?.phase { return true }
                return false
            }
            features[.send] = .temporarilyUnavailable(failed ? String(localized: "Attachment failed") : String(localized: "Preparing attachments…"))
        }
    }

    func mediaPrompt(_ route: ConversationID, text: String, ids: [UUID], idempotencyKey: String) async throws -> RuntimePrompt {
        guard physicalPermitsInput(route), let runtime else { throw StoreFailure.unavailable }
        let activation = activationRevision, wire = wireRevision, epoch = documents[route]?.historyEpoch
        try await modelControls?.verifyInput(route)
        let prepared = try await media?.prepare(ids) ?? []
        try await modelControls?.verifyInput(route)
        guard physicalPermitsInput(route), documents[route]?.historyEpoch == epoch, activation == activationRevision, wire == wireRevision else { throw RuntimeFailure(.superseded) }
        guard prepared.count == ids.count else { throw MediaFailure.missing }
        try validateMediaModel(route, hasImages: prepared.contains(where: \.isImage))
        let input = RuntimePrompt(text: text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !prepared.isEmpty
            ? String(localized: "Review these attachments.") : text, idempotencyKey: idempotencyKey,
            attachments: prepared.map { .init(type: $0.isImage ? .image : .file, mimeType: $0.mimeType, content: $0.data, name: $0.resource.name) })
        try await runtime.validatePrompt(sessionKey: route.sessionID, input: input)
        try await modelControls?.verifyInput(route)
        guard physicalPermitsInput(route), documents[route]?.historyEpoch == epoch, activation == activationRevision, wire == wireRevision else { throw RuntimeFailure(.superseded) }
        return input
    }

    func mediaReferences(_ ids: [UUID]) async throws -> [NativeMediaReference] {
        guard let media else { guard ids.isEmpty else { throw MediaFailure.missing }; return [] }
        var result: [NativeMediaReference] = []
        for id in ids {
            let resource = try await media.library.resource(id)
            result.append(.init(resource: resource, isImage: resource.mimeType.hasPrefix("image/") && resource.mimeType != "image/svg+xml"))
        }
        return result
    }

    func pickMedia(_ route: ConversationID, source: AttachmentSource) {
        guard destination == nil, mediaPreview == nil, let conversation = presentation.conversations[route], documents[route] != nil, media != nil else { return }
        let feature: ClientFeature = switch source { case .photos: .photos; case .camera: .camera; case .files: .files; case .paste: .paste }
        guard conversation.availability(feature).isEnabled else { return }
        let scope = mediaScope(route)
        guard ownsMedia(scope) else { return }
        let remaining = 6 - (documents[route]?.draftResourceIDs.count ?? 0) - mediaImports.values.filter { $0.scope.route == route }.count
        if source == .paste { NativeMediaPickerAdapter.paste(client: self, scope: scope); return }
        guard remaining > 0 else { presentation.draft(for: route).hint = String(localized: "Add up to six attachments."); return }
        mediaPicker = .init(scope: scope, source: source, remaining: remaining,
                            allowsFiles: state.capabilities.fileAttachments || state.capabilities.documentAttachments)
    }

    func consumeMediaPicker(_ request: NativeMediaPickerRequest) -> Bool {
        guard ownsMedia(request.scope), mediaPickerLifetime.consume(request) else { return false }
        if mediaPicker?.id == request.id { mediaPicker = nil }
        return true
    }

    func cancelMediaPicker(_ request: NativeMediaPickerRequest) {
        guard mediaPickerLifetime.consume(request) else { return }
        if mediaPicker?.id == request.id { mediaPicker = nil }
    }

    func reserveMediaImport(_ scope: NativeMediaScope, name: String) -> NativeMediaImport? {
        guard ownsMedia(scope), (documents[scope.route]?.draftResourceIDs.count ?? 0) + mediaImports.values.filter({ $0.scope.route == scope.route }).count < 6 else {
            if ownsMedia(scope) { presentation.draft(for: scope.route).hint = String(localized: "Add up to six attachments.") }
            return nil
        }
        let request = NativeMediaImport(id: UUID(), scope: scope, name: name)
        mediaImports[request.id] = request
        refreshDraftMedia(scope.route); updatePresentation(scope.route)
        return request
    }

    func acceptMedia(_ staged: StagedMediaFile, request: NativeMediaImport) {
        guard let media else { return }
        guard ownsMedia(request.scope), mediaImports[request.id] != nil, mediaImportTasks[request.id] == nil else { try? media.stager.discard(staged); return }
        mediaImportResources[request.id] = staged.id; mediaImportReceipts[request.id] = staged
        mediaImportTasks[request.id] = Task {
            var adoptedID: UUID?
            var published = false
            defer {
                mediaImportTasks.removeValue(forKey: request.id)
                if mediaImports[request.id] == nil { mediaImportResources.removeValue(forKey: request.id); mediaImportReceipts.removeValue(forKey: request.id) }
            }
            do {
                let resource = try await media.adopt(staged, route: request.scope.route)
                adoptedID = resource.id
                let prepared = try await media.prepare([resource.id])
                guard ownsMedia(request.scope), mediaImports[request.id] != nil else {
                    try await media.releaseWhenUnreferenced([resource.id]); if let cache { try await media.reclaim(cache: cache) }; return
                }
                try validateMediaModel(request.scope.route, hasImages: prepared.contains(where: \.isImage))
                guard let runtime, let value = prepared.first else { throw MediaFailure.missing }
                try await runtime.validatePrompt(sessionKey: request.scope.route.sessionID, input: .init(text: String(localized: "Review these attachments."),
                    idempotencyKey: request.id.uuidString, attachments: [.init(type: value.isImage ? .image : .file,
                        mimeType: value.mimeType, content: value.data, name: value.resource.name)]))
                guard ownsMedia(request.scope), mediaImports[request.id] != nil else {
                    try await media.releaseWhenUnreferenced([resource.id]); if let cache { try await media.reclaim(cache: cache) }; return
                }
                mediaDraftOrder[request.scope.route, default: .init()].complete(importID: request.id, resourceID: resource.id)
                documents[request.scope.route]?.draftResourceIDs.append(resource.id)
                if let ids = documents[request.scope.route]?.draftResourceIDs {
                    documents[request.scope.route]?.draftResourceIDs = mediaDraftOrder[request.scope.route]?.orderedResources(ids) ?? ids
                }
                changed(request.scope.route)
                published = true
                mediaImports.removeValue(forKey: request.id)
                refreshDraftMedia(request.scope.route); updatePresentation(request.scope.route)
                try await persist(request.scope.route)
                try await media.confirm(resource.id)
                mediaImports.removeValue(forKey: request.id)
                refreshDraftMedia(request.scope.route); updatePresentation(request.scope.route)
            } catch {
                if let adoptedID, !published {
                    try? await media.releaseWhenUnreferenced([adoptedID])
                    if let cache { try? await media.reclaim(cache: cache) }
                }
                if ownsMedia(request.scope) {
                    if published { showMediaFailure(error, route: request.scope.route) }
                    else if mediaImports[request.id] != nil { failMediaImport(request, error: error) }
                }
            }
        }
    }

    func failMediaImport(_ request: NativeMediaImport, error: any Error) {
        guard ownsMedia(request.scope), mediaImports[request.id] != nil else { return }
        mediaDisplays[request.id.uuidString] = .init(id: request.id.uuidString, name: request.name, kind: .file,
            phase: .failed(nativeMediaFailureLabel(error) ?? String(localized: "Attachment could not be added. Try again.")), canRemove: true)
        refreshDraftMedia(request.scope.route); updatePresentation(request.scope.route)
    }

    func cancelMediaImports() {
        let pending = Array(mediaImports.values)
        mediaImports.removeAll(); mediaPickerLifetime.retire(); mediaPicker = nil
        for request in pending {
            retireMediaImport(request.id)
            mediaDisplays.removeValue(forKey: request.id.uuidString)
        }
        for route in Set(pending.map { $0.scope.route }) { refreshDraftMedia(route); updatePresentation(route) }
    }

    private func retireMediaImport(_ id: UUID) {
        let task = mediaImportTasks[id], resource = mediaImportResources[id], receipt = mediaImportReceipts[id], controller = media, cache = cache
        task?.cancel(); mediaProviderProgress.removeValue(forKey: id)?.cancel()
        guard let resource, let controller else { return }
        Task {
            // Native copying/index replacement must finish before releasing the
            // receipt; otherwise a late adoption could recreate an unowned file.
            await task?.value
            if let receipt { try? controller.stager.discard(receipt) }
            try? await controller.releaseWhenUnreferenced([resource])
            if let cache { try? await controller.reclaim(cache: cache) }
            mediaImportResources.removeValue(forKey: id); mediaImportReceipts.removeValue(forKey: id)
        }
    }

    func retireMediaSelection() {
        retireVoice()
        cancelMediaImports()
        for task in mediaLoads.values { task.cancel() }
        mediaLoads.removeAll(); mediaLoadRevisions.removeAll(); mediaPreviewRequest = nil; mediaPreview = nil
        if let route = mediaVisibleRoute { invalidateMedia(connectionID: route.connectionID, sessionKey: route.sessionID) }
        mediaVisibleRoute = nil
        mediaDisplays.removeAll(); mediaDraftOrder.removeAll()
        for route in presentation.conversations.keys { updatePresentation(route) }
    }

    func retireMedia() {
        retireMediaSelection(); mediaChangingModelTokens.removeAll()
        if let connection = activeConnectionID { invalidateMedia(connectionID: connection) }
    }

    private func invalidateMedia(connectionID: String, sessionKey: String? = nil) {
        guard let media else { return }
        let previous = mediaInvalidationTask
        // A new A operation awaits every earlier A→B retirement. A delayed
        // invalidation can never cancel the replacement after a return to A.
        mediaInvalidationTask = Task {
            await previous?.value
            await media.invalidate(connectionID: connectionID, sessionKey: sessionKey)
        }
    }

    func refreshDraftMedia(_ route: ConversationID) {
        guard let document = documents[route] else { return }
        let scope = mediaScope(route)
        let owned = document.draftResourceIDs.map { id -> AttachmentPresentation in
            let key = id.uuidString.lowercased()
            if media == nil {
                return .init(id: key, name: String(localized: "Attachment"), kind: .file,
                    phase: .failed(String(localized: "Some attachments could not be recovered. Your files have been kept.")))
            }
            if var existing = mediaDisplays[key] { existing.canRemove = true; return existing }
            loadMediaDisplay(id, referenceID: key, route: route, input: true, scope: scope)
            return .init(id: key, name: String(localized: "Attachment"), kind: .image, phase: .preparing, canRemove: true)
        }
        let pending = mediaImports.values.filter { $0.scope.route == route }.sorted { $0.id.uuidString < $1.id.uuidString }.map { request in
            mediaDisplays[request.id.uuidString] ?? .init(id: request.id.uuidString, name: request.name, kind: .file, phase: .preparing, canRemove: true)
        }
        let values = owned + pending
        if values.isEmpty {
            mediaDraftOrder.removeValue(forKey: route)
            presentation.draft(for: route).attachments = []
        } else {
            presentation.draft(for: route).attachments = mediaDraftOrder[route, default: .init()].project(values)
        }
    }

    func removeMedia(_ route: ConversationID, id: String) {
        guard media != nil else { return }
        guard let uuid = UUID(uuidString: id) else { return }
        if let pending = mediaImports[uuid], pending.scope.route == route {
            mediaImports.removeValue(forKey: uuid); retireMediaImport(uuid)
            mediaDisplays.removeValue(forKey: id); refreshDraftMedia(route); updatePresentation(route); return
        }
        guard documents[route]?.draftResourceIDs.contains(uuid) == true else { return }
        documents[route]?.draftResourceIDs.removeAll { $0 == uuid }; changed(route)
        refreshDraftMedia(route); releaseMediaAfterCommit(route, ids: [uuid]); updatePresentation(route)
    }

    func releaseMediaAfterCommit(_ route: ConversationID, ids: Set<UUID>) {
        cancelScheduledSave(route)
        Task {
            do {
                try await media?.releaseWhenUnreferenced(ids)
                try await persist(route)
                if let media, let cache { try await media.reclaim(cache: cache) }
            } catch { presentation.draft(for: route).hint = String(localized: "Your data could not be saved safely. Keep Clawket open and try again.") }
        }
    }

    func loadMediaDisplay(_ id: UUID, referenceID: String, route: ConversationID, input: Bool, scope: NativeMediaScope? = nil) {
        guard mediaLoads[referenceID] == nil, let media else { return }
        let activation = activationRevision
        let token = UUID(); mediaLoadRevisions[referenceID] = token
        mediaLoads[referenceID] = Task {
            defer { finishMediaLoad(referenceID, token: token) }
            do {
                let value = try await media.display(id, input: input, pixels: 320)
                guard !Task.isCancelled, activation == activationRevision, scope.map(ownsMedia) ?? true else { return }
                mediaDisplays[referenceID] = .init(id: referenceID, name: value.resource.name,
                    kind: value.image == nil ? .file : .image, detail: ByteCountFormatter.string(fromByteCount: Int64(value.resource.byteCount), countStyle: .file),
                    thumbnailData: value.image, aspectRatio: value.aspectRatio, canOpen: true)
                refreshDraftMedia(route); updatePresentation(route)
            } catch {
                guard !Task.isCancelled, activation == activationRevision else { return }
                mediaDisplays[referenceID] = .init(id: referenceID, name: String(localized: "Attachment"), kind: .file,
                    phase: .failed(String(localized: "Attachment could not be loaded. Try again.")), canOpen: true, canRemove: input)
                refreshDraftMedia(route); updatePresentation(route)
            }
        }
    }

    func finishMediaLoad(_ id: String, token: UUID) {
        guard mediaLoadRevisions[id] == token else { return }
        mediaLoads.removeValue(forKey: id); mediaLoadRevisions.removeValue(forKey: id)
    }

    func mediaPresentation(_ reference: NativeMediaReference) -> AttachmentPresentation {
        let kind: AttachmentPresentation.Kind = reference.kind == .image && reference.mimeType != "image/svg+xml" ? .image : .file
        guard media != nil else {
            return .init(id: reference.id, name: reference.name, kind: kind,
                phase: .failed(String(localized: "Some attachments could not be recovered. Your files have been kept.")))
        }
        if var ready = mediaDisplays[reference.id] {
            ready.kind = kind; ready.name = reference.name; ready.canRemove = false
            return ready
        }
        return .init(id: reference.id, name: reference.name, kind: kind,
                     detail: reference.artifactID == nil ? nil : String(localized: "Download"), canOpen: reference.resourceID != nil || reference.artifactID != nil)
    }

    func prepareMessageMedia(_ route: ConversationID) {
        let protected = Set((documents[route]?.draftResourceIDs ?? []).map { $0.uuidString.lowercased() })
            .union((documents[route]?.messages ?? []).flatMap { $0.media.map(\.id) }.suffix(6))
        var bytes: Int = mediaDisplays.values.reduce(0) { $0 + ($1.thumbnailData?.count ?? 0) }
        for key in mediaDisplays.keys.sorted() where !protected.contains(key) {
            guard mediaDisplays.count > 32 || bytes > 8 * 1_024 * 1_024 else { break }
            bytes -= mediaDisplays[key]?.thumbnailData?.count ?? 0
            mediaDisplays.removeValue(forKey: key)
        }

        guard physicalPermitsLocalChanges(route), route == mediaVisibleRoute, route == presentation.selectedConversation, route.connectionID == activeConnectionID,
              let media else { return }
        let recent = Array((documents[route]?.messages ?? []).flatMap { message in
            message.media.map { (reference: $0, input: message.isOwnedUser, epoch: message.historyEpoch) }
        }.suffix(6))
        for item in recent where mediaDisplays[item.reference.id] == nil && mediaLoads[item.reference.id] == nil {
            guard mediaLoads.count < 2 else { return }
            let reference = item.reference
            if reference.artifactID == nil, let id = reference.resourceID {
                loadMediaDisplay(id, referenceID: reference.id, route: route, input: item.input)
            } else if reference.kind == .image, ["image/png", "image/jpeg", "image/gif", "image/webp"].contains(reference.mimeType), reference.artifactID != nil {
                let activation = activationRevision, wire = wireRevision, selection = selectionRevision, token = UUID()
                mediaLoadRevisions[reference.id] = token
                mediaDisplays[reference.id] = .init(id: reference.id, name: reference.name, kind: .image, phase: .preparing)
                let runtime = physicalPermitsInput(route) && state.phase == .ready && state.capabilities.artifacts ? runtime : nil
                mediaLoads[reference.id] = Task {
                    defer { finishMediaLoad(reference.id, token: token) }
                    do {
                        let barrier = mediaInvalidationTask; await barrier?.value
                        guard !Task.isCancelled, activation == activationRevision, wire == wireRevision, selection == selectionRevision else { return }
                        let resource = try await media.resolve(reference, route: route, runtime: runtime, historyEpoch: item.epoch)
                        let display = try await media.display(resource.id, pixels: 320)
                        guard !Task.isCancelled, activation == activationRevision, wire == wireRevision, selection == selectionRevision else { return }
                        mediaDisplays[reference.id] = .init(id: reference.id, name: resource.name, kind: display.image == nil ? .file : .image,
                            thumbnailData: display.image, aspectRatio: display.aspectRatio, canOpen: true)
                    } catch {
                        guard !Task.isCancelled, activation == activationRevision, wire == wireRevision, selection == selectionRevision else { return }
                        mediaDisplays[reference.id] = runtime == nil
                            ? .init(id: reference.id, name: reference.name, kind: .image, detail: String(localized: "Download"), canOpen: true)
                            : .init(id: reference.id, name: reference.name, kind: .image,
                                phase: .failed(String(localized: "Attachment could not be loaded. Try again.")), canOpen: true)
                    }
                    updatePresentation(route)
                }
            }
        }
    }

    func openMedia(id: String) {
        guard destination == nil, mediaPreview == nil, let route = presentation.selectedConversation, route.connectionID == activeConnectionID,
              let media, mediaLoads[id] == nil else { return }
        let reference: NativeMediaReference?
        let referenceEpoch: UUID?
        let localInput: Bool
        if let uuid = UUID(uuidString: id), documents[route]?.draftResourceIDs.contains(uuid) == true {
            reference = nil; referenceEpoch = nil; localInput = true
        } else {
            let message = documents[route]?.messages.first { $0.media.contains(where: { $0.id == id }) }
            reference = message?.media.first { $0.id == id }; referenceEpoch = message?.historyEpoch; localInput = message?.isOwnedUser == true
            guard reference != nil else { return }
        }
        if let previous = mediaPreviewRequest {
            mediaLoads[previous.id]?.cancel()
            if var display = mediaDisplays[previous.id] { display.phase = .ready; display.canOpen = true; mediaDisplays[previous.id] = display }
        }
        let previewRequest = UUID(); mediaPreviewRequest = (id, previewRequest)
        let activation = activationRevision, selection = selectionRevision, wire = wireRevision
        mediaDisplays[id] = .init(id: id, name: reference?.name ?? String(localized: "Attachment"), kind: .file, phase: .preparing)
        updatePresentation(route)
        let token = UUID(); mediaLoadRevisions[id] = token
        mediaLoads[id] = Task {
            defer {
                finishMediaLoad(id, token: token)
                if mediaPreviewRequest?.token == previewRequest { mediaPreviewRequest = nil }
            }
            do {
                let barrier = mediaInvalidationTask; await barrier?.value
                guard !Task.isCancelled, mediaPreviewRequest?.token == previewRequest, activation == activationRevision,
                      selection == selectionRevision else { return }
                let resource: MediaResource
                if let reference { resource = try await media.resolve(reference, route: route, runtime: physicalPermitsInput(route) && state.phase == .ready ? runtime : nil, historyEpoch: referenceEpoch) }
                else if let uuid = UUID(uuidString: id) { resource = try await media.library.resource(uuid) }
                else { throw MediaFailure.missing }
                let display = try await media.display(resource.id, input: localInput)
                guard !Task.isCancelled, mediaPreviewRequest?.token == previewRequest, activation == activationRevision, selection == selectionRevision,
                      route == presentation.selectedConversation, reference?.artifactID == nil || wire == wireRevision else { return }
                let preview = try await NativeMediaPreview.create(display: display, library: media.library)
                guard !Task.isCancelled, mediaPreviewRequest?.token == previewRequest, activation == activationRevision, selection == selectionRevision,
                      route == presentation.selectedConversation else { await preview.release(); return }
                mediaPreview = preview
                let thumbnail = try await media.display(resource.id, input: localInput, pixels: 320)
                guard !Task.isCancelled, mediaPreviewRequest?.token == previewRequest else { return }
                mediaDisplays[id] = .init(id: id, name: resource.name, kind: thumbnail.image == nil ? .file : .image,
                    thumbnailData: thumbnail.image, aspectRatio: thumbnail.aspectRatio, canOpen: true)
                refreshDraftMedia(route); updatePresentation(route)
            } catch {
                if !Task.isCancelled, mediaPreviewRequest?.token == previewRequest, mediaLoadRevisions[id] == token, activation == activationRevision, selection == selectionRevision {
                    mediaDisplays[id] = .init(id: id, name: reference?.name ?? String(localized: "Attachment"), kind: .file,
                        phase: .failed(String(localized: "Attachment could not be loaded. Try again.")), canOpen: true)
                    updatePresentation(route); showMediaFailure(error, route: route)
                }
            }
        }
    }

    func retireChangedHistoryMedia(old: [NativeMessage], new: [NativeMessage]) {
        let current = Dictionary(uniqueKeysWithValues: new.map { ($0.id, $0) })
        for message in old {
            let next = current[message.id]
            for reference in message.media where next?.sourceRevisionHash != message.sourceRevisionHash
                || next?.media.contains(reference) != true {
                mediaLoads.removeValue(forKey: reference.id)?.cancel()
                mediaLoadRevisions.removeValue(forKey: reference.id)
                mediaDisplays.removeValue(forKey: reference.id)
            }
        }
    }

    func hydrateHistoryMedia(_ history: RuntimeHistory, route: ConversationID, acceptedHistoryIDs: [Int: String]) {
        for (position, raw) in history.messages.enumerated() {
            guard let id = acceptedHistoryIDs[position],
                  let message = documents[route]?.messages.first(where: { $0.id == id }) else { continue }
            for (index, reference) in message.media.enumerated() {
                if reference.artifactID == nil, let resource = reference.resourceID { loadMediaDisplay(resource, referenceID: reference.id, route: route, input: message.isOwnedUser) }
                else if reference.artifactID == nil {
                    hydrateInlineMedia(route: route, messageID: message.id, reference: reference) { try raw.inlineAttachmentData(at: index) }
                }
            }
        }
    }

    func bindFinalMedia(_ update: RuntimeSessionUpdate, route: ConversationID, messageID: String?) {
        let attachments = update.finalAttachments
        guard !attachments.isEmpty, let messageID, var document = documents[route] else { return }
        let matches = document.messages.indices.filter { document.messages[$0].id.utf8.elementsEqual(messageID.utf8) }
        guard matches.count == 1, let index = matches.first, document.messages[index].role == .assistant,
              document.messages[index].historyEpoch == document.historyEpoch else { return }
        document.messages[index].media = attachments.enumerated().map { offset, attachment in
            .init(id: (try? DocumentStore.scopedKey(namespace: "attachment", parts: [route.connectionID, route.agentID, route.sessionID, messageID, String(offset), attachment.artifactID ?? "inline"])) ?? UUID().uuidString, attachment: attachment)
        }
        documents[route] = document; changed(route)
        for (offset, reference) in document.messages[index].media.enumerated() where reference.artifactID == nil {
            hydrateInlineMedia(route: route, messageID: messageID, reference: reference) { try update.inlineFinalAttachmentData(at: offset) }
        }
    }

    func hydrateInlineMedia(route: ConversationID, messageID: String, reference: NativeMediaReference,
                            bytes: @escaping @Sendable () throws -> Data?) {
        guard mediaLoads[reference.id] == nil, let media else { return }
        let activation = activationRevision, wire = wireRevision
        let sourceHash = documents[route]?.messages.first(where: { $0.id == messageID })?.sourceRevisionHash
        let token = UUID(); mediaLoadRevisions[reference.id] = token
        mediaLoads[reference.id] = Task {
            defer { finishMediaLoad(reference.id, token: token) }
            do {
                guard let staged = try await media.stageInline(bytes, name: NativeMediaNames.safe(reference.name), mimeType: reference.mimeType) else { return }
                guard activation == activationRevision, wire == wireRevision, !Task.isCancelled,
                      mediaLoadRevisions[reference.id] == token,
                      documents[route]?.messages.first(where: { $0.id == messageID })?.sourceRevisionHash == sourceHash else {
                    try? media.stager.discard(staged); return
                }
                let resource = try await media.adopt(staged, route: route, messageID: messageID, referenceID: reference.id)
                guard activation == activationRevision, wire == wireRevision, !Task.isCancelled,
                      mediaLoadRevisions[reference.id] == token,
                      let message = documents[route]?.messages.firstIndex(where: { $0.id == messageID }),
                      documents[route]?.messages[message].sourceRevisionHash == sourceHash,
                      let item = documents[route]?.messages[message].media.firstIndex(where: { $0.id == reference.id }) else {
                    try await media.releaseWhenUnreferenced([resource.id]); return
                }
                documents[route]?.messages[message].media[item].resourceID = resource.id; changed(route)
                try await persist(route); try await media.confirm(resource.id)
                let display = try await media.display(resource.id, pixels: 320)
                guard activation == activationRevision, wire == wireRevision, !Task.isCancelled,
                      mediaLoadRevisions[reference.id] == token else { return }
                mediaDisplays[reference.id] = .init(id: reference.id, name: resource.name, kind: display.image == nil ? .file : .image,
                    thumbnailData: display.image, aspectRatio: display.aspectRatio, canOpen: true)
                updatePresentation(route)
            } catch {
                if !Task.isCancelled, mediaLoadRevisions[reference.id] == token, activation == activationRevision, wire == wireRevision {
                    mediaDisplays[reference.id] = .init(id: reference.id, name: reference.name, kind: .file,
                        phase: .failed(String(localized: "Attachment could not be loaded. Try again.")))
                    updatePresentation(route)
                }
            }
        }
    }

    func showMediaFailure(_ error: any Error, route: ConversationID) {
        if let label = nativeMediaFailureLabel(error) { presentation.draft(for: route).hint = label }
        else { showFailure(error) }
    }
}
