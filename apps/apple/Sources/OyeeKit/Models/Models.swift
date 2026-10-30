import Foundation

// Mirrors packages/schema/src/index.ts (Oyee Protocol v2: the intent-shaped notification, docs/protocol.md §1).
// Rules: camelCase JSON, unknown keys ignored, nullable fields are optionals, missing keys fall back to defaults,
// unknown enum values fall back to a sensible case instead of failing the whole payload.

public let oyeeProtocolVersion = 2

// MARK: - Enums

/// A string enum that decodes unknown values to a fallback case (forward compatibility).
public protocol LenientStringEnum: RawRepresentable, Codable, Sendable, Hashable, CaseIterable
where RawValue == String {
    static var fallback: Self { get }
}

extension LenientStringEnum {
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? Self.fallback
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

/// How urgently a notification needs the user. Every severity alerts; the old `debug` decodes as `info`.
public enum Severity: String, LenientStringEnum, Comparable {
    case info, success, warning, critical
    public static var fallback: Severity { .info }

    private var rank: Int {
        switch self {
        case .info: 0
        case .success: 1
        case .warning: 2
        case .critical: 3
        }
    }

    public static func < (lhs: Severity, rhs: Severity) -> Bool { lhs.rank < rhs.rank }
}

public enum NotificationStatus: String, LenientStringEnum {
    case active, resolved
    public static var fallback: NotificationStatus { .active }
}

public enum Platform: String, LenientStringEnum {
    case android, ios, macos, web
    public static var fallback: Platform { .web }

    #if os(iOS)
    public static var current: Platform { .ios }
    #else
    public static var current: Platform { .macos }
    #endif
}

public enum Transport: String, LenientStringEnum {
    case fcm, websocket, webpush
    public static var fallback: Transport { .websocket }
}

public enum UpdateReason: String, LenientStringEnum {
    case update, read, resolved, responded
    public static var fallback: UpdateReason { .update }
}

public enum ErrorCode: String, LenientStringEnum {
    case badRequest = "bad_request"
    case unauthorized
    case forbidden
    case notFound = "not_found"
    case conflict
    case rateLimited = "rate_limited"
    case payloadTooLarge = "payload_too_large"
    case `internal`
    public static var fallback: ErrorCode { .internal }
}

// MARK: - Intent blocks

/// What a sender means by a notification (GLOSSARY.md: Intent). Every notification is exactly one of these.
public enum Intent: String, LenientStringEnum {
    case inform, ask, progress
    public static var fallback: Intent { .inform }
}

public struct Field: Codable, Sendable, Hashable {
    public var label: String
    public var value: String

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }

    enum CodingKeys: String, CodingKey { case label, value }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        label = c.value(.label, default: "")
        value = c.value(.value, default: "")
    }
}

/// A button that opens a URL on the device; nothing is sent back to the sender.
public struct LinkButton: Codable, Sendable, Hashable {
    public var label: String
    public var url: String

    public init(label: String, url: String) {
        self.label = label
        self.url = url
    }

    enum CodingKeys: String, CodingKey { case label, url }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        url = try c.decode(String.self, forKey: .url)
        label = c.value(.label, default: url)
    }
}

/// Inform: something the user should know (one-way).
public struct InformBlock: Codable, Sendable, Hashable {
    public var links: [LinkButton]
    public var fields: [Field]
    /// https image URL.
    public var image: String?
    /// Emoji or https URL.
    public var icon: String?
    /// Minimum time between two alerts for the key, e.g. "1h".
    public var cooldown: String?

    public init(
        links: [LinkButton] = [], fields: [Field] = [], image: String? = nil, icon: String? = nil, cooldown: String? = nil
    ) {
        self.links = links
        self.fields = fields
        self.image = image
        self.icon = icon
        self.cooldown = cooldown
    }

    enum CodingKeys: String, CodingKey { case links, fields, image, icon, cooldown }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        links = c.lossyArray(.links)
        fields = c.lossyArray(.fields)
        image = c.optional(.image)
        icon = c.optional(.icon)
        cooldown = c.optional(.cooldown)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(links, forKey: .links)
        try c.encode(fields, forKey: .fields)
        try c.encode(image, forKey: .image)
        try c.encode(icon, forKey: .icon)
        try c.encode(cooldown, forKey: .cooldown)
    }
}

