import Foundation

/// Exponential reconnect backoff with jitter: 1 s → 60 s.
///
/// The un-jittered delay doubles per attempt (1, 2, 4, … capped at 60). The returned delay is a random value in
/// `[raw / 2, raw]`, never below `base`, so reconnect storms from many clients spread out.
public struct Backoff: Sendable, Hashable {
    public let base: TimeInterval
    public let maximum: TimeInterval
    public private(set) var attempt: Int = 0

    public init(base: TimeInterval = 1, maximum: TimeInterval = 60) {
        self.base = base
        self.maximum = maximum
    }

    /// Un-jittered delay for a given attempt number.
    public func rawDelay(forAttempt attempt: Int) -> TimeInterval {
        let exponent = Double(min(attempt, 30))
        return min(maximum, base * pow(2, exponent))
    }

    /// Returns the next delay and advances the attempt counter. `random` must return a value in `0...1`.
    public mutating func nextDelay(random: () -> Double = { Double.random(in: 0...1) }) -> TimeInterval {
        let raw = rawDelay(forAttempt: attempt)
        attempt += 1
        let jitter = min(1, max(0, random()))
        let delay = raw / 2 + (raw / 2) * jitter
        return min(maximum, max(base, delay))
    }

    public mutating func reset() {
        attempt = 0
    }
}

/// Tracks the WebSocket sync cursor (protocol §6) plus the newest `updatedAt` seen, used for REST
/// `updatedSince` catch-up (e.g. iOS background refresh).
public struct SyncState: Codable, Sendable, Hashable {
    /// Opaque cursor returned by the last `sync.result`. `nil` = never synced (server returns the last 50 active).
    public var cursor: String?
    /// Newest `updatedAt` of any notification we've seen.
    public var lastUpdatedAt: Date?

    public init(cursor: String? = nil, lastUpdatedAt: Date? = nil) {
        self.cursor = cursor
        self.lastUpdatedAt = lastUpdatedAt
    }

    /// The message to send right after (re)connecting.
    public var syncMessage: ClientMessage { .sync(since: cursor) }

    /// Applies a `sync.result`. Returns the follow-up message to send if the server has more pages.
    @discardableResult
    public mutating func apply(_ result: SyncResult) -> ClientMessage? {
        if let next = result.cursor, !next.isEmpty { cursor = next }
        observe(result.notifications)
        return result.hasMore ? .sync(since: cursor) : nil
    }

    /// Records notifications seen via any channel (socket events, REST pages).
    public mutating func observe(_ notifications: [OyeeNotification]) {
        for notification in notifications {
            if lastUpdatedAt.map({ notification.updatedAt > $0 }) ?? true {
                lastUpdatedAt = notification.updatedAt
            }
        }
    }

    /// Value for REST `updatedSince`: the newest `updatedAt` seen as ISO-8601, or nil.
    public var updatedSinceParameter: String? {
        lastUpdatedAt.map(OyeeJSON.formatDate)
    }
}
