import Foundation

// What each intent's card shows, derived from the notification. Pure, so the labels are unit-tested on the shared
// fixtures; the SwiftUI cards only lay them out. Same wording as the web (apps/web/src/lib/ask.ts, progress.ts,
// inform.ts).

/// The ask card (GLOSSARY.md: Ask, Answer button, Expiry).
public struct AskCardModel: Hashable, Sendable {
    public struct Option: Hashable, Sendable {
        public var label: String
        /// The answer that was picked.
        public var chosen: Bool
    }

    /// The ask's state; an open ask past its expiry already counts as `expired` (the server's broadcast follows).
    public var state: AskState
    /// Answer buttons and the reply box only work while the ask is open.
    public var isOpen: Bool { state == .open }
    public var options: [Option]
    /// The reply box's placeholder, while the ask is open and takes text.
    public var replyPlaceholder: String?
    /// "Just asked", "Waiting 12m", "Answered: Approve · Pixel 9", "Expired" or "Withdrawn".
    public var status: String
    /// "Expires in 48m" while the ask is open.
    public var expiry: String?
    /// Why an expired or withdrawn ask can't be answered.
    public var note: String?

    public init(_ n: OyeeNotification, now: Date = Date()) {
        let ask = n.ask ?? AskBlock(state: .withdrawn)
        let left = ask.expiresAt.map { $0.timeIntervalSince(now) }
        let state: AskState = ask.state == .open && (left ?? 1) <= 0 ? .expired : ask.state
        self.state = state
        options = ask.options.map { Option(label: $0, chosen: ask.answer?.option == $0) }
        replyPlaceholder =
            state == .open && ask.allowText
            ? (ask.replyPlaceholder?.isEmpty == false ? ask.replyPlaceholder : "Reply…") : nil
        switch state {
        case .answered where ask.answer != nil:
            let answer = ask.answer!
            let what = [answer.option, answer.text].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: ": ")
            status = "Answered: \(what)" + (answer.deviceName.map { " · \($0)" } ?? "")
        case .answered: status = "Answered"
        case .expired: status = "Expired"
        case .withdrawn: status = "Withdrawn"
        case .open:
            let waited = now.timeIntervalSince(n.createdAt)
            status = waited < 60 ? "Just asked" : "Waiting \(Self.waited(waited))"
        }
        if state == .open, let left {
            expiry = left < 60 ? "Expires in under a minute" : "Expires in \(Self.span(left))"
        } else {
            expiry = nil
        }
        switch state {
        case .expired:
            let lifetime = ask.expiresAt.map { Self.span($0.timeIntervalSince(n.createdAt)) }
            note =
                lifetime.map { "Nobody answered within \($0), so the question was closed on every device." }
                ?? "Nobody answered in time, so the question was closed on every device."
        case .withdrawn: note = "The sender withdrew this question before it was answered."
        default: note = nil
        }
    }

    /// "12m", "2h", "3d": how long the ask has been waiting (rounded down).
    static func waited(_ seconds: TimeInterval) -> String { Rendering.duration(seconds) }

    /// "30s", "48m", "1h", "2h 30m": how long the ask was answerable or has left.
    static func span(_ seconds: TimeInterval) -> String { Rendering.duration(seconds, span: true) }
}

/// The progress card and rows.
public struct ProgressCardModel: Hashable, Sendable {
    /// Bar and state pill colour: ink while running (docs/design.md), the outcome's colour once it ended, faint when
    /// it stopped reporting.
    public enum Tone: Sendable, Hashable { case ink, success, warning, muted }

    public var state: ProgressState
    /// "Running", "Done", "Failed" or "Stopped reporting after 40%".
    public var stateLabel: String
    /// The sender's label, else "40%" (max 100) or "3/7".
    public var amount: String
    /// 0...100.
    public var percent: Double
    public var tone: Tone

    public init(_ p: ProgressBlock) {
        state = p.state
        percent = p.fraction * 100
        amount = Rendering.progressAmount(p)
        switch p.state {
        case .running: (stateLabel, tone) = ("Running", .ink)
        case .done: (stateLabel, tone) = ("Done", .success)
        case .failed: (stateLabel, tone) = ("Failed", .warning)
        case .stopped: (stateLabel, tone) = (Rendering.stoppedReportingLabel(p), .muted)
        }
    }
}

/// The inform card (GLOSSARY.md: Inform, Link button).
public struct InformCardModel: Hashable, Sendable {
    public enum Icon: Hashable, Sendable {
        case emoji(String)
        case image(URL)
    }

    public struct Link: Hashable, Sendable {
        public var label: String
        public var url: URL
    }

    public var severity: Severity
    public var resolved: Bool
    /// The sender's emoji (at most two characters) or image; nil falls back to the severity symbol.
    public var icon: Icon?
    public var image: URL?
    /// Label/value rows; an empty value reads "—".
    public var rows: [Field]
    /// Link buttons, at most three, only with URLs safe to open.
    public var links: [Link]
    /// Where tapping the notification goes.
    public var open: Destination?

    public struct Destination: Hashable, Sendable {
        public var url: URL
        public var host: String
    }

    public init(_ n: OyeeNotification) {
        let inform = n.inform ?? InformBlock()
        severity = n.severity
        resolved = n.isResolved
        let icon = inform.icon?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if icon.isEmpty {
            self.icon = nil
        } else if let url = Self.webURL(icon) {
            self.icon = .image(url)
        } else {
            self.icon = .emoji(String(icon.prefix(2)))
        }
        image = inform.image.flatMap(Self.webURL)
        rows = inform.fields.map { Field(label: $0.label, value: $0.value.isEmpty ? "—" : $0.value) }
        links = inform.links.compactMap { link in Self.webURL(link.url).map { Link(label: link.label, url: $0) } }
            .prefix(3).map { $0 }
        open = n.url.flatMap(Self.webURL).map { Destination(url: $0, host: $0.host() ?? $0.absoluteString) }
    }

    /// An http(s) URL, or nil for anything else (javascript:, file:, garbage).
    static func webURL(_ string: String) -> URL? {
        guard let url = URL(string: string), let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              url.host() != nil
        else { return nil }
        return url
    }
}
