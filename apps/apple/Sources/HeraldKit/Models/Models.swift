import Foundation

// Mirrors packages/schema/src/index.ts (Herald Protocol v1).
// Rules: camelCase JSON, unknown keys ignored, nullable fields are optionals, missing keys fall back to defaults,
// unknown enum values fall back to a sensible case instead of failing the whole payload.

public let heraldProtocolVersion = 1

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

public enum Severity: String, LenientStringEnum, Comparable {
    case debug, info, success, warning, critical
    public static var fallback: Severity { .info }

    private var rank: Int {
        switch self {
        case .debug: 0
        case .info: 1
        case .success: 2
        case .warning: 3
        case .critical: 4
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

public enum ActionStyle: String, LenientStringEnum {
    case `default`, primary, destructive
    public static var fallback: ActionStyle { .default }
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

// MARK: - Card parts

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

public struct Progress: Codable, Sendable, Hashable {
    public var value: Double
    /// Defaults to 100.
    public var max: Double
    public var label: String?
    public var indeterminate: Bool

    public init(value: Double, max: Double = 100, label: String? = nil, indeterminate: Bool = false) {
        self.value = value
        self.max = max
        self.label = label
        self.indeterminate = indeterminate
    }

    enum CodingKeys: String, CodingKey { case value, max, label, indeterminate }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        value = c.value(.value, default: 0)
        let decodedMax: Double = c.value(.max, default: 100)
        max = decodedMax > 0 ? decodedMax : 100
        label = c.optional(.label)
        indeterminate = c.value(.indeterminate, default: false)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(value, forKey: .value)
        try c.encode(max, forKey: .max)
        try c.encodeIfPresent(label, forKey: .label)
        try c.encode(indeterminate, forKey: .indeterminate)
    }

    /// Completion ratio clamped to 0...1.
    public var fraction: Double {
        guard max > 0 else { return 0 }
        return Swift.max(0, Swift.min(1, value / max))
    }
}

public struct ActionCallback: Codable, Sendable, Hashable {
    public var url: String
    public var headers: [String: String]?

    public init(url: String, headers: [String: String]? = nil) {
        self.url = url
        self.headers = headers
    }
}

public struct Action: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var label: String
    public var style: ActionStyle
    /// If present the client opens this URL and does not call respond.
    public var url: String?
    public var callback: ActionCallback?
    public var resolves: Bool

    public init(
        id: String, label: String, style: ActionStyle = .default, url: String? = nil,
        callback: ActionCallback? = nil, resolves: Bool = false
    ) {
        self.id = id
        self.label = label
        self.style = style
        self.url = url
        self.callback = callback
        self.resolves = resolves
    }

    enum CodingKeys: String, CodingKey { case id, label, style, url, callback, resolves }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        label = c.value(.label, default: id)
        style = c.value(.style, default: .default)
        url = c.optional(.url)
        callback = c.optional(.callback)
        resolves = c.value(.resolves, default: false)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(label, forKey: .label)
        try c.encode(style, forKey: .style)
        try c.encodeIfPresent(url, forKey: .url)
        try c.encodeIfPresent(callback, forKey: .callback)
        try c.encode(resolves, forKey: .resolves)
    }

    /// The URL to open, if this is a URL action.
    public var openURL: URL? { url.flatMap(URL.init(string:)) }
}

public struct Reply: Codable, Sendable, Hashable {
    public var placeholder: String?
    public var buttonLabel: String?

    public init(placeholder: String? = nil, buttonLabel: String? = nil) {
        self.placeholder = placeholder
        self.buttonLabel = buttonLabel
    }
}

public struct Response: Codable, Sendable, Hashable {
    public var actionId: String?
    public var text: String?
    public var deviceId: String?
    public var deviceName: String?
    public var at: Date

    public init(actionId: String?, text: String?, deviceId: String?, deviceName: String?, at: Date) {
        self.actionId = actionId
        self.text = text
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.at = at
    }

