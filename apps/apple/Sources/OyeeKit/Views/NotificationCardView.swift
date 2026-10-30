import SwiftUI

/// A Oyee card in Gluon's language. Full size it is the white message bubble of the conversation view (severity
/// pill, bold title, body, fields, ink progress, image, link, pill actions, and a Resolve footer when `onResolve` is
/// set); `compact` is the menu-bar row with an avatar, the essentials, small pill actions and a ✓ that resolves it
/// (or its whole stack of repeats, `stackCount` > 1).
public struct NotificationCardView: View {
    let notification: OyeeNotification
    let store: InboxStore
    var compact: Bool
    var stackCount: Int
    /// Unread styling for the row; a stack passes whether any of its repeats is unread.
    var unread: Bool
    var onResolve: (() -> Void)?

    @ViewState private var busyAction: String?

    public init(
        notification: OyeeNotification, store: InboxStore, compact: Bool = false, stackCount: Int = 1,
        unread: Bool? = nil, onResolve: (() -> Void)? = nil
    ) {
        self.notification = notification
        self.store = store
        self.compact = compact
        self.stackCount = stackCount
        self.unread = unread ?? !notification.isRead
        self.onResolve = onResolve
    }

    private var n: OyeeNotification { notification }

    public var body: some View {
        if compact { compactBody } else { bubble }
    }

