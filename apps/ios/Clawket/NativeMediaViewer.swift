import ClawketMedia
import Photos
import QuickLook
import SwiftUI
import UniformTypeIdentifiers
import UIKit

protocol NativeShareLease: Sendable { func release() async }

actor NativeMediaLease: NativeShareLease {
    let resourceID: UUID
    let library: MediaLibrary
    private var released = false
    init(resourceID: UUID, library: MediaLibrary) { self.resourceID = resourceID; self.library = library }
    func release() async {
        guard !released else { return }; released = true
        await library.release(resourceID)
    }
}

struct NativeMediaPreview: Identifiable, Sendable {
    let id = UUID()
    let display: NativeMediaDisplay
    let url: URL
    let library: MediaLibrary
    let lease: NativeMediaLease

    static func create(display: NativeMediaDisplay, library: MediaLibrary) async throws -> NativeMediaPreview {
        try await library.retain(display.resource.id)
        do {
            let url = try await library.resourceURL(display.resource.id)
            return .init(display: display, url: url, library: library,
                         lease: .init(resourceID: display.resource.id, library: library))
        } catch { await library.release(display.resource.id); throw error }
    }
    func release() async { await lease.release() }

    @MainActor var allowsFilePreview: Bool {
        let mime = display.resource.mimeType, suffix = url.pathExtension.lowercased()
        guard !mime.hasPrefix("image/"), !["text/html", "application/xhtml+xml"].contains(mime),
              !["svg", "svgz", "html", "htm", "xhtml"].contains(suffix),
              UTType(filenameExtension: suffix)?.conforms(to: .image) != true else { return false }
        return QLPreviewController.canPreview(url as NSURL)
    }
}

@MainActor final class NativeMediaShare: Identifiable {
    private enum Phase { case pending, controllerCreated, handedOff, finished }
    let id = UUID()
    let url: URL
    let lease: any NativeShareLease
    private var phase = Phase.pending
    init(url: URL, lease: any NativeShareLease) { self.url = url; self.lease = lease }
    func controllerCreated() { if phase == .pending { phase = .controllerCreated } }
    func appeared() { if phase == .controllerCreated { phase = .handedOff } }
    func releaseIfUnpresented(controllerDismantled: Bool = false) async {
        guard phase == .pending || (phase == .controllerCreated && controllerDismantled) else { return }
        phase = .finished
        await lease.release()
    }
    func completed() async { phase = .finished; await lease.release() }
}

struct NativeMediaViewer: View {
    let preview: NativeMediaPreview
    @Environment(\.dismiss) private var dismiss
    @State private var share: NativeMediaShare?
    @State private var saving = false
    @State private var shareRequest: UUID?
    @State private var visible = true
    @State private var notice: String?
    var body: some View {
        NavigationStack {
            Group {
                if let data = preview.display.image, let image = UIImage(data: data) {
                    NativeZoomImage(image: image).accessibilityLabel(preview.display.resource.name)
                } else if preview.allowsFilePreview { NativeFilePreview(url: preview.url) }
                else {
                    VStack(spacing: 16) {
                        Image(systemName: "doc").font(.system(size: 48)).foregroundStyle(.secondary)
                        Text(preview.display.resource.name).font(.headline).multilineTextAlignment(.center)
                        Text("Preview unavailable").foregroundStyle(.secondary)
                        Text(ByteCountFormatter.string(fromByteCount: Int64(preview.display.resource.byteCount), countStyle: .file))
                            .font(.caption).foregroundStyle(.secondary)
                        Button { shareFile() } label: { Label("Share", systemImage: "square.and.arrow.up") }
                    }.padding(28)
                }
            }
            .navigationTitle(preview.display.resource.name).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItemGroup(placement: .primaryAction) {
                    if let pixels = preview.display.image {
                        Menu {
                            Button { if let image = UIImage(data: pixels) { UIPasteboard.general.image = image } }
                                label: { Label("Copy image", systemImage: "doc.on.doc") }
                            Button { saveImage() } label: { Label("Save to Photos", systemImage: "square.and.arrow.down") }
                                .disabled(saving)
                        } label: { Image(systemName: "ellipsis.circle").frame(minWidth: 44, minHeight: 44) }
                        .accessibilityLabel("Attachment")
                    }
                    Button { shareFile() } label: { Image(systemName: "square.and.arrow.up").frame(minWidth: 44, minHeight: 44) }
                        .accessibilityLabel("Share")
                }
            }
            .sheet(item: $share) { NativeActivityView(share: $0) }
            .alert("Clawket", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
                Button("OK", role: .cancel) { notice = nil }
            } message: { Text(notice ?? "") }
            .onAppear { visible = true }
            .onDisappear {
                visible = false; shareRequest = nil
                let abandonedShare = share
                Task { await abandonedShare?.releaseIfUnpresented() }
                Task { await preview.release() }
            }
        }
    }

    private func shareFile() {
        guard visible, share == nil, shareRequest == nil else { return }
        let request = UUID(); shareRequest = request
        Task {
            defer { if shareRequest == request { shareRequest = nil } }
            do {
                try await preview.library.retain(preview.display.resource.id)
                let lease = NativeMediaLease(resourceID: preview.display.resource.id, library: preview.library)
                do {
                    let url = try await preview.library.resourceURL(preview.display.resource.id)
                    guard visible, shareRequest == request else { await lease.release(); return }
                    share = .init(url: url, lease: lease)
                } catch { await lease.release(); throw error }
            } catch { notice = String(localized: "Attachment could not be loaded. Try again.") }
        }
    }

    private func saveImage() {
        guard !saving, preview.display.image != nil else { return }
        saving = true
        Task {
            defer { saving = false }
            let operation: NativeMediaLease
            do {
                try await preview.library.retain(preview.display.resource.id)
                operation = .init(resourceID: preview.display.resource.id, library: preview.library)
            } catch { notice = String(localized: "Attachment could not be loaded. Try again."); return }
            defer { Task { await operation.release() } }
            let permission = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            guard permission == .authorized || permission == .limited else {
                notice = String(localized: "Allow photo access in Settings to save this image."); return
            }
            do {
                let url = try await preview.library.resourceURL(preview.display.resource.id)
                try await PHPhotoLibrary.shared().performChanges { @Sendable in
                    PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: url)
                }
                notice = String(localized: "Image saved.")
            } catch { notice = String(localized: "The operation could not be completed. Please try again.") }
        }
    }
}

