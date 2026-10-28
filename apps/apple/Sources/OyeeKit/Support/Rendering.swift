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
