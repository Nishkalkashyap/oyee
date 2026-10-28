import Foundation
@preconcurrency import UserNotifications

/// What the user did with a system notification, extracted into a Sendable value.
public struct NotificationResponseInfo: Sendable, Hashable {
    public enum Kind: Sendable, Hashable {
        /// Tapped the notification body.
        case open
        /// Tapped an action button (Oyee action id). `url` is set for URL actions.
        case action(id: String, url: URL?)
        /// Sent text through the reply box.
        case reply(text: String)
        case dismiss
    }

    public var notificationId: String
    public var kind: Kind
    /// The notification's `url` (opened on body tap).
    public var url: URL?
}

/// Pure helpers for building notification content (testable without UNUserNotificationCenter).
public enum NotificationContentBuilder {
    public static let userInfoId = "oyeeId"
    public static let userInfoURL = "url"
    public static let userInfoActionURLs = "actionURLs"
    public static let userInfoAlert = "alert"
    public static let userInfoVersion = "version"

    /// Whether an alerting post should make a sound (severity + `silent`).
    public static func playsSound(_ n: OyeeNotification, alert: Bool) -> Bool {
        alert && !n.silent && n.severity != .debug
    }

    public static func relevanceScore(_ severity: Severity) -> Double {
        switch severity {
        case .critical: 1.0
        case .warning: 0.8
        case .success: 0.5
        case .info: 0.4
        case .debug: 0.1
        }
    }

    public static func userInfo(for n: OyeeNotification, alert: Bool) -> [String: String] {
        var info: [String: String] = [userInfoId: n.id, userInfoAlert: alert ? "1" : "0", userInfoVersion: String(n.version)]
        if let url = n.url { info[userInfoURL] = url }
        let actionURLs = n.actions.compactMap { action in action.url.map { "\(action.id)\u{1F}\($0)" } }
        if !actionURLs.isEmpty { info[userInfoActionURLs] = actionURLs.joined(separator: "\u{1E}") }
        return info
    }

    static func actionURL(_ actionId: String, in userInfo: [AnyHashable: Any]) -> URL? {
        guard let packed = userInfo[userInfoActionURLs] as? String else { return nil }
        for entry in packed.split(separator: "\u{1E}") {
            let parts = entry.split(separator: "\u{1F}", maxSplits: 1).map(String.init)
            if parts.count == 2, parts[0] == actionId { return URL(string: parts[1]) }
        }
        return nil
    }

    /// Maps a raw UN response into a `NotificationResponseInfo`.
    public static func responseInfo(
        notificationIdentifier: String, actionIdentifier: String, userText: String?, userInfo: [AnyHashable: Any]
    ) -> NotificationResponseInfo {
        let id = (userInfo[userInfoId] as? String) ?? notificationIdentifier
        let url = (userInfo[userInfoURL] as? String).flatMap(URL.init(string:))
        let kind: NotificationResponseInfo.Kind
        switch actionIdentifier {
        case UNNotificationDefaultActionIdentifier:
            kind = .open
        case UNNotificationDismissActionIdentifier:
            kind = .dismiss
        case NotificationCategories.replyActionIdentifier:
            kind = .reply(text: userText ?? "")
        default:
            if let actionId = NotificationCategories.oyeeActionId(from: actionIdentifier) {
                kind = .action(id: actionId, url: actionURL(actionId, in: userInfo))
            } else {
                kind = .open
            }
        }
        return NotificationResponseInfo(notificationId: id, kind: kind, url: url)
    }
}

/// Posts one local notification per Oyee notification (identifier = Oyee id), replaces them in place on updates,
/// removes them on read/resolve/delete, registers dynamic categories for action buttons + reply, and forwards the
/// user's responses to `onResponse`.
@MainActor
public final class NotificationPresenter: NSObject, NotificationSink, UNUserNotificationCenterDelegate {
    /// UNUserNotificationCenter crashes in processes without an app bundle (e.g. `swift run`, `swift test`).
    public static var isSupported: Bool {
        Bundle.main.bundleIdentifier != nil && Bundle.main.bundleURL.pathExtension == "app"
    }

    public static let maxOyeeCategories = 64

