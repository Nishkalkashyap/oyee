import AppKit
import OyeeKit
import SwiftUI

/// The status item: a bell with the unread count. It also opens the inbox window when the model asks for it
/// (deep links, tapped notifications), because this view is always alive.
struct MenuBarLabel: View {
    let model: OyeeModel
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        let unread = model.store.unreadCount
        HStack(spacing: 3) {
            if model.isPaired, model.connectionState == .unauthorized {
                Image(systemName: "bell.slash")
            } else {
                Image(nsImage: MenuBarIcon.image)
            }
            if unread > 0 {
                Text(unread > 99 ? "99+" : "\(unread)")
                    .monospacedDigit()
            }
        }
        .accessibilityLabel(unread > 0 ? "Oyee, \(unread) unread" : "Oyee")
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

}

/// The menu bar window: live list of active notifications (repeats stacked) with progress, quick actions and a ✓ to
/// resolve.
struct MenuBarContentView: View {
    let model: OyeeModel
    let updater: Updater
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings

    private var store: InboxStore { model.store }

    var body: some View {
        VStack(spacing: 0) {
            header
            UpdateBanner(updater: updater)
            NotificationsOffBanner(model: model)
            content
            footer
        }
        .frame(width: 360)
        .background(Theme.background)
        .onAppear { Task { await model.refreshNotificationAuthorization() } }
    }

    private var header: some View {
        HStack(spacing: 9) {
            BrandMark(size: 24)
            Text("Oyee").font(.oyee(15, .bold))
            Spacer()
            if model.isPaired {
                HStack(spacing: 5) {
                    ConnectionStatusDot(state: model.connectionState)
                    Text(model.connectionState.label).font(.oyee(12, .semibold))
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
        } else if store.activeNotifications.isEmpty {
            VStack(spacing: 6) {
                Image(systemName: "checkmark")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.chipForeground)
                    .frame(width: 44, height: 44)
                    .background(Theme.chip, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                Text("All caught up").font(.oyee(15, .bold))
                Text("Active notifications appear here.")
                    .font(.oyee(12.5))
                    .foregroundStyle(Theme.muted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 28)
        } else {
            // Same order as the inbox: questions, running jobs, then the rest with repeats stacked into one row
            // (its ✓ resolves the whole stack).
            let stacks = InboxSection.split(store.activeNotifications).flatMap(\.stacks)
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(stacks.prefix(40)) { stack in
                        NotificationCardView(
                            notification: stack.head, store: store, compact: true, stackCount: stack.items.count,
                            unread: stack.items.contains { !$0.isRead },
                            onResolve: {
                                Task { for n in stack.items { await store.resolve(n.id) } }
                            }
                        )
                        .background(Theme.background)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .onTapGesture {
                            model.requestInbox(select: stack.head.id)
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

/// The Oyee mark as a template image for the menu bar (macOS tints it for light/dark menu bars).
enum MenuBarIcon {
    @MainActor static let image: NSImage = {
        let size = NSSize(width: 18, height: 18)
        let image = NSImage(size: size, flipped: true) { rect in
            let inset = rect.insetBy(dx: 0.5, dy: 0.5)
            let ring = NSBezierPath(cgPath: OyeeMarkGeometry.ring(in: inset).cgPath)
            ring.windingRule = .evenOdd
            NSColor.black.setFill()
            ring.fill()
            NSBezierPath(cgPath: OyeeMarkGeometry.solids(in: inset).cgPath).fill()
            return true
        }
        image.isTemplate = true
        return image
    }()
}

/// Opens System Settings → Notifications, on Oyee's own page where macOS supports it.
@MainActor
func openNotificationSettings() {
    let base = "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
    let id = Bundle.main.bundleIdentifier.map { "?id=\($0)" } ?? ""
    if let url = URL(string: base + id) { NSWorkspace.shared.open(url) }
}

/// Shown while macOS won't let Oyee show notifications: everything still arrives in the inbox and the menu bar,
/// but no banners appear, which otherwise fails silently. "Turn on" opens System Settings (or asks, if macOS
/// hasn't asked yet); the permission is re-checked when Oyee comes back to the front.
struct NotificationsOffBanner: View {
    let model: OyeeModel
    var horizontalPadding: CGFloat = 10
    var topPadding: CGFloat = 0

    var body: some View {
        let status = model.notificationAuthorization
        if model.isPaired, model.presenter != nil, status == .denied || status == .notDetermined {
            HStack(spacing: 8) {
                Image(systemName: "bell.slash.fill")
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(Color(hex: 0xB45309))
                Text("Notifications are off")
                    .font(.oyee(12.5, .semibold))
                    .foregroundStyle(Theme.foreground)
                Spacer(minLength: 0)
                Button("Turn on") {
                    if status == .notDetermined {
                        Task { await model.requestNotificationPermission() }
                    } else {
                        openNotificationSettings()
                    }
                }
                .buttonStyle(PillButtonStyle(.brand, size: .small))
            }
            .padding(.leading, 12)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .background(Color(hex: 0xD97706).opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal, horizontalPadding)
            .padding(.top, topPadding)
            .padding(.bottom, 6)
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                Task { await model.refreshNotificationAuthorization() }
            }
        }
    }
}

/// Light-blue banner while an update is available, downloading or failed.
struct UpdateBanner: View {
    let updater: Updater

    var body: some View {
        let (text, action): (String?, String?) =
            switch updater.state {
            case .available(let v): ("Oyee \(v) is available", "Update")
            case .downloading(let v): ("Downloading Oyee \(v)…", nil)
            case .installing(let v): ("Installing Oyee \(v)…", nil)
            case .failed(let message): (message, "Retry")
            default: (nil, nil)
            }
        if let text {
            HStack(spacing: 8) {
                Text(text).font(.oyee(12.5, .semibold)).foregroundStyle(Theme.chipForeground)
                Spacer(minLength: 0)
                if let action {
                    Button(action) {
                        Task {
                            if case .failed = updater.state { await updater.check(installIfAuto: false) }
                            await updater.install()
                        }
                    }
                    .buttonStyle(PillButtonStyle(.brand, size: .small))
                }
            }
            .padding(.leading, 12)
            .padding(.trailing, 6)
            .padding(.vertical, 6)
            .background(Theme.chip, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal, 10)
            .padding(.bottom, 6)
        }
    }
}
