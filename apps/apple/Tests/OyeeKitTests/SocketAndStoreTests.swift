import Foundation
import Testing
import UserNotifications

@testable import OyeeKit

@Suite("WebSocket messages")
struct SocketMessageTests {
    func message(_ fixtureName: String) throws -> ServerMessage {
        try ServerMessage.decode(String(decoding: try fixture(fixtureName), as: UTF8.self))
    }

    @Test func hello() throws {
        guard case .hello(let userId, let deviceId, let serverTime) = try message("ws_hello") else {
            Issue.record("expected hello")
            return
        }
        #expect(userId == "usr_1")
        #expect(deviceId == "dev_1")
        #expect(serverTime == iso("2026-10-28T10:00:00Z"))
    }

    @Test func created() throws {
        let full = String(decoding: try fixture("notification_full"), as: UTF8.self)
        let text = #"{"type":"notification.created","notification":"# + full + "}"
        guard case .notificationCreated(let n) = try ServerMessage.decode(text) else {
            Issue.record("expected created")
            return
        }
        #expect(n.id == "ntf_01JBX9Z6Q2W3E4R5T6Y7U8I9O0")
    }

    @Test func updated() throws {
        guard case .notificationUpdated(let n, let alert, let reason) = try message("ws_updated") else {
            Issue.record("expected updated")
            return
        }
        #expect(n.version == 4)
        #expect(n.progress?.value == 5)
        #expect(alert == false)
        #expect(reason == .update)
    }

    @Test func updatedDefaultsAndUnknownReason() throws {
        let text = #"{"type":"notification.updated","notification":{"id":"x","title":"t"},"reason":"exploded"}"#
        guard case .notificationUpdated(_, let alert, let reason) = try ServerMessage.decode(text) else {
            Issue.record("expected updated")
            return
        }
        #expect(alert == false)
        #expect(reason == .update)
    }

    @Test func deletedPongUnknown() throws {
        #expect(try ServerMessage.decode(#"{"type":"notification.deleted","id":"ntf_1"}"#) == .notificationDeleted(id: "ntf_1"))
        #expect(try ServerMessage.decode(#"{"type":"pong"}"#) == .pong)
        #expect(try ServerMessage.decode(#"{"type":"presence","who":"x"}"#) == .unknown(type: "presence"))
        #expect(throws: (any Error).self) { try ServerMessage.decode(#"{"no":"type"}"#) }
    }

    @Test func syncResult() throws {
        guard case .syncResult(let result) = try message("ws_sync_result") else {
            Issue.record("expected sync.result")
            return
        }
        #expect(result.notifications.map(\.id) == ["ntf_A"])
        #expect(result.deletedIds == ["ntf_gone"])
        #expect(result.cursor == "c2")
        #expect(result.hasMore)
    }

    @Test func clientMessagesEncoding() throws {
        #expect(try ClientMessage.ping.jsonString() == #"{"type":"ping"}"#)
        #expect(try ClientMessage.sync(since: nil).jsonString() == #"{"since":null,"type":"sync"}"#)
        #expect(try ClientMessage.sync(since: "c1").jsonString() == #"{"since":"c1","type":"sync"}"#)
    }

    @Test func webSocketURL() {
        #expect(
            OyeeSocket.webSocketURL(baseURL: URL(string: "https://host")!, token: "oyee_dev_x")?.absoluteString
                == "wss://host/api/ws?token=oyee_dev_x")
        #expect(
            OyeeSocket.webSocketURL(baseURL: URL(string: "http://localhost:8787/")!, token: "t")?.absoluteString
                == "ws://localhost:8787/api/ws?token=t")
        #expect(
            OyeeSocket.webSocketURL(baseURL: URL(string: "https://host/oyee")!, token: "t")?.absoluteString
                == "wss://host/oyee/api/ws?token=t")
    }
}

@MainActor
final class RecordingSink: NotificationSink {
    enum Event: Equatable {
        case present(String, alert: Bool)
        case replace(String)
        case remove([String])
    }

    var events: [Event] = []

    func present(_ notification: OyeeNotification, alert: Bool) {
        events.append(.present(notification.id, alert: alert))
    }

    func replaceIfShowing(_ notification: OyeeNotification) {
        events.append(.replace(notification.id))
    }

    func remove(ids: [String]) {
        events.append(.remove(ids))
    }
}

@MainActor
@Suite("Inbox store")
struct InboxStoreTests {
    let sink = RecordingSink()
    let store: InboxStore

    init() {
        store = InboxStore(cacheURL: nil)
        store.sink = sink
    }

    func make(
        _ id: String, version: Int = 1, minute: Int = 0, silent: Bool = false, read: Bool = false,
        status: NotificationStatus = .active
    ) -> OyeeNotification {
        let created = iso("2026-10-28T10:00:00Z").addingTimeInterval(TimeInterval(minute * 60))
        return OyeeNotification(
            id: id, title: id, status: status, silent: silent, version: version, createdAt: created,
            updatedAt: created.addingTimeInterval(TimeInterval(version)), readAt: read ? created : nil)
    }

