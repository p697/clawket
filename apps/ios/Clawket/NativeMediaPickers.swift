import AVFoundation
import ClawketMedia
import ClawketUI
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

enum NativeMediaNames {
    static func safe(_ value: String, type: UTType? = nil) -> String {
        var value = (value.replacingOccurrences(of: "\\", with: "/") as NSString).lastPathComponent
        value = String(value.unicodeScalars.filter { $0.value >= 32 && $0.value != 127 })
        if value.isEmpty || value == "." || value == ".." { value = String(localized: "Attachment") }
        while value.utf8.count > 200 { value.removeLast() }
        if (value as NSString).pathExtension.isEmpty, let suffix = type?.preferredFilenameExtension { value += "." + suffix }
        return value
    }
}

@MainActor
enum NativeMediaPickerAdapter {
    static func providers(_ providers: [NSItemProvider], client: NativeAppModel, scope: NativeMediaScope) {
        guard let stager = client.media?.stager, client.ownsMedia(scope) else { return }
        if providers.count > 6 { client.presentation.draft(for: scope.route).hint = String(localized: "Add up to six attachments.") }
        for provider in providers.prefix(6) {
            let identifier = provider.registeredTypeIdentifiers.first { identifier in
                guard let type = UTType(identifier) else { return false }
                return type.conforms(to: .image)
            } ?? provider.registeredTypeIdentifiers.first { identifier in
                guard let type = UTType(identifier) else { return false }
                return type.conforms(to: .data) && !type.conforms(to: .url) && !type.conforms(to: .text)
            }
            guard let identifier, let type = UTType(identifier) else { continue }
            let name = NativeMediaNames.safe(provider.suggestedName ?? String(localized: "Attachment"), type: type)
            guard let request = client.reserveMediaImport(scope, name: name) else { break }
            let mime = type.preferredMIMEType ?? "application/octet-stream"
            let progress = provider.loadFileRepresentation(forTypeIdentifier: identifier) { [weak client] url, _ in
                let result: Result<StagedMediaFile, MediaFailure>
                if let url {
                    // The provider owns this URL only until this callback returns.
                    // Copy synchronously here, before crossing any actor/Task boundary.
                    do { result = .success(try stager.stageFile(from: url, name: name, mimeType: mime)) }
                    catch let failure as MediaFailure { result = .failure(failure) }
                    catch { result = .failure(.invalidFile) }
                } else { result = .failure(.invalidFile) }
                Task { @MainActor in
                    guard let client else { if case let .success(value) = result { try? stager.discard(value) }; return }
                    client.mediaProviderProgress.removeValue(forKey: request.id)
                    switch result {
                    case let .success(value): client.acceptMedia(value, request: request)
                    case let .failure(error): client.failMediaImport(request, error: error)
                    }
                }
            }
            if client.mediaImports[request.id] != nil { client.mediaProviderProgress[request.id] = progress }
            else { progress.cancel() }
        }
    }

    static func documents(_ urls: [URL], client: NativeAppModel, scope: NativeMediaScope) {
        guard let stager = client.media?.stager, client.ownsMedia(scope) else { return }
        if urls.count > 6 { client.presentation.draft(for: scope.route).hint = String(localized: "Add up to six attachments.") }
        for url in urls.prefix(6) {
            guard url.isFileURL else { continue }
            let type = UTType(filenameExtension: url.pathExtension)
            let name = NativeMediaNames.safe(url.lastPathComponent, type: type)
            guard let request = client.reserveMediaImport(scope, name: name) else { break }
            let mime = type?.preferredMIMEType ?? "application/octet-stream"
            client.mediaImportTasks[request.id] = Task {
                do {
                    let access = NativeCoordinatedMediaImport()
                    let copy = Task.detached(priority: .userInitiated) {
                        try access.stage(url, stager: stager, name: name, mimeType: mime)
                    }
                    let staged = try await withTaskCancellationHandler {
                        try await copy.value
                    } onCancel: { copy.cancel(); access.cancel() }
                    guard !Task.isCancelled else { try? stager.discard(staged); return }
                    client.mediaImportTasks.removeValue(forKey: request.id)
                    client.acceptMedia(staged, request: request)
                } catch {
                    client.mediaImportTasks.removeValue(forKey: request.id)
                    client.failMediaImport(request, error: error)
                }
            }
        }
    }

    static func paste(client: NativeAppModel, scope: NativeMediaScope) {
        guard client.ownsMedia(scope) else { return }
        // Read only after the user's explicit Paste action, never on appearance.
        let board = UIPasteboard.general
        let text = board.string
        if let text, !text.isEmpty, text.utf8.count <= 8 * 1_024 * 1_024 {
            client.presentation.draft(for: scope.route).insertText(text)
        }
        let items = board.itemProviders.filter { provider in
            provider.registeredTypeIdentifiers.contains { identifier in
                guard let type = UTType(identifier) else { return false }
                return type.conforms(to: .image) || (type.conforms(to: .data) && !type.conforms(to: .text) && !type.conforms(to: .url))
            }
        }
        providers(items, client: client, scope: scope)
        if (text == nil || text?.isEmpty == true) && items.isEmpty {
            client.presentation.draft(for: scope.route).hint = String(localized: "No supported attachments on the clipboard.")
        }
    }
}

