import AppKit
import Carbon.HIToolbox

@MainActor
final class GlobalShortcutMonitor {
    private let doubleTapThreshold: TimeInterval = 0.24
    private let onDoubleLeftShift: @MainActor () -> Void

    private var flagsMonitor: Any?
    private var keyDownMonitor: Any?
    private var firstLeftShiftTapAt: Date?

    init(onDoubleLeftShift: @escaping @MainActor () -> Void) {
        self.onDoubleLeftShift = onDoubleLeftShift
    }

    func start() {
        installMonitorsIfNeeded()
    }

    func stop() {
        if let flagsMonitor {
            NSEvent.removeMonitor(flagsMonitor)
            self.flagsMonitor = nil
        }

        if let keyDownMonitor {
            NSEvent.removeMonitor(keyDownMonitor)
            self.keyDownMonitor = nil
        }

        resetTapSequence()
    }

    private func installMonitorsIfNeeded() {
        if flagsMonitor == nil {
            flagsMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.flagsChanged]) { [weak self] event in
                Task { @MainActor [weak self] in
                    self?.handleFlagsChanged(event)
                }
            }
        }

        if keyDownMonitor == nil {
            keyDownMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown]) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.resetTapSequence()
                }
            }
        }
    }

    private func handleFlagsChanged(_ event: NSEvent) {
        if event.keyCode == UInt16(kVK_Shift) {
            if event.modifierFlags.contains(.shift) {
                handleLeftShiftPress()
            }
            return
        }

        resetTapSequence()
    }

    private func handleLeftShiftPress() {
        let now = Date()

        if let firstLeftShiftTapAt, now.timeIntervalSince(firstLeftShiftTapAt) <= doubleTapThreshold {
            resetTapSequence()
            onDoubleLeftShift()
            return
        }

        firstLeftShiftTapAt = now
    }

    private func resetTapSequence() {
        firstLeftShiftTapAt = nil
    }
}