    /// Called when the user taps a notification, an action, or sends a reply.
    public var onResponse: ((NotificationResponseInfo) async -> Void)?

    private let center: UNUserNotificationCenter
    private var categoryOrder: [String] = []
    private var categories: [String: UNNotificationCategory] = [:]
    private var pending: [String: Task<Void, Never>] = [:]
    private let images = ImageAttachmentLoader()

    /// Returns nil when notifications aren't supported in this process.
    public init?(center: UNUserNotificationCenter? = nil) {
        guard Self.isSupported else { return nil }
        self.center = center ?? UNUserNotificationCenter.current()
        super.init()
    }

    /// Installs the delegate. Call early (before the app finishes launching) so responses that launched the app
    /// are delivered.
    public func activate() {
        center.delegate = self
    }

    // MARK: Authorization

    @discardableResult
    public func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    public func authorizationStatus() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    public func setBadgeCount(_ count: Int) {
        center.setBadgeCount(count) { _ in }
    }

    // MARK: NotificationSink

    public func present(_ notification: OyeeNotification, alert: Bool) {
        let id = notification.id
        pending[id]?.cancel()
        pending[id] = Task { [weak self] in
            await self?.post(notification, alert: alert)
        }
    }

    public func replaceIfShowing(_ notification: OyeeNotification) {
        let id = notification.id
        Task { [weak self] in
            guard let self else { return }
            let delivered = await self.center.deliveredNotifications()
            guard delivered.contains(where: { $0.request.identifier == id }) else { return }
            self.present(notification, alert: false)
        }
    }

    public func remove(ids: [String]) {
        guard !ids.isEmpty else { return }
        for id in ids {
            pending[id]?.cancel()
            pending[id] = nil
        }
        center.removeDeliveredNotifications(withIdentifiers: ids)
        center.removePendingNotificationRequests(withIdentifiers: ids)
    }

    /// Waits until queued posts (category registration, image download, `add`) have finished. Used before telling
    /// the system a background task is done.
    public func waitForPendingPosts() async {
        for task in pending.values {
            await task.value
        }
    }

    /// Posts a local test notification (no server involved).
    public func sendTestNotification() {
        let sample = OyeeNotification(
            id: "test-\(UUID().uuidString)", source: "oyee", title: "Oyee test notification",
            body: "Notifications are working.", severity: .success,
            fields: [Field(label: "Device", value: ProcessInfo.processInfo.hostName)])
        present(sample, alert: true)
    }

    // MARK: Posting

    private func post(_ n: OyeeNotification, alert: Bool) async {
        let content = UNMutableNotificationContent()
        content.title = Rendering.systemTitle(for: n)
        content.subtitle = n.source
        content.body = Rendering.systemBody(for: n)
        content.threadIdentifier = n.threadIdentifier
        content.userInfo = NotificationContentBuilder.userInfo(for: n, alert: alert)
        content.relevanceScore = NotificationContentBuilder.relevanceScore(n.severity)
        content.sound = NotificationContentBuilder.playsSound(n, alert: alert) ? .default : nil
        // Time-sensitive requires an entitlement we can't get without a paid account, so `.active` is the maximum.
        content.interruptionLevel = (n.severity == .debug || !alert) ? .passive : .active

        if let categoryId = await ensureCategory(for: n) {
            content.categoryIdentifier = categoryId
        }
        if let imageURL = n.imageURL, let attachment = await images.attachment(for: imageURL, notificationId: n.id) {
            content.attachments = [attachment]
        }
        guard !Task.isCancelled else { return }
        let request = UNNotificationRequest(identifier: n.id, content: content, trigger: nil)
        try? await center.add(request)
    }

    /// Registers (merging with existing categories) the category for this action set and returns its id.
    private func ensureCategory(for n: OyeeNotification) async -> String? {
        guard let id = NotificationCategories.categoryIdentifier(for: n) else { return nil }
        if categories[id] != nil {
            categoryOrder.removeAll { $0 == id }
            categoryOrder.append(id)
            return id
        }
        categories[id] = makeCategory(id: id, actions: n.actions, reply: n.reply)
        categoryOrder.append(id)
        while categoryOrder.count > Self.maxOyeeCategories {
            categories[categoryOrder.removeFirst()] = nil
        }
        let existing = await center.notificationCategories()
        var merged = existing.filter { !$0.identifier.hasPrefix(NotificationCategories.prefix) }
        merged.formUnion(categories.values)
        center.setNotificationCategories(merged)
        return id
    }

