import SwiftUI

struct CompanionView: View {
    var body: some View {
        ZStack {
            Triangle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.54, green: 0.73, blue: 1.0),
                            Color(red: 0.29, green: 0.52, blue: 0.96),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay {
                    Triangle()
                        .stroke(Color.white.opacity(0.84), lineWidth: 1)
                }

            Sparkle()
                .fill(.white.opacity(0.95))
                .frame(width: 6, height: 6)
                .offset(x: 4, y: -5)
        }
        .frame(width: 20, height: 20)
        .shadow(color: Color(red: 0.29, green: 0.52, blue: 0.96).opacity(0.2), radius: 6, y: 3)
        .accessibilityLabel("Cursor companion")
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.12, y: rect.minY + rect.height * 0.08))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.78, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.24, y: rect.maxY - rect.height * 0.08))
        path.closeSubpath()
        return path
    }
}

private struct Sparkle: Shape {
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
