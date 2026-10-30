import Foundation

// How the active inbox is laid out (same rules as the web, apps/web/src/lib/inbox.ts): live progress, then what's
// waiting on you, then everything else with repeats stacked into one row.

extension OyeeNotification {
    /// An unanswered question: buttons that call back (not links) or a reply box, with no response yet.
    public var needsAnswer: Bool {
        guard status == .active, responses.isEmpty else { return false }
        return reply != nil || actions.contains { $0.url == nil }
    }

    /// A job that's still running (progress below its max, or an indeterminate bar).
    public var isInProgress: Bool {
        guard status == .active, let p = progress else { return false }
        return p.indeterminate || p.value < p.max
    }

    /// Repeats collapse by thread, otherwise by source + title.
    public var stackKey: String { threadId.map { "thread:\($0)" } ?? "title:\(source)\u{0}\(title)" }
}

/// Newest first; the first item is the row that's shown.
public struct InboxStack: Identifiable, Hashable, Sendable {
    public let id: String
    public let items: [OyeeNotification]
    public var head: OyeeNotification { items[0] }
}

public struct InboxSection: Identifiable, Hashable, Sendable {
    public enum Kind: String, Sendable { case needsYou, inProgress, updates }
    public let kind: Kind
    public let stacks: [InboxStack]
    public var id: String { kind.rawValue }

    public var title: String {
        switch kind {
        case .needsYou: "Needs you"
        case .inProgress: "In progress"
        case .updates: "Updates"
        }
    }

    /// Splits a createdAt-desc list into sections, dropping empty ones. Only Updates stacks repeats.
    public static func split(_ items: [OyeeNotification]) -> [InboxSection] {
        var needs: [InboxStack] = []
        var live: [InboxStack] = []
        var order: [String] = []
        var groups: [String: [OyeeNotification]] = [:]
        for n in items {
            if n.isInProgress {
                // A running job's buttons (Pause, Roll back) are controls, not questions.
                live.append(InboxStack(id: n.id, items: [n]))
            } else if n.needsAnswer {
                needs.append(InboxStack(id: n.id, items: [n]))
            } else {
                let key = n.stackKey
                if groups[key] == nil { order.append(key) }
                groups[key, default: []].append(n)
            }
        }
        return [
            InboxSection(kind: .needsYou, stacks: needs),
            InboxSection(kind: .inProgress, stacks: live),
            InboxSection(kind: .updates, stacks: order.map { InboxStack(id: $0, items: groups[$0]!) }),
        ].filter { !$0.stacks.isEmpty }
    }

    /// One row per item, for search results and the resolved list.
    public static func flat(_ items: [OyeeNotification]) -> [InboxSection] {
        items.isEmpty ? [] : [InboxSection(kind: .updates, stacks: items.map { InboxStack(id: $0.id, items: [$0]) })]
    }
}

extension InboxStore {
    /// The list as shown: sections and stacks for the everyday view, a flat list for search, other tabs or filters.
    public var sections: [InboxSection] {
        let visible = visibleNotifications
        return filter.status == .active && filter.isUnnarrowed ? InboxSection.split(visible) : InboxSection.flat(visible)
    }

    /// The notification to open after `id` is resolved: the next row on screen, else the previous one.
    public func nextSelection(afterResolving ids: Set<String>, current: String) -> String? {
        let order = sections.flatMap { $0.stacks.flatMap(\.items) }.map(\.id)
        guard let at = order.firstIndex(of: current) else { return nil }
        return (order[(at + 1)...] + order[..<at].reversed()).first { !ids.contains($0) }
    }
}
