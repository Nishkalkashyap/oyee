import Foundation
import Testing

@testable import OyeeKit

/// What each intent's card says, on the shared fixtures. The labels match the web (lib/ask.ts, lib/progress.ts,
/// lib/inform.ts) and `stoppedReportingLabel` in @oyee/schema.
@Suite("Card states")
struct CardStateTests {
    let asked = iso("2026-10-30T09:00:00.000Z")

    // MARK: Ask

    @Test func openAskWaitsAndExpires() throws {
        let card = AskCardModel(try v2("ask-open"), now: asked.addingTimeInterval(12 * 60))
        #expect(card.state == .open)
        #expect(card.isOpen)
        #expect(card.status == "Waiting 12m")
        #expect(card.expiry == "Expires in 48m")
        #expect(card.options == [
            AskCardModel.Option(label: "Approve", chosen: false), AskCardModel.Option(label: "Reject", chosen: false),
            AskCardModel.Option(label: "Wait", chosen: false),
        ])
        #expect(card.replyPlaceholder == "Reply…")
        #expect(card.note == nil)
    }

    @Test func waitingTimeAndExpiryWording() throws {
        let n = try v2("ask-open")
        #expect(AskCardModel(n, now: asked.addingTimeInterval(20)).status == "Just asked")
        #expect(AskCardModel(n, now: asked.addingTimeInterval(20)).expiry == "Expires in 1h")
        #expect(AskCardModel(n, now: asked.addingTimeInterval(3540 + 45)).expiry == "Expires in under a minute")
        var long = n
        long.content = .ask(AskBlock(options: ["Go"], expiresAt: asked.addingTimeInterval(150 * 60)))
        #expect(AskCardModel(long, now: asked).expiry == "Expires in 2h 30m")
        #expect(AskCardModel(long, now: asked.addingTimeInterval(125 * 60)).status == "Waiting 2h")
        // No reply box without allowText; the default placeholder otherwise.
        #expect(AskCardModel(long, now: asked).replyPlaceholder == nil)
        long.content = .ask(AskBlock(allowText: true, expiresAt: asked.addingTimeInterval(60 * 60)))
        #expect(AskCardModel(long, now: asked).replyPlaceholder == "Reply…")
    }

    @Test func openAskPastItsExpiryCountsAsExpired() throws {
        let card = AskCardModel(try v2("ask-open"), now: asked.addingTimeInterval(61 * 60))
        #expect(card.state == .expired)
        #expect(!card.isOpen)
        #expect(card.status == "Expired")
        #expect(card.expiry == nil)
        #expect(card.replyPlaceholder == nil)
    }

    @Test func answeredAskSaysWhatAndWhere() throws {
        let option = AskCardModel(try v2("ask-answered-option"), now: asked)
        #expect(option.state == .answered)
        #expect(option.status == "Answered: Approve · Pixel 9")
        #expect(option.options.map(\.chosen) == [true, false])
        #expect(option.expiry == nil && option.note == nil && option.replyPlaceholder == nil)
        #expect(AskCardModel(try v2("ask-answered-text"), now: asked).status == "Answered: release/1.4 · MacBook Pro")
    }

    @Test func closedUnansweredAsksSayWhy() throws {
        let expired = AskCardModel(try v2("ask-expired"), now: asked)
        #expect(expired.status == "Expired")
        #expect(expired.note == "Nobody answered within 1h, so the question was closed on every device.")
        #expect(expired.options.map(\.chosen) == [false, false])
        let withdrawn = AskCardModel(try v2("ask-withdrawn"), now: asked)
        #expect(withdrawn.status == "Withdrawn")
        #expect(withdrawn.note == "The sender withdrew this question before it was answered.")
        #expect(!withdrawn.isOpen)
    }

    // MARK: Progress

    @Test func progressStateLabels() throws {
        let running = ProgressCardModel(try #require(try v2("progress-running").progress))
        #expect(running.stateLabel == "Running")
        #expect(running.amount == "3/7 checks")
        #expect(abs(running.percent - 300.0 / 7) < 0.0001)
        #expect(running.tone == .ink)

        let percent = ProgressCardModel(try #require(try v2("progress-running-percent").progress))
        #expect(percent.amount == "40%")

        let done = ProgressCardModel(try #require(try v2("progress-done").progress))
        #expect((done.stateLabel, done.amount, done.percent, done.tone) == ("Done", "7/7 checks", 100, .success))
        let failed = ProgressCardModel(try #require(try v2("progress-failed").progress))
        #expect((failed.stateLabel, failed.amount, failed.tone) == ("Failed", "4/7 checks", .warning))
        let stopped = ProgressCardModel(try #require(try v2("progress-stopped").progress))
        #expect((stopped.stateLabel, stopped.amount, stopped.tone) == ("Stopped reporting after 40%", "40%", .muted))
    }

    @Test func stoppedReportingLabelMirrorsTheSchema() {
        #expect(Rendering.stoppedReportingLabel(ProgressBlock(value: 3, max: 7, label: "3/7 checks")) == "Stopped reporting after 3/7 checks")
        #expect(Rendering.stoppedReportingLabel(ProgressBlock(value: 40)) == "Stopped reporting after 40%")
        // The percent, even when max isn't 100 (unlike the amount, which reads 2/3).
        #expect(Rendering.stoppedReportingLabel(ProgressBlock(value: 2, max: 3)) == "Stopped reporting after 67%")
        #expect(ProgressCardModel(ProgressBlock(value: 2, max: 3)).amount == "2/3")
        #expect(Rendering.stoppedReportingLabel(ProgressBlock(value: 12.5)) == "Stopped reporting after 13%")
        #expect(Rendering.stoppedReportingLabel(ProgressBlock(value: 250)) == "Stopped reporting after 100%")
    }

    // MARK: Inform

    @Test func informCard() throws {
        let card = InformCardModel(try v2("inform-full"))
        #expect(card.severity == .critical)
        #expect(card.icon == .emoji("💾"))
        #expect(card.image?.absoluteString == "https://grafana.example.com/render/disk.png")
        #expect(card.rows == [Field(label: "Host", value: "db-1"), Field(label: "Used", value: "95%")])
        #expect(card.links.map(\.label) == ["Dashboard", "Runbook"])
        #expect(card.links.first?.url.absoluteString == "https://grafana.example.com/d/disk")
        #expect(card.open?.host == "grafana.example.com")
        #expect(!card.resolved)

        let minimal = InformCardModel(try v2("inform-minimal"))
        #expect(minimal.icon == nil && minimal.image == nil && minimal.open == nil)
        #expect(minimal.rows.isEmpty && minimal.links.isEmpty)
        #expect(InformCardModel(try v2("inform-resolved")).resolved)
    }

    @Test func informCardDropsWhatItCannotShowSafely() {
        let n = OyeeNotification(
            id: "x", title: "x",
            content: .inform(InformBlock(
                links: [
                    LinkButton(label: "Bad", url: "javascript:alert(1)"), LinkButton(label: "A", url: "https://a.dev"),
                    LinkButton(label: "B", url: "https://b.dev"), LinkButton(label: "C", url: "https://c.dev"),
                    LinkButton(label: "D", url: "https://d.dev"),
                ],
                fields: [Field(label: "Empty", value: "")], image: "file:///etc/passwd", icon: "https://x.dev/i.png")))
        let card = InformCardModel(n)
        #expect(card.links.map(\.label) == ["A", "B", "C"])
        #expect(card.rows == [Field(label: "Empty", value: "—")])
        #expect(card.image == nil)
        #expect(card.icon == .image(URL(string: "https://x.dev/i.png")!))
        var flags = n
        flags.content = .inform(InformBlock(icon: "🇺🇸🇬🇧🇫🇷"))
        #expect(InformCardModel(flags).icon == .emoji("🇺🇸🇬🇧"))
    }
}
