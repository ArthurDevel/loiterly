import AppKit
import Foundation

final class CompanionInputMonitor {
    private var keyboardMonitor: Any?
    private var pointerMonitor: Any?

    func run() {
        keyboardMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.keyDown, .flagsChanged]) { event in
            if event.type == .flagsChanged {
                return
            }

            print("keyboard")
            fflush(stdout)
        }

        pointerMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [
                .mouseMoved,
                .leftMouseDown,
                .rightMouseDown,
                .otherMouseDown,
                .leftMouseDragged,
                .rightMouseDragged,
                .otherMouseDragged,
                .scrollWheel,
            ]
        ) { _ in
            print("pointer")
            fflush(stdout)
        }

        RunLoop.main.run()
    }
}

let monitor = CompanionInputMonitor()
monitor.run()
