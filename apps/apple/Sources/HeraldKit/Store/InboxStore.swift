import Foundation
import Observation

/// Receives system-notification side effects from the store (implemented by `NotificationPresenter`).
@MainActor
public protocol NotificationSink: AnyObject {
    /// Posts (or replaces) the system notification. `alert` = play sound / show banner.
    func present(_ notification: HeraldNotification, alert: Bool)
    /// Replaces the system notification in place, silently, only if it's currently showing.
    func replaceIfShowing(_ notification: HeraldNotification)
    /// Removes delivered/pending system notifications.
    func remove(ids: [String])
}

/// Inbox filters (applied locally and sent to the server on refresh).
public struct InboxFilter: Sendable, Hashable {
    public var status: NotificationStatus?
    public var severity: Severity?
    public var source: String?
    public var query: String = ""
    public var unreadOnly = false

    public init(
        status: NotificationStatus? = nil, severity: Severity? = nil, source: String? = nil, query: String = "",
        unreadOnly: Bool = false
    ) {
        self.status = status
        self.severity = severity
        self.source = source
        self.query = query
        self.unreadOnly = unreadOnly
    }

    public var isDefault: Bool { self == InboxFilter() }

    public func matches(_ n: HeraldNotification) -> Bool {
        if let status, n.status != status { return false }
        if let severity, n.severity != severity { return false }
        if let source, !source.isEmpty, n.source != source { return false }
        if unreadOnly, n.isRead { return false }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !q.isEmpty {
            let haystack = [n.title, n.body ?? "", n.source, n.threadId ?? ""] + n.tags + n.fields.map(\.value)
            if !haystack.contains(where: { $0.localizedCaseInsensitiveContains(q) }) { return false }
        }
        return true
    }

    func query(limit: Int, cursor: String?) -> NotificationQuery {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return NotificationQuery(
            limit: limit, cursor: cursor, source: source, severity: severity, status: status, q: q.isEmpty ? nil : q)
    }
}

/// On-disk cache so the inbox shows instantly on launch.
struct InboxCache: Codable {
    var version = 1
    var notifications: [HeraldNotification]
    var syncState: SyncState
}

/// The in-memory inbox: REST pagination + filters, live socket events, optimistic actions, and a small JSON cache.
@MainActor
@Observable
public final class InboxStore {
    public static let cacheLimit = 300
    public static let pageSize = 50

    /// All known notifications, newest first.
    public private(set) var notifications: [HeraldNotification] = []
    public var filter = InboxFilter()
    public private(set) var nextCursor: String?
    public private(set) var isLoading = false
    public private(set) var isLoadingMore = false
    public var lastError: String?
    public private(set) var sources: [SourceSummary] = []
    public private(set) var syncState = SyncState()
    /// Set once the first refresh or sync has completed (or a cache was loaded).
    public private(set) var hasLoaded = false

    @ObservationIgnored public var api: HeraldAPI?
    /// This device's id; notifications targeted at other devices stay in the inbox but never post here.
    @ObservationIgnored public var deviceId: String?
    @ObservationIgnored public weak var sink: NotificationSink?
    /// Opens URLs for URL actions (injected by the app).
    @ObservationIgnored public var openURL: (URL) -> Void = { _ in }
    /// Called whenever the token turns out to be invalid.
    @ObservationIgnored public var onUnauthorized: () -> Void = {}

    @ObservationIgnored private var byId: [String: HeraldNotification] = [:]
    @ObservationIgnored private let cacheURL: URL?
    @ObservationIgnored private var saveTask: Task<Void, Never>?

    public init(cacheURL: URL? = HeraldPaths.applicationSupport().appendingPathComponent("inbox-cache.json")) {
        self.cacheURL = cacheURL
    }

    // MARK: - Derived

    public var visibleNotifications: [HeraldNotification] {
        notifications.filter(filter.matches)
    }

    /// Unread, active notifications (menu bar badge / app badge).
    public var unreadCount: Int {
        notifications.reduce(0) { $0 + ($1.wantsSystemNotification ? 1 : 0) }
    }

    /// Active or unread notifications for the menu bar list.
    public var activeOrUnread: [HeraldNotification] {
        notifications.filter { $0.status == .active || !$0.isRead }
    }

    public var knownSources: [String] {
        var set = Set(notifications.map(\.source))
        set.formUnion(sources.map(\.source))
        return set.sorted()
    }

    public func notification(id: String) -> HeraldNotification? { byId[id] }

    // MARK: - Cache

    public func loadCache() {
        guard let cacheURL, let data = try? Data(contentsOf: cacheURL),
              let cache = try? HeraldJSON.makeDecoder().decode(InboxCache.self, from: data)
        else { return }
        for n in cache.notifications { byId[n.id] = n }
        syncState = cache.syncState
        hasLoaded = !cache.notifications.isEmpty
        rebuild()
    }

