#if os(iOS)
import SwiftUI

/// A selectable reading surface without composer, consent or backend actions.
/// Links are explicit system opens; this view never fetches remote content.
public struct NativeReadOnlyMessageText: View {
    private let text: String
    @Environment(\.openURL) private var openURL
    public init(_ text: String) { self.text = text }
    public var body: some View {
        SelectableMessageText(text: text) { url in
            guard let scheme = url.scheme?.lowercased(), ["https", "http", "mailto"].contains(scheme),
                  url.user == nil, url.password == nil else { return }
            openURL(url)
        }
    }
}
#endif