/// `open` until the first answer (`answered`), its expiry (`expired`) or the sender withdrawing it (`withdrawn`).
public enum AskState: String, LenientStringEnum {
    case open, answered, expired, withdrawn
    /// An ask in a state this build doesn't know can't be answered from here.
    public static var fallback: AskState { .expired }
}

/// The first answer to an ask, from any device.
public struct AskAnswer: Codable, Sendable, Hashable {
    /// Label of the answer button chosen, or nil for a text answer.
    public var option: String?
    public var text: String?
    public var deviceId: String?
    public var deviceName: String?
    public var at: Date

    public init(option: String?, text: String?, deviceId: String?, deviceName: String?, at: Date) {
        self.option = option
        self.text = text
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.at = at
    }

    enum CodingKeys: String, CodingKey { case option, text, deviceId, deviceName, at }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        option = c.optional(.option)
        text = c.optional(.text)
        deviceId = c.optional(.deviceId)
        deviceName = c.optional(.deviceName)
        at = c.value(.at, default: Date(timeIntervalSince1970: 0))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(option, forKey: .option)
        try c.encode(text, forKey: .text)
        try c.encode(deviceId, forKey: .deviceId)
        try c.encode(deviceName, forKey: .deviceName)
        try c.encode(at, forKey: .at)
    }
}

/// Ask: a decision or text the sender needs from the user.
public struct AskBlock: Codable, Sendable, Hashable {
    /// Answer-button labels (at most three).
    public var options: [String]
    /// Whether a free-text answer is accepted.
    public var allowText: Bool
    public var replyPlaceholder: String?
    /// When the ask closes unanswered. Always sent by the server; nil only for a malformed payload.
    public var expiresAt: Date?
    public var answer: AskAnswer?
    public var state: AskState

    public init(
        options: [String] = [], allowText: Bool = false, replyPlaceholder: String? = nil, expiresAt: Date? = nil,
        answer: AskAnswer? = nil, state: AskState = .open
    ) {
        self.options = options
        self.allowText = allowText
        self.replyPlaceholder = replyPlaceholder
        self.expiresAt = expiresAt
        self.answer = answer
        self.state = state
    }

    enum CodingKeys: String, CodingKey { case options, allowText, replyPlaceholder, expiresAt, answer, state }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        options = c.lossyArray(.options)
        allowText = c.value(.allowText, default: false)
        replyPlaceholder = c.optional(.replyPlaceholder)
        expiresAt = c.optional(.expiresAt)
        answer = c.optional(.answer)
        state = c.value(.state, default: .fallback)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(options, forKey: .options)
        try c.encode(allowText, forKey: .allowText)
        try c.encode(replyPlaceholder, forKey: .replyPlaceholder)
        try c.encodeIfPresent(expiresAt, forKey: .expiresAt)
        try c.encode(answer, forKey: .answer)
        try c.encode(state, forKey: .state)
    }
}

/// `stopped` = Stopped reporting: the sender went quiet for longer than `staleAfter`; a later report revives it.
public enum ProgressState: String, LenientStringEnum {
    case running, done, failed, stopped
    public static var fallback: ProgressState { .running }
}

/// Progress: long-running work, updated in place until it ends as done or failed.
public struct ProgressBlock: Codable, Sendable, Hashable {
    public var value: Double
    /// Defaults to 100.
    public var max: Double
    public var label: String?
    public var state: ProgressState
    /// How long it may go quiet before it counts as stopped, e.g. "30m".
    public var staleAfter: String
    /// When the sender last reported. Always sent by the server; nil only for a malformed payload.
    public var lastReportAt: Date?

    public init(
        value: Double, max: Double = 100, label: String? = nil, state: ProgressState = .running,
        staleAfter: String = "30m", lastReportAt: Date? = nil
    ) {
        self.value = value
        self.max = max
        self.label = label
        self.state = state
        self.staleAfter = staleAfter
        self.lastReportAt = lastReportAt
    }