struct NativeActivityView: UIViewControllerRepresentable {
    let share: NativeMediaShare
    func makeUIViewController(context: Context) -> NativeActivityController {
        let controller = NativeActivityController(share: share)
        share.controllerCreated()
        controller.completionWithItemsHandler = { _, _, _, _ in Task { await share.completed() } }
        return controller
    }
    func updateUIViewController(_ uiViewController: NativeActivityController, context: Context) {}
    static func dismantleUIViewController(_ controller: NativeActivityController, coordinator: ()) {
        let share = controller.share
        // Constructing a controller does not prove that UIKit presented it.
        // Once it appeared, only system completion may release its file lease.
        Task { await share.releaseIfUnpresented(controllerDismantled: true) }
    }
}

final class NativeActivityController: UIActivityViewController {
    let share: NativeMediaShare
    init(share: NativeMediaShare) {
        self.share = share
        super.init(activityItems: [share.url], applicationActivities: nil)
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        share.appeared()
    }
}

private struct NativeFilePreview: UIViewControllerRepresentable {
    let url: URL
    func makeCoordinator() -> Coordinator { Coordinator(url: url) }
    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController(); controller.dataSource = context.coordinator; return controller
    }
    func updateUIViewController(_ uiViewController: QLPreviewController, context: Context) {}
    @MainActor final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> any QLPreviewItem { url as NSURL }
    }
}

private struct NativeZoomImage: UIViewRepresentable {
    let image: UIImage
    func makeUIView(context: Context) -> ImageScrollView { ImageScrollView(image: image) }
    func updateUIView(_ uiView: ImageScrollView, context: Context) {}
}

private final class ImageScrollView: UIScrollView, UIScrollViewDelegate {
    private let imageView: UIImageView
    private var fittedSize = CGSize.zero
    init(image: UIImage) {
        imageView = UIImageView(image: image)
        super.init(frame: .zero)
        delegate = self; addSubview(imageView); imageView.frame.size = image.size
        showsHorizontalScrollIndicator = false; showsVerticalScrollIndicator = false
        backgroundColor = .systemBackground; bouncesZoom = true
        let tap = UITapGestureRecognizer(target: self, action: #selector(doubleTap(_:)))
        tap.numberOfTapsRequired = 2; addGestureRecognizer(tap)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 0, bounds.height > 0, imageView.bounds.width > 0 else { return }
        if fittedSize != bounds.size {
            fittedSize = bounds.size
            let fit = min(bounds.width / imageView.bounds.width, bounds.height / imageView.bounds.height)
            minimumZoomScale = fit; maximumZoomScale = fit * 6; zoomScale = fit
        }
        centerImage()
    }
    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }
    func scrollViewDidZoom(_ scrollView: UIScrollView) { centerImage() }
    private func centerImage() {
        contentInset = .init(top: max(0, (bounds.height - contentSize.height) / 2), left: max(0, (bounds.width - contentSize.width) / 2), bottom: 0, right: 0)
    }
    @objc private func doubleTap(_ gesture: UITapGestureRecognizer) {
        if zoomScale > minimumZoomScale { setZoomScale(minimumZoomScale, animated: true) }
        else {
            let scale = minimumZoomScale * 2.5, point = gesture.location(in: imageView)
            zoom(to: CGRect(x: point.x - bounds.width / scale / 2, y: point.y - bounds.height / scale / 2,
                            width: bounds.width / scale, height: bounds.height / scale), animated: true)
        }
    }
}
