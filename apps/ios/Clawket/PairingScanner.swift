import SwiftUI
import VisionKit

struct PairingScanner: View {
    let onValue: @MainActor (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable && error == nil {
                    ScannerSurface(onValue: onValue, onFailure: { error = $0 })
                        .ignoresSafeArea(edges: .bottom)
                } else {
                    VStack(spacing: 18) {
                        Image(systemName: "qrcode.viewfinder").font(.system(size: 44)).foregroundStyle(.secondary)
                        Text("Camera scanning unavailable").font(.title3.bold())
                        Text(error ?? "You can paste the QR text or enter the pairing code instead. Check camera access in Settings if needed.")
                            .foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .navigationTitle("Scan pairing QR").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}

private struct ScannerSurface: UIViewControllerRepresentable {
    let onValue: @MainActor (String) -> Void
    let onFailure: @MainActor (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onValue: onValue, onFailure: onFailure) }
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let controller = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced, recognizesMultipleItems: false, isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true, isGuidanceEnabled: true, isHighlightingEnabled: true)
        controller.delegate = context.coordinator
        do { try controller.startScanning() }
        catch { Task { @MainActor in onFailure("Camera access is unavailable. You can use a pairing code instead.") } }
        return controller
    }
    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {}
    static func dismantleUIViewController(_ uiViewController: DataScannerViewController, coordinator: Coordinator) {
        uiViewController.stopScanning()
    }

    @MainActor final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let onValue: @MainActor (String) -> Void
        private let onFailure: @MainActor (String) -> Void
        private var accepted = false
        init(onValue: @escaping @MainActor (String) -> Void, onFailure: @escaping @MainActor (String) -> Void) {
            self.onValue = onValue; self.onFailure = onFailure
        }
        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !accepted else { return }
            for case let .barcode(barcode) in addedItems {
                guard let value = barcode.payloadStringValue, value.utf8.count <= 64 * 1024 else { continue }
                accepted = true; dataScanner.stopScanning(); onValue(value); return
            }
        }
        func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
            onFailure("Camera scanning stopped. You can enter the pairing code instead.")
        }
    }
}