    // MARK: Bubble

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 10) {
            FlowRow {
                SeverityPill(n.severity)
                if n.isResolved {
                    Label("Resolved", systemImage: "checkmark")
                        .font(.oyee(11.5, .semibold))
                        .foregroundStyle(Theme.background)
                        .padding(.horizontal, 9)
                        .frame(height: 22)
                        .background(Theme.foreground, in: Capsule())
                }
                ForEach(n.tags.prefix(5), id: \.self) { tag in
                    Text("#\(tag)")
                        .font(.oyee(11.5, .semibold))
                        .foregroundStyle(Theme.secondaryLabel)
                        .padding(.horizontal, 9)
                        .frame(height: 22)
                        .background(Theme.secondary, in: Capsule())
                }
            }
            Text(n.title)
                .font(.oyee(18, .bold))
                .foregroundStyle(Theme.foreground)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            if let body = n.body, !body.isEmpty {
                Text(MarkdownSubset.attributed(body))
                    .font(.oyee(14.5))
                    .foregroundStyle(Theme.secondaryLabel)
                    .lineSpacing(2)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let imageURL = n.imageURL { image(imageURL) }
            if !n.fields.isEmpty { fieldsGrid(limit: 10) }
            if let progress = n.progress { NotificationProgressView(progress: progress).padding(.top, 2) }
            if let url = n.openURL {
                Button {
                    store.openURL(url)
                } label: {
                    Label(url.host() ?? url.absoluteString, systemImage: "arrow.up.right")
                        .font(.oyee(13, .medium))
                        .foregroundStyle(Theme.foreground)
                        .underline(color: Theme.faint)
                }
                .buttonStyle(.plain)
            }
            if !n.actions.isEmpty, n.status == .active { actionButtons(size: .regular).padding(.top, 2) }
            if let onResolve, n.status == .active {
                // The card's own control, under a hairline so it doesn't read as one of the agent's buttons.
                Divider().overlay(Theme.border).padding(.top, 4)
                Button(action: onResolve) {
                    Label("Resolve", systemImage: "checkmark")
                }
                .buttonStyle(PillButtonStyle(.primary, size: .small))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            UnevenRoundedRectangle(
                topLeadingRadius: 22, bottomLeadingRadius: 6, bottomTrailingRadius: 22, topTrailingRadius: 22,
                style: .continuous
            )
            .fill(Theme.bubble)
        )
    }

    // MARK: Compact (menu bar)

    private var compactBody: some View {
        HStack(alignment: .top, spacing: 10) {
            SourceAvatar(name: n.source, size: 32, severity: n.severity)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(n.title)
                        .font(.oyee(13.5, .semibold))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(2)
                    if stackCount > 1 { StackCount(stackCount) }
                    Spacer(minLength: 4)
                    RelativeTimeText(n.createdAt)
                        .font(.oyee(11.5, unread ? .semibold : .regular))
                        .foregroundStyle(unread ? Theme.brand : Theme.muted)
                }
                Text(subtitle)
                    .font(.oyee(12.5))
                    .foregroundStyle(unread ? Theme.secondaryLabel : Theme.muted)
                    .lineLimit(2)
                if let progress = n.progress, n.status == .active {
                    NotificationProgressView(progress: progress, showLabel: false).padding(.top, 4)
                }
                if !n.actions.isEmpty, n.status == .active {
                    actionButtons(size: .small).padding(.top, 5)
                }
            }
            if n.status == .active {
                // One tap to resolve: it leaves the menu bar (and the default inbox view) on every device.
                Button {
                    if let onResolve { onResolve() } else { Task { await store.resolve(n.id) } }
                } label: {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .frame(width: 24, height: 24)
                        .background(Theme.secondary, in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.secondaryLabel)
                .help(stackCount > 1 ? "Resolve all \(stackCount)" : "Resolve")
                .accessibilityLabel(stackCount > 1 ? "Resolve all \(stackCount)" : "Resolve")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        let body = n.body.map(MarkdownSubset.plainText) ?? ""
        return body.isEmpty ? n.source : "\(n.source) · \(body)"
    }

    // MARK: Parts

    private func fieldsGrid(limit: Int) -> some View {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 5) {
            ForEach(Array(n.fields.prefix(limit).enumerated()), id: \.offset) { _, field in
                GridRow {
                    Text(field.label)
                        .foregroundStyle(Theme.muted)
                        .gridColumnAlignment(.leading)
                    Text(field.value)
                        .font(.oyee(13.5, .medium))
                        .foregroundStyle(Theme.foreground)
                        .textSelection(.enabled)
                }
            }
        }
        .font(.oyee(13.5))
    }

    private func image(_ url: URL) -> some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            case .failure:
                Label("Image unavailable", systemImage: "photo").font(.oyee(12)).foregroundStyle(Theme.muted)
            default:
                ProgressView().frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .frame(maxHeight: 320)
    }

    private func actionButtons(size: PillButtonStyle.Size) -> some View {
        HStack(spacing: 6) {
            ForEach(n.actions) { action in
                Button {
                    busyAction = action.id
                    Task {
                        await store.perform(action, on: n)
                        busyAction = nil
                    }
                } label: {
                    HStack(spacing: 4) {
                        if busyAction == action.id {
                            ProgressView().controlSize(.mini)
                        } else if action.url != nil {
                            Image(systemName: "arrow.up.right")
                        }
                        Text(action.label)
                    }
                }
                .buttonStyle(PillButtonStyle(variant(for: action), size: size))
                .disabled(busyAction != nil)
            }
        }
    }

    private func variant(for action: Action) -> PillButtonStyle.Variant {
        switch action.style {
        case .primary: .primary
        case .destructive: .destructive
        default: .secondary
        }
    }
}

/// Gluon's list row: the source's tinted avatar (a red or amber mark only for critical and warning), title, time
/// (blue while unread), preview. Blue means unread and nothing else. `count` > 1 makes it the head of a stack of
/// repeats. `hideTrailing` hides the time and unread dot while the list's hover ✓ sits on top of them.
public struct NotificationRowView: View {
    let notification: OyeeNotification
    var selected: Bool
    var count: Int
    var unread: Bool
    var child: Bool
    var highlighted: Bool
    var hideTrailing: Bool

    public init(
        notification: OyeeNotification, selected: Bool = false, count: Int = 1, unread: Bool? = nil, child: Bool = false,
        highlighted: Bool = false, hideTrailing: Bool = false
    ) {
        self.notification = notification
        self.selected = selected
        self.count = count
        self.unread = unread ?? (!notification.isRead && notification.status == .active)
        self.child = child
        self.highlighted = highlighted
        self.hideTrailing = hideTrailing
    }

