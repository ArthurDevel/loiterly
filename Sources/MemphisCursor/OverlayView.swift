import SwiftUI

struct OverlayView: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 24, style: .continuous)
            .fill(Color(red: 0.04, green: 0.09, blue: 0.19).opacity(0.68))
            .overlay {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: [
                                Color(red: 0.43, green: 0.79, blue: 1.0),
                                Color(red: 0.12, green: 0.47, blue: 1.0),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1.5
                    )
            }
            .overlay(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        OverlaySparkle()
                            .fill(.white.opacity(0.95))
                            .frame(width: 9, height: 9)

                        Text("Overlay")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.95))
                    }

                    Text("Triggered by double left Shift")
                        .font(.system(size: 11))
                        .foregroundStyle(.white.opacity(0.62))
                }
                .padding(18)
            }
            .overlay(alignment: .center) {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.12), style: StrokeStyle(lineWidth: 1, dash: [6, 6]))
                    .padding(18)
            }
            .frame(width: 320, height: 200)
            .shadow(color: Color.blue.opacity(0.18), radius: 22, y: 10)
            .accessibilityLabel("Expanded overlay container")
    }
}

private struct OverlaySparkle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let center = CGPoint(x: rect.midX, y: rect.midY)

        path.move(to: CGPoint(x: center.x, y: rect.minY))
        path.addLine(to: CGPoint(x: center.x, y: rect.maxY))
        path.move(to: CGPoint(x: rect.minX, y: center.y))
        path.addLine(to: CGPoint(x: rect.maxX, y: center.y))
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.2, y: rect.minY + rect.height * 0.2))
        path.addLine(to: CGPoint(x: rect.maxX - rect.width * 0.2, y: rect.maxY - rect.height * 0.2))
        path.move(to: CGPoint(x: rect.maxX - rect.width * 0.2, y: rect.minY + rect.height * 0.2))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.2, y: rect.maxY - rect.height * 0.2))

        return path.strokedPath(.init(lineWidth: 1.2, lineCap: .round))
    }
}
