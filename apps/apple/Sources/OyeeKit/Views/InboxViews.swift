import SwiftUI

/// Filter controls (status, severity, source, unread only).
public struct InboxFilterControls: View {
    @Bindable var store: InboxStore

    public init(store: InboxStore) { self.store = store }

    public var body: some View {
        Picker("Status", selection: $store.filter.status) {
            Text("Active").tag(NotificationStatus?.some(.active))
            Text("Resolved").tag(NotificationStatus?.some(.resolved))
            Text("All").tag(NotificationStatus?.none)
        }
        Picker("Severity", selection: $store.filter.severity) {
            Text("Any severity").tag(Severity?.none)
            ForEach(Severity.allCases.reversed(), id: \.self) { severity in
                Label(severity.title, systemImage: severity.symbolName).tag(Severity?.some(severity))
            }
        }
        Picker("Source", selection: $store.filter.source) {
            Text("All sources").tag(String?.none)
            ForEach(store.knownSources, id: \.self) { source in
                Text(source).tag(String?.some(source))
            }
        }
        Toggle("Unread only", isOn: $store.filter.unreadOnly)
        if !store.filter.isDefault {
            Button("Clear filters") { store.filter = InboxFilter() }
        }
    }
}

/// The inbox list in Gluon's language: large title, search pill, peach filter chips and rounded rows.
public struct InboxListView: View {
    @Bindable var store: InboxStore
    @Binding var selection: String?
    @ViewState private var refreshTask: Task<Void, Never>?

    public init(store: InboxStore, selection: Binding<String?>) {
        self.store = store
        self._selection = selection
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header
                searchField
                chips
                if let error = store.lastError {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.oyee(12))
                        .foregroundStyle(Color(hex: 0xD97706))
                        .padding(.horizontal, 4)
                }
                LazyVStack(spacing: 2) {
                    ForEach(store.visibleNotifications) { notification in
                        Button {
                            selection = notification.id
                        } label: {
                            NotificationRowView(notification: notification, selected: selection == notification.id)
                        }
                        .buttonStyle(.plain)
                        .contextMenu { contextMenu(for: notification) }
                    }
                    if store.nextCursor != nil {
                        ProgressView()
                            .controlSize(.small)
                            .frame(maxWidth: .infinity)
                            .padding(8)
                            .onAppear { Task { await store.loadMore() } }
                    }
                }
                .padding(.horizontal, -8)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 18)
        }
        .scrollIndicators(.never)
        .refreshable { await store.refresh() }
        .overlay {
            if store.visibleNotifications.isEmpty {
                if store.isLoading && !store.hasLoaded {
                    ProgressView()
                } else {
                    let empty = emptyState
                    VStack(spacing: 8) {
                        Image(systemName: empty.symbol)
                            .font(.system(size: 20))
                            .foregroundStyle(Theme.chipForeground)
                            .frame(width: 48, height: 48)
                            .background(Theme.chip, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        Text(empty.title)
                            .font(.oyee(15, .bold))
                        Text(empty.message)
                            .font(.oyee(13))
                            .foregroundStyle(Theme.muted)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 120)
                    .padding(.horizontal, 24)
                }
            }
        }
        .onChange(of: store.filter) {
            // Debounce server-side filtering (local filtering is instant).
            refreshTask?.cancel()
            refreshTask = Task {
                try? await Task.sleep(for: .milliseconds(400))
                guard !Task.isCancelled else { return }
                await store.refresh()
            }
        }
    }

    private var emptyState: (symbol: String, title: String, message: String) {
        if !store.filter.isUnnarrowed { return ("magnifyingglass", "Nothing matches", "Try another filter.") }
        switch store.filter.status {
        case .resolved:
            return ("checkmark", "Nothing resolved yet", "Notifications you resolve move here, out of your inbox.")
        case .active where store.hasAnyNotifications:
            return ("checkmark", "All caught up", "Nothing needs your attention. Resolved notifications are under Resolved.")
        default:
            return ("tray", "No notifications yet", "Notifications sent to Oyee show up here.")
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("Inbox").font(.oyee(24, .bold))
            if store.unreadCount > 0 {
                Text("\(store.unreadCount) unread").font(.oyee(13, .semibold)).foregroundStyle(Theme.brand)
            }
            Spacer()
            Button {
                Task { await store.markAllRead() }
            } label: {
                Label("Read all", systemImage: "checkmark")
            }
            .buttonStyle(PillButtonStyle(.ghost, size: .small))
            .disabled(store.unreadCount == 0)
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
            TextField("Search", text: $store.filter.query)
                .textFieldStyle(.plain)
                .font(.oyee(14))
        }
        .padding(.horizontal, 14)
        .frame(height: 38)
        .background(Theme.secondary, in: Capsule())
    }

    private var chips: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                FilterChip("Active", isOn: store.filter.status == .active) { store.filter.status = .active }
                FilterChip("Resolved", isOn: store.filter.status == .resolved) { store.filter.status = .resolved }
                FilterChip("All", isOn: store.filter.status == nil) { store.filter.status = nil }
                FilterChip("Unread", isOn: store.filter.unreadOnly) { store.filter.unreadOnly.toggle() }
                ForEach(store.knownSources, id: \.self) { source in
                    FilterChip(source, isOn: store.filter.source == source) {
                        store.filter.source = store.filter.source == source ? nil : source
                    }
                }
            }
        }
        .scrollIndicators(.never)
    }

    @ViewBuilder
    private func contextMenu(for n: OyeeNotification) -> some View {
        if !n.isRead {
            Button("Mark as read") { Task { await store.markRead(n.id) } }
        }
        if n.status == .active {
            Button("Resolve") { Task { await store.resolve(n.id) } }
        }
        if let url = n.openURL {
            Button("Open link") { store.openURL(url) }
        }
        Divider()
        Button("Delete", role: .destructive) { Task { await store.delete(n.id) } }
    }
}

