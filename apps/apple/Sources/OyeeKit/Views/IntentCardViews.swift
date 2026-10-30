import SwiftUI

// One purpose-built card per intent (GLOSSARY.md), drawn from the pure card models in Support/IntentCards.swift and
// matching the web's InformCard, AskCard and ProgressCard: the white message bubble of the conversation view.

/// The clock the cards read ("Waiting 12m", "Expires in 48m"). Nil = the live clock; screenshots pin it.
struct OyeeNowKey: EnvironmentKey {
    static let defaultValue: Date? = nil
}

extension EnvironmentValues {
    public var oyeeNow: Date? {
        get { self[OyeeNowKey.self] }
        set { self[OyeeNowKey.self] = newValue }
    }
}

/// The card for a notification's intent.
public struct IntentCardView: View {
    let notification: OyeeNotification
    let store: InboxStore
    var onResolve: (() -> Void)?

    public init(notification: OyeeNotification, store: InboxStore, onResolve: (() -> Void)? = nil) {
        self.notification = notification
        self.store = store
        self.onResolve = onResolve
    }

    public var body: some View {
        CardBubble(footer: notification.status == .active ? onResolve : nil) {
            switch notification.content {
            case .inform: InformCardView(notification: notification, store: store)
            case .ask: AskCardView(notification: notification, store: store)
            case .progress(let progress): ProgressCardView(notification: notification, progress: progress, store: store)
            }
        }
    }
}

/// The white bubble with one 6pt corner toward the speaker, and the card's own Resolve under a hairline.
struct CardBubble<Content: View>: View {
    var footer: (() -> Void)?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            content
            if let footer {
                // The card's own control, under a hairline so it doesn't read as one of the sender's buttons.
                Divider().overlay(Theme.border).padding(.top, 4)
                Button(action: footer) {
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
}

// MARK: - Inform

/// Something the user should know: icon and severity pill, the title, the markdown body, an image, label/value rows
/// in a soft inset, and up to three link buttons. One-way, so nothing on it answers back.
struct InformCardView: View {
    let notification: OyeeNotification
    let store: InboxStore

    var body: some View {
        let card = InformCardModel(notification)
        HStack(alignment: .top, spacing: 12) {
            InformIcon(icon: card.icon, severity: card.severity)
            VStack(alignment: .leading, spacing: 6) {
                FlowRow {
                    SeverityPill(card.severity)
                    if card.resolved { ResolvedBadge() }
                }
                CardTitle(notification.title)
            }
        }
        CardBody(notification.body)
        if let image = card.image { CardImage(url: image) }
        if !card.rows.isEmpty {
            VStack(spacing: 0) {
                ForEach(Array(card.rows.enumerated()), id: \.offset) { index, row in
                    if index > 0 { Divider().overlay(Theme.border) }
                    HStack(alignment: .firstTextBaseline, spacing: 16) {
                        Text(row.label).foregroundStyle(Theme.muted)
                        Spacer(minLength: 8)
                        Text(row.value)
                            .font(.oyee(13.5, .medium))
                            .foregroundStyle(Theme.foreground)
                            .multilineTextAlignment(.trailing)
                            .textSelection(.enabled)
                    }
                    .padding(.vertical, 8)
                }
            }
            .font(.oyee(13.5))
            .padding(.horizontal, 14)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        if !card.links.isEmpty || card.open != nil {
            FlowRow {
                ForEach(Array(card.links.enumerated()), id: \.offset) { index, link in
                    Button {
                        store.openURL(link.url)
                        Task { await store.markRead(notification.id) }
                    } label: {
                        HStack(spacing: 4) {
                            Text(link.label)
                            Image(systemName: "arrow.up.right")
                        }
                    }
                    .buttonStyle(PillButtonStyle(index == 0 ? .primary : .secondary))
                    .help(link.url.absoluteString)
                }
                if let open = card.open { OpenLink(url: open.url, label: open.host, store: store) }
            }
            .padding(.top, 2)
        }
    }
}

/// The inform's emoji or image on its severity's soft circle, else the severity symbol.
struct InformIcon: View {
    let icon: InformCardModel.Icon?
    let severity: Severity

    var body: some View {
        Group {
            switch icon {
            case .emoji(let emoji):
                Text(emoji).font(.system(size: 19))
            case .image(let url):
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    symbol
                }
            case nil:
                symbol
            }
        }
        .frame(width: 40, height: 40)
        .background(severity.color.opacity(0.13))
        .clipShape(Circle())
        .accessibilityHidden(true)
    }

    private var symbol: some View {
        Image(systemName: severity.symbolName).font(.system(size: 17, weight: .semibold)).foregroundStyle(severity.color)
    }
}

// MARK: - Ask

/// The question as a message bubble: a status pill saying how long it has waited (and when it expires) or who answered
/// it, the question, and its answer buttons. Once answered, expired or withdrawn nothing is pressable; a closed,
/// unanswered ask is muted and says why. The reply box is the conversation's composer (NotificationDetailView).
struct AskCardView: View {
    let notification: OyeeNotification
    let store: InboxStore
    @Environment(\.oyeeNow) private var pinnedNow
    @ViewState private var busy: String?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            content(AskCardModel(notification, now: pinnedNow ?? context.date))
        }
    }

