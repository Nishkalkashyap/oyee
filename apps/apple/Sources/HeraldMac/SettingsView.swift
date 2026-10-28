import AppKit
import HeraldKit
import ServiceManagement
import SwiftUI
import UserNotifications

struct SettingsView: View {
    let model: HeraldModel
    @Environment(\.openWindow) private var openWindow
    @ViewState private var launchAtLogin = LaunchAtLogin.isEnabled
    @ViewState private var launchStatus = LaunchAtLogin.statusText
    @ViewState private var confirmUnpair = false

    var body: some View {
        Form {
            Section("Server") {
                if let credentials = model.credentials {
                    LabeledContent("Server", value: credentials.serverURL.absoluteString)
                    if let email = credentials.userEmail { LabeledContent("Account", value: email) }
                    LabeledContent("Device", value: credentials.deviceName ?? model.configuration.deviceName)
                    LabeledContent("Connection") {
                        HStack(spacing: 6) {
                            ConnectionStatusDot(state: model.connectionState)
                            Text(model.connectionState.label)
                        }
                    }
                    HStack {
                        Button("Reconnect") { model.reconnect() }
                        Spacer()
                        Button("Unpair this Mac…", role: .destructive) { confirmUnpair = true }
                    }
                } else {
                    LabeledContent("Status", value: "Not paired")
                    Button("Pair…") { showInboxWindow(openWindow) }
                }
            }

            Section("General") {
                Toggle("Launch at login", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { _, enabled in
                        LaunchAtLogin.set(enabled)
                        launchAtLogin = LaunchAtLogin.isEnabled
                        launchStatus = LaunchAtLogin.statusText
                    }
                if let launchStatus {
                    Text(launchStatus).font(.caption).foregroundStyle(.secondary)
                }
            }

            Section("Notifications") {
                LabeledContent("Permission", value: permissionText)
                HStack {
                    if model.notificationAuthorization == .notDetermined {
                        Button("Allow notifications") { Task { await model.requestNotificationPermission() } }
                    }
                    Button("Open System Settings") {
                        if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
                            NSWorkspace.shared.open(url)
                        }
                    }
                    Spacer()
                    Button("Send test notification") { model.presenter?.sendTestNotification() }
                        .disabled(model.presenter == nil)
                }
                if model.presenter == nil {
                    Text("System notifications need the bundled Herald.app (scripts/build-macos-app.sh).")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section("About") {
                LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? HeraldKitInfo.version)
                Text("Herald delivers to this Mac over a WebSocket (no APNs). Keep the app running, ideally with Launch at login, to receive notifications.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(width: 480)
        .fixedSize(horizontal: false, vertical: true)
        .task { await model.refreshNotificationAuthorization() }
        .confirmationDialog("Unpair this Mac?", isPresented: $confirmUnpair) {
            Button("Unpair", role: .destructive) { Task { await model.unpair() } }
        } message: {
            Text("It stops receiving notifications until you pair it again.")
        }
    }

    private var permissionText: String {
        switch model.notificationAuthorization {
        case .authorized: "Allowed"
        case .provisional: "Provisional"
        case .denied: "Denied (enable in System Settings)"
        case .notDetermined: "Not requested"
        case .ephemeral: "Ephemeral"
        @unknown default: "Unknown"
        }
    }
}

/// Launch at login via `SMAppService.mainApp` (macOS 13+).
@MainActor
enum LaunchAtLogin {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }

    static var statusText: String? {
        switch SMAppService.mainApp.status {
        case .requiresApproval: "Approve Herald in System Settings → General → Login Items."
        case .notFound: "Move Herald.app to /Applications to enable this."
        default: nil
        }
    }

    static func set(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            NSLog("Herald: launch at login change failed: \(error)")
        }
    }
}
