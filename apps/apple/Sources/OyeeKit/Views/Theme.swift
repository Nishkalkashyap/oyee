import CoreText
import SwiftUI

#if os(macOS)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

/// Oyee's design tokens: Gluon's warm paper palette (see docs/design.md). Every color adapts to light/dark.
public enum Theme {
    public static let ground = dynamic(light: 0xF3F2EF, dark: 0x131211)
    public static let background = dynamic(light: 0xFFFFFF, dark: 0x1E1C1A)
    public static let foreground = dynamic(light: 0x1C1B19, dark: 0xF1EDE6)
    public static let card = dynamic(light: 0xF7F6F3, dark: 0x262421)
    public static let brand = dynamic(light: 0xD9480F, dark: 0xFF6B1A)
    public static let brandForeground = dynamic(light: 0xFFFFFF, dark: 0x1C1B19)
    public static let chip = dynamic(light: 0xFDE7D7, dark: 0x4A2713)
    public static let chipForeground = dynamic(light: 0x9A3412, dark: 0xFDBA8C)
    public static let thread = dynamic(light: 0xF7F4EF, dark: 0x181614)
    public static let bubble = dynamic(light: 0xFFFFFF, dark: 0x2B2825)
    public static let secondary = dynamic(light: 0xF3F2EF, dark: 0x2B2825)
    public static let accent = dynamic(light: 0xE9E5DE, dark: 0x35312D)
    public static let muted = dynamic(light: 0x6B675F, dark: 0xA39D92)
    public static let faint = dynamic(light: 0xA8A39A, dark: 0x6E685F)
    public static let border = dynamic(light: 0xECE9E3, dark: 0x302D29)
    public static let rowSelected = dynamic(light: 0xECE9E3, dark: 0x35312D)
    public static let secondaryLabel = dynamic(light: 0x44403C, dark: 0xD6D0C6)

    /// Warm pastel avatar fills with matching ink, picked by hashing the name (same palette and hash as the web app).
    static let tints: [(fill: UInt32, ink: UInt32)] = [
        (0xFDE7D7, 0x9A3412), (0xD5F0EC, 0x0F5F57), (0xE2ECFB, 0x1E4E9A),
        (0xE3F2E1, 0x2F6B2A), (0xF9D3DE, 0x9D174D), (0xEDE4F7, 0x5B21B6),
    ]

    public static func tint(for name: String) -> (fill: Color, ink: Color) {
        var hash: Int32 = 0
        for scalar in name.unicodeScalars {
            hash = hash &* 31 &+ Int32(truncatingIfNeeded: scalar.value)
        }
        let t = tints[Int(hash.magnitude) % tints.count]
        return (Color(hex: t.fill), Color(hex: t.ink))
    }

    public static func dynamic(light: UInt32, dark: UInt32) -> Color {
        #if os(macOS)
        Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .vibrantDark, .accessibilityHighContrastDarkAqua]) != nil
                ? NSColor(hex: dark) : NSColor(hex: light)
        })
        #elseif canImport(UIKit)
        Color(uiColor: UIColor { traits in traits.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
        #else
        Color(hex: light)
        #endif
    }
}

