import SwiftUI

struct OverlayView: View {
    @ObservedObject var browserStore: BrowserStore

    var body: some View {
        HStack(spacing: 0) {
            appRail
            mainPanel
        }
        .background(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(Color(red: 0.04, green: 0.09, blue: 0.19).opacity(0.96))
        )
        .overlay {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [
                            Color(red: 0.43, green: 0.79, blue: 1.0),
                            Color(red: 0.12, green: 0.47, blue: 1.0),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1.4
                )
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .frame(width: 980, height: 680)
        .shadow(color: Color.blue.opacity(0.22), radius: 26, y: 12)
        .accessibilityLabel("Expanded overlay container")
    }

    private var appRail: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                OverlaySparkle()
                    .fill(.white.opacity(0.95))
                    .frame(width: 10, height: 10)

                Text("Loiterly")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.96))
            }
            .padding(.bottom, 6)

            ForEach(OverlayApp.allCases) { app in
                Button {
                    browserStore.selectedApp = app
                } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: app.systemImage)
                            .font(.system(size: 16, weight: .medium))
                        Text(app.title)
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(browserStore.selectedApp == app ? .white : .white.opacity(0.72))
                    .frame(maxWidth: .infinity, minHeight: 78, alignment: .leading)
                    .padding(.horizontal, 14)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(browserStore.selectedApp == app ? Color(red: 0.12, green: 0.39, blue: 0.96) : Color.white.opacity(0.06))
                    )
                }
                .buttonStyle(.plain)
            }

            Spacer()

            Text("Double left Shift to show or hide")
                .font(.system(size: 11))
                .foregroundStyle(.white.opacity(0.48))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .frame(width: 128)
        .background(Color.white.opacity(0.04))
    }

    private var mainPanel: some View {
        VStack(spacing: 0) {
            toolbar
            Divider().overlay(Color.white.opacity(0.08))

            Group {
                switch browserStore.selectedApp {
                case .browser:
                    BrowserWebView(webView: browserStore.webView)
                case .notes:
                    placeholderCard(
                        title: "Notes tile",
                        body: "This is a placeholder tile for now. The important part is that the overlay window is hidden and reshown instead of recreated, so future tools can keep their state alive."
                    )
                case .links:
                    placeholderCard(
                        title: "Links tile",
                        body: "This can become a pinned links or command launcher area. For now it proves out the left-side app rail pattern."
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color.black.opacity(0.18))
    }

    private var toolbar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                toolbarButton("chevron.left", enabled: browserStore.selectedApp == .browser && browserStore.canGoBack) {
                    browserStore.goBack()
                }
                toolbarButton("chevron.right", enabled: browserStore.selectedApp == .browser && browserStore.canGoForward) {
                    browserStore.goForward()
                }
                toolbarButton("arrow.clockwise", enabled: browserStore.selectedApp == .browser) {
                    browserStore.reload()
                }
            }

            TextField("Enter a URL or search", text: $browserStore.addressText)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .foregroundStyle(.white.opacity(0.96))
                .padding(.horizontal, 14)
                .frame(height: 38)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color.white.opacity(0.08))
                )
                .onSubmit {
                    browserStore.openSelection()
                }

            if browserStore.selectedApp == .browser {
                Text(browserStore.isLoading ? "Loading..." : browserStore.pageTitle)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.56))
                    .lineLimit(1)
            }
        }
        .padding(16)
    }

    private func toolbarButton(_ systemImage: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(enabled ? .white : .white.opacity(0.28))
                .frame(width: 30, height: 30)
                .background(
                    Circle()
                        .fill(Color.white.opacity(enabled ? 0.10 : 0.04))
                )
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private func placeholderCard(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white.opacity(0.95))

            Text(body)
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.7))
                .fixedSize(horizontal: false, vertical: true)

            Spacer()
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.white.opacity(0.03))
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
