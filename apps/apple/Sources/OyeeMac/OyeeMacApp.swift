import AppKit
import OyeeKit
import SwiftUI

/// Oyee for macOS: a menu-bar app (LSUIElement) that keeps a WebSocket open to the Oyee server and turns events
/// into local notifications. The inbox window and Settings are opened from the menu.
@main
struct OyeeMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        MenuBarExtra {
            MenuBarContentView(model: appDelegate.model, updater: appDelegate.updater)
                .tint(Theme.brand)
        } label: {
            MenuBarLabel(model: appDelegate.model)
        }
        .menuBarExtraStyle(.window)

        Window("Oyee", id: WindowID.inbox) {
            InboxWindowView(model: appDelegate.model)
                .tint(Theme.brand)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 980, height: 660)

        Settings {
            SettingsView(model: appDelegate.model, updater: appDelegate.updater)
                .tint(Theme.brand)
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
    let updater = Updater()
    let model = OyeeModel(
        configuration: .init(
            platform: .macos,
            deviceName: Host.current().localizedName ?? "Mac",
            enableSystemNotifications: NotificationPresenter.isSupported))

    func applicationWillFinishLaunching(_ notification: Notification) {
        OyeeFonts.register()
        // Handle oyee:// URLs ourselves: an LSUIElement app often has no window for SwiftUI's onOpenURL.
        NSAppleEventManager.shared().setEventHandler(
            self, andSelector: #selector(handleGetURL(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        model.start()
        updater.start()
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
