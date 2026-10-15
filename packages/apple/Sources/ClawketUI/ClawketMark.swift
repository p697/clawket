#if os(iOS)
import SwiftUI

/// The approved companion geometry from apps/mobile/src/brand/companion.json.
/// Elliptical SVG quarter-arcs are represented with their cubic Bézier equivalent.
public struct ClawketMark: View {
    public init() {}
    public var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                CompanionSilhouette().fill(.foreground)
                eye(x: 24.44, in: geometry.size)
                eye(x: 57.8288, in: geometry.size)
            }
        }
        .aspectRatio(94 / 88, contentMode: .fit)
        .accessibilityHidden(true)
    }

    private func eye(x: CGFloat, in size: CGSize) -> some View {
        Capsule()
            .fill(Color(uiColor: .systemBackground))
            .frame(width: size.width * 11.7312 / 94, height: size.height * 20.24 / 88)
            .offset(x: size.width * x / 94, y: size.height * 39.6 / 88)
    }
}

private struct CompanionSilhouette: Shape {
    func path(in rect: CGRect) -> Path {
        var face = Path()
        face.move(to: CGPoint(x: 41.3412, y: 22))
        face.addLine(to: CGPoint(x: 52.6588, y: 22))
        corner(&face, via: CGPoint(x: 87.42, y: 22), to: CGPoint(x: 87.42, y: 48.8664))
        face.addLine(to: CGPoint(x: 87.42, y: 59.488))
        corner(&face, via: CGPoint(x: 87.42, y: 84.48), to: CGPoint(x: 55.084, y: 84.48))
        face.addLine(to: CGPoint(x: 38.916, y: 84.48))
        corner(&face, via: CGPoint(x: 6.58, y: 84.48), to: CGPoint(x: 6.58, y: 59.488))
        face.addLine(to: CGPoint(x: 6.58, y: 48.8664))
        corner(&face, via: CGPoint(x: 6.58, y: 22), to: CGPoint(x: 41.3412, y: 22))
        face.closeSubpath()

        var left = Path()
        left.move(to: CGPoint(x: 12.9532, y: 7.92))
        left.addLine(to: CGPoint(x: 14.476, y: 7.92))
        corner(&left, via: CGPoint(x: 34.78, y: 7.92), to: CGPoint(x: 34.78, y: 42.416))
        left.addLine(to: CGPoint(x: 34.78, y: 45.8656))
        corner(&left, via: CGPoint(x: 34.78, y: 51.04), to: CGPoint(x: 31.7344, y: 51.04))
        left.addLine(to: CGPoint(x: 14.476, y: 51.04))
        corner(&left, via: CGPoint(x: 9.4, y: 51.04), to: CGPoint(x: 9.4, y: 42.416))
        left.addLine(to: CGPoint(x: 9.4, y: 13.9568))
        corner(&left, via: CGPoint(x: 9.4, y: 7.92), to: CGPoint(x: 12.9532, y: 7.92))
        left.closeSubpath()

        var right = Path()
        right.move(to: CGPoint(x: 79.524, y: 13.2))
        right.addLine(to: CGPoint(x: 81.0468, y: 13.2))
        corner(&right, via: CGPoint(x: 84.6, y: 13.2), to: CGPoint(x: 84.6, y: 18.4976))
        right.addLine(to: CGPoint(x: 84.6, y: 43.472))
        corner(&right, via: CGPoint(x: 84.6, y: 51.04), to: CGPoint(x: 79.524, y: 51.04))
        right.addLine(to: CGPoint(x: 62.2656, y: 51.04))
        corner(&right, via: CGPoint(x: 59.22, y: 51.04), to: CGPoint(x: 59.22, y: 46.4992))
        right.addLine(to: CGPoint(x: 59.22, y: 43.472))
        corner(&right, via: CGPoint(x: 59.22, y: 13.2), to: CGPoint(x: 79.524, y: 13.2))
        right.closeSubpath()

        face.addPath(left, transform: rotation(-13, around: CGPoint(x: 22.09, y: 29.48)))
        face.addPath(right, transform: rotation(13, around: CGPoint(x: 71.91, y: 32.12)))
        return face.applying(CGAffineTransform(scaleX: rect.width / 94, y: rect.height / 88))
    }

    private func corner(_ path: inout Path, via corner: CGPoint, to end: CGPoint) {
        guard let start = path.currentPoint else { return }
        let k: CGFloat = 0.5522847498307936
        path.addCurve(to: end,
                      control1: CGPoint(x: start.x + (corner.x - start.x) * k, y: start.y + (corner.y - start.y) * k),
                      control2: CGPoint(x: end.x + (corner.x - end.x) * k, y: end.y + (corner.y - end.y) * k))
    }

    private func rotation(_ degrees: CGFloat, around center: CGPoint) -> CGAffineTransform {
        CGAffineTransform(translationX: center.x, y: center.y)
            .rotated(by: degrees * .pi / 180).translatedBy(x: -center.x, y: -center.y)
    }
}
#endif
