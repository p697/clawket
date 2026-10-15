#if os(iOS)
import SwiftUI
import UIKit

/// A real native control owns its complete 44-point hit and accessibility frame.
/// This is used for compact voice actions, where an outer SwiftUI frame can leave
/// a text-only accessibility target smaller than the visible row.
@MainActor
public struct NativeTextActionButton: UIViewRepresentable {
    private let title: String
    private let identifier: String
    private let destructive: Bool
    private let action: @MainActor () -> Void
    @Environment(\.isEnabled) private var enabled
    public init(_ title: String, accessibilityIdentifier: String, destructive: Bool = false,
                action: @escaping @MainActor () -> Void) {
        self.title = title; self.identifier = accessibilityIdentifier; self.destructive = destructive; self.action = action
    }
    public func makeCoordinator() -> Coordinator { Coordinator(action: action) }
    public func makeUIView(context: Context) -> UIButton {
        let button = MinimumActionButton(type: .system)
        button.isAccessibilityElement = true
        button.accessibilityTraits = .button
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.titleLabel?.numberOfLines = 0
        button.addTarget(context.coordinator, action: #selector(Coordinator.activate), for: .touchUpInside)
        updateUIView(button, context: context)
        return button
    }
    public func updateUIView(_ button: UIButton, context: Context) {
        context.coordinator.action = action
        var configuration = UIButton.Configuration.plain()
        configuration.title = title
        configuration.titleAlignment = .center
        configuration.titleLineBreakMode = .byWordWrapping
        configuration.contentInsets = .init(top: 0, leading: 8, bottom: 0, trailing: 8)
        if destructive { configuration.baseForegroundColor = .systemRed }
        configuration.titleTextAttributesTransformer = .init { attributes in
            var result = attributes; result.font = .preferredFont(forTextStyle: .body); return result
        }
        button.configuration = configuration
        button.isEnabled = enabled
        button.accessibilityTraits = enabled ? .button : [.button, .notEnabled]
        button.accessibilityIdentifier = identifier
        button.accessibilityLabel = title
        button.invalidateIntrinsicContentSize()
    }
    public func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIButton, context: Context) -> CGSize? {
        let proposed = proposal.width.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? .greatestFiniteMagnitude
        let fitted = uiView.sizeThatFits(CGSize(width: proposed, height: .greatestFiniteMagnitude))
        return CGSize(width: max(44, min(proposed, fitted.width)), height: max(44, fitted.height))
    }
    @MainActor public final class Coordinator: NSObject {
        fileprivate var action: @MainActor () -> Void
        fileprivate init(action: @escaping @MainActor () -> Void) { self.action = action }
        @objc fileprivate func activate() { action() }
    }
}

@MainActor
private final class MinimumActionButton: UIButton {
    override var intrinsicContentSize: CGSize {
        let value = super.intrinsicContentSize
        return CGSize(width: max(44, value.width), height: max(44, value.height))
    }
}
#endif
