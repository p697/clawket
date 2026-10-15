#if os(iOS)
import SwiftUI
import UIKit

/// A real TextKit reading surface keeps partial selection, edit menus, links,
/// VoiceOver text navigation and Speak Screen available on the iOS 16.4 baseline.
@MainActor
struct SelectableMessageText: UIViewRepresentable {
    let text: String
    var monospaced = false
    var fontSize: Int = 17
    let onURL: (URL) -> Void
    var onReadingInteraction: () -> Void = {}

    func makeCoordinator() -> Coordinator { Coordinator(onURL: onURL) }

    func makeUIView(context: Context) -> UITextView {
        let view = ReadingTextView()
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.delegate = context.coordinator
        view.linkTextAttributes = [.foregroundColor: UIColor.systemBlue]
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        updateUIView(view, context: context)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.onURL = onURL
        context.coordinator.onReadingInteraction = onReadingInteraction
        (view as? ReadingTextView)?.onReadingInteraction = onReadingInteraction
        let category = view.traitCollection.preferredContentSizeCategory
        guard context.coordinator.text != text || context.coordinator.category != category || context.coordinator.monospaced != monospaced || context.coordinator.fontSize != fontSize else { return }
        let selection = view.selectedRange
        context.coordinator.text = text
        context.coordinator.category = category
        context.coordinator.monospaced = monospaced
        context.coordinator.fontSize = fontSize
        view.attributedText = NativeMarkdownFormatter.format(text, monospaced: monospaced, fontSize: fontSize, traits: view.traitCollection)
        let length = view.attributedText.length
        let location = min(selection.location, length)
        view.selectedRange = NSRange(location: location, length: min(selection.length, length - location))
        view.invalidateIntrinsicContentSize()
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        // An unspecified proposal asks for an ideal width. A text view's natural
        // single-line width must not become the minimum width of a chat bubble.
        guard let width = proposal.width, width.isFinite, width > 0 else { return .zero }
        let size = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: ceil(size.height))
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate {
        var text: String?
        var category: UIContentSizeCategory?
        var monospaced = false
        var fontSize: Int?
        var onURL: (URL) -> Void
        var onReadingInteraction: () -> Void = {}
        init(onURL: @escaping (URL) -> Void) { self.onURL = onURL }
        func textViewDidChangeSelection(_ textView: UITextView) {
            if textView.selectedRange.length > 0 { onReadingInteraction() }
        }
        func textView(_ textView: UITextView, shouldInteractWith URL: URL, in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool {
            onURL(URL)
            return false
        }
    }
}

@MainActor
private final class ReadingTextView: UITextView {
    var onReadingInteraction: (() -> Void)?
    override var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: super.intrinsicContentSize.height)
    }
    override func accessibilityElementDidBecomeFocused() {
        super.accessibilityElementDidBecomeFocused()
        onReadingInteraction?()
    }
}

@MainActor
private enum NativeMarkdownFormatter {
    static func format(_ raw: String, monospaced: Bool, fontSize: Int, traits: UITraitCollection) -> NSAttributedString {
        let result = NSMutableAttributedString(string: "")
        let lines = raw.components(separatedBy: "\n")
        var inCode = monospaced
        for (index, line) in lines.enumerated() {
            if !monospaced && (line.hasPrefix("```") || line.hasPrefix("~~~")) {
                inCode.toggle()
                continue
            }
            var text = line
            var headingLevel = 0
            if !inCode {
                let prefix = line.prefix(while: { $0 == "#" }).count
                if prefix > 0 && prefix <= 6 && line.dropFirst(prefix).hasPrefix(" ") {
                    headingLevel = prefix
                    text = String(line.dropFirst(prefix + 1))
                } else if line.hasPrefix("- ") || line.hasPrefix("* ") {
                    text = "• " + line.dropFirst(2)
                }
            }
            let style = NSMutableParagraphStyle()
            style.lineHeightMultiple = inCode ? 1.05 : 1.12
            style.paragraphSpacing = inCode ? 2 : headingLevel > 0 ? 8 : 5
            let baseFont = font(headingLevel: headingLevel, code: inCode, size: fontSize, traits: traits)
            if inCode {
                result.append(NSAttributedString(string: text, attributes: [.font: baseFont, .foregroundColor: UIColor.label, .paragraphStyle: style]))
            } else if let attributed = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
                for run in attributed.runs {
                    let intent = run.inlinePresentationIntent ?? []
                    var runFont = intent.contains(.code) ? font(headingLevel: 0, code: true, size: fontSize, traits: traits) : baseFont
                    var traits = runFont.fontDescriptor.symbolicTraits
                    if intent.contains(.stronglyEmphasized) { traits.insert(.traitBold) }
                    if intent.contains(.emphasized) { traits.insert(.traitItalic) }
                    if let descriptor = runFont.fontDescriptor.withSymbolicTraits(traits) { runFont = UIFont(descriptor: descriptor, size: 0) }
                    var attributes: [NSAttributedString.Key: Any] = [.font: runFont, .foregroundColor: UIColor.label, .paragraphStyle: style]
                    if let link = run.link { attributes[.link] = link }
                    if intent.contains(.strikethrough) { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
                    if intent.contains(.code) { attributes[.backgroundColor] = UIColor.secondarySystemBackground }
                    result.append(NSAttributedString(string: String(attributed[run.range].characters), attributes: attributes))
                }
            } else {
                result.append(NSAttributedString(string: text, attributes: [.font: baseFont, .foregroundColor: UIColor.label, .paragraphStyle: style]))
            }
            if index < lines.count - 1 { result.append(NSAttributedString(string: "\n", attributes: [.font: baseFont, .paragraphStyle: style])) }
        }
        return result
    }

    private static func font(headingLevel: Int, code: Bool, size: Int, traits: UITraitCollection) -> UIFont {
        let base = CGFloat((12...20).contains(size) ? size : 17)
        let pointSize = code ? base * 0.88 : headingLevel == 1 ? base * 1.3 : headingLevel == 2 ? base * 1.18 : base
        let unscaled = code ? UIFont.monospacedSystemFont(ofSize: pointSize, weight: .regular)
            : UIFont.systemFont(ofSize: pointSize, weight: headingLevel > 0 ? .semibold : .regular)
        return UIFontMetrics(forTextStyle: .body).scaledFont(for: unscaled, compatibleWith: traits)
    }
}
#endif
