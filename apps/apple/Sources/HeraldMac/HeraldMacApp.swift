import AppKit
import HeraldKit
import SwiftUI

/// Herald for macOS: a menu-bar app (LSUIElement) that keeps a WebSocket open to the Herald server and turns events
/// into local notifications. The inbox window and Settings are opened from the menu.
@main
struct HeraldMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        MenuBarExtra {
            MenuBarContentView(model: appDelegate.model)
        } label: {
            MenuBarLabel(model: appDelegate.model)
        }
        .menuBarExtraStyle(.window)

        Window("Herald", id: WindowID.inbox) {
            InboxWindowView(model: appDelegate.model)
        }
        .defaultSize(width: 960, height: 640)

        Settings {
            SettingsView(model: appDelegate.model)
        }
    }
}

enum WindowID {
    static let inbox = "inbox"
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    /// Created when the delegate is (before launch finishes), so the notification delegate is installed in time to
    /// receive the response that launched the app.
    let model = HeraldModel(
        configuration: .init(
            platform: .macos,
            deviceName: Host.current().localizedName ?? "Mac",
            enableSystemNotifications: NotificationPresenter.isSupported))

    func applicationWillFinishLaunching(_ notification: Notification) {
        // Handle herald:// URLs ourselves: an LSUIElement app often has no window for SwiftUI's onOpenURL.
        NSAppleEventManager.shared().setEventHandler(
            self, andSelector: #selector(handleGetURL(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        model.start()
        if model.isPaired {
            // The socket is the delivery transport, so it stays connected for the app's whole lifetime.
            model.connect()
            Task { await model.requestNotificationPermission() }
        }
        // When unpaired, MenuBarLabel opens the inbox window (which shows pairing) as soon as it appears.
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationWillTerminate(_ notification: Notification) {
        model.store.saveNow()
    }

    @objc private func handleGetURL(_ event: NSAppleEventDescriptor, withReplyEvent reply: NSAppleEventDescriptor) {
        guard let string = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
              let url = URL(string: string)
        else { return }
        model.handleOpenURL(url)
    }
}

/// Brings the (accessory) app forward and opens the inbox window.
@MainActor
func showInboxWindow(_ openWindow: OpenWindowAction) {
    openWindow(id: WindowID.inbox)
    NSApp.activate()
}
