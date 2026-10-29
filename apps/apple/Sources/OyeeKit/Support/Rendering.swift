import Foundation

/// Platform rendering helpers (protocol §9).
public enum Rendering {
    /// Text progress bar used where native progress isn't available: `▓▓▓░░░░░░░ 3/7`.
    /// Mirrors `progressText` in packages/schema exactly.
    public static func progressText(_ progress: Progress) -> String {
        if progress.indeterminate { return progress.label ?? "In progress…" }
        let max = progress.max
        let ratio = Swift.max(0, Swift.min(1, progress.value / max))
        let filled = Int(jsRound(ratio * 10))
        let bar = String(repeating: "▓", count: filled) + String(repeating: "░", count: 10 - filled)
        let suffix =
            progress.label
            ?? (max == 100 ? "\(Int(jsRound(ratio * 100)))%" : "\(jsNumber(progress.value))/\(jsNumber(max))")
        return "\(bar) \(suffix)"
    }

    /// The body of a system notification: plain-text body + `Label: value` lines + progress text.
    public static func systemBody(for notification: OyeeNotification) -> String {
        var lines: [String] = []
        if let body = notification.body, !body.isEmpty {
            lines.append(MarkdownSubset.plainText(body))
        }
        for field in notification.fields {
            lines.append("\(field.label): \(field.value)")
        }
        if let progress = notification.progress {
            lines.append(progressText(progress))
        }
        return lines.joined(separator: "\n")
    }

    /// System notification title, prefixed with the emoji icon when there is one.
    public static func systemTitle(for notification: OyeeNotification) -> String {
        if let emoji = notification.emojiIcon, emoji.count <= 4 {
            return "\(emoji) \(notification.title)"
        }
        return notification.title
    }

    /// JavaScript `Math.round`: rounds half up (towards +∞).
    static func jsRound(_ value: Double) -> Double {
        (value + 0.5).rounded(.down)
    }

    /// Formats a number like JavaScript's `String(n)` for the common cases (integers without `.0`).
    static func jsNumber(_ value: Double) -> String {
        if value.isFinite, value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }
}

/// Relative times that never point into the future. A brand-new notification can be stamped a moment "after" this
/// device's clock (server and local clocks drift), which the system formatters render as "in 0 sec".
public enum RelativeTime {
    /// Compact list time: "now" for the last 45 seconds (or anything slightly in the future), else "3 min ago".
    /// Same "now" window as the web and Android clients.
    public static func short(_ date: Date, now: Date = Date()) -> String {
        if now.timeIntervalSince(date) < 45 { return "now" }
        return date.formatted(.relative(presentation: .numeric, unitsStyle: .narrow))
    }

    /// Spelled-out time for system lines ("2 minutes ago", "yesterday"), clamped to now.
    public static func named(_ date: Date, now: Date = Date()) -> String {
        if now.timeIntervalSince(date) < 45 { return "just now" }
        return date.formatted(.relative(presentation: .named))
    }
}
