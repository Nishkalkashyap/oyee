// Renders the Oyee app icon (the white mark on the blue squircle) into an .iconset directory.
// Usage: swift scripts/make-icon.swift <output.iconset>
import AppKit

let output = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset")
try? FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

func render(pixels: Int) -> Data? {
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
        hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
    else { return nil }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let size = CGFloat(pixels)
    let inset = size * 0.09
    let rect = NSRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let path = NSBezierPath(roundedRect: rect, xRadius: rect.width * 0.225, yRadius: rect.width * 0.225)
    NSColor(srgbRed: 0x1F / 255, green: 0x6F / 255, blue: 0xEB / 255, alpha: 1).setFill()  // brand blue
    path.fill()

    // The Oyee mark (docs/brand/oyee-mark.svg): an "o" speech bubble with an unread dot, on a 24-unit grid.
    let content = rect.width * 0.62, s = content / 24
    let ox = rect.midX - content / 2, top = rect.midY + content / 2
    func oval(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat) -> NSRect {
        NSRect(x: ox + (cx - r) * s, y: top - (cy + r) * s, width: 2 * r * s, height: 2 * r * s)
    }
    func pt(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: ox + x * s, y: top - y * s) }
    NSColor.white.setFill()
    let ring = NSBezierPath()
    ring.appendOval(in: oval(10.5, 13.5, 7.2))
    ring.appendOval(in: oval(10.5, 13.5, 3.3))
    ring.windingRule = .evenOdd
    ring.fill()
    let solids = NSBezierPath()
    solids.move(to: pt(4.4, 17.2)); solids.line(to: pt(3, 21.6)); solids.line(to: pt(8.4, 20.2)); solids.close()
    solids.appendOval(in: oval(19, 5, 3))
    solids.fill()
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])
}

for base in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
        if let data = render(pixels: base * scale) {
            try data.write(to: output.appendingPathComponent(name))
        }
    }
}
