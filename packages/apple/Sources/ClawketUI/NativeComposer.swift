#if os(iOS)
import SwiftUI
import UIKit

@MainActor
struct NativeComposer: View {
    @ObservedObject var draft: ComposerDraft
    let conversation: ConversationPresentation
    @Binding var expanded: Bool
    let onIntent: @MainActor (ClientIntent) -> Void
    let showModels: () -> Void
    @StateObject private var input = NativeInputController()
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(spacing: 8) {
            if expanded {
                HStack {
                    Text("Message").font(.headline)
                    Spacer()
                    Button { expanded = false } label: {
                        Image(systemName: "chevron.down").frame(minWidth: 44, minHeight: 44)
                    }.accessibilityLabel("Collapse editor")
                }.padding(.horizontal, 8)
            }
            if let voice = draft.voice { voiceStatus(voice) }
            if !draft.attachments.isEmpty { attachmentTray }
            if let hint = draft.hint ?? conversation.availability(.send).explanation {
                Text(hint).font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 8)
            }
            HStack(alignment: .bottom, spacing: 8) {
                if hasAddActions { addMenu }
                VStack(alignment: .leading, spacing: 0) {
                    ZStack(alignment: .topLeading) {
                        PersistentTextInput(controller: input, text: draft.text, expanded: expanded) { text in
                            draft.text = text
                            onIntent(.draftChanged(conversation.id, text: text))
                        }
                        .frame(height: expanded ? nil : input.height)
                        .frame(maxHeight: expanded ? .infinity : nil)
                        .accessibilityIdentifier("message-input")
                        if draft.text.isEmpty {
                            Text("Message \(conversation.agentName)")
                                .font(.body).foregroundStyle(.tertiary)
                                .padding(.top, 13).padding(.horizontal, 12)
                                .allowsHitTesting(false).accessibilityHidden(true)
                        }
                    }
                    HStack(spacing: 0) {
                        if conversation.availability(.models).isVisible, let modelTitle = conversation.modelTitle {
                            Button(action: showModels) {
                                HStack(spacing: 5) {
                                    Text(modelTitle).lineLimit(1).truncationMode(.middle)
                                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                                }.font(.caption).foregroundStyle(.secondary)
                                    .padding(.horizontal, 12).frame(minHeight: 36)
                                    .contentShape(Rectangle())
                            }
                            .disabled(!conversation.availability(.models).isEnabled)
                            .accessibilityLabel("Model: \(modelTitle)")
                            .accessibilityHint(conversation.modelScopeLabel ?? "")
                            .accessibilityIdentifier("composer-model")
                        }
                        Spacer(minLength: 0)
                        if expanded || input.lineCount >= 3 {
                            Button { expanded.toggle() } label: {
                                Image(systemName: expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                                    .font(.caption).foregroundStyle(.secondary).frame(minWidth: 44, minHeight: 36)
                            }
                            .accessibilityLabel(expanded ? "Collapse editor" : "Expand editor")
                            .accessibilityIdentifier("composer-expand")
                        }
                    }
                    .frame(minHeight: hasBottomControls ? 36 : 0)
                    .opacity(hasBottomControls ? 1 : 0)
                }
                .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 25, style: .continuous))
                primaryAction
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .frame(maxWidth: 790)
        .frame(maxWidth: .infinity)
        .frame(maxHeight: expanded ? .infinity : nil, alignment: .bottom)
        .background(Color(uiColor: .systemBackground))
    }

    private var hasContent: Bool {
        !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !draft.attachments.isEmpty
    }
    private var attachmentsReady: Bool { draft.attachments.allSatisfy { $0.phase == .ready } }
    private var hasBottomControls: Bool {
        (conversation.availability(.models).isVisible && conversation.modelTitle != nil) || input.lineCount >= 3 || expanded
    }
    private var hasAddActions: Bool {
        [ClientFeature.photos, .camera, .files, .paste, .skills, .commands, .schedule, .tools, .sessionFiles]
            .contains { conversation.availability($0).isVisible }
    }

    private var addMenu: some View {
        Menu {
            attachmentAction("Photos", symbol: "photo", feature: .photos, source: .photos)
            attachmentAction("Camera", symbol: "camera", feature: .camera, source: .camera)
            attachmentAction("Files", symbol: "doc", feature: .files, source: .files)
            attachmentAction("Paste", symbol: "doc.on.clipboard", feature: .paste, source: .paste)
            if [ClientFeature.skills, .commands, .schedule, .tools, .sessionFiles].contains(where: { conversation.availability($0).isVisible }) {
                Divider()
                destinationAction("Use a skill", symbol: "sparkles", feature: .skills, destination: .skills)
                destinationAction("Commands", symbol: "slash.circle", feature: .commands, destination: .commands)
                destinationAction("Schedule a task", symbol: "calendar.badge.plus", feature: .schedule, destination: .schedule)
                destinationAction("Tools", symbol: "wrench.and.screwdriver", feature: .tools, destination: .tools)
                destinationAction("Conversation files", symbol: "folder", feature: .sessionFiles, destination: .sessionFiles)
            }
        } label: {
            Image(systemName: "plus").font(.title3)
                .frame(width: 44, height: 48).contentShape(Rectangle())
        }
        .accessibilityLabel("Add attachment or action")
        .accessibilityIdentifier("composer-add")
    }

    @ViewBuilder private var primaryAction: some View {
        VStack(spacing: 8) {
            if conversation.availability(.stop).isVisible { stopButton }
            if hasContent && conversation.availability(.send).isVisible {
                sendButton
            } else if !conversation.availability(.stop).isVisible && conversation.availability(.voice).isVisible {
                VoiceCaptureControl(isRecording: draft.voice?.phase == .recording,
                                    isEnabled: conversation.availability(.voice).isEnabled) { action in
                    onIntent(.voice(conversation.id, action: action))
                }
                .frame(width: 44, height: 48)
                .accessibilityIdentifier("composer-voice")
            }
        }
        .padding(.bottom, 2)
    }

    private var stopButton: some View {
        Button { onIntent(.stop(conversation.id)) } label: {
            Group {
                if conversation.availability(.stop).isEnabled { Image(systemName: "stop.fill").font(.body) }
                else { ProgressView().tint(hasContent ? Color.primary : Color(uiColor: .systemBackground)) }
            }.frame(width: 44, height: 44)
                .foregroundStyle(hasContent ? Color.primary : Color(uiColor: .systemBackground))
                .background(hasContent ? Color(uiColor: .secondarySystemBackground) : Color.primary, in: Circle())
        }
        .disabled(!conversation.availability(.stop).isEnabled)
        .accessibilityLabel(conversation.availability(.stop).isEnabled ? "Stop task" : "Stopping task")
        .accessibilityIdentifier("composer-stop")
    }

    private var sendButton: some View {
        Button {
            input.commitMarkedText()
            onIntent(.send(conversation.id))
        } label: {
            Image(systemName: "arrow.up").font(.body.weight(.semibold))
                .frame(width: 44, height: 44)
                .foregroundStyle(Color(uiColor: .systemBackground))
                .background(Color.primary, in: Circle())
        }
        .disabled(!conversation.availability(.send).isEnabled || !attachmentsReady)
        .opacity(conversation.availability(.send).isEnabled && attachmentsReady ? 1 : 0.35)
        .accessibilityLabel(conversation.sendLabel)
        .help(conversation.sendLabel)
        .accessibilityIdentifier("composer-send")
    }

    private var attachmentTray: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 10) {
                ForEach(draft.attachments) { attachment in
                    ComposerAttachmentView(attachment: attachment, onOpen: {
                        onIntent(.openAttachment(attachmentID: attachment.id))
                    }, onRemove: {
                        onIntent(.removeAttachment(conversation.id, attachmentID: attachment.id))
                    })
                }
            }.padding(.horizontal, 4)
        }
    }

    private func voiceStatus(_ voice: VoicePresentation) -> some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: voice.phase == .recording ? "mic.fill" : "waveform")
                .foregroundStyle(voice.phase == .recording ? Color.red : Color.secondary)
            VStack(alignment: .leading, spacing: 3) {
                Text(voice.label).font(.subheadline.weight(.medium))
                if let detail = voice.detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 0)
            if voice.canRetry {
                Button("Retry") { onIntent(.voice(conversation.id, action: .retry)) }.frame(minHeight: 44)
            }
            if voice.canStop {
                Button("Stop") { onIntent(.voice(conversation.id, action: .stop)) }.frame(minHeight: 44)
            }
            if voice.canCancel {
                Button { onIntent(.voice(conversation.id, action: .cancel)) } label: {
                    Image(systemName: "xmark").frame(minWidth: 44, minHeight: 44)
                }.accessibilityLabel("Cancel recording")
            }
        }
        .padding(.leading, 14).padding(.trailing, 4)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    @ViewBuilder
    private func attachmentAction(_ title: String, symbol: String, feature: ClientFeature, source: AttachmentSource) -> some View {
        if conversation.availability(feature).isVisible {
            Button { onIntent(.pickAttachment(conversation.id, source: source)) } label: {
                Label(title, systemImage: symbol)
            }.disabled(!conversation.availability(feature).isEnabled)
        }
    }

    @ViewBuilder
    private func destinationAction(_ title: String, symbol: String, feature: ClientFeature, destination: ClientDestination) -> some View {
        if conversation.availability(feature).isVisible {
            Button { onIntent(.openDestination(destination, conversation: conversation.id)) } label: {
                Label(title, systemImage: symbol)
            }.disabled(!conversation.availability(feature).isEnabled)
        }
    }
}