    enum CodingKeys: String, CodingKey { case value, max, label, state, staleAfter, lastReportAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        value = c.value(.value, default: 0)
        let decodedMax: Double = c.value(.max, default: 100)
        max = decodedMax > 0 ? decodedMax : 100
        label = c.optional(.label)
        state = c.value(.state, default: .fallback)
        staleAfter = c.value(.staleAfter, default: "30m")
        lastReportAt = c.optional(.lastReportAt)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(value, forKey: .value)
        try c.encode(max, forKey: .max)
        try c.encodeIfPresent(label, forKey: .label)
        try c.encode(state, forKey: .state)
        try c.encode(staleAfter, forKey: .staleAfter)
        try c.encodeIfPresent(lastReportAt, forKey: .lastReportAt)
    }

    /// Completion ratio clamped to 0...1.
    public var fraction: Double {
        guard max > 0 else { return 0 }
        return Swift.max(0, Swift.min(1, value / max))
    }
}

/// The one block a notification carries, named after its intent.
public enum IntentContent: Sendable, Hashable {
    case inform(InformBlock)
    case ask(AskBlock)
    case progress(ProgressBlock)

    public var intent: Intent {
        switch self {
        case .inform: .inform
        case .ask: .ask
        case .progress: .progress
        }
    }
}

// MARK: - Notification

/// An Oyee notification (protocol v2): shared fields plus one intent block. Named `OyeeNotification` to avoid
/// clashing with `Foundation.Notification`.
public struct OyeeNotification: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var source: String
    /// Names the notification per source so later sends update it (GLOSSARY.md: Key).
    public var key: String?
    public var title: String
    public var body: String?
    public var severity: Severity
    public var status: NotificationStatus
    /// Opens when the notification is tapped.
    public var url: String?
    public var version: Int
    public var createdAt: Date
    public var updatedAt: Date
    public var readAt: Date?
    public var resolvedAt: Date?
    /// Devices that should alert for this item; `nil` = every device. Every inbox still lists it.
    public var targetDeviceIds: [String]?
    public var content: IntentContent

    public init(
        id: String, source: String = "oyee", key: String? = nil, title: String, body: String? = nil,
        severity: Severity = .info, status: NotificationStatus = .active, url: String? = nil,
        content: IntentContent = .inform(InformBlock()), version: Int = 1, createdAt: Date = Date(),
        updatedAt: Date? = nil, readAt: Date? = nil, resolvedAt: Date? = nil, targetDeviceIds: [String]? = nil
    ) {
        self.id = id
        self.source = source
        self.key = key
        self.title = title
        self.body = body
        self.severity = severity
        self.status = status
        self.url = url
        self.content = content
        self.version = version
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.readAt = readAt
        self.resolvedAt = resolvedAt
        self.targetDeviceIds = targetDeviceIds
    }

    enum CodingKeys: String, CodingKey {
        case id, intent, source, key, title, body, severity, status, url, version, createdAt, updatedAt, readAt
        case resolvedAt, targetDeviceIds, inform, ask, progress
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        source = c.value(.source, default: "unknown")
        key = c.optional(.key)
        title = c.value(.title, default: "Notification")
        body = c.optional(.body)
        severity = c.value(.severity, default: .info)
        status = c.value(.status, default: .active)
        url = c.optional(.url)
        version = c.value(.version, default: 1)
        let created: Date = c.value(.createdAt, default: Date(timeIntervalSince1970: 0))
        createdAt = created
        updatedAt = c.value(.updatedAt, default: created)
        readAt = c.optional(.readAt)
        resolvedAt = c.optional(.resolvedAt)
        targetDeviceIds = c.optional(.targetDeviceIds)
        switch c.value(.intent, default: Intent.inform) {
        case .inform: content = .inform(c.value(.inform, default: InformBlock()))
        case .ask: content = .ask(c.value(.ask, default: AskBlock(state: .fallback)))
        case .progress: content = .progress(c.value(.progress, default: ProgressBlock(value: 0)))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(intent, forKey: .intent)
        try c.encode(source, forKey: .source)
        try c.encode(key, forKey: .key)
        try c.encode(title, forKey: .title)
        try c.encode(body, forKey: .body)
        try c.encode(severity, forKey: .severity)
        try c.encode(status, forKey: .status)
        try c.encode(url, forKey: .url)
        try c.encode(version, forKey: .version)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encode(readAt, forKey: .readAt)
        try c.encode(resolvedAt, forKey: .resolvedAt)
        try c.encodeIfPresent(targetDeviceIds, forKey: .targetDeviceIds)
        switch content {
        case .inform(let block): try c.encode(block, forKey: .inform)
        case .ask(let block): try c.encode(block, forKey: .ask)
        case .progress(let block): try c.encode(block, forKey: .progress)
        }
    }

    public var intent: Intent { content.intent }

    /// The inform block, if this is an inform.
    public var inform: InformBlock? {
        if case .inform(let block) = content { block } else { nil }
    }

    /// The ask block, if this is an ask.
    public var ask: AskBlock? {
        if case .ask(let block) = content { block } else { nil }
    }

    /// The progress block, if this is a progress.
    public var progress: ProgressBlock? {
        if case .progress(let block) = content { block } else { nil }
    }

    public var isRead: Bool { readAt != nil }
    public var isResolved: Bool { status == .resolved }

    /// Ids of local test notifications (Settings → Test notification). The server never sees them.
    static let localTestPrefix = "test-"
    public static func isLocalTest(id: String) -> Bool { id.hasPrefix(localTestPrefix) }
    public static func makeLocalTestID() -> String { localTestPrefix + UUID().uuidString }
    /// Whether a system notification for this card should still be visible.
    public var wantsSystemNotification: Bool { !isRead && !isResolved }

    /// A running progress appears and updates without sound; everything else alerts when it arrives.
    public var arrivesQuietly: Bool { progress?.state == .running }

    /// Whether the device `deviceId` should show a system notification for this item.
    public func isTargeted(at deviceId: String?) -> Bool {
        guard let targetDeviceIds, let deviceId else { return true }
        return targetDeviceIds.contains(deviceId)
    }
    public var openURL: URL? { url.flatMap(URL.init(string:)) }
    /// An inform's image.
    public var imageURL: URL? { inform?.image.flatMap(URL.init(string:)) }

    /// An inform's `icon` if it's an emoji/short text (not a URL).
    public var emojiIcon: String? {
        guard let icon = inform?.icon, !icon.isEmpty, !icon.lowercased().hasPrefix("http") else { return nil }
        return icon
    }

    /// An inform's `icon` if it's an http(s) URL.
    public var iconURL: URL? {
        guard let icon = inform?.icon, icon.lowercased().hasPrefix("http") else { return nil }
        return URL(string: icon)
    }
}
// MARK: - Users, devices, pairing