    enum CodingKeys: String, CodingKey { case actionId, text, deviceId, deviceName, at }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        actionId = c.optional(.actionId)
        text = c.optional(.text)
        deviceId = c.optional(.deviceId)
        deviceName = c.optional(.deviceName)
        at = c.value(.at, default: Date(timeIntervalSince1970: 0))
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(actionId, forKey: .actionId)
        try c.encode(text, forKey: .text)
        try c.encode(deviceId, forKey: .deviceId)
        try c.encode(deviceName, forKey: .deviceName)
        try c.encode(at, forKey: .at)
    }
}

// MARK: - Notification

/// A Herald notification ("card"). Named `HeraldNotification` to avoid clashing with `Foundation.Notification`.
public struct HeraldNotification: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var source: String
    public var threadId: String?
    public var title: String
    public var body: String?
    public var severity: Severity
    public var status: NotificationStatus
    public var icon: String?
    public var image: String?
    public var url: String?
    public var fields: [Field]
    public var progress: Progress?
    public var actions: [Action]
    public var reply: Reply?
    public var tags: [String]
    public var silent: Bool
    public var template: String?
    public var version: Int
    public var createdAt: Date
    public var updatedAt: Date
    public var readAt: Date?
    public var resolvedAt: Date?
    public var responses: [Response]
    /// Devices that should alert for this item; `nil` = every device. Every inbox still lists it.
    public var targetDeviceIds: [String]?

    public init(
        id: String, source: String = "herald", threadId: String? = nil, title: String, body: String? = nil,
        severity: Severity = .info, status: NotificationStatus = .active, icon: String? = nil,
        image: String? = nil, url: String? = nil, fields: [Field] = [], progress: Progress? = nil,
        actions: [Action] = [], reply: Reply? = nil, tags: [String] = [], silent: Bool = false,
        template: String? = nil, version: Int = 1, createdAt: Date = Date(), updatedAt: Date? = nil,
        readAt: Date? = nil, resolvedAt: Date? = nil, responses: [Response] = [], targetDeviceIds: [String]? = nil
    ) {
        self.id = id
        self.source = source
        self.threadId = threadId
        self.title = title
        self.body = body
        self.severity = severity
        self.status = status
        self.icon = icon
        self.image = image
        self.url = url
        self.fields = fields
        self.progress = progress
        self.actions = actions
        self.reply = reply
        self.tags = tags
        self.silent = silent
        self.template = template
        self.version = version
        self.createdAt = createdAt
        self.updatedAt = updatedAt ?? createdAt
        self.readAt = readAt
        self.resolvedAt = resolvedAt
        self.responses = responses
        self.targetDeviceIds = targetDeviceIds
    }

    enum CodingKeys: String, CodingKey {
        case id, source, threadId, title, body, severity, status, icon, image, url, fields, progress, actions
        case reply, tags, silent, template, version, createdAt, updatedAt, readAt, resolvedAt, responses
        case targetDeviceIds
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        source = c.value(.source, default: "unknown")
        threadId = c.optional(.threadId)
        title = c.value(.title, default: "Notification")
        body = c.optional(.body)
        severity = c.value(.severity, default: .info)
        status = c.value(.status, default: .active)
        icon = c.optional(.icon)
        image = c.optional(.image)
        url = c.optional(.url)
        fields = c.lossyArray(.fields)
        progress = c.optional(.progress)
        actions = c.lossyArray(.actions)
        reply = c.optional(.reply)
        tags = c.lossyArray(.tags)
        silent = c.value(.silent, default: false)
        template = c.optional(.template)
        version = c.value(.version, default: 1)
        let created: Date = c.value(.createdAt, default: Date(timeIntervalSince1970: 0))
        createdAt = created
        updatedAt = c.value(.updatedAt, default: created)
        readAt = c.optional(.readAt)
        resolvedAt = c.optional(.resolvedAt)
        responses = c.lossyArray(.responses)
        targetDeviceIds = c.optional(.targetDeviceIds)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(source, forKey: .source)
        try c.encode(threadId, forKey: .threadId)
        try c.encode(title, forKey: .title)
        try c.encode(body, forKey: .body)
        try c.encode(severity, forKey: .severity)
        try c.encode(status, forKey: .status)
        try c.encode(icon, forKey: .icon)
        try c.encode(image, forKey: .image)
        try c.encode(url, forKey: .url)
        try c.encode(fields, forKey: .fields)
        try c.encode(progress, forKey: .progress)
        try c.encode(actions, forKey: .actions)
        try c.encode(reply, forKey: .reply)
        try c.encode(tags, forKey: .tags)
        try c.encode(silent, forKey: .silent)
        try c.encode(template, forKey: .template)
        try c.encode(version, forKey: .version)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encode(readAt, forKey: .readAt)
        try c.encode(resolvedAt, forKey: .resolvedAt)
        try c.encode(responses, forKey: .responses)
        try c.encodeIfPresent(targetDeviceIds, forKey: .targetDeviceIds)
    }

    public var isRead: Bool { readAt != nil }
    public var isResolved: Bool { status == .resolved }
    /// Whether a system notification for this card should still be visible.
    public var wantsSystemNotification: Bool { !isRead && !isResolved }

    /// Whether the device `deviceId` should show a system notification for this item.
    public func isTargeted(at deviceId: String?) -> Bool {
        guard let targetDeviceIds, let deviceId else { return true }
        return targetDeviceIds.contains(deviceId)
    }
    public var openURL: URL? { url.flatMap(URL.init(string:)) }
    public var imageURL: URL? { image.flatMap(URL.init(string:)) }
    /// Apple `threadIdentifier` = `threadId ?? source`.
    public var threadIdentifier: String { threadId ?? source }

    /// `icon` if it's an emoji/short text (not a URL).
    public var emojiIcon: String? {
        guard let icon, !icon.isEmpty, !icon.lowercased().hasPrefix("http") else { return nil }
        return icon
    }

    /// `icon` if it's an http(s) URL.
    public var iconURL: URL? {
        guard let icon, icon.lowercased().hasPrefix("http") else { return nil }
        return URL(string: icon)
    }
}

