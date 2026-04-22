import AppKit
import SwiftUI

@MainActor
final class OverlayWindowController {
    private let size = CGSize(width: 980, height: 680)
    private let cursorOffset = CGPoint(x: 24, y: -24)
    private let browserStore = BrowserStore()

    private lazy var window: OverlayWindow = {
        let window = OverlayWindow(
            contentRect: CGRect(origin: .zero, size: size),
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.ignoresMouseEvents = false
        window.isMovableByWindowBackground = true
        window.level = .statusBar
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        window.contentView = NSHostingView(rootView: OverlayView(browserStore: browserStore))
        return window
    }()

    func showNearCursor() {
        let mouse = NSEvent.mouseLocation
        let proposedOrigin = CGPoint(
            x: mouse.x + cursorOffset.x,
            y: mouse.y - size.height + cursorOffset.y
        )

        window.setFrameOrigin(clampedOrigin(for: proposedOrigin))
        window.alphaValue = 0
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)

        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.12
            window.animator().alphaValue = 1
        }
    }

    func hide() {
        guard window.isVisible else {
            return
        }

        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.1
            window.animator().alphaValue = 0
        }, completionHandler: {
            Task { @MainActor [weak self] in
                self?.window.orderOut(nil)
            }
        })
    }

    private func clampedOrigin(for proposedOrigin: CGPoint) -> CGPoint {
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) ?? NSScreen.main else {
            return proposedOrigin
        }

        let visibleFrame = screen.visibleFrame
        let minX = visibleFrame.minX + 12
        let maxX = visibleFrame.maxX - size.width - 12
        let minY = visibleFrame.minY + 12
        let maxY = visibleFrame.maxY - size.height - 12

        return CGPoint(
            x: min(max(proposedOrigin.x, minX), maxX),
            y: min(max(proposedOrigin.y, minY), maxY)
        )
    }
}