    public var body: some View {
        let n = notification
        let showResolve = hideTrailing
        HStack(spacing: 12) {
            SourceAvatar(name: n.source, size: child ? 34 : 44, severity: n.severity)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(n.title)
                        .font(.oyee(15, unread ? .semibold : .medium))
                        .foregroundStyle(unread ? Theme.foreground : n.isResolved ? Theme.muted : Theme.secondaryLabel)
                        .lineLimit(1)
                    if count > 1 { StackCount(count) }
                    Spacer(minLength: 4)
                    RelativeTimeText(n.createdAt)
                        .font(.oyee(12, unread ? .semibold : .regular))
                        .foregroundStyle(unread ? Theme.brand : Theme.muted)
                        .monospacedDigit()
                        .opacity(showResolve ? 0 : 1)
                }
                HStack(spacing: 8) {
                    Text(preview)
                        .font(.oyee(13.5))
                        .foregroundStyle(unread ? Theme.secondaryLabel : Theme.muted)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if !n.responses.isEmpty {
                        Label("\(n.responses.count)", systemImage: "arrowshape.turn.up.left")
                            .font(.oyee(11.5))
                            .foregroundStyle(Theme.muted)
                    }
                    if n.isResolved {
                        Image(systemName: "checkmark").font(.oyee(12, .bold)).foregroundStyle(Color(hex: 0x16A34A))
                    }
                    if unread {
                        Circle().fill(Theme.brand).frame(width: 9, height: 9).accessibilityLabel("Unread")
                            .opacity(showResolve ? 0 : 1)
                    }
                }
                if let progress = n.progress, n.status == .active {
                    NotificationProgressView(progress: progress, showLabel: false).padding(.top, 5)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            selected ? Theme.rowSelected : highlighted ? Theme.secondary.opacity(0.6) : .clear,
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var preview: String {
        let body = notification.body.map(MarkdownSubset.plainText)?.replacingOccurrences(of: "\n", with: " ") ?? ""
        if child { return body.isEmpty ? notification.source : body }
        return body.isEmpty ? notification.source : "\(notification.source) · \(body)"
    }
}

/// The grey count beside a stacked row's title.
struct StackCount: View {
    let count: Int
    init(_ count: Int) { self.count = count }

    var body: some View {
        Text("\(count)")
            .font(.oyee(11, .semibold))
            .monospacedDigit()
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(Theme.secondary, in: Capsule())
            .accessibilityLabel("\(count) in this stack")
    }
}

/// Gluon's composer: a rounded bubble field with a blue send button.
public struct ReplyComposer: View {
    let placeholder: String
    let onSend: (String) async -> Void
    @ViewState private var text = ""
    @ViewState private var sending = false

    public init(placeholder: String, onSend: @escaping (String) async -> Void) {
        self.placeholder = placeholder
        self.onSend = onSend
    }

    private var canSend: Bool { !sending && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    public var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            TextField(placeholder, text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.oyee(14.5))
                .lineLimit(1...5)
                .padding(.vertical, 8)
                .onSubmit(send)
            Button(action: send) {
                Image(systemName: sending ? "ellipsis" : "arrow.up")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.brandForeground)
                    .frame(width: 34, height: 34)
                    .background(Theme.brand.opacity(canSend ? 1 : 0.4), in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .keyboardShortcut(.return, modifiers: .command)
        }
        .padding(.leading, 16)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .background(Theme.bubble, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.05), radius: 3, y: 1)
    }

    private func send() {
        let value = text
        guard canSend else { return }
        sending = true
        Task {
            await onSend(value)
            text = ""
            sending = false
        }
    }
}

/// Wraps its children onto new lines (pills, tags).
struct FlowRow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += line + spacing
                line = 0
            }
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            line = max(line, size.height)
        }
        return CGSize(width: maxX, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += line + spacing
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

extension View {
    /// A system-style "secondary text" line centered in the conversation (updates, resolution, timestamps).
    func systemLine() -> some View {
        self.font(.oyee(12)).foregroundStyle(Theme.muted).frame(maxWidth: .infinity)
    }
}