    private func makeCategory(id: String, actions: [Action], reply: Reply?) -> UNNotificationCategory {
        var unActions: [UNNotificationAction] = actions.map { action in
            var options: UNNotificationActionOptions = []
            if action.style == .destructive { options.insert(.destructive) }
            if action.url != nil { options.insert(.foreground) }
            return UNNotificationAction(
                identifier: NotificationCategories.actionIdentifier(for: action.id), title: action.label,
                options: options)
        }
        if let reply {
            let button = reply.buttonLabel ?? "Send"
            unActions.append(
                UNTextInputNotificationAction(
                    identifier: NotificationCategories.replyActionIdentifier, title: "Reply", options: [],
                    textInputButtonTitle: button, textInputPlaceholder: reply.placeholder ?? "Reply…"))
        }
        return UNNotificationCategory(identifier: id, actions: unActions, intentIdentifiers: [], options: [])
    }

    // MARK: UNUserNotificationCenterDelegate

    public nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        // Silent in-place updates (progress etc.) must not re-show a banner while the app is frontmost.
        let alert = (notification.request.content.userInfo[NotificationContentBuilder.userInfoAlert] as? String) == "1"
        guard alert else { return [.list] }
        return notification.request.content.sound == nil ? [.banner, .list] : [.banner, .list, .sound]
    }

    public nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        let info = NotificationContentBuilder.responseInfo(
            notificationIdentifier: response.notification.request.identifier,
            actionIdentifier: response.actionIdentifier,
            userText: (response as? UNTextInputNotificationResponse)?.userText,
            userInfo: response.notification.request.content.userInfo)
        await handle(info)
    }

    private func handle(_ info: NotificationResponseInfo) async {
        await onResponse?(info)
    }
}

/// Downloads notification images to temp files for `UNNotificationAttachment`, with a timeout and a small cache so
/// in-place updates (e.g. progress) don't re-download the image every time.
@MainActor
final class ImageAttachmentLoader {
    private var cache: [URL: URL] = [:]
    private let directory: URL
    private let session: URLSession

    init() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("OyeeImages", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        config.timeoutIntervalForResource = 15
        session = URLSession(configuration: config)
    }

    func attachment(for url: URL, notificationId: String) async -> UNNotificationAttachment? {
        guard let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return nil }
        let local: URL
        if let cached = cache[url], FileManager.default.fileExists(atPath: cached.path) {
            local = cached
        } else {
            guard let downloaded = await download(url) else { return nil }
            cache[url] = downloaded
            local = downloaded
        }
        // UNNotificationAttachment moves the file into its own store, so hand it a copy.
        let copy = directory.appendingPathComponent("\(UUID().uuidString).\(local.pathExtension)")
        guard (try? FileManager.default.copyItem(at: local, to: copy)) != nil else { return nil }
        return try? UNNotificationAttachment(identifier: "image", url: copy, options: nil)
    }

    private func download(_ url: URL) async -> URL? {
        guard let (data, response) = try? await session.data(from: url),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              !data.isEmpty, data.count <= 10 * 1024 * 1024
        else { return nil }
        let ext = Self.fileExtension(for: url, mimeType: http.mimeType)
        let file = directory.appendingPathComponent("cache-\(NotificationCategories.fnv1a64Hex(url.absoluteString)).\(ext)")
        guard (try? data.write(to: file, options: .atomic)) != nil else { return nil }
        return file
    }

    nonisolated static func fileExtension(for url: URL, mimeType: String?) -> String {
        switch mimeType?.lowercased() {
        case "image/png": return "png"
        case "image/jpeg", "image/jpg": return "jpg"
        case "image/gif": return "gif"
        case "image/heic": return "heic"
        case "image/webp": return "webp"
        default: break
        }
        let ext = url.pathExtension.lowercased()
        return ["png", "jpg", "jpeg", "gif", "heic", "webp"].contains(ext) ? ext : "png"
    }
}