/// The conversation view: the agent's card as a bubble, quiet update lines, your answers as peach bubbles on the
/// right and a composer at the bottom. Marks the notification read when shown.
public struct NotificationDetailView: View {
    let notification: OyeeNotification
    let store: InboxStore
    @ViewState private var confirmDelete = false

    public init(notification: OyeeNotification, store: InboxStore) {
        self.notification = notification
        self.store = store
    }

    private var n: OyeeNotification { notification }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Theme.border)
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(n.createdAt.formatted(date: .abbreviated, time: .shortened)).systemLine()
                    NotificationCardView(notification: n, store: store)
                        .padding(.trailing, 40)
                    if n.version > 1, n.updatedAt != n.createdAt {
                        Text("Updated \(n.updatedAt.formatted(.relative(presentation: .named))) · v\(n.version)").systemLine()
                    }
                    ForEach(Array(n.responses.enumerated()), id: \.offset) { _, response in
                        responseBubble(response)
                    }
                    if n.isResolved, let at = n.resolvedAt {
                        Label("Resolved \(at.formatted(.relative(presentation: .named)))", systemImage: "checkmark").systemLine()
                    }
                }
                .padding(16)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
            if let reply = n.reply, n.status == .active {
                ReplyComposer(placeholder: reply.placeholder ?? "Reply to \(n.source)…") { text in
                    await store.reply(text, to: n)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 14)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
        }
        .background(Theme.thread)
        .confirmationDialog("Delete this notification on every device?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { Task { await store.delete(n.id) } }
        }
        .task(id: n.id) {
            if !n.isRead { await store.markRead(n.id) }
        }
    }

    private var header: some View {
        HStack(spacing: 11) {
            SourceAvatar(name: n.source, size: 34)
            VStack(alignment: .leading, spacing: 1) {
                Text(n.source).font(.oyee(15, .bold)).foregroundStyle(Theme.foreground)
                Text(recipients).font(.oyee(12)).foregroundStyle(Theme.muted).lineLimit(1)
            }
            Spacer()
            if n.status == .active {
                Button {
                    Task { await store.resolve(n.id) }
                } label: {
                    Label("Resolve", systemImage: "checkmark")
                }
                .buttonStyle(PillButtonStyle(.secondary, size: .small))
            }
            Button {
                confirmDelete = true
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(PillButtonStyle(.ghost, size: .small))
            .help("Delete")
        }
        .padding(.horizontal, 16)
        .frame(height: 62)
        .background(Theme.background)
    }

    private var recipients: String {
        var parts: [String] = []
        if let targets = n.targetDeviceIds {
            parts.append(targets.count == 1 ? "Sent to 1 device" : "Sent to \(targets.count) devices")
        } else {
            parts.append("All devices")
        }
        if let thread = n.threadId { parts.append(thread) }
        return parts.joined(separator: " · ")
    }

    private func responseBubble(_ r: Response) -> some View {
        let label = r.actionId.flatMap { id in n.actions.first(where: { $0.id == id })?.label ?? id }
        return VStack(alignment: .trailing, spacing: 4) {
            (Text(label ?? "").font(.oyee(14.5, .semibold))
                + Text(label != nil && r.text != nil ? " · " : "").font(.oyee(14.5))
                + Text(r.text ?? "").font(.oyee(14.5)))
                .foregroundStyle(Theme.foreground)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    UnevenRoundedRectangle(
                        topLeadingRadius: 22, bottomLeadingRadius: 22, bottomTrailingRadius: 6, topTrailingRadius: 22,
                        style: .continuous
                    )
                    .fill(Theme.chip)
                )
                .textSelection(.enabled)
            Text("\(r.deviceName ?? "Unknown device") · \(r.at.formatted(.relative(presentation: .named)))")
                .font(.oyee(12))
                .foregroundStyle(Theme.muted)
        }
        .padding(.leading, 60)
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// Shown when a selected notification id isn't in the store (e.g. opened from a system notification after a
/// restart): fetches it once.
public struct NotificationLoaderView: View {
    let id: String
    let store: InboxStore
    @ViewState private var failed = false

    public init(id: String, store: InboxStore) {
        self.id = id
        self.store = store
    }

    public var body: some View {
        Group {
            if let n = store.notification(id: id) {
                NotificationDetailView(notification: n, store: store)
            } else if failed {
                ContentUnavailableView("Notification not found", systemImage: "questionmark.circle")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.thread)
            } else {
                ProgressView()
            }
        }
        .task(id: id) {
            guard store.notification(id: id) == nil else { return }
            failed = !(await store.fetch(id: id))
        }
    }
}

extension InboxStore {
    /// Fetches a single notification into the store. Returns false if it couldn't be loaded.
    public func fetch(id: String) async -> Bool {
        guard let api else { return false }
        guard let n = try? await api.notification(id: id) else { return false }
        accept(n)
        return true
    }
}