    @Test func targetedAtOtherDevicesStaysInInboxWithoutPosting() {
        store.deviceId = "dev_mac"
        var forPhone = make("p")
        forPhone.targetDeviceIds = ["dev_phone"]
        var forMac = make("m", minute: 1)
        forMac.targetDeviceIds = ["dev_mac"]
        store.apply(.notificationCreated(forPhone))
        store.apply(.notificationCreated(forMac))
        var updated = forPhone
        updated.version = 2
        store.apply(.notificationUpdated(updated, alert: true, reason: .update))
        #expect(sink.events == [.present("m", alert: true)])
        #expect(store.notifications.map(\.id) == ["m", "p"])
    }

    @Test func createdPostsAndAlertsUnlessSilent() {
        store.apply(.notificationCreated(make("a")))
        store.apply(.notificationCreated(make("b", minute: 1, silent: true)))
        #expect(sink.events == [.present("a", alert: true), .present("b", alert: false)])
        #expect(store.notifications.map(\.id) == ["b", "a"])  // newest first
        #expect(store.unreadCount == 2)
    }

    @Test func updatesReplaceSilentlyAlertOrCancel() {
        store.apply(.notificationCreated(make("a")))
        sink.events.removeAll()

        store.apply(.notificationUpdated(make("a", version: 2), alert: false, reason: .update))
        store.apply(.notificationUpdated(make("a", version: 3), alert: true, reason: .update))
        store.apply(.notificationUpdated(make("a", version: 4, read: true), alert: false, reason: .read))
        #expect(sink.events == [.replace("a"), .present("a", alert: true), .remove(["a"])])
        #expect(store.notification(id: "a")?.version == 4)
        #expect(store.unreadCount == 0)

        sink.events.removeAll()
        store.apply(.notificationUpdated(make("a", version: 5, status: .resolved), alert: false, reason: .resolved))
        #expect(sink.events == [.remove(["a"])])
    }

    @Test func staleUpdatesAreIgnored() {
        store.apply(.notificationCreated(make("a", version: 5)))
        sink.events.removeAll()
        store.apply(.notificationUpdated(make("a", version: 3), alert: true, reason: .update))
        #expect(sink.events.isEmpty)
        #expect(store.notification(id: "a")?.version == 5)
    }

    @Test func deleteRemoves() {
        store.apply(.notificationCreated(make("a")))
        store.apply(.notificationDeleted(id: "a"))
        #expect(store.notifications.isEmpty)
        #expect(sink.events.last == .remove(["a"]))
    }

    @Test func initialSyncIsSilentLaterSyncsPostNewestWithSound() {
        let follow = store.apply(
            .syncResult(SyncResult(notifications: [make("old1"), make("old2", minute: 1)], deletedIds: [], cursor: "c1", hasMore: true)))
        #expect(follow == .sync(since: "c1"))
        #expect(sink.events.isEmpty)
        #expect(store.notifications.count == 2)

        let none = store.apply(
            .syncResult(
                SyncResult(
                    notifications: [make("new1", minute: 5), make("new2", minute: 6), make("old1", version: 2, read: true)],
                    deletedIds: ["old2"], cursor: "c2", hasMore: false)))
        #expect(none == nil)
        #expect(store.syncState.cursor == "c2")
        #expect(store.notifications.map(\.id) == ["new2", "new1", "old1"])
        #expect(
            sink.events == [
                .remove(["old1", "old2"]), .present("new2", alert: true), .present("new1", alert: false),
            ])
    }

    @Test func syncReplacesChangedKnownItems() {
        store.apply(.syncResult(SyncResult(notifications: [make("a")], deletedIds: [], cursor: "c1", hasMore: false)))
        sink.events.removeAll()
        store.apply(.syncResult(SyncResult(notifications: [make("a", version: 2)], deletedIds: [], cursor: "c2", hasMore: false)))
        #expect(sink.events == [.replace("a")])
    }

    @Test func filters() {
        var critical = make("crit", minute: 2)
        critical.severity = .critical
        critical.source = "aws"
        critical.body = "CPU **high**"
        store.apply(.notificationCreated(critical))
        store.apply(.notificationCreated(make("done", minute: 1, read: true, status: .resolved)))

        store.filter = InboxFilter(status: .active)
        #expect(store.visibleNotifications.map(\.id) == ["crit"])
        store.filter = InboxFilter(severity: .critical, source: "aws")
        #expect(store.visibleNotifications.map(\.id) == ["crit"])
        store.filter = InboxFilter(query: "cpu")
        #expect(store.visibleNotifications.map(\.id) == ["crit"])
        store.filter = InboxFilter(unreadOnly: true)
        #expect(store.visibleNotifications.map(\.id) == ["crit"])
        store.filter = InboxFilter()
        #expect(store.visibleNotifications.count == 2)
        #expect(store.activeOrUnread.map(\.id) == ["crit"])
    }

    @Test func cacheRoundTrip() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("oyee-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("inbox-cache.json")
        let first = InboxStore(cacheURL: url)
        first.apply(.syncResult(SyncResult(notifications: [make("a"), make("b", minute: 1)], deletedIds: [], cursor: "cur", hasMore: false)))
        first.saveNow()

        let second = InboxStore(cacheURL: url)
        second.loadCache()
        #expect(second.notifications.map(\.id) == ["b", "a"])
        #expect(second.syncState.cursor == "cur")
        #expect(second.hasLoaded)
        let perms = try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? Int
        #expect(perms == 0o600)

        second.reset()
        #expect(!FileManager.default.fileExists(atPath: url.path))
    }
}

