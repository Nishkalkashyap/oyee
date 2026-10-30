import Foundation
import Testing

@testable import OyeeKit

func fixture(_ name: String) throws -> Data {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
}

func decode<T: Decodable>(_ type: T.Type, fixture name: String) throws -> T {
    try OyeeJSON.makeDecoder().decode(T.self, from: fixture(name))
}

func iso(_ s: String) -> Date { OyeeJSON.parseDate(s)! }

/// The shared protocol v2 examples (packages/schema/fixtures/notifications.v2.json), by name.
func v2(_ name: String) throws -> OyeeNotification {
    let all = try OyeeJSON.makeDecoder().decode([String: OyeeNotification].self, from: fixture("notifications.v2"))
    return try #require(all[name], "no fixture \(name)")
}

@Suite("Model decoding")
struct ModelDecodingTests {
    @Test func sharedFixturesMatchTheSchemaPackage() throws {
        // A test target can only bundle files inside its own folder, so it carries a copy. Refresh it with
        // `cp packages/schema/fixtures/notifications.v2.json apps/apple/Tests/OyeeKitTests/Fixtures/`.
        let original = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("../../../../packages/schema/fixtures/notifications.v2.json")
            .standardizedFileURL
        #expect(try fixture("notifications.v2") == Data(contentsOf: original), "the Swift copy of notifications.v2.json drifted")
    }

    @Test func everySharedFixtureDecodesAsItsIntent() throws {
        let all = try OyeeJSON.makeDecoder().decode([String: OyeeNotification].self, from: fixture("notifications.v2"))
        #expect(all.count == 14)
        for (name, n) in all {
            #expect(name.hasPrefix(n.intent.rawValue + "-"), "\(name) decoded as \(n.intent)")
        }
    }

    @Test func informBlock() throws {
        let n = try v2("inform-full")
        #expect(n.intent == .inform)
        #expect(n.id == "ntf_01JBXA0000000000000000INF2")
        #expect(n.source == "alertmanager")
        #expect(n.key == "disk-full-db1")
        #expect(n.title == "Disk 95% full on db-1")
        #expect(n.body == "Free space is **below 5%**. See the `/var` breakdown.\nNext check in 5 minutes.")
        #expect(n.severity == .critical)
        #expect(n.status == .active)
        #expect(n.url == "https://grafana.example.com/d/disk")
        #expect(n.version == 3)
        #expect(n.createdAt == iso("2026-10-30T09:00:00.000Z"))
        #expect(n.updatedAt == iso("2026-10-30T09:10:00.000Z"))
        #expect(n.readAt == nil && n.resolvedAt == nil)
        #expect(n.targetDeviceIds == ["dev_01JBXA00000000000000000PX9"])
        let inform = try #require(n.inform)
        #expect(
            inform.links == [
                LinkButton(label: "Dashboard", url: "https://grafana.example.com/d/disk"),
                LinkButton(label: "Runbook", url: "https://wiki.example.com/runbooks/disk"),
            ])
        #expect(inform.fields == [Field(label: "Host", value: "db-1"), Field(label: "Used", value: "95%")])
        #expect(inform.image == "https://grafana.example.com/render/disk.png")
        #expect(inform.icon == "💾")
        #expect(inform.cooldown == "1h")
        #expect(n.ask == nil && n.progress == nil)

