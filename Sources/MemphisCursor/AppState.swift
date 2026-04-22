import Combine
import SwiftUI

@MainActor
final class AppState: ObservableObject {
    @Published var isCompanionEnabled = true {
        didSet {
            if isCompanionEnabled {
                companionController.start()
            } else {
                companionController.stop()
            }
        }
    }
    @Published var isOverlayExpanded = false {
        didSet {
            if isOverlayExpanded {
                overlayController.showNearCursor()
            } else {
                overlayController.hide()
            }
        }
    }

    private let companionController = CompanionWindowController()
    private let overlayController = OverlayWindowController()
    private var shortcutMonitor: GlobalShortcutMonitor?

    init() {
        companionController.start()
        shortcutMonitor = GlobalShortcutMonitor { [weak self] in
            self?.toggleOverlay()
        }
        shortcutMonitor?.start()
    }

    func toggleOverlay() {
        isOverlayExpanded.toggle()
    }
}