@MainActor
private struct ComposerAttachmentView: View {
    let attachment: AttachmentPresentation
    let onOpen: () -> Void
    let onRemove: () -> Void
    var body: some View {
        HStack(spacing: 8) {
            Group {
                if let data = attachment.thumbnailData, let image = UIImage(data: data) {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Image(systemName: attachment.kind == .image ? "photo" : "doc")
                        .font(.title3).foregroundStyle(.secondary)
                }
            }
            .frame(width: 56, height: 56).clipped()
            .background(Color(uiColor: .tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .accessibilityHidden(true)
            .modifier(AttachmentPreviewInteraction(canOpen: attachment.canOpen, name: attachment.name, open: onOpen))
            if attachment.kind != .image {
                VStack(alignment: .leading, spacing: 3) {
                    Text(attachment.name).font(.caption.weight(.medium)).lineLimit(2)
                    if let detail = attachment.detail { Text(detail).font(.caption2).foregroundStyle(.secondary) }
                }.frame(maxWidth: 160, alignment: .leading)
            }
            switch attachment.phase {
            case .preparing: ProgressView().accessibilityLabel("Preparing \(attachment.name)")
            case .failed: Image(systemName: "exclamationmark.circle").foregroundStyle(.orange).accessibilityLabel("Attachment failed")
            case .ready: EmptyView()
            }
            if attachment.canRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill").font(.body).foregroundStyle(.secondary)
                        .frame(width: 44, height: 56).contentShape(Rectangle())
                }.accessibilityLabel("Remove \(attachment.name)")
            }
        }
        .padding(4)
        .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(attachment.name)
    }
}

