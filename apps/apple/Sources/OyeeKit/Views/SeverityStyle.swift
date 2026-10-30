import SwiftUI

extension Severity {
    /// Severity colors from the shared palette (dot on avatars, soft pills).
    public var color: Color {
        switch self {
        case .info: Color(hex: 0x3B82F6)
        case .success: Color(hex: 0x16A34A)
        case .warning: Color(hex: 0xD97706)
        case .critical: Color(hex: 0xDC2626)
        }
    }

    public var symbolName: String {
        switch self {
        case .info: "info.circle.fill"
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .critical: "exclamationmark.octagon.fill"
        }
    }

    public var title: String { rawValue.capitalized }
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

/// A progress bar on a light track: ink while running (docs/design.md), the outcome's colour once it ended, faint
/// once it stopped reporting.
public struct ProgressBar: View {
    let fraction: Double
    let tone: ProgressCardModel.Tone
    var height: CGFloat

    public init(fraction: Double, tone: ProgressCardModel.Tone, height: CGFloat = 6) {
        self.fraction = fraction
        self.tone = tone
        self.height = height
    }

    public var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.accent)
                Capsule()
                    .fill(tone.color)
                    .frame(width: max(height, geo.size.width * Swift.min(1, Swift.max(0, fraction))))
                    .animation(.easeInOut(duration: 0.3), value: fraction)
            }
            .clipShape(Capsule())
        }
        .frame(height: height)
    }
}

extension ProgressCardModel.Tone {
    /// Bar and pill ink.
    public var color: Color {
        switch self {
        case .ink: Theme.foreground
        case .success: Severity.success.color
        case .warning: Severity.warning.color
        case .muted: Theme.faint
        }
    }
}