struct NativeMediaPicker: View {
    @ObservedObject var client: NativeAppModel
    let request: NativeMediaPickerRequest
    @State private var cameraAllowed: Bool?
    var body: some View {
        Group {
            switch request.source {
            case .photos: PhotoPicker(client: client, request: request)
            case .files: DocumentPicker(client: client, request: request)
            case .camera:
                if cameraAllowed == true { CameraPicker(client: client, request: request) }
                else if cameraAllowed == false {
                    NavigationStack {
                        VStack(spacing: 18) {
                            Image(systemName: "camera").font(.largeTitle).foregroundStyle(.secondary)
                            Text("Camera unavailable").font(.title3.bold())
                            Text("Camera access is unavailable. Check Settings or choose a photo.")
                                .multilineTextAlignment(.center).foregroundStyle(.secondary)
                            Button("Open Settings") { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
                        }.padding(28)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { client.cancelMediaPicker(request) } } }
                    }
                } else { ProgressView().task { cameraAllowed = await AVCaptureDevice.requestAccess(for: .video) } }
            case .paste: EmptyView()
            }
        }
    }
}

private struct PhotoPicker: UIViewControllerRepresentable {
    let client: NativeAppModel
    let request: NativeMediaPickerRequest
    func makeCoordinator() -> Coordinator { Coordinator(client: client, request: request) }
    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.filter = .images; configuration.selectionLimit = request.remaining
        configuration.preferredAssetRepresentationMode = .current
        let controller = PHPickerViewController(configuration: configuration); controller.delegate = context.coordinator
        return controller
    }
    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}
    @MainActor final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let client: NativeAppModel; let request: NativeMediaPickerRequest
        init(client: NativeAppModel, request: NativeMediaPickerRequest) { self.client = client; self.request = request }
        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard client.consumeMediaPicker(request) else { return }
            NativeMediaPickerAdapter.providers(results.map(\.itemProvider), client: client, scope: request.scope)
        }
    }
}

private struct DocumentPicker: UIViewControllerRepresentable {
    let client: NativeAppModel
    let request: NativeMediaPickerRequest
    func makeCoordinator() -> Coordinator { Coordinator(client: client, request: request) }
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let controller = UIDocumentPickerViewController(forOpeningContentTypes: request.allowsFiles ? [.item] : [.image], asCopy: false)
        controller.allowsMultipleSelection = true; controller.delegate = context.coordinator
        return controller
    }
    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}
    @MainActor final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let client: NativeAppModel; let request: NativeMediaPickerRequest
        init(client: NativeAppModel, request: NativeMediaPickerRequest) { self.client = client; self.request = request }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard client.consumeMediaPicker(request) else { return }
            NativeMediaPickerAdapter.documents(urls, client: client, scope: request.scope)
        }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
            client.cancelMediaPicker(request)
        }
    }
}

private struct CameraPicker: UIViewControllerRepresentable {
    let client: NativeAppModel
    let request: NativeMediaPickerRequest
    func makeCoordinator() -> Coordinator { Coordinator(client: client, request: request) }
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let controller = UIImagePickerController(); controller.sourceType = .camera
        controller.mediaTypes = [UTType.image.identifier]; controller.cameraCaptureMode = .photo
        controller.delegate = context.coordinator; return controller
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    @MainActor final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let client: NativeAppModel; let request: NativeMediaPickerRequest
        init(client: NativeAppModel, request: NativeMediaPickerRequest) { self.client = client; self.request = request }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            client.cancelMediaPicker(request)
        }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            guard client.consumeMediaPicker(request) else { return }
            guard let stager = client.media?.stager,
                  let job = client.reserveMediaImport(request.scope, name: "Photo.jpg") else { return }
            do {
                guard let image = info[.originalImage] as? UIImage,
                      image.size.width * image.scale * image.size.height * image.scale <= 100_000_000,
                      let bytes = image.jpegData(compressionQuality: 0.92), bytes.count <= MediaLimits.sourceBytes else { throw MediaFailure.tooLarge }
                let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("jpg")
                defer { try? FileManager.default.removeItem(at: temporary) }
                try bytes.write(to: temporary, options: [.atomic, .completeFileProtection])
                let staged = try stager.stageFile(from: temporary, name: "Photo.jpg", mimeType: "image/jpeg")
                client.acceptMedia(staged, request: job)
            } catch { client.failMediaImport(job, error: error) }
        }
    }
}

/// NSFileCoordinator.cancel is explicitly thread-safe. Cancellation does not
/// prove that its accessor did not run: await the captured copy before cleanup.
private final class NativeCoordinatedMediaImport: @unchecked Sendable {
    private let coordinator = NSFileCoordinator(filePresenter: nil)
    func cancel() { coordinator.cancel() }
    func stage(_ url: URL, stager: MediaImportStager, name: String, mimeType: String) throws -> StagedMediaFile {
        try Task.checkCancellation()
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        var coordinationError: NSError?
        var result: Result<StagedMediaFile, MediaFailure> = .failure(.invalidFile)
        coordinator.coordinate(readingItemAt: url, options: .withoutChanges, error: &coordinationError) { coordinated in
            do { try Task.checkCancellation(); result = .success(try stager.stageFile(from: coordinated, name: name, mimeType: mimeType)) }
            catch let failure as MediaFailure { result = .failure(failure) }
            catch { result = .failure(.cancelled) }
        }
        guard coordinationError == nil else { throw MediaFailure.cancelled }
        let staged = try result.get()
        if Task.isCancelled { try? stager.discard(staged); throw MediaFailure.cancelled }
        return staged
    }
}
