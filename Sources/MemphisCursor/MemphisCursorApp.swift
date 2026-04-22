import SwiftUI

@main
struct MemphisCursorApp: App {
    @StateObject private var appState = AppState()

    init() {
        NSApplication.shared.setActivationPolicy(.accessory)
    }

    var body: some Scene {
        MenuBarExtra("Loiterly", systemImage: "sparkles") {
            VStack(alignment: .leading, spacing: 10) {
                Toggle("Companion Enabled", isOn: $appState.isCompanionEnabled)
                Toggle("Overlay Expanded", isOn: $appState.isOverlayExpanded)

                Text("Shortcut: double left Shift")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Divider()

                Text("A simple cursor companion prototype.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Button("Quit") {
                    NSApplication.shared.terminate(nil)
                }
                .keyboardShortcut("q")
            }
            .padding(12)
            .frame(width: 220)
        }
        .menuBarExtraStyle(.window)
    }
}
