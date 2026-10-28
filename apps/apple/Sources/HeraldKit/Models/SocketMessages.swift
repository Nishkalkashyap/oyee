import Foundation

/// Server → client WebSocket messages (protocol §6).
public enum ServerMessage: Sendable, Hashable {
    case hello(userId: String, deviceId: String?, serverTime: Date?)
    case notificationCreated(HeraldNotification)
    case notificationUpdated(HeraldNotification, alert: Bool, reason: UpdateReason)
    case notificationDeleted(id: String)
    case syncResult(SyncResult)
    case pong
    /// A message type this client doesn't know (ignored for forward compatibility).
    case unknown(type: String)
}

public struct SyncResult: Codable, Sendable, Hashable {
    public var notifications: [HeraldNotification]
    public var deletedIds: [String]
    public var cursor: String?
    public var hasMore: Bool

    public init(notifications: [HeraldNotification], deletedIds: [String], cursor: String?, hasMore: Bool) {
        self.notifications = notifications
        self.deletedIds = deletedIds
        self.cursor = cursor
        self.hasMore = hasMore
    }

    enum CodingKeys: String, CodingKey { case notifications, deletedIds, cursor, hasMore }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        notifications = c.lossyArray(.notifications)
        deletedIds = c.lossyArray(.deletedIds)
        cursor = c.optional(.cursor)
        hasMore = c.value(.hasMore, default: false)
    }
}

extension ServerMessage: Decodable {
    enum CodingKeys: String, CodingKey {
        case type, userId, deviceId, serverTime, notification, alert, reason, id
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "hello":
            self = .hello(
                userId: c.value(.userId, default: ""), deviceId: c.optional(.deviceId),
                serverTime: c.optional(.serverTime))
        case "notification.created":
            self = .notificationCreated(try c.decode(HeraldNotification.self, forKey: .notification))
        case "notification.updated":
            self = .notificationUpdated(
                try c.decode(HeraldNotification.self, forKey: .notification),
                alert: c.value(.alert, default: false),
                reason: c.value(.reason, default: .update))
        case "notification.deleted":
            self = .notificationDeleted(id: try c.decode(String.self, forKey: .id))
        case "sync.result":
            self = .syncResult(try SyncResult(from: decoder))
        case "pong":
            self = .pong
        default:
            self = .unknown(type: type)
        }
    }

    /// Decodes a text frame.
    public static func decode(_ text: String) throws -> ServerMessage {
        try HeraldJSON.makeDecoder().decode(ServerMessage.self, from: Data(text.utf8))
    }
}

/// Client → server WebSocket messages.
public enum ClientMessage: Sendable, Hashable {
    case ping
    /// `since` = last cursor, an ISO time, or `nil` (= last 50 active).
    case sync(since: String?)
}

extension ClientMessage: Encodable {
    enum CodingKeys: String, CodingKey { case type, since }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .ping:
            try c.encode("ping", forKey: .type)
        case .sync(let since):
            try c.encode("sync", forKey: .type)
            // `since` is required by the schema (nullable), so encode an explicit null.
            try c.encode(since, forKey: .since)
        }
    }

    public func jsonString() throws -> String {
        let data = try HeraldJSON.makeEncoder().encode(self)
        return String(decoding: data, as: UTF8.self)
    }
}
