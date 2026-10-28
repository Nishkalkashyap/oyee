import SwiftUI

/// Filter controls (status, severity, source, unread only).
public struct InboxFilterControls: View {
    @Bindable var store: InboxStore

    public init(store: InboxStore) { self.store = store }

    public var body: some View {
        Picker("Status", selection: $store.filter.status) {
            Text("All").tag(NotificationStatus?.none)
            Text("Active").tag(NotificationStatus?.some(.active))
            Text("Resolved").tag(NotificationStatus?.some(.resolved))
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

/// The inbox list with search, filters, pull-to-refresh and infinite scroll.
public struct InboxListView: View {
    @Bindable var store: InboxStore
    @Binding var selection: String?
    @ViewState private var refreshTask: Task<Void, Never>?

    public init(store: InboxStore, selection: Binding<String?>) {
        self.store = store
        self._selection = selection
    }

    public var body: some View {
        List(selection: $selection) {
            if let error = store.lastError {
                Label(error, systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
            ForEach(store.visibleNotifications) { notification in
                NotificationRowView(notification: notification)
                    .tag(notification.id)
                    .contextMenu { contextMenu(for: notification) }
                    #if os(iOS)
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            Task { await store.delete(notification.id) }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        if notification.status == .active {
                            Button {
                                Task { await store.resolve(notification.id) }
                            } label: {
                                Label("Resolve", systemImage: "checkmark")
                            }
                            .tint(.green)
                        }
                    }
                    .swipeActions(edge: .leading) {
                        if !notification.isRead {
                            Button {
                                Task { await store.markRead(notification.id) }
                            } label: {
                                Label("Read", systemImage: "envelope.open")
                            }
                            .tint(.blue)
                        }
                    }
                    #endif
            }
            if store.nextCursor != nil {
                HStack {
                    Spacer()
                    ProgressView().controlSize(.small)
                    Spacer()
                }
                .onAppear { Task { await store.loadMore() } }
            }
        }
        .searchable(text: $store.filter.query, prompt: "Search notifications")
        .refreshable { await store.refresh() }
        .overlay {
            if store.visibleNotifications.isEmpty {
                if store.isLoading && !store.hasLoaded {
                    ProgressView()
                } else if store.filter.isDefault {
                    ContentUnavailableView(
                        "No notifications", systemImage: "bell.slash",
                        description: Text("Notifications sent to Herald show up here."))
                } else {
                    ContentUnavailableView.search
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

    @ViewBuilder
    private func contextMenu(for n: HeraldNotification) -> some View {
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

/// Detail pane: the full card. Marks the notification read when shown.
public struct NotificationDetailView: View {
    let notification: HeraldNotification
    let store: InboxStore

    public init(notification: HeraldNotification, store: InboxStore) {
        self.notification = notification
        self.store = store
    }

    public var body: some View {
        ScrollView {
            NotificationCardView(notification: notification, store: store)
                .padding()
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle(notification.title)
        .task(id: notification.id) {
            if !notification.isRead { await store.markRead(notification.id) }
        }
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
