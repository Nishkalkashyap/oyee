import SwiftUI

extension Severity {
    /// Severity colors from the shared palette (dot on avatars, soft pills).
    public var color: Color {
        switch self {
        case .debug: Theme.faint
        case .info: Color(hex: 0x3B82F6)
        case .success: Color(hex: 0x16A34A)
        case .warning: Color(hex: 0xD97706)
        case .critical: Color(hex: 0xDC2626)
        }
    }

    public var symbolName: String {
        switch self {
        case .debug: "ladybug.fill"
        case .info: "info.circle.fill"
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .critical: "exclamationmark.octagon.fill"
        }
    }

    public var title: String { rawValue.capitalized }
}

/// The card's leading icon: emoji `icon`, remote `icon` URL, or the severity symbol.
public struct NotificationIconView: View {
    let notification: HeraldNotification
    var size: CGFloat = 28

    public init(notification: HeraldNotification, size: CGFloat = 28) {
        self.notification = notification
        self.size = size
    }

    public var body: some View {
        Group {
            if let emoji = notification.emojiIcon {
                Text(emoji).font(.system(size: size * 0.75))
            } else if let url = notification.iconURL {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFit()
                } placeholder: {
                    severitySymbol
                }
                .clipShape(RoundedRectangle(cornerRadius: size * 0.2))
            } else {
                severitySymbol
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(notification.severity.title)
    }

    private var severitySymbol: some View {
        Image(systemName: notification.severity.symbolName)
            .resizable()
            .scaledToFit()
            .foregroundStyle(notification.severity.color)
            .padding(size * 0.08)
    }
}

/// Small colored dot reflecting the WebSocket connection state.
public struct ConnectionStatusDot: View {
    let state: ConnectionState

    public init(state: ConnectionState) { self.state = state }

    public var color: Color {
        switch state {
        case .connected: .green
        case .connecting, .waiting: .yellow
        case .offline, .disconnected: .gray
        case .unauthorized: .red
        }
    }

    public var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .help(state.label)
            .accessibilityLabel(state.label)
    }
}

/// Ink progress bar (determinate or sliding indeterminate) with its label, as in the web app.
public struct NotificationProgressView: View {
    let progress: Progress
    var showLabel: Bool
    @ViewState private var phase: CGFloat = -0.35

    public init(progress: Progress, showLabel: Bool = true) {
        self.progress = progress
        self.showLabel = showLabel
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.accent)
                    if progress.indeterminate {
                        Capsule()
                            .fill(Theme.foreground)
                            .frame(width: geo.size.width * 0.35)
                            .offset(x: geo.size.width * phase)
                            .onAppear {
                                withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: false)) { phase = 1 }
                            }
                    } else {
                        Capsule()
                            .fill(Theme.foreground)
                            .frame(width: max(6, geo.size.width * progress.fraction))
                            .animation(.easeInOut(duration: 0.3), value: progress.fraction)
                    }
                }
                .clipShape(Capsule())
            }
            .frame(height: 6)
            if showLabel {
                Text(label)
                    .font(.herald(12))
                    .foregroundStyle(Theme.muted)
                    .monospacedDigit()
            }
        }
    }

    private var label: String {
        if let label = progress.label { return label }
        if progress.indeterminate { return "In progress…" }
        return progress.max == 100
            ? "\(Int(Rendering.jsRound(progress.fraction * 100)))%"
            : "\(Rendering.jsNumber(progress.value))/\(Rendering.jsNumber(progress.max))"
    }
}