extension Color {
    public init(hex: UInt32) {
        self.init(
            .sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }
}

#if os(macOS)
extension NSColor {
    convenience init(hex: UInt32) {
        self.init(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
#elseif canImport(UIKit)
extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
#endif

// MARK: - Type

/// Figtree (bundled as `Fonts/Figtree.ttf`, a variable font) with a system-font fallback when it isn't bundled.
public enum OyeeFonts {
    nonisolated(unsafe) private static var registered: Bool?

    /// Registers the bundled font once. Safe to call repeatedly; returns whether Figtree is available.
    @discardableResult
    public static func register() -> Bool {
        if let registered { return registered }
        let candidates = [
            Bundle.main.url(forResource: "Figtree", withExtension: "ttf", subdirectory: "Fonts"),
            Bundle.main.url(forResource: "Figtree", withExtension: "ttf"),
        ].compactMap { $0 }
        var ok = false
        for url in candidates {
            var error: Unmanaged<CFError>?
            if CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error) {
                ok = true
                break
            }
            // Already registered (e.g. by Info.plist ATSApplicationFontsPath) also counts.
            if let err = error?.takeRetainedValue(), CFErrorGetCode(err) == CTFontManagerError.alreadyRegistered.rawValue {
                ok = true
                break
            }
        }
        registered = ok
        return ok
    }
}

extension Font {
    /// Oyee's text style: Figtree at `size` and `weight` (system font if Figtree isn't bundled).
    public static func oyee(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        OyeeFonts.register()
            ? .custom("Figtree", size: size).weight(weight)
            : .system(size: size, weight: weight)
    }
}

// MARK: - Components

/// The orange "o" mark.
public struct BrandMark: View {
    var size: CGFloat
    public init(size: CGFloat = 28) { self.size = size }
    public var body: some View {
        Text("o")
            .font(.oyee(size * 0.55, .heavy))
            .foregroundStyle(Theme.brandForeground)
            .frame(width: size, height: size)
            .background(Theme.brand, in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .accessibilityHidden(true)
    }
}

/// A round avatar with the name's initial in its tint, plus an optional severity dot.
public struct SourceAvatar: View {
    let name: String
    var size: CGFloat
    var severity: Severity?

    public init(name: String, size: CGFloat = 40, severity: Severity? = nil) {
        self.name = name
        self.size = size
        self.severity = severity
    }

    public var body: some View {
        let t = Theme.tint(for: name)
        Text(String(name.first(where: { $0.isLetter || $0.isNumber }) ?? "?").uppercased())
            .font(.oyee(size * 0.4, .bold))
            .foregroundStyle(t.ink)
            .frame(width: size, height: size)
            .background(t.fill, in: Circle())
            .overlay(alignment: .bottomTrailing) {
                if let severity, severity != .debug {
                    Circle()
                        .fill(severity.color)
                        .frame(width: size * 0.3, height: size * 0.3)
                        .overlay(Circle().stroke(Theme.background, lineWidth: 2.2))
                        .offset(x: 1, y: 1)
                        .accessibilityLabel(severity.title)
                }
            }
    }
}

/// Gluon's pill buttons.
public struct PillButtonStyle: ButtonStyle {
    public enum Variant: Sendable { case primary, brand, secondary, ghost, destructive }
    public enum Size: Sendable { case small, regular, large }
    var variant: Variant
    var size: Size

    public init(_ variant: Variant = .secondary, size: Size = .regular) {
        self.variant = variant
        self.size = size
    }

    public func makeBody(configuration: Configuration) -> some View {
        let (fill, ink): (Color, Color) =
            switch variant {
            case .primary: (Theme.foreground, Theme.background)
            case .brand: (Theme.brand, Theme.brandForeground)
            case .secondary: (Theme.secondary, Theme.foreground)
            case .ghost: (.clear, Theme.secondaryLabel)
            case .destructive: (Color.red.opacity(0.12), .red)
            }
        let (height, font, padding): (CGFloat, CGFloat, CGFloat) =
            switch size {
            case .small: (26, 12, 10)
            case .regular: (32, 13, 13)
            case .large: (44, 15, 18)
            }
        configuration.label
            .font(.oyee(font, .medium))
            .lineLimit(1)
            .foregroundStyle(ink)
            .padding(.horizontal, padding)
            .frame(height: height)
            .background(fill.opacity(configuration.isPressed ? 0.85 : 1), in: Capsule())
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed ? 0.96 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// A single-select filter pill: grey, peach when selected.
public struct FilterChip: View {
    let title: String
    let isOn: Bool
    let action: () -> Void

    public init(_ title: String, isOn: Bool, action: @escaping () -> Void) {
        self.title = title
        self.isOn = isOn
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Text(title)
                .font(.oyee(12.5, isOn ? .semibold : .medium))
                .foregroundStyle(isOn ? Theme.chipForeground : Theme.secondaryLabel)
                .padding(.horizontal, 12)
                .frame(height: 28)
                .background(isOn ? Theme.chip : Theme.secondary, in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// Orange unread count.
public struct CountBadge: View {
    let count: Int
    public init(_ count: Int) { self.count = count }
    public var body: some View {
        if count > 0 {
            Text(count > 99 ? "99+" : "\(count)")
                .font(.oyee(10.5, .bold))
                .monospacedDigit()
                .foregroundStyle(Theme.brandForeground)
                .padding(.horizontal, 5)
                .frame(minWidth: 17, minHeight: 17)
                .background(Theme.brand, in: Capsule())
        }
    }
}

/// Soft severity pill ("● Warning").
public struct SeverityPill: View {
    let severity: Severity
    public init(_ severity: Severity) { self.severity = severity }
    public var body: some View {
        HStack(spacing: 5) {
            Circle().fill(severity.color).frame(width: 6, height: 6)
            Text(severity.title)
        }
        .font(.oyee(11.5, .semibold))
        .foregroundStyle(severity.color)
        .padding(.horizontal, 9)
        .frame(height: 22)
        .background(severity.color.opacity(0.13), in: Capsule())
    }
}

/// Gluon's switch: grey track, green when on, white thumb.
public struct OyeeToggleStyle: ToggleStyle {
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        HStack {
            configuration.label
            Spacer(minLength: 12)
            Capsule()
                .fill(configuration.isOn ? Color(hex: 0x16A34A) : Theme.dynamic(light: 0xE0DCD4, dark: 0x3D3934))
                .frame(width: 42, height: 24)
                .overlay(alignment: configuration.isOn ? .trailing : .leading) {
                    Circle().fill(.white).shadow(color: .black.opacity(0.15), radius: 1, y: 1).padding(3)
                }
                .animation(.spring(response: 0.25, dampingFraction: 0.8), value: configuration.isOn)
                .onTapGesture { configuration.isOn.toggle() }
                .accessibilityAddTraits(.isButton)
        }
    }
}

/// Gluon's setting row: title, muted description, control on the right, hairline below.
public struct SettingRow<Trailing: View>: View {
    let title: String
    let description: String?
    let last: Bool
    let trailing: Trailing

    public init(_ title: String, description: String? = nil, last: Bool = false, @ViewBuilder trailing: () -> Trailing) {
        self.title = title
        self.description = description
        self.last = last
        self.trailing = trailing()
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.oyee(14.5, .semibold)).foregroundStyle(Theme.foreground)
                    if let description {
                        Text(description)
                            .font(.oyee(12.5))
                            .foregroundStyle(Theme.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                trailing
            }
            .padding(.vertical, 12)
            if !last { Rectangle().fill(Theme.border).frame(height: 1) }
        }
    }
}

extension SettingRow where Trailing == EmptyView {
    public init(_ title: String, description: String? = nil, last: Bool = false) {
        self.init(title, description: description, last: last) { EmptyView() }
    }
}
