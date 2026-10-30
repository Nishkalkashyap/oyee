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

/// The inbox list in Gluon's language: a large title with round search / mark-all-read buttons, quiet section labels
/// (Needs you, In progress, Updates), stacked repeats and rounded rows. No filter chips: filters set elsewhere show as
/// removable pills, and Resolved is a row at the end of the list.
public struct InboxListView: View {
    @Bindable var store: InboxStore
    @Binding var selection: String?
    @ViewState private var refreshTask: Task<Void, Never>?
    @ViewState private var searching = false
    @ViewState private var expanded: Set<String> = []
    @ViewState private var resolving: Set<String> = []

    public init(store: InboxStore, selection: Binding<String?>) {
        self.store = store
        self._selection = selection
    }

    private var activeView: Bool { store.filter.status == .active }

    public var body: some View {
        let sections = store.sections
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                header
                if searching || !store.filter.query.isEmpty { searchField }
                filterPills
                if let error = store.lastError {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.oyee(12))
                        .foregroundStyle(Color(hex: 0xD97706))
                        .padding(.horizontal, 4)
                }
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(sections) { section in
                        if sections.count > 1 { sectionTitle(section) }
                        ForEach(section.stacks) { stack in
                            stackRows(stack, in: section)
                        }
                    }
                    if store.nextCursor != nil {
                        ProgressView()
                            .controlSize(.small)
                            .frame(maxWidth: .infinity)
                            .padding(8)
                            // `task(id:)` runs again for each new cursor while the spinner stays on screen: a page of
                            // repeats can fold into an existing stack and add no rows, so onAppear alone would stall.
                            .task(id: store.nextCursor) { await store.loadMore() }
                    } else if activeView, !store.visibleNotifications.isEmpty {
                        Button {
                            store.filter.status = .resolved
                        } label: {
                            HStack {
                                Text("Resolved").font(.oyee(14, .semibold))
                                Spacer()
                                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold))
                            }
                            .foregroundStyle(Theme.muted)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 12)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .padding(.top, 4)
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
                        if activeView, store.filter.isUnnarrowed, store.hasAnyNotifications {
                            Button("View resolved") { store.filter.status = .resolved }
                                .buttonStyle(PillButtonStyle(.secondary, size: .small))
                                .padding(.top, 6)
                        }
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

    @ViewBuilder
    private func stackRows(_ stack: InboxStack, in section: InboxSection) -> some View {
        let head = stack.head
        let isOpen = expanded.contains(stack.id) || stack.items.dropFirst().contains { $0.id == selection }
        row(head, count: stack.items.count, unread: stack.items.contains { !$0.isRead && $0.status == .active }, resolveAll: stack.items) {
            if stack.items.count > 1 {
                if expanded.contains(stack.id) { expanded.remove(stack.id) } else { expanded.insert(stack.id) }
            }
        }
        if section.kind == .needsYou {
            // A question's buttons right in the list, so answering doesn't need a detour through the conversation.
            AnswerButtons(notification: head, store: store, onReply: { selection = head.id })
                .padding(.leading, 68)
                .padding(.bottom, 6)
        }
        if isOpen {
            ForEach(stack.items.dropFirst()) { n in
                row(n, child: true, resolveAll: [n])
                    .padding(.leading, 28)
            }
        }
    }

    private func row(
        _ n: OyeeNotification, count: Int = 1, unread: Bool? = nil, child: Bool = false, resolveAll: [OyeeNotification],
        onTap: @escaping () -> Void = {}
    ) -> some View {
        let active = resolveAll.filter { $0.status == .active }
        return ResolvableRow(
            notification: n, selected: selection == n.id, count: count, unread: unread, child: child,
            onOpen: {
                onTap()
                selection = n.id
            },
            onResolve: active.isEmpty ? nil : { resolve(active) }
        )
        .opacity(resolveAll.contains { resolving.contains($0.id) } ? 0.4 : 1)
        .contextMenu { contextMenu(for: n) }
    }

    /// Resolves a row or a whole stack; if the open notification goes, the next row opens.
    private func resolve(_ ns: [OyeeNotification]) {
        let ids = Set(ns.map(\.id))
        resolving.formUnion(ids)
        if let current = selection, ids.contains(current), activeView {
            selection = store.nextSelection(afterResolving: ids, current: current)
        }
        Task {
            for n in ns { await store.resolve(n.id) }
            resolving.subtract(ids)
        }
    }

    private func sectionTitle(_ section: InboxSection) -> some View {
        HStack(spacing: 5) {
            Text(section.title)
            if section.kind == .needsYou {
                Text("\(section.stacks.count)").foregroundStyle(Theme.brand)
            }
        }
        .font(.oyee(13, .semibold))
        .foregroundStyle(Theme.muted)
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 2)
    }

    private var emptyState: (symbol: String, title: String, message: String) {
        if !store.filter.isUnnarrowed { return ("magnifyingglass", "Nothing matches", "Try another search, or clear the filter.") }
        switch store.filter.status {
        case .resolved:
            return ("checkmark", "Nothing resolved yet", "Notifications you resolve move here, out of your inbox.")
        case .active where store.hasAnyNotifications:
            return ("checkmark", "All caught up", "Nothing needs your attention.")
        default:
            return ("tray", "No notifications yet", "Notifications sent to Oyee show up here.")
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 8) {
            if !activeView {
                Button {
                    store.filter.status = .active
                } label: {
                    Image(systemName: "chevron.left").font(.system(size: 14, weight: .semibold))
                }
                .buttonStyle(RoundIconButtonStyle())
                .help("Back to inbox")
            }
            Text(store.filter.status == .resolved ? "Resolved" : activeView ? "Inbox" : "Everything").font(.oyee(24, .bold))
            if activeView, store.unreadCount > 0 {
                Text("\(store.unreadCount) unread").font(.oyee(13, .semibold)).foregroundStyle(Theme.brand)
            }
            Spacer()
            if activeView, store.unreadCount > 0 {
                Button {
                    Task { await store.markAllRead() }
                } label: {
                    Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold))
                }
                .buttonStyle(RoundIconButtonStyle())
                .help("Mark all read")
            }
            Button {
                if searching { store.filter.query = "" }
                searching.toggle()
            } label: {
                Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold))
            }
            .buttonStyle(RoundIconButtonStyle(on: searching || !store.filter.query.isEmpty))
            .help("Search")
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
            TextField("Search titles, text and fields", text: $store.filter.query)
                .textFieldStyle(.plain)
                .font(.oyee(14))
                #if os(macOS)
                .onExitCommand {
                    store.filter.query = ""
                    searching = false
                }
                #endif
        }
        .padding(.horizontal, 14)
        .frame(height: 38)
        .background(Theme.secondary, in: Capsule())
    }

    /// Filters set elsewhere (the iOS filter menu, a source picked before) as removable pills.
    @ViewBuilder
    private var filterPills: some View {
        let f = store.filter
        if f.source != nil || f.severity != nil || f.unreadOnly {
            HStack(spacing: 6) {
                if let source = f.source { RemovablePill(source) { store.filter.source = nil } }
                if let severity = f.severity { RemovablePill(severity.title) { store.filter.severity = nil } }
                if f.unreadOnly { RemovablePill("Unread") { store.filter.unreadOnly = false } }
            }
        }
    }

    @ViewBuilder
    private func contextMenu(for n: OyeeNotification) -> some View {
        if !n.isRead {
            Button("Mark as read") { Task { await store.markRead(n.id) } }
        }
        if n.status == .active {
            Button("Resolve") { resolve([n]) }
        }
        if let url = n.openURL {
            Button("Open link") { store.openURL(url) }
        }
        Button("Show only \(n.source)") { store.filter.source = n.source }
        Divider()
        Button("Delete", role: .destructive) { Task { await store.delete(n.id) } }
    }
}

