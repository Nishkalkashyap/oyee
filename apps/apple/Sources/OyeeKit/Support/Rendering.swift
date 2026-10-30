import Foundation

/// Platform rendering helpers (protocol §8–9): the text of a system notification, per intent.
public enum Rendering {
    /// Text progress bar used where native progress isn't available: `▓▓▓░░░░░░░ 3/7`.
    /// Mirrors `progressText` in packages/schema exactly.
    public static func progressText(_ progress: ProgressBlock) -> String {
        let max = progress.max
        let ratio = Swift.max(0, Swift.min(1, progress.value / max))
        let filled = Int(jsRound(ratio * 10))
        let bar = String(repeating: "▓", count: filled) + String(repeating: "░", count: 10 - filled)
        let suffix =
            progress.label
            ?? (max == 100 ? "\(Int(jsRound(ratio * 100)))%" : "\(jsNumber(progress.value))/\(jsNumber(max))")
        return "\(bar) \(suffix)"
    }

    /// "Stopped reporting after 3/7 checks" or "… after 40%". Mirrors `stoppedReportingLabel` in packages/schema
    /// exactly: the sender's last label, else the rounded percent.
    public static func stoppedReportingLabel(_ progress: ProgressBlock) -> String {
        let ratio = progress.max > 0 ? Swift.max(0, Swift.min(1, progress.value / progress.max)) : 0
        return "Stopped reporting after \(progress.label ?? "\(Int(jsRound(ratio * 100)))%")"
    }

    /// The body of a system notification (same text as the browser popup, apps/web/src/lib/webpush.ts): the
    /// plain-text body, then an inform's `Label: value` rows or a progress's line (the text bar while running,
    /// "Done · 7/7 checks" / "Failed · 4/7 checks" once ended, "Stopped reporting after 40%" when stopped).
    public static func systemBody(for notification: OyeeNotification) -> String {
        var lines: [String] = []
        if let body = notification.body {
            let plain = MarkdownSubset.plainText(body).trimmingCharacters(in: .whitespacesAndNewlines)
            if !plain.isEmpty { lines.append(plain) }
        }
        switch notification.content {
        case .inform(let inform):
            lines += inform.fields.map { "\($0.label): \($0.value)" }
        case .ask:
            break
        case .progress(let progress):
            let card = ProgressCardModel(progress)
            switch progress.state {
            case .running: lines.append(progressText(progress))
            case .stopped: lines.append(card.stateLabel)
            case .done, .failed: lines.append("\(card.stateLabel) · \(card.amount)")
            }
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