    @ViewBuilder
    private func content(_ card: AskCardModel) -> some View {
        let closed = card.state == .expired || card.state == .withdrawn
        VStack(alignment: .leading, spacing: 10) {
            FlowRow {
                AskStatusPill(card: card)
                if let expiry = card.expiry {
                    Label(expiry, systemImage: "clock")
                        .font(.oyee(12))
                        .foregroundStyle(Theme.muted)
                        .frame(height: 22)
                }
            }
            CardTitle(notification.title, muted: closed)
            CardBody(notification.body, muted: closed)
            if let url = notification.openURL { OpenLink(url: url, label: url.absoluteString, store: store) }
            if !card.options.isEmpty {
                FlowRow(spacing: 8) {
                    ForEach(Array(card.options.enumerated()), id: \.offset) { index, option in
                        Button {
                            busy = option.label
                            Task {
                                await store.answer(option.label, to: notification)
                                busy = nil
                            }
                        } label: {
                            HStack(spacing: 5) {
                                if busy == option.label {
                                    ProgressView().controlSize(.mini)
                                } else if option.chosen {
                                    Image(systemName: "checkmark")
                                }
                                Text(option.label)
                            }
                        }
                        .buttonStyle(PillButtonStyle(option.chosen || (card.isOpen && index == 0) ? .primary : .secondary))
                        .disabled(!card.isOpen || busy != nil)
                        .opacity(!card.isOpen && !option.chosen ? 0.55 : 1)
                    }
                }
                .padding(.top, 2)
            }
            if let note = card.note {
                Text(note)
                    .font(.oyee(13))
                    .foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// "● Waiting 12m" in the warning colours while open (an ask always alerts at warning), an ink "✓ Answered: …" pill,
/// or a grey "Expired" / "Withdrawn" one.
struct AskStatusPill: View {
    let card: AskCardModel

    var body: some View {
        switch card.state {
        case .open:
            Pill(text: card.status, ink: Severity.warning.color, fill: Severity.warning.color.opacity(0.13)) {
                Circle().fill(Severity.warning.color).frame(width: 6, height: 6)
            }
        case .answered:
            Pill(text: card.status, ink: Theme.background, fill: Theme.foreground) {
                Image(systemName: "checkmark").font(.system(size: 9.5, weight: .bold))
            }
        case .expired, .withdrawn:
            Pill(text: card.status, ink: Theme.secondaryLabel, fill: Theme.secondary) {
                Image(systemName: card.state == .withdrawn ? "arrow.uturn.backward" : "clock")
                    .font(.system(size: 9.5, weight: .bold))
            }
        }
    }
}

// MARK: - Progress

/// Long-running work: a state pill, the title, a real bar with its amount and the last report, and for a progress that
/// stopped reporting a line on what that means.
struct ProgressCardView: View {
    let notification: OyeeNotification
    let progress: ProgressBlock
    let store: InboxStore
    @Environment(\.oyeeNow) private var pinnedNow

    var body: some View {
        let card = ProgressCardModel(progress)
        let lastReport = progress.lastReportAt ?? notification.updatedAt
        FlowRow {
            ProgressStatePill(card: card)
            if notification.isResolved { ResolvedBadge() }
        }
        CardTitle(notification.title)
        CardBody(notification.body)
        VStack(alignment: .leading, spacing: 6) {
            TimelineView(.periodic(from: .now, by: 30)) { context in
                let now = pinnedNow ?? context.date
                HStack(alignment: .firstTextBaseline) {
                    Text(card.amount).font(.oyee(13, .semibold)).foregroundStyle(Theme.foreground).lineLimit(1)
                    Spacer(minLength: 8)
                    Group {
                        switch card.state {
                        case .running: Text("\(Int(Rendering.jsRound(card.percent)))%")
                        case .stopped: Text("Last report \(RelativeTime.short(lastReport, now: now))")
                        case .done, .failed: Text("Ended \(RelativeTime.short(lastReport, now: now))")
                        }
                    }
                    .font(.oyee(12))
                    .foregroundStyle(Theme.muted)
                }
            }
            .monospacedDigit()
            ProgressBar(fraction: card.percent / 100, tone: card.tone, height: 8)
                .accessibilityElement()
                .accessibilityLabel(notification.title)
                .accessibilityValue("\(card.amount), \(card.stateLabel)")
            if card.state == .running {
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    Text("Updated \(RelativeTime.named(lastReport, now: pinnedNow ?? context.date))")
                        .font(.oyee(12))
                        .foregroundStyle(Theme.muted)
                }
            }
            if card.state == .stopped {
                Text("No report for over \(progress.staleAfter). It picks up again if \(notification.source) reports.")
                    .font(.oyee(13))
                    .foregroundStyle(Theme.secondaryLabel)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 4)
        if let url = notification.openURL { OpenLink(url: url, label: url.absoluteString, store: store) }
    }
}

/// The progress pill: a dot while running, ✓ when done, ⚠ when it failed or stopped reporting.
struct ProgressStatePill: View {
    let card: ProgressCardModel

    var body: some View {
        let (ink, fill): (Color, Color) =
            switch card.tone {
            case .ink: (Theme.secondaryLabel, Theme.secondary)
            case .success: (Severity.success.color, Severity.success.color.opacity(0.13))
            case .warning: (Severity.warning.color, Severity.warning.color.opacity(0.15))
            case .muted: (Theme.muted, Theme.secondary)
            }
        Pill(text: card.stateLabel, ink: ink, fill: fill) {
            switch card.state {
            case .running: Circle().fill(Theme.foreground).frame(width: 6, height: 6)
            case .done: Image(systemName: "checkmark").font(.system(size: 9.5, weight: .bold))
            case .failed, .stopped: Image(systemName: "exclamationmark.triangle").font(.system(size: 9.5, weight: .bold))
            }
        }
    }
}

// MARK: - Parts

/// A 22pt soft pill with a leading glyph.
struct Pill<Glyph: View>: View {
    let text: String
    let ink: Color
    let fill: Color
    @ViewBuilder var glyph: Glyph

    var body: some View {
        HStack(spacing: 5) {
            glyph
            Text(text).lineLimit(1)
        }
        .font(.oyee(11.5, .semibold))
        .foregroundStyle(ink)
        .padding(.horizontal, 9)
        .frame(height: 22)
        .background(fill, in: Capsule())
    }
}

struct ResolvedBadge: View {
    var body: some View {
        Pill(text: "Resolved", ink: Theme.background, fill: Theme.foreground) {
            Image(systemName: "checkmark").font(.system(size: 9.5, weight: .bold))
        }
    }
}

struct CardTitle: View {
    let text: String
    var muted = false
    init(_ text: String, muted: Bool = false) {
        self.text = text
        self.muted = muted
    }

    var body: some View {
        Text(text)
            .font(.oyee(18, .bold))
            .foregroundStyle(muted ? Theme.muted : Theme.foreground)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
    }
}

struct CardBody: View {
    let text: String?
    var muted = false
    init(_ text: String?, muted: Bool = false) {
        self.text = text
        self.muted = muted
    }

    var body: some View {
        if let text, !text.isEmpty {
            Text(MarkdownSubset.attributed(text))
                .font(.oyee(14.5))
                .foregroundStyle(muted ? Theme.muted : Theme.secondaryLabel)
                .lineSpacing(2)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

struct CardImage: View {
    let url: URL

    var body: some View {
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
}

/// The notification's own `url`, as an underlined link.
struct OpenLink: View {
    let url: URL
    let label: String
    let store: InboxStore

    var body: some View {
        Button {
            store.openURL(url)
        } label: {
            Label(label, systemImage: "arrow.up.right")
                .font(.oyee(13, .medium))
                .foregroundStyle(Theme.foreground)
                .underline(color: Theme.faint)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .buttonStyle(.plain)
        .help(url.absoluteString)
    }
}
