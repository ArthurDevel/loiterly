import AppKit
import Carbon.HIToolbox

@MainActor
final class GlobalShortcutMonitor {
    private let doubleTapThreshold: TimeInterval = 0.24
    private let onDoubleLeftShift: @MainActor () -> Void

    private var globalFlagsMonitor: Any?
    private var localFlagsMonitor: Any?
    private var globalKeyDownMonitor: Any?
    private var localKeyDownMonitor: Any?
    private var firstLeftShiftTapAt: Date?

    init(onDoubleLeftShift: @escaping @MainActor () -> Void) {
        self.onDoubleLeftShift = onDoubleLeftShift
    }

    func start() {
        installMonitorsIfNeeded()
    }

    func stop() {
        if let globalFlagsMonitor {
            NSEvent.removeMonitor(globalFlagsMonitor)
            self.globalFlagsMonitor = nil
        }

        if let localFlagsMonitor {
            NSEvent.removeMonitor(localFlagsMonitor)
            self.localFlagsMonitor = nil
        }

        if let globalKeyDownMonitor {
            NSEvent.removeMonitor(globalKeyDownMonitor)
            self.globalKeyDownMonitor = nil
        }

        if let localKeyDownMonitor {
            NSEvent.removeMonitor(localKeyDownMonitor)
            self.localKeyDownMonitor = nil
        }

        resetTapSequence()
    }

    private func installMonitorsIfNeeded() {
        if globalFlagsMonitor == nil {
            globalFlagsMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.flagsChanged]) { [weak self] event in
                Task { @MainActor [weak self] in
                    self?.handleFlagsChanged(event)
                }
            }
        }

        if localFlagsMonitor == nil {
            localFlagsMonitor = NSEvent.addLocalMonitorForEvents(matching: [.flagsChanged]) { [weak self] event in
                self?.handleFlagsChanged(event)
                return event
            }
        }

        if globalKeyDownMonitor == nil {
            globalKeyDownMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown]) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.resetTapSequence()
                }
            }
        }

        if localKeyDownMonitor == nil {
            localKeyDownMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown]) { [weak self] event in
                self?.resetTapSequence()
                return event
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
