import Foundation

/// The buttons a system notification gets, per intent, as `UNNotificationCategory` plans.
///
/// macOS/iOS attach buttons to a notification through its category, so every distinct button set gets its own
/// category, identified by a stable hash of what the buttons show. An open ask gets its answer buttons and, when it
/// takes text, a text-input "Reply" action; an inform gets its link buttons; a progress and a closed ask get none.
/// Swift's `Hasher` is randomly seeded per process, so the hash is FNV-1a (64-bit), stable across launches.
public enum NotificationCategories {
    public static let prefix = "oyee.cat."
    public static let answerPrefix = "oyee.answer."
    public static let linkPrefix = "oyee.link."
    public static let replyActionIdentifier = "oyee.reply"

    public struct Button: Hashable, Sendable {
        /// The `UNNotificationAction` identifier: `oyee.answer.<option label>` or `oyee.link.<index>`.
        public var identifier: String
        public var title: String
        /// Link buttons bring the browser forward; answers are sent in the background.
        public var opensURL: Bool
    }

    public struct Plan: Hashable, Sendable {
        public var id: String
        public var buttons: [Button]
        /// Placeholder of the text-input "Reply" action, when the ask takes text.
        public var textInput: String?
    }

    /// The category for this notification, or nil when it has nothing to press.
    public static func plan(for n: OyeeNotification) -> Plan? {
        var buttons: [Button] = []
        var textInput: String?
        switch n.content {
        case .ask(let ask) where ask.state == .open:
            buttons = ask.options.map { Button(identifier: answerPrefix + $0, title: $0, opensURL: false) }
            if ask.allowText || ask.options.isEmpty {
                textInput = ask.replyPlaceholder?.isEmpty == false ? ask.replyPlaceholder : "Reply…"
            }
        case .inform:
            buttons = InformCardModel(n).links.enumerated().map {
                Button(identifier: linkPrefix + String($0.offset), title: $0.element.label, opensURL: true)
            }
        default:
            break
        }
        guard !buttons.isEmpty || textInput != nil else { return nil }
        return Plan(id: prefix + fnv1a64Hex(canonicalDescription(buttons, textInput)), buttons: buttons, textInput: textInput)
    }

    /// Canonical, order-preserving description of everything that changes how the category looks or behaves.
    static func canonicalDescription(_ buttons: [Button], _ textInput: String?) -> String {
        var parts = ["v2"]
        for b in buttons {
            parts.append([escape(b.identifier), escape(b.title), b.opensURL ? "u" : "r"].joined(separator: "\u{1F}"))
        }
        if let textInput { parts.append(["reply", escape(textInput)].joined(separator: "\u{1F}")) }
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

    /// The answer-button label behind a UN action identifier.
    public static func answerOption(from identifier: String) -> String? {
        guard identifier.hasPrefix(answerPrefix) else { return nil }
        return String(identifier.dropFirst(answerPrefix.count))
    }

    /// The link-button index behind a UN action identifier.
    public static func linkIndex(from identifier: String) -> Int? {
        guard identifier.hasPrefix(linkPrefix) else { return nil }
        return Int(identifier.dropFirst(linkPrefix.count))
    }
}
