import SwiftUI

/// A full Herald card: severity, markdown body, fields, live progress, image, actions, reply, responses, and
/// read/resolve/delete controls. `compact` trims it down for the menu bar.
public struct NotificationCardView: View {
    let notification: HeraldNotification
    let store: InboxStore
    var compact: Bool

    @ViewState private var replyText = ""
    @ViewState private var busyAction: String?
    @ViewState private var confirmDelete = false

    public init(notification: HeraldNotification, store: InboxStore, compact: Bool = false) {
        self.notification = notification
        self.store = store
        self.compact = compact
    }

    private var n: HeraldNotification { notification }

    public var body: some View {
        HStack(alignment: .top, spacing: 10) {
            NotificationIconView(notification: n, size: compact ? 22 : 30)
            VStack(alignment: .leading, spacing: compact ? 4 : 8) {
                header
                if let body = n.body, !body.isEmpty {
                    Text(MarkdownSubset.attributed(body))
                        .font(compact ? .callout : .body)
                        .lineLimit(compact ? 3 : nil)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !n.fields.isEmpty { fieldsGrid }
                if let progress = n.progress { NotificationProgressView(progress: progress) }
                if !compact, let imageURL = n.imageURL { image(imageURL) }
                if !n.actions.isEmpty, n.status == .active { actionButtons }
                if let reply = n.reply, n.status == .active, !compact { replyField(reply) }
                if !compact, !n.responses.isEmpty { responsesList }
                if !compact { footer }
            }
        }
        .padding(compact ? 8 : 14)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(n.severity.color.opacity(n.isResolved ? 0.04 : 0.09))
        )
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2)
                .fill(n.severity.color)
                .frame(width: 3)
                .padding(.vertical, 6)
                .opacity(n.isResolved ? 0.3 : 1)
        }
        .confirmationDialog("Delete this notification?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { run("delete") { await store.delete(n.id) } }
        }
    }

    // MARK: Parts

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(n.title)
                    .font(compact ? .subheadline.weight(.semibold) : .headline)
                    .lineLimit(compact ? 2 : nil)
                    .strikethrough(false)
                Spacer(minLength: 4)
                if !n.isRead {
                    Circle().fill(Color.accentColor).frame(width: 7, height: 7).accessibilityLabel("Unread")
                }
                Text(n.createdAt, format: .relative(presentation: .named))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 6) {
                Text(n.source)
                if let thread = n.threadId { Text("· \(thread)").lineLimit(1) }
                if n.isResolved {
                    Label("Resolved", systemImage: "checkmark.seal.fill")
                        .labelStyle(.titleAndIcon)
                        .foregroundStyle(.green)
                }
                if !compact, !n.tags.isEmpty {
                    ForEach(n.tags.prefix(5), id: \.self) { tag in
                        Text(tag)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.secondary.opacity(0.15)))
                    }
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    private var fieldsGrid: some View {
        Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 3) {
            ForEach(Array(n.fields.prefix(compact ? 4 : 10).enumerated()), id: \.offset) { _, field in
                GridRow {
                    Text(field.label)
                        .foregroundStyle(.secondary)
                        .gridColumnAlignment(.leading)
                    Text(field.value)
                        .textSelection(.enabled)
                        .lineLimit(compact ? 1 : nil)
                }
            }
        }
        .font(.callout)
    }

    private func image(_ url: URL) -> some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 8))
            case .failure:
                Label("Image unavailable", systemImage: "photo").font(.caption).foregroundStyle(.secondary)
            default:
                ProgressView().frame(maxWidth: .infinity, minHeight: 80)
            }
        }
        .frame(maxHeight: 320)
    }

    private var actionButtons: some View {
        HStack(spacing: 8) {
            ForEach(n.actions) { action in
                actionButton(action)
            }
        }
    }

    @ViewBuilder
    private func actionButton(_ action: Action) -> some View {
        let button = Button(role: action.style == .destructive ? .destructive : nil) {
            run(action.id) { await store.perform(action, on: n) }
        } label: {
            HStack(spacing: 4) {
                if busyAction == action.id {
                    ProgressView().controlSize(.small)
                } else if action.url != nil {
                    Image(systemName: "arrow.up.right.square")
                }
                Text(action.label).lineLimit(1)
            }
        }
        .controlSize(compact ? .small : .regular)
        .disabled(busyAction != nil)

        if action.style == .primary {
            button.buttonStyle(.borderedProminent)
        } else {
            button.buttonStyle(.bordered)
        }
    }

    private func replyField(_ reply: Reply) -> some View {
        HStack {
            TextField(reply.placeholder ?? "Reply…", text: $replyText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
                .onSubmit(sendReply)
            Button(reply.buttonLabel ?? "Send", action: sendReply)
                .buttonStyle(.borderedProminent)
                .disabled(replyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busyAction != nil)
        }
    }

    private func sendReply() {
        let text = replyText
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        run("reply") {
            await store.reply(text, to: n)
            replyText = ""
        }
    }

    private var responsesList: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Responses").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(Array(n.responses.enumerated()), id: \.offset) { _, response in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: response.text != nil ? "text.bubble" : "hand.tap")
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(responseSummary(response)).font(.callout)
                        Text(
                            "\(response.deviceName ?? "Unknown device") · \(response.at.formatted(.relative(presentation: .named)))"
                        )
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func responseSummary(_ response: Response) -> String {
        var parts: [String] = []
        if let actionId = response.actionId {
            parts.append(n.actions.first(where: { $0.id == actionId })?.label ?? actionId)
        }
        if let text = response.text { parts.append("“\(text)”") }
        return parts.joined(separator: " — ")
    }

    private var footer: some View {
        HStack(spacing: 12) {
            if let url = n.openURL {
                Button {
                    store.openURL(url)
                } label: {
                    Label("Open link", systemImage: "safari")
                }
            }
            Spacer()
            if !n.isRead {
                Button {
                    run("read") { await store.markRead(n.id) }
                } label: {
                    Label("Mark read", systemImage: "envelope.open")
                }
            }
            if n.status == .active {
                Button {
                    run("resolve") { await store.resolve(n.id) }
                } label: {
                    Label("Resolve", systemImage: "checkmark.circle")
                }
            }
            Button(role: .destructive) {
                confirmDelete = true
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .buttonStyle(.borderless)
        .font(.callout)
        .disabled(busyAction != nil)
    }

    private func run(_ key: String, _ work: @escaping @MainActor () async -> Void) {
        busyAction = key
        Task {
            await work()
            busyAction = nil
        }
    }
}

/// A one-line summary row for lists.
public struct NotificationRowView: View {
    let notification: HeraldNotification

    public init(notification: HeraldNotification) { self.notification = notification }

    public var body: some View {
        HStack(alignment: .top, spacing: 10) {
            NotificationIconView(notification: notification, size: 22)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(notification.title)
                        .font(.subheadline.weight(notification.isRead ? .regular : .semibold))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(notification.createdAt, format: .relative(presentation: .numeric))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if let body = notification.body, !body.isEmpty {
                    Text(MarkdownSubset.plainText(body))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                if let progress = notification.progress, notification.status == .active {
                    if progress.indeterminate {
                        ProgressView().progressViewStyle(.linear).controlSize(.mini)
                    } else {
                        ProgressView(value: progress.fraction).controlSize(.mini)
                    }
                }
                HStack(spacing: 4) {
                    Text(notification.source)
                    if notification.isResolved {
                        Image(systemName: "checkmark.seal.fill").foregroundStyle(.green)
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
            if !notification.isRead {
                Circle().fill(Color.accentColor).frame(width: 7, height: 7).padding(.top, 5)
            }
        }
        .padding(.vertical, 3)
        .opacity(notification.isResolved ? 0.7 : 1)
    }
}
