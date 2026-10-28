import AppKit
import HeraldKit
import SwiftUI

/// The status item: a bell with the unread count. It also opens the inbox window when the model asks for it
/// (deep links, tapped notifications), because this view is always alive.
struct MenuBarLabel: View {
    let model: HeraldModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        let unread = model.store.unreadCount
        HStack(spacing: 3) {
            Image(systemName: symbolName(unread: unread))
            if unread > 0 {
                Text(unread > 99 ? "99+" : "\(unread)")
                    .monospacedDigit()
            }
        }
        .accessibilityLabel(unread > 0 ? "Herald, \(unread) unread" : "Herald")
        .onChange(of: model.inboxRequest) { showInboxWindow(openWindow) }
        .task {
            // First launch: nothing to show in the menu bar yet, so open the window with the pairing form.
            if !model.isPaired { showInboxWindow(openWindow) }
        }
        .onChange(of: model.pairingRequest) { showInboxWindow(openWindow) }
    }

    private func symbolName(unread: Int) -> String {
        if model.isPaired, model.connectionState == .unauthorized { return "bell.slash" }
        return unread > 0 ? "bell.badge.fill" : "bell"
    }
}

/// The menu bar window: live list of active/unread notifications with progress and quick actions.
struct MenuBarContentView: View {
    let model: HeraldModel
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings

    private var store: InboxStore { model.store }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
            Divider()
            footer
        }
        .frame(width: 380)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text("Herald").font(.headline)
            if model.isPaired {
                ConnectionStatusDot(state: model.connectionState)
                Text(model.connectionState.label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if model.isPaired, store.unreadCount > 0 {
                Button("Mark all read") { Task { await store.markAllRead() } }
                    .buttonStyle(.borderless)
                    .font(.caption)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var content: some View {
        if !model.isPaired || model.pendingPairLink != nil {
            PairingView(model: model, compact: true)
                .padding(12)
        } else if model.needsRepair {
            VStack(alignment: .leading, spacing: 8) {
                Label("This Mac was unpaired on the server.", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                PairingView(model: model, compact: true)
            }
            .padding(12)
        } else if store.activeOrUnread.isEmpty {
            VStack(spacing: 6) {
                Image(systemName: "checkmark.circle")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                Text("All caught up").font(.headline)
                Text("Active and unread notifications appear here.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 28)
        } else {
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(store.activeOrUnread.prefix(40)) { notification in
                        NotificationCardView(notification: notification, store: store, compact: true)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                model.requestInbox(select: notification.id)
                            }
                    }
                }
                .padding(10)
            }
            .frame(maxHeight: 460)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var footer: some View {
        HStack {
            Button {
                showInboxWindow(openWindow)
            } label: {
                Label("Open Inbox", systemImage: "tray.full")
            }
            Button {
                openSettings()
                NSApp.activate()
            } label: {
                Label("Settings…", systemImage: "gearshape")
            }
            Spacer()
            Button("Quit") { NSApp.terminate(nil) }
                .keyboardShortcut("q")
        }
        .buttonStyle(.borderless)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }
}
