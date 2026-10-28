import OyeeKit
import SwiftUI
import UIKit
import UserNotifications

struct SettingsScreen: View {
    let model: OyeeModel
    @Environment(\.dismiss) private var dismiss
    @ViewState private var confirmUnpair = false
    @ViewState private var showPairing = false

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
                    Button("Reconnect") { model.reconnect() }
                    if model.needsRepair {
                        Button("Pair again…") { showPairing = true }
                    }
                    Button("Unpair this device", role: .destructive) { confirmUnpair = true }
                } else {
                    Text("Not paired")
                }
            }

            Section {
                DeliveryNote()
            } header: {
                Text("Delivery")
            } footer: {
                Text("Keep Background App Refresh enabled for Oyee in iOS Settings for the best catch-up.")
            }

            Section("Notifications") {
                LabeledContent("Permission", value: permissionText)
                if model.notificationAuthorization == .notDetermined {
                    Button("Allow notifications") { Task { await model.requestNotificationPermission() } }
                }
                Button("Open iOS Settings") {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                Button("Send test notification") { model.presenter?.sendTestNotification() }
                    .disabled(model.presenter == nil)
            }

            Section("About") {
                LabeledContent(
                    "Version",
                    value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? OyeeKitInfo.version)
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
        .task { await model.refreshNotificationAuthorization() }
        .confirmationDialog("Unpair this device?", isPresented: $confirmUnpair, titleVisibility: .visible) {
            Button("Unpair", role: .destructive) {
                Task {
                    await model.unpair()
                    dismiss()
                }
            }
        } message: {
            Text("It stops receiving notifications until you pair it again.")
        }
        .sheet(isPresented: $showPairing) {
            NavigationStack {
                ScrollView { PairingView(model: model) }
                    .navigationTitle("Pair again")
                    .navigationBarTitleDisplayMode(.inline)
            }
        }
    }

    private var permissionText: String {
        switch model.notificationAuthorization {
        case .authorized: "Allowed"
        case .provisional: "Provisional"
        case .ephemeral: "Ephemeral"
        case .denied: "Denied"
        case .notDetermined: "Not requested"
        @unknown default: "Unknown"
        }
    }
}
