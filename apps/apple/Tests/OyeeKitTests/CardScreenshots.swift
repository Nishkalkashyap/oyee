import CoreText
import Foundation
import ImageIO
import SwiftUI
import Testing
import UniformTypeIdentifiers

@testable import OyeeKit

/// Renders every card state from the shared fixtures to PNGs for code review (no assertions on pixels). Opt-in:
/// `OYEE_SCREENSHOTS=/some/dir scripts/test.sh --filter "Card screenshots"`.
@MainActor
@Suite("Card screenshots", .enabled(if: ProcessInfo.processInfo.environment["OYEE_SCREENSHOTS"] != nil))
struct CardScreenshots {
    let directory = URL(fileURLWithPath: ProcessInfo.processInfo.environment["OYEE_SCREENSHOTS"] ?? NSTemporaryDirectory())
    let store = InboxStore(cacheURL: nil)
    /// The fixtures read as if it were 09:12 on their day (ask-open: waiting 12m, expires in 48m).
    let shift = Date().timeIntervalSince(iso("2026-10-30T09:12:00.000Z"))

    init() {
        let font = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../../Resources/Fonts/Figtree.ttf").standardizedFileURL
        CTFontManagerRegisterFontsForURL(font as CFURL, .process, nil)
    }

    /// A fixture with its timestamps moved to the present, so relative times read naturally.
    func fixture(_ name: String) throws -> OyeeNotification {
        var n = try v2(name)
        n.createdAt += shift
        n.updatedAt += shift
        n.readAt = n.readAt.map { $0 + shift }
        n.resolvedAt = n.resolvedAt.map { $0 + shift }
        switch n.content {
        case .inform(var inform):
            inform.image = nil  // no network here; the image would only render as a spinner
            n.content = .inform(inform)
        case .ask(var ask):
            ask.expiresAt = ask.expiresAt.map { $0 + shift }
            ask.answer?.at += shift
            n.content = .ask(ask)
        case .progress(var progress):
            progress.lastReportAt = progress.lastReportAt.map { $0 + shift }
            n.content = .progress(progress)
        }
        return n
    }

    func save(_ view: some View, as name: String, width: CGFloat = 560) throws {
        let framed = view
            .frame(width: width, alignment: .leading)
            .padding(20)
            .background(Theme.thread)
            .environment(\.colorScheme, .light)
        let renderer = ImageRenderer(content: framed)
        renderer.scale = 2
        let image = try #require(renderer.cgImage)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("14-mac-\(name).png")
        let destination = try #require(CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, nil)
        #expect(CGImageDestinationFinalize(destination))
    }

    @Test func everyCardState() throws {
        let cards = [
            "inform-full", "inform-warning", "inform-resolved", "ask-open", "ask-answered-option", "ask-answered-text",
            "ask-expired", "ask-withdrawn", "progress-running", "progress-done", "progress-failed", "progress-stopped",
        ]
        for name in cards {
            let n = try fixture(name)
            try save(IntentCardView(notification: n, store: store, onResolve: n.status == .active ? {} : nil), as: name)
        }
    }

    @Test func inboxRowsAndMenuBar() throws {
        let names = [
            "ask-open", "progress-running", "progress-stopped", "inform-full", "progress-done", "progress-failed",
            "ask-answered-option", "ask-expired", "inform-warning", "inform-minimal",
        ]
        let items = try names.map(fixture)
        let sections = InboxSection.split(items)
        let rows = VStack(alignment: .leading, spacing: 2) {
            ForEach(sections) { section in
                Text(section.title).font(.oyee(13, .semibold)).foregroundStyle(Theme.muted)
                    .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 2)
                ForEach(section.stacks) { stack in
                    NotificationRowView(notification: stack.head, count: stack.items.count)
                    if section.kind == .needsYou {
                        AnswerButtons(notification: stack.head, store: store, onReply: {})
                            .padding(.leading, 68).padding(.bottom, 6)
                    }
                }
            }
        }
        .padding(8)
        .background(Theme.background, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        try save(rows, as: "inbox", width: 380)

        let menu = VStack(spacing: 0) {
            ForEach(InboxSection.split(items.filter { $0.status == .active }).flatMap(\.stacks)) { stack in
                NotificationCardView(notification: stack.head, store: store, compact: true, stackCount: stack.items.count)
            }
        }
        .padding(6)
        .background(Theme.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        try save(menu, as: "menubar", width: 360)
    }
}