        let minimal = try v2("inform-minimal")
        #expect(minimal.key == nil && minimal.body == nil && minimal.targetDeviceIds == nil)
        #expect(minimal.inform == InformBlock())
        let resolved = try v2("inform-resolved")
        #expect(resolved.isResolved && resolved.isRead)
        #expect(!resolved.wantsSystemNotification)
    }

    @Test func askBlock() throws {
        let open = try v2("ask-open")
        #expect(open.intent == .ask)
        #expect(open.severity == .warning)
        let ask = try #require(open.ask)
        #expect(ask.options == ["Approve", "Reject", "Wait"])
        #expect(ask.allowText)
        #expect(ask.replyPlaceholder == "Reply…")
        #expect(ask.expiresAt == iso("2026-10-30T10:00:00.000Z"))
        #expect(ask.answer == nil)
        #expect(ask.state == .open)
        #expect(open.inform == nil && open.progress == nil)

        let answered = try #require(try v2("ask-answered-option").ask)
        #expect(answered.state == .answered)
        #expect(
            answered.answer
                == AskAnswer(
                    option: "Approve", text: nil, deviceId: "dev_01JBXA00000000000000000PX9", deviceName: "Pixel 9",
                    at: iso("2026-10-30T09:04:00.000Z")))
        let text = try #require(try v2("ask-answered-text").ask)
        #expect(text.answer?.option == nil)
        #expect(text.answer?.text == "release/1.4")
        #expect(text.answer?.deviceName == "MacBook Pro")
        #expect(text.options.isEmpty)
        #expect(try v2("ask-expired").ask?.state == .expired)
        #expect(try v2("ask-withdrawn").ask?.state == .withdrawn)
    }

    @Test func progressBlock() throws {
        let running = try v2("progress-running")
        #expect(running.intent == .progress)
        #expect(running.key == "ci-run-812")
        #expect(
            running.progress
                == ProgressBlock(
                    value: 3, max: 7, label: "3/7 checks", state: .running, staleAfter: "30m",
                    lastReportAt: iso("2026-10-30T09:03:00.000Z")))
        let percent = try #require(try v2("progress-running-percent").progress)
        #expect(percent.label == nil)
        #expect(percent.value == 40 && percent.max == 100)
        #expect(percent.staleAfter == "2h")
        #expect(try v2("progress-done").progress?.state == .done)
        #expect(try v2("progress-failed").progress?.state == .failed)
        #expect(try v2("progress-stopped").progress?.state == .stopped)
        #expect(running.inform == nil && running.ask == nil)
    }

    @Test func missingKeysFallBackToDefaults() throws {
        // A notification from a server that predates intents still shows its title and body, as an inform.
        let n = try decode(OyeeNotification.self, fixture: "notification_minimal")
        #expect(n.title == "Backup finished")
        #expect(n.intent == .inform)
        #expect(n.inform == InformBlock())
        #expect(n.key == nil)
        #expect(n.source == "unknown")
        #expect(n.severity == .info)
        #expect(n.status == .active)
        #expect(n.body == nil)
        #expect(n.version == 1)
        #expect(n.updatedAt == n.createdAt)
    }

    @Test func unknownEnumsAndBrokenElementsAreTolerated() throws {
        let n = try decode(OyeeNotification.self, fixture: "notification_unknown_enums")
        #expect(n.severity == .info)  // "emergency" → fallback
        #expect(n.status == .active)  // "archived" → fallback
        #expect(n.intent == .inform)  // "poll" → fallback
        #expect(n.inform?.fields == [Field(label: "Branch", value: "main"), Field(label: "", value: "")])
        #expect(n.inform?.links.map(\.label) == ["Logs"])  // a link without a url is dropped
        #expect(n.isRead)
        #expect(!n.wantsSystemNotification)
        // Microsecond precision and offsets.
        #expect(abs(n.createdAt.timeIntervalSince(iso("2026-10-28T09:00:00.123Z"))) < 0.001)
        #expect(n.updatedAt == iso("2026-10-28T09:00:00Z"))

        // The old `debug` severity reads as info; an unknown ask state reads as closed, a progress one as running.
        let ask = try OyeeJSON.makeDecoder().decode(
            OyeeNotification.self,
            from: Data(#"{"id":"a","title":"t","severity":"debug","intent":"ask","ask":{"options":["Yes"],"state":"snoozed"}}"#.utf8))
        #expect(ask.severity == .info)
        #expect(ask.ask?.state == .expired)
        #expect(ask.ask?.options == ["Yes"])
        #expect(ask.ask?.allowText == false)
        #expect(ask.ask?.expiresAt == nil)
        let progress = try OyeeJSON.makeDecoder().decode(
            OyeeNotification.self,
            from: Data(#"{"id":"p","title":"t","intent":"progress","progress":{"value":4,"max":0,"state":"paused"}}"#.utf8))
        #expect(progress.progress == ProgressBlock(value: 4, max: 100, state: .running))
    }

    @Test func notificationRoundTrips() throws {
        for name in ["inform-full", "ask-answered-option", "ask-open", "progress-running-percent"] {
            let original = try v2(name)
            let data = try OyeeJSON.makeEncoder().encode(original)
            #expect(try OyeeJSON.makeDecoder().decode(OyeeNotification.self, from: data) == original)
        }
        // Nullable fields are encoded as explicit nulls (camelCase keys), the block under its intent's name.
        let json = String(decoding: try OyeeJSON.makeEncoder().encode(try v2("ask-open")), as: UTF8.self)
        #expect(json.contains("\"readAt\":null"))
        #expect(json.contains("\"intent\":\"ask\""))
        #expect(json.contains("\"ask\":{"))
        #expect(json.contains("\"createdAt\":\"2026-10-30T09:00:00.000Z\""))
    }

    @Test func notificationWithoutIdFails() {
        let data = Data(#"{"title":"x"}"#.utf8)
        #expect(throws: DecodingError.self) {
            try OyeeJSON.makeDecoder().decode(OyeeNotification.self, from: data)
        }
    }

    @Test func pairResult() throws {
        let result = try decode(PairResult.self, fixture: "pair_result")
        #expect(result.token.hasPrefix("oyee_dev_"))
        #expect(result.device.platform == .macos)
        #expect(result.device.transports == [.websocket])
        #expect(result.device.lastSeenAt == nil)
        #expect(result.user.email == "a@b.c")
        #expect(result.user.avatarUrl == nil)
    }

    @Test func pairingCode() throws {
        let code = try decode(PairingCode.self, fixture: "pairing_code")
        #expect(code.code == "K7Q2-9XMA")
        let deepLink = try #require(URL(string: code.deepLink))
        let link = try #require(Pairing.parseLink(deepLink))
        #expect(link.server.absoluteString == "https://host")
        #expect(link.code == "K7Q29XMA")
    }

    @Test func pageConfigSourcesDevice() throws {
        let page = try decode(Page<OyeeNotification>.self, fixture: "page")
        #expect(page.items.map(\.id) == ["ntf_A", "ntf_B"])
        #expect(page.nextCursor == "opaque-cursor-1")

        let config = try decode(ServerConfig.self, fixture: "config")
        #expect(config.version == "0.1.0")
        #expect(config.vapidPublicKey == nil)
        #expect(config.fcmEnabled)
        #expect(!config.devLogin)

        let sources = try decode(ItemList<SourceSummary>.self, fixture: "sources")
        #expect(sources.items.first?.source == "aws-monitor")
        #expect(sources.items.first?.unread == 3)

        let device = try decode(Device.self, fixture: "device")
        #expect(device.platform == .android)
        // Unknown transport falls back instead of failing the device.
        #expect(device.transports == [.fcm, .websocket, .websocket])
    }

    @Test func errorEnvelope() throws {
        let envelope = try decode(APIErrorEnvelope.self, fixture: "error")
        #expect(envelope.error.code == .notFound)
        #expect(envelope.error.message == "Notification not found")
        let unknown = try OyeeJSON.makeDecoder().decode(
            APIErrorEnvelope.self, from: Data(#"{"error":{"code":"teapot","message":"x"}}"#.utf8))
        #expect(unknown.error.code == .internal)
    }

    @Test func dateParsingVariants() {
        #expect(OyeeJSON.parseDate("2026-10-28T10:00:00.000Z") != nil)
        #expect(OyeeJSON.parseDate("2026-10-28T10:00:00Z") != nil)
        #expect(OyeeJSON.parseDate("2026-10-28T12:00:00+02:00") == OyeeJSON.parseDate("2026-10-28T10:00:00Z"))
        #expect(OyeeJSON.parseDate("not a date") == nil)
        #expect(OyeeJSON.formatDate(iso("2026-10-28T10:00:00Z")) == "2026-10-28T10:00:00.000Z")
    }

    @Test func notificationQueryItems() {
        let q = NotificationQuery(
            limit: 500, cursor: "c", source: "aws", severity: .warning, status: .active, q: "cpu",
            updatedSince: "2026-10-28T10:00:00.000Z")
        let items = Dictionary(uniqueKeysWithValues: q.queryItems.map { ($0.name, $0.value ?? "") })
        #expect(items["limit"] == "200")  // clamped to the max
        #expect(items["severity"] == "warning")
        #expect(items["status"] == "active")
        #expect(items["updatedSince"] == "2026-10-28T10:00:00.000Z")
        #expect(NotificationQuery(source: "", q: "").queryItems.isEmpty)
    }
}