@Suite("Credentials")
struct CredentialStoreTests {
    @Test func saveLoadClearWithPrivatePermissions() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("oyee-cred-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CredentialStore(directory: dir)
        #expect(store.load() == nil)
        let creds = Credentials(
            serverURL: URL(string: "https://host")!, token: "oyee_dev_secret", deviceId: "dev_1", deviceName: "Mac",
            userEmail: "a@b.c", pairedAt: iso("2026-10-28T10:00:00Z"))
        try store.save(creds)
        #expect(store.load() == creds)
        let attrs = try FileManager.default.attributesOfItem(atPath: store.fileURL.path)
        #expect(attrs[.posixPermissions] as? Int == 0o600)
        let dirAttrs = try FileManager.default.attributesOfItem(atPath: dir.path)
        #expect(dirAttrs[.posixPermissions] as? Int == 0o700)
        // Overwrite keeps permissions.
        var updated = creds
        updated.token = "oyee_dev_other"
        try store.save(updated)
        #expect(store.load()?.token == "oyee_dev_other")
        #expect(try FileManager.default.attributesOfItem(atPath: store.fileURL.path)[.posixPermissions] as? Int == 0o600)
        store.clear()
        #expect(store.load() == nil)
    }
}

@Suite("Notification content")
struct NotificationContentTests {
    @Test func userInfoAndResponseMapping() throws {
        let n = try decode(OyeeNotification.self, fixture: "notification_full")
        let info = NotificationContentBuilder.userInfo(for: n, alert: true)
        #expect(info["oyeeId"] == n.id)
        #expect(info["alert"] == "1")
        #expect(info["url"] == "https://console.aws.amazon.com/cloudwatch")
        let userInfo: [AnyHashable: Any] = info

        let open = NotificationContentBuilder.responseInfo(
            notificationIdentifier: n.id, actionIdentifier: UNNotificationDefaultActionIdentifier, userText: nil,
            userInfo: userInfo)
        #expect(open.kind == .open)
        #expect(open.url?.absoluteString == "https://console.aws.amazon.com/cloudwatch")

        let ack = NotificationContentBuilder.responseInfo(
            notificationIdentifier: n.id, actionIdentifier: "oyee.action.ack", userText: nil, userInfo: userInfo)
        #expect(ack.kind == .action(id: "ack", url: nil))

        let openAction = NotificationContentBuilder.responseInfo(
            notificationIdentifier: n.id, actionIdentifier: "oyee.action.open", userText: nil, userInfo: userInfo)
        #expect(openAction.kind == .action(id: "open", url: URL(string: "https://console.aws.amazon.com")))

        let reply = NotificationContentBuilder.responseInfo(
            notificationIdentifier: n.id, actionIdentifier: "oyee.reply", userText: "scale it", userInfo: userInfo)
        #expect(reply.kind == .reply(text: "scale it"))

        let dismiss = NotificationContentBuilder.responseInfo(
            notificationIdentifier: n.id, actionIdentifier: UNNotificationDismissActionIdentifier, userText: nil,
            userInfo: [:])
        #expect(dismiss.kind == .dismiss)
        #expect(dismiss.notificationId == n.id)
    }

    @Test func soundRules() {
        var n = OyeeNotification(id: "a", title: "a", severity: .critical)
        #expect(NotificationContentBuilder.playsSound(n, alert: true))
        #expect(!NotificationContentBuilder.playsSound(n, alert: false))
        n.silent = true
        #expect(!NotificationContentBuilder.playsSound(n, alert: true))
        n.silent = false
        n.severity = .debug
        #expect(!NotificationContentBuilder.playsSound(n, alert: true))
        #expect(NotificationContentBuilder.relevanceScore(.critical) > NotificationContentBuilder.relevanceScore(.info))
    }

    @Test func imageExtensions() {
        #expect(ImageAttachmentLoader.fileExtension(for: URL(string: "https://x/a")!, mimeType: "image/jpeg") == "jpg")
        #expect(ImageAttachmentLoader.fileExtension(for: URL(string: "https://x/a.gif")!, mimeType: nil) == "gif")
        #expect(ImageAttachmentLoader.fileExtension(for: URL(string: "https://x/a.php")!, mimeType: "text/html") == "png")
    }
}
