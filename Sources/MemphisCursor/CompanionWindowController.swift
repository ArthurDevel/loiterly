import AppKit
import SwiftUI

@MainActor
final class CompanionWindowController {
    private let size = CGSize(width: 20, height: 20)
    private let offset = CGPoint(x: 10, y: -14)

    private lazy var window: NSWindow = {
        let frame = CGRect(origin: .zero, size: size)
        let window = NSWindow(
            contentRect: frame,
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.ignoresMouseEvents = true
        window.level = .statusBar
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        window.contentView = NSHostingView(rootView: CompanionView())
        return window
    }()

    private var timer: Timer?
    private var currentPosition = CGPoint.zero
    private var isInitialized = false
    private var isCompanionVisible = false
    private var isSuppressedForTyping = false
    private var globalKeyMonitor: Any?
    private var globalMouseMonitor: Any?

    func start() {
        installEventMonitorsIfNeeded()

        if timer == nil {
            timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.tick()
                }
            }
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        removeEventMonitors()
        window.orderOut(nil)
        isCompanionVisible = false
    }

    private func tick() {
        if isSuppressedForTyping {
            if isCompanionVisible {
                window.orderOut(nil)
                isCompanionVisible = false
            }
            return
        }

        if !isCompanionVisible {
            window.orderFrontRegardless()
            isCompanionVisible = true
        }

        let mouse = NSEvent.mouseLocation
        let target = CGPoint(
            x: mouse.x + offset.x,
            y: mouse.y + offset.y
        )

        if !isInitialized {
            currentPosition = target
            isInitialized = true
        } else {
            currentPosition.x += (target.x - currentPosition.x) * 0.22
            currentPosition.y += (target.y - currentPosition.y) * 0.22
        }

        window.setFrameOrigin(currentPosition)
    }

    private func installEventMonitorsIfNeeded() {
        if globalKeyMonitor == nil {
            globalKeyMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown]) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.isSuppressedForTyping = true
                }
            }
        }

        if globalMouseMonitor == nil {
            globalMouseMonitor = NSEvent.addGlobalMonitorForEvents(
                matching: [.mouseMoved, .leftMouseDown, .rightMouseDown, .otherMouseDown, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel]
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.isSuppressedForTyping = false
                }
            }
        }
    }

    private func removeEventMonitors() {
        if let globalKeyMonitor {
            NSEvent.removeMonitor(globalKeyMonitor)
            self.globalKeyMonitor = nil
        }

        if let globalMouseMonitor {
            NSEvent.removeMonitor(globalMouseMonitor)
            self.globalMouseMonitor = nil
        }
    }
}
