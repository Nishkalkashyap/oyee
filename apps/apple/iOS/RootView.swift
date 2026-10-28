import OyeeKit
import SwiftUI

struct RootView: View {
    @Bindable var model: OyeeModel

    var body: some View {
        Group {
            if model.isPaired {
                InboxScreen(model: model)
            } else {
                NavigationStack {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            PairingView(model: model)
                            DeliveryNote()
                                .padding(.horizontal, 24)
                        }
                    }
                    .navigationTitle("Oyee")
                }
            }
        }
        .sheet(isPresented: pairingSheetBinding) {
            NavigationStack {
                ScrollView { PairingView(model: model) }
                    .navigationTitle("Pair device")
                    .navigationBarTitleDisplayMode(.inline)
            }
        }
        .onChange(of: model.store.unreadCount) { _, count in
            model.presenter?.setBadgeCount(count)
        }
    }

    /// A pairing deep link while already paired → confirm in a sheet.
    private var pairingSheetBinding: Binding<Bool> {
        Binding(
            get: { model.isPaired && model.pendingPairLink != nil },
            set: { presented in if !presented { model.pendingPairLink = nil } }
        )
    }
}

struct InboxScreen: View {
    @Bindable var model: OyeeModel
    @ViewState private var showSettings = false

    var body: some View {
        NavigationSplitView {
            InboxListView(store: model.store, selection: $model.selectedNotificationID)
                .navigationTitle("Inbox")
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            model.reconnect()
                        } label: {
                            HStack(spacing: 6) {
                                ConnectionStatusDot(state: model.connectionState)
                                Text(model.connectionState.label).font(.caption)
                            }
                        }
                        .accessibilityLabel("Connection: \(model.connectionState.label). Tap to reconnect.")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            InboxFilterControls(store: model.store)
                            Divider()
                            Button("Mark all as read") { Task { await model.store.markAllRead() } }
                        } label: {
                            Image(
                                systemName: model.store.filter.isDefault
                                    ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showSettings = true
                        } label: {
                            Image(systemName: "gearshape")
                        }
                        .accessibilityLabel("Settings")
                    }
                }
                .safeAreaInset(edge: .top) {
                    if model.needsRepair {
                        Label("This device was unpaired on the server. Pair it again in Settings.", systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                            .padding(8)
                            .frame(maxWidth: .infinity)
                            .background(.thinMaterial)
                    }
                }
        } detail: {
            if let id = model.selectedNotificationID {
                NotificationLoaderView(id: id, store: model.store)
                    .id(id)
            } else {
                ContentUnavailableView("No notification selected", systemImage: "bell")
            }
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                SettingsScreen(model: model)
            }
        }
    }
}

/// The honest explanation of iOS delivery without APNs.
struct DeliveryNote: View {
    var body: some View {
        Label {
            Text("iOS only gets instant notifications while Oyee is open. Without APNs (which needs a paid Apple Developer account), iOS can't wake the app, so when it's in the background Oyee catches up periodically when iOS allows it, and fully when you open the app.")
        } icon: {
            Image(systemName: "info.circle")
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }
}