/// A row as a real button (keyboard focus, Space to open) with the hover ✓ as a sibling, so both stay clickable.
struct ResolvableRow: View {
    let notification: OyeeNotification
    var selected: Bool
    var count: Int
    var unread: Bool?
    var child: Bool
    let onOpen: () -> Void
    var onResolve: (() -> Void)?
    @ViewState private var hovering = false

    var body: some View {
        let showResolve = hovering && onResolve != nil
        Button(action: onOpen) {
            NotificationRowView(
                notification: notification, selected: selected, count: count, unread: unread, child: child,
                highlighted: hovering, hideTrailing: showResolve
            )
        }
        .buttonStyle(.plain)
        .overlay(alignment: .trailing) {
            if showResolve, let onResolve {
                Button(action: onResolve) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.background)
                        .frame(width: 28, height: 28)
                        .background(Theme.foreground, in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .padding(.trailing, 12)
                .help(count > 1 ? "Resolve all \(count)" : "Resolve")
                .accessibilityLabel(count > 1 ? "Resolve all \(count)" : "Resolve")
            }
        }
        .onHover { hovering = $0 }
        .accessibilityAction(named: count > 1 ? "Resolve all \(count)" : "Resolve") { onResolve?() }
    }
}

/// A light-blue pill with an ×.
struct RemovablePill: View {
    let title: String
    let onRemove: () -> Void
    init(_ title: String, onRemove: @escaping () -> Void) {
        self.title = title
        self.onRemove = onRemove
    }