    /// Clears everything (unpair).
    public func reset() {
        byId = [:]
        notifications = []
        nextCursor = nil
        sources = []
        syncState = SyncState()
        hasLoaded = false
        lastError = nil
        saveTask?.cancel()
        if let cacheURL { try? FileManager.default.removeItem(at: cacheURL) }
    }

    private func scheduleSave() {
        guard cacheURL != nil else { return }
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            self?.saveNow()
        }
    }

    public func saveNow() {
        guard let cacheURL else { return }
        let cache = InboxCache(notifications: Array(notifications.prefix(Self.cacheLimit)), syncState: syncState)
        guard let data = try? HeraldJSON.makeEncoder().encode(cache) else { return }
        try? SecureFile.write(data, to: cacheURL)
    }

    // MARK: - Mutation primitives

    private func rebuild() {
        notifications = byId.values.sorted {
            $0.createdAt != $1.createdAt ? $0.createdAt > $1.createdAt : $0.id > $1.id
        }
    }

    /// Inserts or replaces a notification unless the stored one is newer. Returns false for stale updates.
    @discardableResult
    func upsert(_ n: HeraldNotification, rebuildNow: Bool = true) -> Bool {
        if let existing = byId[n.id], existing.version > n.version { return false }
        byId[n.id] = n
        if rebuildNow { rebuild() }
        return true
    }

    private func targetedHere(_ n: HeraldNotification) -> Bool { n.isTargeted(at: deviceId) }

    private func removeLocal(_ id: String) {
        guard byId.removeValue(forKey: id) != nil else { return }
        notifications.removeAll { $0.id == id }
    }

    // MARK: - Socket events

    /// Applies a server message. Returns a follow-up message to send (more sync pages), if any.
    @discardableResult
    public func apply(_ message: ServerMessage) -> ClientMessage? {
        switch message {
        case .notificationCreated(let n):
            let isNew = byId[n.id] == nil
            guard upsert(n) else { return nil }
            syncState.observe([n])
            if n.wantsSystemNotification && targetedHere(n) {
                sink?.present(n, alert: isNew && !n.silent)
            }
            hasLoaded = true
            scheduleSave()
        case .notificationUpdated(let n, let alert, _):
            guard upsert(n) else { return nil }
            syncState.observe([n])
            if !n.wantsSystemNotification {
                sink?.remove(ids: [n.id])
            } else if !targetedHere(n) {
                break
            } else if alert {
                sink?.present(n, alert: !n.silent)
            } else {
                sink?.replaceIfShowing(n)
            }
            scheduleSave()
        case .notificationDeleted(let id):
            removeLocal(id)
            sink?.remove(ids: [id])
            scheduleSave()
        case .syncResult(let result):
            let follow = applySync(result)
            return follow
        case .hello, .pong, .unknown:
            break
        }
        return nil
    }

    /// Applies a batch of changes from `sync.result` (or REST catch-up). The first sync after pairing doesn't post
    /// system notifications (it's history); later syncs post new unread items (only the newest one with sound).
    private func applySync(_ result: SyncResult) -> ClientMessage? {
        let isInitial = syncState.cursor == nil
        let follow = syncState.apply(result)
        applyChanges(result.notifications, deletedIds: result.deletedIds, postNew: !isInitial)
        hasLoaded = true
        return follow
    }

    /// Returns the notifications that were new to this device.
    @discardableResult
    func applyChanges(_ changed: [HeraldNotification], deletedIds: [String], postNew: Bool) -> [HeraldNotification] {
        var newOnes: [HeraldNotification] = []
        var toRemove: [String] = []
        for n in changed {
            let existing = byId[n.id]
            guard upsert(n, rebuildNow: false) else { continue }
            if !n.wantsSystemNotification {
                toRemove.append(n.id)
            } else if !targetedHere(n) {
                continue
            } else if existing == nil {
                newOnes.append(n)
            } else if existing?.version != n.version {
                sink?.replaceIfShowing(n)
            }
        }
        for id in deletedIds {
            byId.removeValue(forKey: id)
            toRemove.append(id)
        }
        rebuild()
        if !toRemove.isEmpty { sink?.remove(ids: toRemove) }
        if postNew {
            let newestFirst = newOnes.sorted { $0.createdAt > $1.createdAt }
            for (index, n) in newestFirst.enumerated() {
                sink?.present(n, alert: index == 0 && !n.silent)
            }
        }
        scheduleSave()
        return newOnes
    }

    // MARK: - REST

    /// Reloads the first page for the current filter.
    public func refresh() async {
        guard let api else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let page = try await api.listNotifications(filter.query(limit: Self.pageSize, cursor: nil))
            mergePage(page.items)
            nextCursor = page.nextCursor
            lastError = nil
            hasLoaded = true
        } catch {
            handle(error)
        }
        if let sources = try? await api.sources() { self.sources = sources }
    }

    public func loadMore() async {
        guard let api, let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await api.listNotifications(filter.query(limit: Self.pageSize, cursor: cursor))
            mergePage(page.items)
            nextCursor = page.nextCursor
        } catch {
            handle(error)
        }
    }

    private func mergePage(_ items: [HeraldNotification]) {
        var toRemove: [String] = []
        for n in items {
            let existing = byId[n.id]
            guard upsert(n, rebuildNow: false) else { continue }
            // Catch up on cross-device dismissals we may have missed.
            if !n.wantsSystemNotification, existing?.wantsSystemNotification ?? true { toRemove.append(n.id) }
        }
        syncState.observe(items)
        rebuild()
        if !toRemove.isEmpty { sink?.remove(ids: toRemove) }
        scheduleSave()
    }

    /// REST catch-up with `updatedSince` (used by iOS background refresh and when the socket is unavailable).
    /// Posts system notifications for new unread items. Returns them.
    @discardableResult
    public func catchUp(maxPages: Int = 5) async -> [HeraldNotification] {
        guard let api else { return [] }
        guard let since = syncState.updatedSinceParameter else {
            await refresh()
            return []
        }
        var cursor: String?
        var collected: [HeraldNotification] = []
        for _ in 0..<maxPages {
            do {
                let page = try await api.listNotifications(
                    NotificationQuery(limit: 200, cursor: cursor, updatedSince: since))
                collected += page.items
                cursor = page.nextCursor
                if cursor == nil { break }
            } catch {
                handle(error)
                break
            }
        }
        guard !collected.isEmpty else { return [] }
        syncState.observe(collected)
        return applyChanges(collected, deletedIds: [], postNew: true)
    }

    private func handle(_ error: Error) {
        if let apiError = error as? HeraldAPIError, apiError.isUnauthorized {
            onUnauthorized()
        }
        lastError = error.localizedDescription
    }

    // MARK: - Actions

    /// Taps an action button: URL actions open the URL; others `POST …/respond { actionId }`.
    public func perform(_ action: Action, on n: HeraldNotification) async {
        if let url = action.openURL {
            openURL(url)
            return
        }
        await respond(id: n.id, actionId: action.id, text: nil)
    }

    public func reply(_ text: String, to n: HeraldNotification) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        await respond(id: n.id, actionId: nil, text: String(trimmed.prefix(2000)))
    }

    public func respond(id: String, actionId: String?, text: String?) async {
        guard let api else { return }
        do {
            let updated = try await api.respond(id: id, actionId: actionId, text: text)
            accept(updated)
        } catch {
            handle(error)
        }
    }

    public func markRead(_ id: String) async {
        guard let api else { return }
        if var local = byId[id], local.readAt == nil {
            local.readAt = Date()
            byId[id] = local
            rebuild()
        }
        sink?.remove(ids: [id])
        do {
            accept(try await api.markRead(id: id))
        } catch {
            handle(error)
        }
    }

    public func resolve(_ id: String) async {
        guard let api else { return }
        sink?.remove(ids: [id])
        do {
            accept(try await api.resolve(id: id))
        } catch {
            handle(error)
        }
    }

    public func delete(_ id: String) async {
        guard let api else { return }
        let backup = byId[id]
        removeLocal(id)
        sink?.remove(ids: [id])
        do {
            try await api.delete(id: id)
            scheduleSave()
        } catch {
            if let backup, (error as? HeraldAPIError)?.status != 404 { upsert(backup) }
            handle(error)
        }
    }

    public func markAllRead(source: String? = nil) async {
        guard let api else { return }
        let now = Date()
        var ids: [String] = []
        for (id, n) in byId where n.readAt == nil && (source == nil || n.source == source) {
            var copy = n
            copy.readAt = now
            byId[id] = copy
            ids.append(id)
        }
        rebuild()
        sink?.remove(ids: ids)
        do {
            _ = try await api.readAll(source: source)
            scheduleSave()
        } catch {
            handle(error)
        }
    }

    /// Applies a notification returned by a REST action.
    func accept(_ n: HeraldNotification) {
        guard upsert(n) else { return }
        syncState.observe([n])
        if !n.wantsSystemNotification { sink?.remove(ids: [n.id]) } else { sink?.replaceIfShowing(n) }
        lastError = nil
        scheduleSave()
    }
}
