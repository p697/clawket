import SwiftUI
import WidgetKit

struct ClawketEntry: TimelineEntry { let date: Date }
struct ClawketProvider: TimelineProvider {
  func placeholder(in context: Context) -> ClawketEntry { ClawketEntry(date: .now) }
  func getSnapshot(in context: Context, completion: @escaping (ClawketEntry) -> Void) { completion(placeholder(in: context)) }
  func getTimeline(in context: Context, completion: @escaping (Timeline<ClawketEntry>) -> Void) {
    completion(Timeline(entries: [placeholder(in: context)], policy: .never))
  }
}

// The same simple outline geometry is used by the Android widget.
struct ShortcutGlyph: Shape {
  let action: String
  func path(in rect: CGRect) -> Path {
    var p = Path()
    func line(_ points: [CGPoint]) { p.addLines(points) }
    switch action {
    case "camera":
      line([CGPoint(x: 4, y: 6), CGPoint(x: 7, y: 6), CGPoint(x: 9, y: 3), CGPoint(x: 15, y: 3), CGPoint(x: 17, y: 6), CGPoint(x: 20, y: 6)])
      p.addRoundedRect(in: CGRect(x: 2, y: 6, width: 20, height: 15), cornerSize: CGSize(width: 3, height: 3))
      p.addEllipse(in: CGRect(x: 8, y: 10, width: 8, height: 8))
    case "photos":
      p.addRoundedRect(in: CGRect(x: 3, y: 3, width: 18, height: 18), cornerSize: CGSize(width: 2, height: 2))
      p.addEllipse(in: CGRect(x: 7, y: 7, width: 3, height: 3))
      line([CGPoint(x: 21, y: 15), CGPoint(x: 16, y: 10), CGPoint(x: 5, y: 21)])
    case "voice":
      p.addRoundedRect(in: CGRect(x: 9, y: 2, width: 6, height: 13), cornerSize: CGSize(width: 3, height: 3))
      p.move(to: CGPoint(x: 5, y: 10)); p.addLine(to: CGPoint(x: 5, y: 12))
      p.addCurve(to: CGPoint(x: 19, y: 12), control1: CGPoint(x: 5, y: 21.3), control2: CGPoint(x: 19, y: 21.3))
      p.addLine(to: CGPoint(x: 19, y: 10))
      line([CGPoint(x: 12, y: 19), CGPoint(x: 12, y: 22)])
      line([CGPoint(x: 8, y: 22), CGPoint(x: 16, y: 22)])
    default:
      line([CGPoint(x: 12, y: 3), CGPoint(x: 14.7, y: 9.3), CGPoint(x: 21, y: 12), CGPoint(x: 14.7, y: 14.7), CGPoint(x: 12, y: 21), CGPoint(x: 9.3, y: 14.7), CGPoint(x: 3, y: 12), CGPoint(x: 9.3, y: 9.3), CGPoint(x: 12, y: 3)])
    }
    return p.applying(CGAffineTransform(scaleX: rect.width / 24, y: rect.height / 24))
  }
}

struct ClawketWidgetView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme
  private var small: Bool { family == .systemSmall }
  private var ink: Color { colorScheme == .dark ? .white : Color(white: 0.10) }
  private var paper: Color { colorScheme == .dark ? Color(white: 0.10) : .white }
  private var control: Color { colorScheme == .dark ? Color(white: 0.16) : Color(white: 0.93) }
  private func url(_ action: String) -> URL { URL(string: "clawket://widget?action=\(action)")! }
  private func action(_ route: String, _ label: LocalizedStringKey, diameter: CGFloat) -> some View {
    Link(destination: url(route)) {
      ShortcutGlyph(action: route).stroke(ink, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        .frame(width: diameter * 0.43, height: diameter * 0.43)
        .frame(width: diameter, height: diameter).background(control, in: Circle())
    }.accessibilityLabel(label)
  }
  private var content: some View {
    GeometryReader { geometry in
      let width = max(0, geometry.size.width - (small ? 32 : 40))
      let diameter = min(small ? 54 : 60, max(36, (width - (small ? 12 : 36)) / (small ? 2 : 4)))
      VStack(spacing: 12) {
        Link(destination: url("chat")) {
          HStack(spacing: 10) {
            Image("ClawketMark").resizable().scaledToFit().frame(width: small ? 34 : 38, height: small ? 34 : 38).clipShape(Circle())
            Text("Chat").font(.system(size: 18, weight: .regular)).foregroundStyle(ink.opacity(0.65))
              .lineLimit(1).minimumScaleFactor(0.75)
            Spacer(minLength: 0)
          }.padding(.horizontal, 10).frame(height: small ? 54 : 58).frame(maxWidth: .infinity)
            .background(control, in: Capsule())
        }.accessibilityLabel(Text("Chat"))
        HStack(spacing: 0) {
          if !small {
            action("camera", "Camera", diameter: diameter); Spacer(minLength: 8)
            action("photos", "Photos", diameter: diameter); Spacer(minLength: 8)
          }
          action("voice", "Voice", diameter: diameter); Spacer(minLength: 8)
          action("skills", "Skills", diameter: diameter)
        }
      }.frame(width: width).frame(maxWidth: .infinity, maxHeight: .infinity)
    }.widgetURL(url("chat"))
  }
  var body: some View {
    if #available(iOSApplicationExtension 17.0, *) { content.containerBackground(paper, for: .widget) }
    else { content.background(paper) }
  }
}

@main
struct ClawketWidget: Widget {
  let kind = "ClawketQuickActions"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ClawketProvider()) { _ in ClawketWidgetView() }
      .configurationDisplayName("Clawket")
      .description("Chat, voice and skills.")
      .supportedFamilies([.systemSmall, .systemMedium])
      .contentMarginsDisabled()
  }
}