@MainActor
private struct AttachmentPreviewInteraction: ViewModifier {
    let canOpen: Bool
    let name: String
    let open: () -> Void
    @ViewBuilder func body(content: Content) -> some View {
        if canOpen {
            Button(action: open) { content }
                .buttonStyle(.plain)
                .accessibilityLabel("Preview \(name)")
        } else { content }
    }
}

@MainActor
private final class NativeInputController: NSObject, ObservableObject, UITextViewDelegate {
    @Published var height: CGFloat = 48
    @Published var lineCount = 1
    var expanded = false
    var onChange: ((String) -> Void)?
    lazy var textView: GrowingTextView = {
        let view = GrowingTextView()
        view.backgroundColor = .clear
        view.font = UIFont.preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        view.textContainer.lineFragmentPadding = 0
        view.delegate = self
        view.isScrollEnabled = false
        view.keyboardDismissMode = .interactive
        view.accessibilityLabel = String(localized: "Message")
        view.onLayout = { [weak self] in self?.measure() }
        return view
    }()

    func textViewDidChange(_ textView: UITextView) {
        onChange?(textView.text)
        measure()
    }

    func sync(text: String, expanded: Bool) {
        self.expanded = expanded
        if textView.text != text && textView.markedTextRange == nil {
            let selection = textView.selectedRange
            textView.text = text
            textView.selectedRange = NSRange(location: min(selection.location, text.utf16.count), length: 0)
        }
        textView.isScrollEnabled = expanded || lineCount > 5
        measure()
    }