public struct User: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var email: String
    public var name: String?
    public var avatarUrl: String?

    public init(id: String, email: String, name: String? = nil, avatarUrl: String? = nil) {
        self.id = id
        self.email = email
        self.name = name
        self.avatarUrl = avatarUrl
    }

    enum CodingKeys: String, CodingKey { case id, email, name, avatarUrl }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        email = c.value(.email, default: "")
        name = c.optional(.name)
        avatarUrl = c.optional(.avatarUrl)
    }
}

public struct Device: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var platform: Platform
    public var transports: [Transport]
    public var createdAt: Date
    public var lastSeenAt: Date?

    public init(
        id: String, name: String, platform: Platform, transports: [Transport] = [], createdAt: Date = Date(),
        lastSeenAt: Date? = nil
    ) {
        self.id = id
        self.name = name
        self.platform = platform
        self.transports = transports
        self.createdAt = createdAt
        self.lastSeenAt = lastSeenAt
    }

    enum CodingKeys: String, CodingKey { case id, name, platform, transports, createdAt, lastSeenAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.value(.name, default: "")
        platform = c.value(.platform, default: .web)
        transports = c.lossyArray(.transports)
        createdAt = c.value(.createdAt, default: Date(timeIntervalSince1970: 0))
        lastSeenAt = c.optional(.lastSeenAt)
    }
}

public struct PairingCode: Codable, Sendable, Hashable {
    public var code: String
    public var expiresAt: Date
    public var deepLink: String
}

