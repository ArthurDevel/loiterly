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
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.99, green: 0.99, blue: 1.0).opacity(0.9),
                            Color(red: 0.95, green: 0.97, blue: 0.99).opacity(0.78),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        )
        .overlay {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.92),
                            Color(red: 0.71, green: 0.78, blue: 0.89).opacity(0.55),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1.1
                )
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .frame(width: 980, height: 680)
        .shadow(color: Color(red: 0.38, green: 0.45, blue: 0.57).opacity(0.18), radius: 26, y: 12)
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
                    .foregroundStyle(Color(red: 0.09, green: 0.13, blue: 0.19))
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
                    .foregroundStyle(
                        browserStore.selectedApp == app
                            ? Color(red: 0.09, green: 0.13, blue: 0.19)
                            : Color(red: 0.38, green: 0.44, blue: 0.53)
                    )
                    .frame(maxWidth: .infinity, minHeight: 78, alignment: .leading)
                    .padding(.horizontal, 14)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(
                                browserStore.selectedApp == app
                                    ? Color.white.opacity(0.8)
                                    : Color.white.opacity(0.24)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .stroke(Color.white.opacity(browserStore.selectedApp == app ? 0.85 : 0.35), lineWidth: 1)
                            )
                    )
                    .shadow(
                        color: browserStore.selectedApp == app
                            ? Color(red: 0.38, green: 0.45, blue: 0.57).opacity(0.12)
                            : .clear,
                        radius: 14,
                        y: 8
                    )
                }
                .buttonStyle(.plain)
            }

            Spacer()

            VStack(alignment: .leading, spacing: 10) {
                Text("Open / Close")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Color(red: 0.4, green: 0.46, blue: 0.56))
                    .textCase(.uppercase)

                HStack(spacing: 4) {
                    shortcutKey("⌘")
                    shortcutKey("⇧")
                    shortcutKey("L")
                }
            }
        }
        .padding(18)
        .frame(width: 128)
        .background(
            LinearGradient(
                colors: [
                    Color.white.opacity(0.42),
                    Color(red: 0.96, green: 0.97, blue: 0.99).opacity(0.24),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    private var mainPanel: some View {
        VStack(spacing: 0) {
            toolbar
            Divider().overlay(Color(red: 0.78, green: 0.82, blue: 0.88).opacity(0.55))

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
        .background(Color.white.opacity(0.18))
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
                .foregroundStyle(Color(red: 0.09, green: 0.13, blue: 0.19))
                .padding(.horizontal, 14)
                .frame(height: 38)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color.white.opacity(0.72))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(Color(red: 0.79, green: 0.83, blue: 0.89).opacity(0.45), lineWidth: 1)
                        )
                )
                .onSubmit {
                    browserStore.openSelection()
                }

            if browserStore.selectedApp == .browser {
                Text(browserStore.isLoading ? "Loading..." : browserStore.pageTitle)
                    .font(.system(size: 12))
                    .foregroundStyle(Color(red: 0.4, green: 0.46, blue: 0.56))
                    .lineLimit(1)
            }
        }
        .padding(16)
    }

    private func toolbarButton(_ systemImage: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(
                    enabled
                        ? Color(red: 0.09, green: 0.13, blue: 0.19)
                        : Color(red: 0.62, green: 0.67, blue: 0.74)
                )
                .frame(width: 30, height: 30)
                .background(
                    Circle()
                        .fill(Color.white.opacity(enabled ? 0.72 : 0.34))
                        .overlay(
                            Circle()
                                .stroke(Color.white.opacity(enabled ? 0.88 : 0.54), lineWidth: 1)
                        )
                )
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private func shortcutKey(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color(red: 0.27, green: 0.33, blue: 0.41))
            .frame(minWidth: 22, minHeight: 24)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color.white.opacity(0.72))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(Color(red: 0.79, green: 0.83, blue: 0.89).opacity(0.5), lineWidth: 1)
                    )
            )
    }

    private func placeholderCard(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Color(red: 0.09, green: 0.13, blue: 0.19))

            Text(body)
                .font(.system(size: 14))
                .foregroundStyle(Color(red: 0.38, green: 0.44, blue: 0.53))
                .fixedSize(horizontal: false, vertical: true)

            Spacer()
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color.white.opacity(0.56))
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .stroke(Color.white.opacity(0.82), lineWidth: 1)
                )
        )
        .padding(16)
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
