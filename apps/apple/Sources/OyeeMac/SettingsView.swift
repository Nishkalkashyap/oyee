import AppKit
import OyeeKit
import ServiceManagement
import SwiftUI
import UserNotifications

struct SettingsView: View {
    let model: OyeeModel
    @Bindable var updater: Updater
    @Environment(\.openWindow) private var openWindow
    @ViewState private var launchAtLogin = LaunchAtLogin.isEnabled
    @ViewState private var launchStatus = LaunchAtLogin.statusText
    @ViewState private var confirmUnpair = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("Settings").font(.oyee(24, .bold)).foregroundStyle(Theme.foreground)
                Text("This Mac and how Oyee reaches it.")
                    .font(.oyee(13.5))
                    .foregroundStyle(Theme.muted)
                    .padding(.top, 2)

                accountCard.padding(.top, 18)

                heading("General")
                Toggle(isOn: $launchAtLogin) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Launch at login").font(.oyee(14.5, .semibold)).foregroundStyle(Theme.foreground)
                        Text(launchStatus ?? "Keeps the live connection up, so notifications always arrive.")
                            .font(.oyee(12.5))
                            .foregroundStyle(Theme.muted)
                    }
                }
                .toggleStyle(OyeeToggleStyle())
                .padding(.vertical, 12)
                .onChange(of: launchAtLogin) { _, enabled in
                    LaunchAtLogin.set(enabled)
                    launchAtLogin = LaunchAtLogin.isEnabled
                    launchStatus = LaunchAtLogin.statusText
                }

                heading("Notifications")
                SettingRow("Permission", description: permissionText) {
                    if model.notificationAuthorization == .notDetermined {
                        Button("Allow") { Task { await model.requestNotificationPermission() } }
                            .buttonStyle(PillButtonStyle(.brand, size: .small))
                    } else {
                        statusDot(model.notificationAuthorization == .authorized)
                    }
                }
                SettingRow("System settings", description: "Banner style, sound and Focus for Oyee.") {
                    Button("Open") {
                        if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
                            NSWorkspace.shared.open(url)
                        }
                    }
                    .buttonStyle(PillButtonStyle(.secondary, size: .small))
                }
                SettingRow(
                    "Test notification",
                    description: model.presenter == nil
                        ? "Needs the bundled Oyee.app (scripts/build-macos-app.sh)."
                        : "Shows a local notification on this Mac.",
                    last: true
                ) {
                    Button("Send") { model.presenter?.sendTestNotification() }
                        .buttonStyle(PillButtonStyle(.secondary, size: .small))
                        .disabled(model.presenter == nil)
                }

                heading("Updates")
                SettingRow("Oyee \(updater.currentVersion)", description: updater.statusText) {
                    switch updater.state {
                    case .available:
                        Button("Update") { Task { await updater.install() } }
                            .buttonStyle(PillButtonStyle(.brand, size: .small))
                    case .checking, .downloading, .installing:
                        ProgressView().controlSize(.small)
                    default:
                        if updater.enabled {
                            Button("Check") { Task { await updater.check(installIfAuto: updater.autoInstall) } }
                                .buttonStyle(PillButtonStyle(.secondary, size: .small))
                        }
                    }
                }
                if updater.enabled {
                    Toggle(isOn: $updater.autoInstall) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Install updates automatically").font(.oyee(14.5, .semibold)).foregroundStyle(Theme.foreground)
                            Text("Downloads, verifies and restarts Oyee in the background.")
                                .font(.oyee(12.5))
                                .foregroundStyle(Theme.muted)
                        }
                    }
                    .toggleStyle(OyeeToggleStyle())
                    .padding(.vertical, 12)
                }

                heading("About")
                SettingRow(
                    "Version",
                    description: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? OyeeKitInfo.version)
                SettingRow(
                    "Delivery",
                    description: "Oyee reaches this Mac over a live connection (no APNs). Keep the app running, ideally with Launch at login.",
                    last: true)
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 24)
        }
        .frame(width: 500, height: 620)
        .background(Theme.background)
        .task { await model.refreshNotificationAuthorization() }
        .confirmationDialog("Unpair this Mac?", isPresented: $confirmUnpair) {
            Button("Unpair", role: .destructive) { Task { await model.unpair() } }
        } message: {
            Text("It stops receiving notifications until you pair it again.")
        }
    }

    /// Account, server and connection, with reconnect / unpair.
    @ViewBuilder
    private var accountCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let credentials = model.credentials {
                HStack(spacing: 12) {
                    SourceAvatar(name: credentials.userEmail ?? credentials.serverURL.host() ?? "Oyee", size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(credentials.userEmail ?? "Signed in").font(.oyee(15, .semibold)).foregroundStyle(Theme.foreground)
                        Text(credentials.serverURL.host() ?? credentials.serverURL.absoluteString)
                            .font(.oyee(12.5))
                            .foregroundStyle(Theme.muted)
                        Text("This Mac: \(credentials.deviceName ?? model.configuration.deviceName)")
                            .font(.oyee(12.5))
                            .foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    HStack(spacing: 5) {
                        ConnectionStatusDot(state: model.connectionState)
                        Text(model.connectionState.label).font(.oyee(12, .semibold))
                    }
                    .foregroundStyle(model.connectionState == .connected ? Color(hex: 0x16A34A) : Theme.muted)
                }
                HStack(spacing: 8) {
                    Button("Reconnect") { model.reconnect() }
                        .buttonStyle(PillButtonStyle(.secondary, size: .small))
                    Spacer()
                    Button("Unpair this Mac…") { confirmUnpair = true }
                        .buttonStyle(PillButtonStyle(.destructive, size: .small))
                }
            } else {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Not paired").font(.oyee(15, .semibold))
                        Text("Pair this Mac with a code from the web app.").font(.oyee(12.5)).foregroundStyle(Theme.muted)
                    }
                    Spacer()
                    Button("Pair…") { showInboxWindow(openWindow) }
                        .buttonStyle(PillButtonStyle(.brand, size: .small))
                }
            }
        }
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func heading(_ title: String) -> some View {
        Text(title)
            .font(.oyee(16, .bold))
            .foregroundStyle(Theme.foreground)
            .padding(.top, 26)
            .padding(.bottom, 2)
    }

    private func statusDot(_ ok: Bool) -> some View {
        Circle().fill(ok ? Color(hex: 0x16A34A) : Theme.faint).frame(width: 9, height: 9)
    }

    private var permissionText: String {
        switch model.notificationAuthorization {
        case .authorized: "Oyee can show notifications."
        case .provisional: "Delivered quietly (provisional)."
        case .denied: "Blocked. Enable Oyee in System Settings."
        case .notDetermined: "Not requested yet."
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
        case .requiresApproval: "Approve Oyee in System Settings → General → Login Items."
        case .notFound: "Move Oyee.app to /Applications to enable this."
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
            NSLog("Oyee: launch at login change failed: \(error)")
        }
    }
}