public struct PairInput: Codable, Sendable, Hashable {
    public var code: String
    public var name: String
    public var platform: Platform

    public init(code: String, name: String, platform: Platform) {
        self.code = code
        self.name = name
        self.platform = platform
    }
}

public struct PairResult: Codable, Sendable, Hashable {
    public var device: Device
    public var token: String
    public var user: User
}

public struct UpdateSelfDeviceInput: Codable, Sendable, Hashable {
    public var name: String?

    public init(name: String?) { self.name = name }
}

public struct ServerConfig: Codable, Sendable, Hashable {
    public var version: String
    public var vapidPublicKey: String?
    public var fcmEnabled: Bool
    public var devLogin: Bool

    enum CodingKeys: String, CodingKey { case version, vapidPublicKey, fcmEnabled, devLogin }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = c.value(.version, default: "")
        vapidPublicKey = c.optional(.vapidPublicKey)
        fcmEnabled = c.value(.fcmEnabled, default: false)
        devLogin = c.value(.devLogin, default: false)
    }
}

public struct SourceSummary: Codable, Sendable, Hashable, Identifiable {
    public var source: String
    public var count: Int
    public var unread: Int
    public var lastAt: Date?
    public var id: String { source }

    enum CodingKeys: String, CodingKey { case source, count, unread, lastAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        source = try c.decode(String.self, forKey: .source)
        count = c.value(.count, default: 0)
        unread = c.value(.unread, default: 0)
        lastAt = c.optional(.lastAt)
    }
}

// MARK: - Envelopes

public struct Page<T: Codable & Sendable>: Codable, Sendable {
    public var items: [T]
    public var nextCursor: String?

    public init(items: [T], nextCursor: String?) {
        self.items = items
        self.nextCursor = nextCursor
    }

    enum CodingKeys: String, CodingKey { case items, nextCursor }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = c.lossyArray(.items)
        nextCursor = c.optional(.nextCursor)
    }
}

/// `{ "items": [...] }` without a cursor.
public struct ItemList<T: Codable & Sendable>: Codable, Sendable {
    public var items: [T]

    enum CodingKeys: String, CodingKey { case items }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = c.lossyArray(.items)
    }
}

public struct APIErrorEnvelope: Codable, Sendable, Hashable {
    public struct Body: Codable, Sendable, Hashable {
        public var code: ErrorCode
        public var message: String
    }

    public var error: Body
}

/// `POST /api/notifications/:id/respond`: an answer-button label (`option`) or a free-text answer (`text`) to an
/// open ask. The first answer from any device wins; later ones get `409 conflict`.
public struct RespondInput: Codable, Sendable, Hashable {
    public var option: String?
    public var text: String?

    public init(option: String? = nil, text: String? = nil) {
        self.option = option
        self.text = text
    }
}

public struct ReadAllResult: Codable, Sendable, Hashable {
    public var updated: Int
}

/// Query for `GET /api/notifications`.
public struct NotificationQuery: Sendable, Hashable {
    public var limit: Int?
    public var cursor: String?
    public var source: String?
    public var severity: Severity?
    public var status: NotificationStatus?
    public var q: String?
    public var updatedSince: String?

    public init(
        limit: Int? = nil, cursor: String? = nil, source: String? = nil, severity: Severity? = nil,
        status: NotificationStatus? = nil, q: String? = nil, updatedSince: String? = nil
    ) {
        self.limit = limit
        self.cursor = cursor
        self.source = source
        self.severity = severity
        self.status = status
        self.q = q
        self.updatedSince = updatedSince
    }

    public var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        if let limit { items.append(URLQueryItem(name: "limit", value: String(Swift.min(Swift.max(limit, 1), 200)))) }
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        if let source, !source.isEmpty { items.append(URLQueryItem(name: "source", value: source)) }
        if let severity { items.append(URLQueryItem(name: "severity", value: severity.rawValue)) }
        if let status { items.append(URLQueryItem(name: "status", value: status.rawValue)) }
        if let q, !q.isEmpty { items.append(URLQueryItem(name: "q", value: q)) }
        if let updatedSince { items.append(URLQueryItem(name: "updatedSince", value: updatedSince)) }
        return items
    }
}
