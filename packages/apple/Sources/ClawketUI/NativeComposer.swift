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
    var maximumHeight: CGFloat = .infinity
    @StateObject private var input = NativeInputController()
    @State private var contentHeights: [String: CGFloat] = [:]
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                ScrollView(.vertical, showsIndicators: naturalContentHeight > availableContentHeight) {
                    VStack(alignment: .leading, spacing: 0) {
                        VStack(spacing: 8) {
                            if expanded {
                                HStack {
                                    Text("Message").font(.headline)
                                    Spacer()
                                    Button { expanded = false } label: {
                                        Image(systemName: "chevron.down").font(.system(size: 17, weight: .medium))
                                            .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                                    }.accessibilityLabel("Collapse editor").buttonStyle(.plain)
                                }.padding(.horizontal, 8)
                            }
                            if let voice = draft.voice { voiceStatus(voice) }
                            if !draft.attachments.isEmpty {
                                attachmentTray.padding(.top, 10).padding(.bottom, 4)
                            }
                        }.composerHeight("before")
                        PersistentTextInput(controller: input, text: draft.text, expanded: expanded) { text in
                            draft.text = text
                            onIntent(.draftChanged(conversation.id, text: text))
                        }
                        .frame(minWidth: 0, maxWidth: .infinity)
                        .frame(height: editorHeight)
                        .accessibilityIdentifier("message-input")
                        .overlay(alignment: .topLeading) {
                            if draft.text.isEmpty {
                                Text("Message \(conversation.agentName)")
                                    .font(.body).foregroundStyle(.tertiary).lineLimit(1)
                                    .padding(.top, 13).padding(.horizontal, 12)
                                    .allowsHitTesting(false).accessibilityHidden(true)
                            }
                        }
                        VStack(alignment: .leading, spacing: 0) {
                            if dynamicTypeSize.isAccessibilitySize {
                                modelButton.fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 8)
                            }
                            if let hint = draft.hint ?? conversation.availability(.send).explanation {
                                Text(hint).font(.caption).foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 12).padding(.top, 4).padding(.bottom, 8)
                            }
                        }.composerHeight("after")
                    }
                }
                .scrollBounceBehavior(.basedOnSize)
                .scrollDismissesKeyboard(.never)
                .frame(height: expanded ? availableContentHeight : min(naturalContentHeight, availableContentHeight))
                .composerHeight("viewport")
                .accessibilityIdentifier("composer-content")
                HStack(spacing: 4) {
                    if hasAddActions { addMenu }
                    if !dynamicTypeSize.isAccessibilitySize { modelButton }
                    Spacer(minLength: 0)
                    if expanded || input.lineCount >= 3 {
                        Button { expanded.toggle() } label: {
                            Image(systemName: expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                                .font(.system(size: 14, weight: .medium)).foregroundStyle(Color(uiColor: .secondaryLabel))
                                .frame(width: 44, height: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(expanded ? String(localized: "Collapse editor") : String(localized: "Expand editor"))
                        .accessibilityIdentifier("composer-expand")
                    }
                    primaryAction
                }
                .padding(.horizontal, 2).padding(.bottom, 4)
            }
            .padding(.horizontal, 4)
            .frame(minWidth: 0, maxWidth: .infinity)
            .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .strokeBorder(Color(uiColor: .separator).opacity(0.13), lineWidth: 0.5)
                    .allowsHitTesting(false)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 8)
        .frame(maxWidth: 790)
        .frame(maxWidth: .infinity)
        .frame(maxHeight: expanded ? .infinity : nil, alignment: .bottom)
        .background(Color(uiColor: .systemBackground))
        .onPreferenceChange(NativeComposerHeightKey.self) { values in
            let measured = values.filter { $0.value.isFinite && $0.value >= 0 }
            guard measured.keys != contentHeights.keys || measured.contains(where: { abs($0.value - (contentHeights[$0.key] ?? 0)) > 0.5 }) else { return }
            contentHeights = measured
            input.requestSelectionReveal()
        }
        .onChange(of: maximumHeight) { _ in input.requestSelectionReveal() }
        .onChange(of: expanded) { _ in input.requestSelectionReveal() }
        .onChange(of: draft.insertion?.id) { _ in
            guard let insertion = draft.insertion else { return }
            if insertion.expectedRevision != nil { input.commitMarkedText() }
            if let revision = insertion.expectedRevision, revision != draft.editRevision {
                if insertion.acknowledgement { onIntent(.composerInsertionApplied(conversation.id, insertionID: insertion.id, text: nil)) }
                if draft.insertion?.id == insertion.id { draft.insertion = nil }; return
            }
            let text = input.insertText(insertion.text, replacingText: insertion.replacingText)
            if insertion.acknowledgement {
                onIntent(.composerInsertionApplied(conversation.id, insertionID: insertion.id, text: text))
            }
            if draft.insertion?.id == insertion.id { draft.insertion = nil }
        }
    }

    private var availableContentHeight: CGFloat {
        // The conversation supplies its actual remaining height after keyboard
        // and accessory layout. Only the body scrolls; actions retain 44 points.
        let bound = maximumHeight.isFinite ? maximumHeight : 600
        return max(0, bound - 16 - 48)
    }
    private var editorHeight: CGFloat {
        let oneLine = (input.textView.font?.lineHeight ?? 24)
            + input.textView.textContainerInset.top + input.textView.textContainerInset.bottom
        return expanded ? max(max(48, oneLine), availableContentHeight - (contentHeights["before"] ?? 0) - (contentHeights["after"] ?? 0)) : input.height
    }
    private var naturalContentHeight: CGFloat {
        (contentHeights["before"] ?? 0) + editorHeight + (contentHeights["after"] ?? 0)
    }

    @ViewBuilder private var modelButton: some View {
        if conversation.availability(.models).isVisible, let modelTitle = conversation.modelTitle {
            Button(action: showModels) {
                HStack(spacing: 5) {
                    Text(modelTitle).lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1).truncationMode(.middle)
                    Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                }
                .font(.caption.weight(.medium)).foregroundStyle(Color(uiColor: .secondaryLabel))
                .padding(.horizontal, 8).frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!conversation.availability(.models).isEnabled)
            .accessibilityLabel(Text("Model: \(modelTitle)"))
            .accessibilityHint(conversation.modelScopeLabel ?? "")
            .accessibilityIdentifier("composer-model")
        }
    }

    private var hasContent: Bool {
        !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !draft.attachments.isEmpty
    }
    private var attachmentsReady: Bool { draft.attachments.allSatisfy { $0.phase == .ready } }
    private var hasAddActions: Bool {
        [ClientFeature.photos, .camera, .files, .paste, .voice, .skills, .commands, .schedule, .tools, .sessionFiles]
            .contains { conversation.availability($0).isVisible }
    }

    private var addMenu: some View {
        Menu {
            attachmentAction("Photos", symbol: "photo", feature: .photos, source: .photos)
            attachmentAction("Camera", symbol: "camera", feature: .camera, source: .camera)
            attachmentAction("Files", symbol: "doc", feature: .files, source: .files)
            attachmentAction("Paste", symbol: "doc.on.clipboard", feature: .paste, source: .paste)
            if conversation.availability(.voice).isVisible {
                Button {
                    input.commitMarkedText()
                    onIntent(.voice(conversation.id, action: draft.voice?.phase == .recording ? .stop : .start))
                } label: {
                    Label(draft.voice?.phase == .recording ? String(localized: "Stop voice input") : String(localized: "Voice input"), systemImage: "mic")
                }
                    .disabled(!conversation.availability(.voice).isEnabled)
            }
            if [ClientFeature.skills, .commands, .schedule, .tools, .sessionFiles].contains(where: { conversation.availability($0).isVisible }) {
                Divider()
                destinationAction("Use a skill", symbol: "sparkles", feature: .skills, destination: .skills)
                destinationAction("Commands", symbol: "slash.circle", feature: .commands, destination: .commands)
                destinationAction("Schedule a task", symbol: "calendar.badge.plus", feature: .schedule, destination: .schedule)
                destinationAction("Tools", symbol: "wrench.and.screwdriver", feature: .tools, destination: .tools)
                destinationAction("Conversation files", symbol: "folder", feature: .sessionFiles, destination: .sessionFiles)
            }
        } label: {
            Image(systemName: "plus").font(.system(size: 20, weight: .regular)).foregroundStyle(Color(uiColor: .label))
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .tint(Color(uiColor: .label))
        .accessibilityLabel("Add attachment or action")
        .accessibilityIdentifier("composer-add")
    }

    @ViewBuilder private var primaryAction: some View {
        HStack(spacing: 4) {
            if conversation.availability(.stop).isVisible { stopButton }
            if hasContent && conversation.availability(.send).isVisible {
                sendButton
            } else if !conversation.availability(.stop).isVisible && conversation.availability(.voice).isVisible {
                VoiceCaptureControl(isRecording: draft.voice?.phase == .recording,
                                    isEnabled: conversation.availability(.voice).isEnabled) { action in
                    if action == .start { input.commitMarkedText() }
                    onIntent(.voice(conversation.id, action: action))
                }
                .frame(width: 44, height: 44)
                .accessibilityIdentifier("composer-voice")
            } else if !conversation.availability(.stop).isVisible && conversation.availability(.send).isVisible {
                sendButton
            }
        }
    }

    private var stopButton: some View {
        Button { onIntent(.stop(conversation.id)) } label: {
            Image(systemName: "stop.fill").font(.system(size: 14, weight: .semibold))
                .frame(width: 34, height: 34)
                .foregroundStyle(hasContent ? Color.primary : Color(uiColor: .systemBackground))
                .background(hasContent ? Color(uiColor: .tertiarySystemFill) : Color.primary, in: Circle())
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .disabled(!conversation.availability(.stop).isEnabled)
        .opacity(conversation.availability(.stop).isEnabled ? 1 : 0.35)
        .accessibilityLabel("Stop task")
        .accessibilityHint(conversation.availability(.stop).explanation ?? "")
        .accessibilityIdentifier("composer-stop")
    }

    private var sendButton: some View {
        Button {
            input.commitMarkedText()
            onIntent(.send(conversation.id))
        } label: {
            Image(systemName: "arrow.up").font(.system(size: 17, weight: .semibold))
                .frame(width: 34, height: 34)
                .foregroundStyle(Color(uiColor: .systemBackground))
                .background(Color.primary, in: Circle())
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .disabled(!hasContent || !conversation.availability(.send).isEnabled || !attachmentsReady)
        .opacity(hasContent && conversation.availability(.send).isEnabled && attachmentsReady ? 1 : 0.25)
        .accessibilityLabel(conversation.sendLabel)
        .help(conversation.sendLabel)
        .accessibilityIdentifier("composer-send")
    }

    private var attachmentTray: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 10) {
                ForEach(draft.attachments, id: \.displayID) { attachment in
                    ComposerAttachmentView(attachment: attachment, onOpen: {
                        onIntent(.openAttachment(attachmentID: attachment.id))
                    }, onRemove: {
                        onIntent(.removeAttachment(conversation.id, attachmentID: attachment.id))
                    })
                }
            }.padding(.horizontal, 8)
                .fixedSize(horizontal: false, vertical: true).composerHeight("attachments")
        }
        .frame(height: contentHeights["attachments"] ?? 0)
        .accessibilityIdentifier("composer-attachments")
    }

    private func voiceStatus(_ voice: VoicePresentation) -> some View {
        HStack(alignment: .center, spacing: 10) {
            if voice.phase == .recording, let level = voice.level {
                HStack(spacing: 2) {
                    ForEach(0..<5) { index in
                        Capsule().fill(Color.red).frame(width: 3, height: 4 + CGFloat(level) * [10.0, 16, 22, 15, 8][index])
                    }
                }.frame(width: 24, height: 28).accessibilityHidden(true)
            } else { Image(systemName: "waveform").foregroundStyle(.secondary) }
            VStack(alignment: .leading, spacing: 3) {
                Text(voice.label).font(.subheadline.weight(.medium))
                if let detail = voice.detail { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            }
            Spacer(minLength: 0)
            if voice.canReview {
                NativeTextActionButton(String(localized: "Saved recording"), accessibilityIdentifier: "voice-saved-recording") {
                    onIntent(.voice(conversation.id, action: .showRecordings))
                }
            }
            if voice.canRetry {
                NativeTextActionButton(String(localized: "Retry"), accessibilityIdentifier: "voice-retry") {
                    onIntent(.voice(conversation.id, action: .retry))
                }
            }
            if voice.canStop {
                NativeTextActionButton(String(localized: "Stop"), accessibilityIdentifier: "voice-stop") {
                    onIntent(.voice(conversation.id, action: .stop))
                }
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
    private func attachmentAction(_ title: LocalizedStringKey, symbol: String, feature: ClientFeature, source: AttachmentSource) -> some View {
        if conversation.availability(feature).isVisible {
            Button { onIntent(.pickAttachment(conversation.id, source: source)) } label: {
                Label(title, systemImage: symbol)
            }.disabled(!conversation.availability(feature).isEnabled)
        }
    }

    @ViewBuilder
    private func destinationAction(_ title: LocalizedStringKey, symbol: String, feature: ClientFeature, destination: ClientDestination) -> some View {
        if conversation.availability(feature).isVisible {
            Button { onIntent(.openDestination(destination, conversation: conversation.id)) } label: {
                Label(title, systemImage: symbol)
            }.disabled(!conversation.availability(feature).isEnabled)
        }
    }
}

private struct NativeComposerHeightKey: PreferenceKey {
    static let defaultValue: [String: CGFloat] = [:]
    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

private extension View {
    func composerHeight(_ name: String) -> some View {
        background(GeometryReader { geometry in
            Color.clear.preference(key: NativeComposerHeightKey.self, value: [name: geometry.size.height])
        })
    }
}

@MainActor
private struct ComposerAttachmentView: View {
    let attachment: AttachmentPresentation
    let onOpen: () -> Void
    let onRemove: () -> Void
    private struct Information {
        let title: String
        let message: String
    }
    @State private var information: Information?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private var compactImage: Bool { attachment.kind == .image && !dynamicTypeSize.isAccessibilitySize }
    private var cardWidth: CGFloat { dynamicTypeSize.isAccessibilitySize ? 224 : compactImage ? 88 : 144 }
    private var thumbnailHeight: CGFloat { compactImage ? 88 : 84 }
    private var showsMetadata: Bool {
        if case .failed = attachment.phase { return true }
        return !compactImage
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack {
                Color(uiColor: .tertiarySystemBackground)
                if let data = attachment.thumbnailData, let image = UIImage(data: data) {
                    Image(uiImage: image).resizable().scaledToFill()
                        .frame(width: cardWidth, height: thumbnailHeight).clipped()
                        .accessibilityHidden(true)
                } else {
                    Image(systemName: attachment.kind == .image ? "photo" : "doc.text")
                        .font(.system(size: 28, weight: .light)).foregroundStyle(.secondary)
                }
                if attachment.phase == .preparing {
                    ProgressView().padding(9).background(.regularMaterial, in: Circle())
                        .accessibilityLabel(Text("Preparing \(attachment.name)"))
                }
            }
            .frame(width: cardWidth, height: thumbnailHeight)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .modifier(AttachmentPreviewInteraction(canOpen: attachment.canOpen, name: attachment.name,
                detail: attachment.detail, open: onOpen))
            .contextMenu {
                if compactImage {
                    Button {
                        let message: String
                        switch attachment.phase {
                        case .preparing: message = String(localized: "Preparing \(attachment.name)")
                        case .failed(let reason): message = reason
                        case .ready: message = attachment.detail ?? String(localized: "Attachment")
                        }
                        information = .init(title: attachment.name, message: message)
                    } label: { Label("Details", systemImage: "info.circle") }
                }
            }
            if showsMetadata {
                VStack(alignment: .leading, spacing: 3) {
                    Text(attachment.name).font(.caption.weight(.medium))
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1).truncationMode(.middle)
                        .fixedSize(horizontal: false, vertical: true)
                    if case .failed(let reason) = attachment.phase {
                        Button {
                            information = .init(title: String(localized: "Attachment failed"), message: attachment.name + "\n\n" + reason)
                        } label: {
                            HStack(alignment: .top, spacing: 4) {
                                Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
                                Text(reason).lineLimit(2).foregroundStyle(.primary)
                                Image(systemName: "chevron.right").font(.system(size: 8, weight: .semibold))
                            }
                            .font(.caption2).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .topLeading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Attachment failed"))
                        .accessibilityValue(reason)
                    } else {
                        Text(attachment.detail ?? " ").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                            .accessibilityHidden(attachment.detail == nil)
                    }
                }
                .frame(width: cardWidth - 8, alignment: .leading).padding(.horizontal, 4)
            }
        }
        .frame(width: cardWidth, alignment: .topLeading)
        .overlay(alignment: .topTrailing) {
            if attachment.canRemove {
                Button(action: onRemove) {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.primary).frame(width: 23, height: 23)
                        .background(.regularMaterial, in: Circle())
                        .frame(width: 44, height: 44).contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Remove \(attachment.name)"))
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(attachment.name)
        .alert(Text(information?.title ?? ""), isPresented: Binding(
            get: { information != nil }, set: { if !$0 { information = nil } }
        )) {
            Button("OK", role: .cancel) { information = nil }
        } message: {
            Text(information?.message ?? "")
        }
    }
}

@MainActor
private struct AttachmentPreviewInteraction: ViewModifier {
    let canOpen: Bool
    let name: String
    let detail: String?
    let open: () -> Void
    @ViewBuilder func body(content: Content) -> some View {
        if canOpen {
            Button(action: open) {
                Label { Text("Preview \(name)") } icon: { content }
                    .labelStyle(.iconOnly)
            }
                .buttonStyle(.plain)
                .contentShape(Rectangle())
                .accessibilityLabel(Text("Preview \(name)"))
                .accessibilityValue(detail ?? "")
        } else { content }
    }
}

@MainActor
private final class NativeInputController: NSObject, ObservableObject, UITextViewDelegate {
    @Published var height: CGFloat = 48
    @Published var lineCount = 1
    var expanded = false
    var onChange: ((String) -> Void)?
    private var selectionRevealPending = false
    private var selectionRevealScheduled = false
    private var selectionRevealAttempts = 0
    lazy var textView: GrowingTextView = {
        let view = GrowingTextView()
        view.backgroundColor = .clear
        view.font = UIFont.preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
        view.textContainer.lineFragmentPadding = 0
        view.delegate = self
        view.isScrollEnabled = false
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.keyboardDismissMode = .interactive
        view.accessibilityLabel = String(localized: "Message")
        view.onLayout = { [weak self] in
            self?.measure()
            self?.scheduleSelectionReveal()
        }
        return view
    }()

    func textViewDidChange(_ textView: UITextView) {
        onChange?(textView.text)
        measure()
        requestSelectionReveal()
    }

    func textViewDidBeginEditing(_ textView: UITextView) { requestSelectionReveal() }
    func textViewDidChangeSelection(_ textView: UITextView) { requestSelectionReveal() }

    func requestSelectionReveal() {
        guard textView.isFirstResponder else { return }
        selectionRevealPending = true
        selectionRevealAttempts = 0
        scheduleSelectionReveal()
    }

    private func scheduleSelectionReveal() {
        guard selectionRevealPending, !selectionRevealScheduled else { return }
        selectionRevealScheduled = true
        Task { @MainActor [weak self] in
            await Task.yield()
            guard let self else { return }
            self.selectionRevealScheduled = false
            guard self.selectionRevealPending else { return }
            self.selectionRevealAttempts += 1
            if self.revealSelection() || self.selectionRevealAttempts >= 3 {
                self.selectionRevealPending = false
            } else {
                // TextKit and SwiftUI may finish their viewport layouts on
                // different turns. Only this active request earns correction.
                self.textView.setNeedsLayout()
            }
        }
    }

    private func revealSelection() -> Bool {
        guard textView.isFirstResponder, textView.window != nil,
              !textView.isTracking, !textView.isDragging, !textView.isDecelerating,
              let selection = textView.selectedTextRange else { return true }
        // TextKit follows its caret inside the editor. The bounded composer
        // also scrolls attachments and model details, so reveal that same caret
        // in its enclosing viewport without changing selection or marked text.
        var ancestor = textView.superview
        while let view = ancestor {
            defer { ancestor = view.superview }
            guard let scroll = view as? UIScrollView else { continue }
            guard scroll.bounds.height > 0 else { return false }
            guard !scroll.isTracking, !scroll.isDragging, !scroll.isDecelerating else { return true }
            textView.layoutIfNeeded()
            var caret = textView.textInputView.convert(textView.caretRect(for: selection.end), to: textView)
            guard caret.minX.isFinite, caret.maxX.isFinite, caret.minY.isFinite, caret.maxY.isFinite,
                  !caret.isNull, caret.height > 0 else { return false }
            if caret.maxY > textView.contentSize.height + 0.5,
               let manager = textView.textLayoutManager, let content = manager.textContentManager {
                // A lazy TextKit estimate may still understate a distant caret
                // after a font/width change. Do not force TextKit 1 fallback.
                manager.ensureLayout(for: content.documentRange)
                textView.setNeedsLayout(); textView.layoutIfNeeded()
                caret = textView.textInputView.convert(textView.caretRect(for: selection.end), to: textView)
            }
            guard caret.minX.isFinite, caret.maxX.isFinite, caret.minY.isFinite, caret.maxY.isFinite,
                  caret.height > 0 else { return false }
            if textView.isScrollEnabled { reveal(caret, in: textView, allowingEstimatedExtent: true) }
            let target = textView.textInputView.convert(textView.caretRect(for: selection.end), to: scroll)
            reveal(target, in: scroll)
            let innerVisible = textView.bounds.inset(by: textView.adjustedContentInset).insetBy(dx: -0.5, dy: -0.5)
            let outerVisible = scroll.bounds.inset(by: scroll.adjustedContentInset).insetBy(dx: -0.5, dy: -0.5)
            return innerVisible.contains(textView.textInputView.convert(textView.caretRect(for: selection.end), to: textView))
                && outerVisible.contains(textView.textInputView.convert(textView.caretRect(for: selection.end), to: scroll))
        }
        return false
    }

    private func reveal(_ caret: CGRect, in scroll: UIScrollView, allowingEstimatedExtent: Bool = false) {
        let visible = scroll.bounds.inset(by: scroll.adjustedContentInset)
        let padding = min(8, max(0, (visible.height - caret.height) / 2))
        let target = caret.insetBy(dx: 0, dy: -padding)
        var offset = scroll.contentOffset.y
        if target.minY < visible.minY { offset += target.minY - visible.minY }
        else if target.maxY > visible.maxY { offset += target.maxY - visible.maxY }
        let minimum = -scroll.adjustedContentInset.top
        // UITextView's lazy contentSize can lag its actual TextKit caret.
        // Never clamp a known caret back to that smaller estimate.
        let extent = allowingEstimatedExtent ? max(scroll.contentSize.height, target.maxY) : scroll.contentSize.height
        let maximum = max(minimum, extent - scroll.bounds.height + scroll.adjustedContentInset.bottom)
        offset = min(maximum, max(minimum, offset))
        if abs(offset - scroll.contentOffset.y) > 0.5 {
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: offset), animated: false)
        }
    }

    func sync(text: String, expanded: Bool) {
        self.expanded = expanded
        if textView.text != text && textView.markedTextRange == nil {
            let selection = textView.selectedRange
            textView.text = text
            textView.selectedRange = NSRange(location: min(selection.location, text.utf16.count), length: 0)
            requestSelectionReveal()
        }
        measure()
    }

    func commitMarkedText() {
        textView.unmarkText()
        onChange?(textView.text)
    }

    @discardableResult func insertText(_ text: String, replacingText: Bool = false) -> String {
        textView.unmarkText()
        if replacingText { textView.selectedRange = NSRange(location: 0, length: textView.text.utf16.count) }
        textView.insertText(text)
        onChange?(textView.text)
        measure()
        return textView.text
    }

    private func measure() {
        guard textView.bounds.width > 1 else { return }
        let fitting = textView.sizeThatFits(CGSize(width: textView.bounds.width, height: .greatestFiniteMagnitude)).height
        let lineHeight = textView.font?.lineHeight ?? 21
        let lines = max(1, Int(ceil(max(lineHeight, fitting - 24) / lineHeight)))
        // At accessibility sizes five lines would cover the action row and
        // keyboard. Keep whole readable lines in a bounded, scrollable editor.
        let visibleLines = max(1, min(5, floor((160 - 24) / lineHeight)))
        let newHeight = max(48, min(fitting, lineHeight * visibleLines + 24))
        let scrolls = expanded || fitting > newHeight + 0.5
        guard abs(height - newHeight) > 0.5 || lineCount != lines || textView.isScrollEnabled != scrolls else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.height = newHeight
            self.lineCount = lines
            self.textView.isScrollEnabled = self.expanded || scrolls
            self.requestSelectionReveal()
        }
    }
}

@MainActor
private final class GrowingTextView: UITextView {
    var onLayout: (() -> Void)?
    override var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: super.intrinsicContentSize.height)
    }
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
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: GrowingTextView, context: Context) -> CGSize? {
        let width = proposal.width.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? 0
        let height = expanded ? proposal.height.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? controller.height : controller.height
        return CGSize(width: width, height: height)
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
        button.accessibilityLabel = isRecording ? String(localized: "Stop recording") : String(localized: "Start voice input")
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