// MARK: - Templates

/// Partial card with `{{var}}` placeholders. Kept loosely typed except for the common fields.
public struct TemplateCard: Codable, Sendable, Hashable {
    public var title: String?
    public var body: String?
    public var severity: Severity?
    public var source: String?
    public var threadId: String?
    public var icon: String?
    public var image: String?
    public var url: String?
    public var fields: [Field]?
    public var progress: Progress?
    public var actions: [Action]?
    public var reply: Reply?
    public var tags: [String]?
    public var silent: Bool?
    public var replaceKey: String?
}

public struct Template: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var name: String
    public var description: String?
    public var card: TemplateCard
    public var createdAt: Date
    public var updatedAt: Date

    enum CodingKeys: String, CodingKey { case id, name, description, card, createdAt, updatedAt }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = c.value(.name, default: id)
        description = c.optional(.description)
        card = c.value(.card, default: TemplateCard())
        let created: Date = c.value(.createdAt, default: Date(timeIntervalSince1970: 0))
        createdAt = created
        updatedAt = c.value(.updatedAt, default: created)
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

public struct RespondInput: Codable, Sendable, Hashable {
    public var actionId: String?
    public var text: String?

    public init(actionId: String? = nil, text: String? = nil) {
        self.actionId = actionId
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
    public var threadId: String?
    public var q: String?
    public var updatedSince: String?

    public init(
        limit: Int? = nil, cursor: String? = nil, source: String? = nil, severity: Severity? = nil,
        status: NotificationStatus? = nil, threadId: String? = nil, q: String? = nil, updatedSince: String? = nil
    ) {
        self.limit = limit
        self.cursor = cursor
        self.source = source
        self.severity = severity
        self.status = status
        self.threadId = threadId
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
        if let threadId, !threadId.isEmpty { items.append(URLQueryItem(name: "threadId", value: threadId)) }
        if let q, !q.isEmpty { items.append(URLQueryItem(name: "q", value: q)) }
        if let updatedSince { items.append(URLQueryItem(name: "updatedSince", value: updatedSince)) }
        return items
    }
}