    var body: some View {
        HStack(spacing: 4) {
            Text(title).lineLimit(1)
            Button(action: onRemove) { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)) }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear filter")
        }
        .font(.oyee(12, .semibold))
        .foregroundStyle(Theme.chipForeground)
        .padding(.leading, 10)
        .padding(.trailing, 8)
        .frame(height: 26)
        .background(Theme.chip, in: Capsule())
    }
}

/// A round 32pt icon button on the soft fill (light blue while on).
struct RoundIconButtonStyle: ButtonStyle {
    var on = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(on ? Theme.chipForeground : Theme.secondaryLabel)
            .frame(width: 32, height: 32)
            .background(on ? Theme.chip : Theme.secondary, in: Circle())
            .contentShape(Circle())
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
    }
}

/// The conversation view: the agent's card as a bubble, quiet update lines, your answers as light-blue bubbles on the
/// right and a composer at the bottom. Marks the notification read when shown.
public struct NotificationDetailView: View {
    let notification: OyeeNotification
    let store: InboxStore
    /// Resolve from the card's footer. Defaults to resolving in place; the Mac window also opens the next row.
    var onResolve: ((OyeeNotification) -> Void)?
    @ViewState private var confirmDelete = false

    public init(notification: OyeeNotification, store: InboxStore, onResolve: ((OyeeNotification) -> Void)? = nil) {
        self.notification = notification
        self.store = store
        self.onResolve = onResolve
    }

    private var n: OyeeNotification { notification }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Theme.border)
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(n.createdAt.formatted(date: .abbreviated, time: .shortened)).systemLine()
                    NotificationCardView(notification: n, store: store, onResolve: resolve)
                        .padding(.trailing, 40)
                    if n.version > 1, n.updatedAt != n.createdAt {
                        Text("Updated \(RelativeTime.named(n.updatedAt)) · v\(n.version)").systemLine()
                    }
                    if let answer = n.ask?.answer { answerBubble(answer) }
                    if n.isResolved, let at = n.resolvedAt {
                        Label("Resolved \(RelativeTime.named(at))", systemImage: "checkmark").systemLine()
                    }
                }
                .padding(16)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
            // An open ask that takes text: the conversation's composer is its reply box.
            if let placeholder = AskCardModel(n).replyPlaceholder {
                ReplyComposer(placeholder: placeholder) { text in
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

    private func resolve() {
        if let onResolve { onResolve(n) } else { Task { await store.resolve(n.id) } }
    }

    private var recipients: String {
        var parts: [String] = []
        if let targets = n.targetDeviceIds {
            parts.append(targets.count == 1 ? "Sent to 1 device" : "Sent to \(targets.count) devices")
        } else {
            parts.append("All devices")
        }
        if let key = n.key { parts.append(key) }
        return parts.joined(separator: " · ")
    }

    /// The answer to an ask, as the user's light-blue bubble on the right with the device it came from.
    private func answerBubble(_ r: AskAnswer) -> some View {
        let label = r.option
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
            Text("\(r.deviceName ?? "Unknown device") · \(RelativeTime.named(r.at))")
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
    var onResolve: ((OyeeNotification) -> Void)?
    @ViewState private var failed = false

    public init(id: String, store: InboxStore, onResolve: ((OyeeNotification) -> Void)? = nil) {
        self.id = id
        self.store = store
        self.onResolve = onResolve
    }

    public var body: some View {
        Group {
            if let n = store.notification(id: id) {
                NotificationDetailView(notification: n, store: store, onResolve: onResolve)
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
