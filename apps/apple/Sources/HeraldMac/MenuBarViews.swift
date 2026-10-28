import AppKit
import HeraldKit
import SwiftUI

/// The status item: a bell with the unread count. It also opens the inbox window when the model asks for it
/// (deep links, tapped notifications), because this view is always alive.
struct MenuBarLabel: View {
    let model: HeraldModel
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings

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
        .onChange(of: model.settingsRequest) {
            openSettings()
            NSApp.activate()
        }
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
            content
            footer
        }
        .frame(width: 360)
        .background(Theme.background)
    }

    private var header: some View {
        HStack(spacing: 9) {
            BrandMark(size: 24)
            Text("Herald").font(.herald(15, .bold))
            Spacer()
            if model.isPaired {
                HStack(spacing: 5) {
                    ConnectionStatusDot(state: model.connectionState)
                    Text(model.connectionState.label).font(.herald(12, .semibold))
                }
                .foregroundStyle(model.connectionState == .connected ? Color(hex: 0x16A34A) : Theme.muted)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 6)
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
                Image(systemName: "checkmark")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.chipForeground)
                    .frame(width: 44, height: 44)
                    .background(Theme.chip, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                Text("All caught up").font(.herald(15, .bold))
                Text("Active and unread notifications appear here.")
                    .font(.herald(12.5))
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 28)
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(store.activeOrUnread.prefix(40)) { notification in
                        NotificationCardView(notification: notification, store: store, compact: true)
                            .background(Theme.background)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .onTapGesture {
                                model.requestInbox(select: notification.id)
                            }
                    }
                }
                .padding(.horizontal, 6)
                .padding(.bottom, 4)
            }
            .frame(maxHeight: 460)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var footer: some View {
        HStack(spacing: 6) {
            Button("Open inbox") { showInboxWindow(openWindow) }
                .buttonStyle(PillButtonStyle(.secondary, size: .small))
            if model.isPaired, store.unreadCount > 0 {
                Button("Read all") { Task { await store.markAllRead() } }
                    .buttonStyle(PillButtonStyle(.ghost, size: .small))
            }
            Button("Settings") {
                openSettings()
                NSApp.activate()
            }
            .buttonStyle(PillButtonStyle(.ghost, size: .small))
            Spacer()
            Button("Quit") { NSApp.terminate(nil) }
                .buttonStyle(PillButtonStyle(.ghost, size: .small))
                .keyboardShortcut("q")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .overlay(alignment: .top) { Divider().overlay(Theme.border) }
    }
}