    func commitMarkedText() {
        textView.unmarkText()
        onChange?(textView.text)
    }

    private func measure() {
        guard textView.bounds.width > 1 else { return }
        let fitting = textView.sizeThatFits(CGSize(width: textView.bounds.width, height: .greatestFiniteMagnitude)).height
        let lineHeight = textView.font?.lineHeight ?? 21
        let lines = max(1, Int(ceil(max(lineHeight, fitting - 24) / lineHeight)))
        let newHeight = max(48, min(fitting, lineHeight * 5 + 24))
        guard abs(height - newHeight) > 0.5 || lineCount != lines else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.height = newHeight
            self.lineCount = lines
            self.textView.isScrollEnabled = self.expanded || lines > 5
        }
    }
}

@MainActor
private final class GrowingTextView: UITextView {
    var onLayout: (() -> Void)?
    override func layoutSubviews() { super.layoutSubviews(); onLayout?() }
}

@MainActor
private struct PersistentTextInput: UIViewRepresentable {
    let controller: NativeInputController
    let text: String
    let expanded: Bool
    let onChange: (String) -> Void
    func makeUIView(context: Context) -> GrowingTextView {
        controller.onChange = onChange
        controller.sync(text: text, expanded: expanded)
        return controller.textView
    }
    func updateUIView(_ uiView: GrowingTextView, context: Context) {
        controller.onChange = onChange
        controller.sync(text: text, expanded: expanded)
    }
}

@MainActor
private struct VoiceCaptureControl: UIViewRepresentable {
    var isRecording: Bool
    var isEnabled: Bool
    var action: (VoiceIntent) -> Void
    func makeUIView(context: Context) -> CaptureButton { CaptureButton() }
    func updateUIView(_ button: CaptureButton, context: Context) {
        button.recording = isRecording
        button.isEnabled = isEnabled
        button.action = action
        button.setImage(UIImage(systemName: isRecording ? "stop.circle" : "mic"), for: .normal)
        button.tintColor = .label
        button.accessibilityLabel = String(localized: isRecording ? "Stop recording" : "Start voice input")
        button.accessibilityHint = String(localized: "Tap to record. Hold and release to send. Slide up to cancel.")
    }
}

@MainActor
private final class CaptureButton: UIButton {
    var recording = false
    var action: ((VoiceIntent) -> Void)?
    private var beganAt: TimeInterval = 0
    private var beganRecording = false
    private var cancelled = false
    private var initialPoint = CGPoint.zero

    override func beginTracking(_ touch: UITouch, with event: UIEvent?) -> Bool {
        guard isEnabled else { return false }
        beganAt = event?.timestamp ?? ProcessInfo.processInfo.systemUptime
        initialPoint = touch.location(in: self)
        beganRecording = !recording
        cancelled = false
        if beganRecording { action?(.start) }
        isHighlighted = true
        return true
    }
    override func continueTracking(_ touch: UITouch, with event: UIEvent?) -> Bool {
        cancelled = touch.location(in: self).y < initialPoint.y - 64
        alpha = cancelled ? 0.35 : 1
        return true
    }
    override func endTracking(_ touch: UITouch?, with event: UIEvent?) {
        isHighlighted = false; alpha = 1
        if cancelled { action?(.cancel) }
        else if !beganRecording { action?(.stop) }
        else if (event?.timestamp ?? ProcessInfo.processInfo.systemUptime) - beganAt >= 0.3 { action?(.finishAndSend) }
    }
    override func cancelTracking(with event: UIEvent?) {
        isHighlighted = false; alpha = 1
        if beganRecording { action?(.cancel) }
    }
    override func accessibilityActivate() -> Bool {
        guard isEnabled else { return false }
        action?(recording ? .stop : .start)
        return true
    }
}
#endif
