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

@Suite("Model decoding")
struct ModelDecodingTests {
    @Test func fullNotificationFromProtocolExample() throws {
        let n = try decode(OyeeNotification.self, fixture: "notification_full")
        #expect(n.id == "ntf_01JBX9Z6Q2W3E4R5T6Y7U8I9O0")
        #expect(n.source == "aws-monitor")
        #expect(n.threadId == "run-42")
        #expect(n.title == "prod-api CPU high")
        #expect(n.body == "CPU above **90%** for 5m")
        #expect(n.severity == .critical)
        #expect(n.status == .active)
        #expect(n.icon == "🔥")
        #expect(n.emojiIcon == "🔥")
        #expect(n.iconURL == nil)
        #expect(n.imageURL?.absoluteString == "https://example.com/graph.png")
        #expect(n.fields == [Field(label: "Region", value: "us-east-1")])
        #expect(n.progress == Progress(value: 3, max: 7, label: "3/7 checks", indeterminate: false))
        #expect(n.actions.count == 3)
        #expect(n.actions[0] == Action(id: "ack", label: "Acknowledge", style: .primary, resolves: true))
        #expect(n.actions[1].callback?.url == "https://example.com/scale")
        #expect(n.actions[1].resolves == false)
        #expect(n.actions[2].openURL?.absoluteString == "https://console.aws.amazon.com")
        #expect(n.actions[2].style == .default)
        #expect(n.reply == Reply(placeholder: "Tell the agent…", buttonLabel: "Send"))
        #expect(n.tags == ["prod", "aws"])
        #expect(n.silent == false)
        #expect(n.template == "aws-alarm")
        #expect(n.version == 3)
        #expect(n.createdAt == iso("2026-10-28T10:00:00.000Z"))
        #expect(n.updatedAt == iso("2026-10-28T10:05:00.000Z"))
        #expect(n.readAt == nil)
        #expect(n.resolvedAt == nil)
        #expect(n.responses.count == 1)
        #expect(n.responses[0].actionId == "ack")
        #expect(n.responses[0].text == nil)
        #expect(n.responses[0].deviceName == "Pixel 9")
        #expect(n.threadIdentifier == "run-42")
        #expect(n.wantsSystemNotification)
    }

    @Test func missingOptionalKeysFallBackToDefaults() throws {
        let n = try decode(OyeeNotification.self, fixture: "notification_minimal")
        #expect(n.title == "Backup finished")
        #expect(n.source == "unknown")
        #expect(n.severity == .info)
        #expect(n.status == .active)
        #expect(n.body == nil)
        #expect(n.fields.isEmpty)
        #expect(n.actions.isEmpty)
        #expect(n.tags.isEmpty)
        #expect(n.responses.isEmpty)
        #expect(n.progress == nil)
        #expect(n.reply == nil)
        #expect(n.silent == false)
        #expect(n.version == 1)
        #expect(n.updatedAt == n.createdAt)
        #expect(n.threadIdentifier == "unknown")
    }

    @Test func unknownEnumsAndBrokenElementsAreTolerated() throws {
        let n = try decode(OyeeNotification.self, fixture: "notification_unknown_enums")
        #expect(n.severity == .info)  // "emergency" → fallback
        #expect(n.status == .active)  // "archived" → fallback
        #expect(n.fields == [Field(label: "Branch", value: "main"), Field(label: "", value: "")])
        #expect(n.actions.map(\.id) == ["retry"])  // action without id dropped
        #expect(n.actions[0].style == .default)  // "fancy" → default
        #expect(n.progress?.max == 100)  // default max
        #expect(n.progress?.indeterminate == false)
        #expect(n.reply == Reply(placeholder: nil, buttonLabel: nil))
        #expect(n.silent)
        #expect(n.isRead)
        #expect(!n.wantsSystemNotification)
        // Microsecond precision and offsets.
        #expect(abs(n.createdAt.timeIntervalSince(iso("2026-10-28T09:00:00.123Z"))) < 0.001)
        #expect(n.updatedAt == iso("2026-10-28T09:00:00Z"))
    }

    @Test func notificationRoundTrips() throws {
        let original = try decode(OyeeNotification.self, fixture: "notification_full")
        let data = try OyeeJSON.makeEncoder().encode(original)
        let decoded = try OyeeJSON.makeDecoder().decode(OyeeNotification.self, from: data)
        #expect(decoded == original)
        // Nullable fields are encoded as explicit nulls (camelCase keys).
        let json = String(decoding: data, as: UTF8.self)
        #expect(json.contains("\"readAt\":null"))
        #expect(json.contains("\"createdAt\":\"2026-10-28T10:00:00.000Z\""))
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

    @Test func pageConfigSourcesDeviceTemplate() throws {
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

        let template = try decode(Template.self, fixture: "template")
        #expect(template.name == "aws-alarm")
        #expect(template.card.severity == .warning)
        #expect(template.card.fields?.first?.value == "{{region|us-east-1}}")
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
            limit: 500, cursor: "c", source: "aws", severity: .warning, status: .active, threadId: "t", q: "cpu",
            updatedSince: "2026-10-28T10:00:00.000Z")
        let items = Dictionary(uniqueKeysWithValues: q.queryItems.map { ($0.name, $0.value ?? "") })
        #expect(items["limit"] == "200")  // clamped to the max
        #expect(items["severity"] == "warning")
        #expect(items["status"] == "active")
        #expect(items["updatedSince"] == "2026-10-28T10:00:00.000Z")
        #expect(NotificationQuery(source: "", q: "").queryItems.isEmpty)
    }
}
