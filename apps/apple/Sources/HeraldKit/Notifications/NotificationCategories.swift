import Foundation

/// Stable identifiers for dynamic `UNNotificationCategory`s.
///
/// iOS/macOS attach action buttons to a notification through its category, so every distinct action set gets its
/// own category whose id is a stable hash of the action ids/labels/styles, whether each one opens a URL, and the reply
/// box. Swift's `Hasher` is randomly seeded per process, so we use FNV-1a (64-bit) for stability across launches.
public enum NotificationCategories {
    public static let prefix = "herald.cat."
    public static let actionPrefix = "herald.action."
    public static let replyActionIdentifier = "herald.reply"

    /// The category id for an action set, or `nil` when there are no buttons and no reply box.
    public static func categoryIdentifier(actions: [Action], reply: Reply?) -> String? {
        guard !actions.isEmpty || reply != nil else { return nil }
        return prefix + fnv1a64Hex(canonicalDescription(actions: actions, reply: reply))
    }

    public static func categoryIdentifier(for notification: HeraldNotification) -> String? {
        categoryIdentifier(actions: notification.actions, reply: notification.reply)
    }

    /// Canonical, order-preserving description of everything that changes how the category looks or behaves.
    static func canonicalDescription(actions: [Action], reply: Reply?) -> String {
        var parts: [String] = ["v1"]
        for action in actions {
            parts.append(
                ["a", escape(action.id), escape(action.label), action.style.rawValue, action.url == nil ? "r" : "u"]
                    .joined(separator: "\u{1F}"))
        }
        if let reply {
            parts.append(
                ["reply", escape(reply.placeholder ?? ""), escape(reply.buttonLabel ?? "")].joined(separator: "\u{1F}"))
        }
        return parts.joined(separator: "\u{1E}")
    }

    private static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "\u{1F}", with: " ").replacingOccurrences(of: "\u{1E}", with: " ")
    }

    /// FNV-1a 64-bit hash, hex encoded (16 chars).
    public static func fnv1a64Hex(_ string: String) -> String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in string.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01b3
        }
        let hex = String(hash, radix: 16)
        return String(repeating: "0", count: 16 - hex.count) + hex
    }

    /// UN action identifier for a Herald action id.
    public static func actionIdentifier(for actionId: String) -> String { actionPrefix + actionId }

    /// Herald action id from a UN action identifier.
    public static func heraldActionId(from identifier: String) -> String? {
        guard identifier.hasPrefix(actionPrefix) else { return nil }
        return String(identifier.dropFirst(actionPrefix.count))
    }
}
