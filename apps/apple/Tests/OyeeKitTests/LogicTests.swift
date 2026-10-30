import Foundation
import Testing

@testable import OyeeKit

@Suite("Pairing")
struct PairingTests {
    @Test(arguments: [
        ("K7Q2-9XMA", "K7Q29XMA"),
        ("k7q2-9xma", "K7Q29XMA"),
        ("K7Q29XMA", "K7Q29XMA"),
        ("  k7q2 9xma ", "K7Q29XMA"),
        ("k7q2–9xma".replacingOccurrences(of: "–", with: "-"), "K7Q29XMA"),
    ])
    func validCodes(input: String, expected: String) {
        #expect(Pairing.normalizeCode(input) == expected)
    }

    @Test(arguments: ["", "K7Q2-9XM", "K7Q2-9XMAB", "O0I1-LLLL", "K7Q2_9XMA", "K7Q2-9XM!"])
    func invalidCodes(input: String) {
        #expect(Pairing.normalizeCode(input) == nil)
    }

    @Test func displayCode() {
        #expect(Pairing.displayCode("k7q") == "K7Q")
        #expect(Pairing.displayCode("k7q2") == "K7Q2")
        #expect(Pairing.displayCode("k7q29") == "K7Q2-9")
        #expect(Pairing.displayCode("K7Q2-9XMA") == "K7Q2-9XMA")
        #expect(Pairing.displayCode("K7Q29XMAZZZ") == "K7Q2-9XMA")
    }

    @Test func serverURLNormalization() {
        #expect(Pairing.normalizeServerURL("oyee.example.com")?.absoluteString == "https://oyee.example.com")
        #expect(Pairing.normalizeServerURL("https://Oyee.Example.com/")?.absoluteString == "https://oyee.example.com")
        #expect(Pairing.normalizeServerURL("localhost:8787")?.absoluteString == "http://localhost:8787")
        #expect(Pairing.normalizeServerURL("http://localhost:8787/")?.absoluteString == "http://localhost:8787")
        #expect(Pairing.normalizeServerURL("https://host/oyee/?x=1#y")?.absoluteString == "https://host/oyee")
        #expect(Pairing.normalizeServerURL("ftp://host") == nil)
        #expect(Pairing.normalizeServerURL("   ") == nil)
    }

    @Test func deepLinks() throws {
        let url = try #require(URL(string: "oyee://pair?server=https%3A%2F%2Fhost&code=K7Q2-9XMA"))
        let link = try #require(Pairing.parseLink(url))
        #expect(link == Pairing.Link(server: URL(string: "https://host")!, code: "K7Q29XMA"))

        let local = try #require(URL(string: "oyee://pair?code=abcd-efgh&server=http://localhost:8787"))
        #expect(Pairing.parseLink(local)?.server.absoluteString == "http://localhost:8787")
        #expect(Pairing.parseLink(local)?.code == "ABCDEFGH")

        #expect(Pairing.parseLink(URL(string: "oyee://inbox")!) == nil)
        #expect(Pairing.parseLink(URL(string: "https://pair?server=x&code=K7Q29XMA")!) == nil)
        #expect(Pairing.parseLink(URL(string: "oyee://pair?server=https%3A%2F%2Fhost&code=bad")!) == nil)
    }
}

@Suite("Notification categories")
struct CategoryTests {
    @Test func fnvTestVectors() {
        #expect(NotificationCategories.fnv1a64Hex("") == "cbf29ce484222325")
        #expect(NotificationCategories.fnv1a64Hex("a") == "af63dc4c8601ec8c")
        #expect(NotificationCategories.fnv1a64Hex("foobar") == "85944171f73967e8")
    }

    @Test func openAskGetsAnswerButtonsAndATextReply() throws {
        let plan = try #require(NotificationCategories.plan(for: try v2("ask-open")))
        #expect(plan.buttons == [
            .init(identifier: "oyee.answer.Approve", title: "Approve", opensURL: false),
            .init(identifier: "oyee.answer.Reject", title: "Reject", opensURL: false),
            .init(identifier: "oyee.answer.Wait", title: "Wait", opensURL: false),
        ])
        #expect(plan.textInput == "Reply…")
        #expect(plan.id.hasPrefix("oyee.cat.") && plan.id.count == "oyee.cat.".count + 16)

        var textOnly = try v2("ask-open")
        textOnly.content = .ask(AskBlock(allowText: true, replyPlaceholder: "Branch name", state: .open))
        let reply = try #require(NotificationCategories.plan(for: textOnly))
        #expect(reply.buttons.isEmpty)
        #expect(reply.textInput == "Branch name")
    }

    @Test func informGetsItsLinkButtons() throws {
        let plan = try #require(NotificationCategories.plan(for: try v2("inform-full")))
        #expect(plan.buttons == [
            .init(identifier: "oyee.link.0", title: "Dashboard", opensURL: true),
            .init(identifier: "oyee.link.1", title: "Runbook", opensURL: true),
        ])
        #expect(plan.textInput == nil)
    }

    @Test func nothingToPressNoCategory() throws {
        for name in ["inform-minimal", "ask-answered-option", "ask-expired", "ask-withdrawn", "progress-running", "progress-done"] {
            #expect(NotificationCategories.plan(for: try v2(name)) == nil, "\(name)")
        }
    }

    @Test func categoryIdsAreStableAndOnlyChangeWithWhatIsShown() throws {
        let ask = try v2("ask-open")
        let id = try #require(NotificationCategories.plan(for: ask)?.id)
        // Pinned: changing the canonical form strands categories registered by older launches.
        #expect(id == "oyee.cat." + NotificationCategories.fnv1a64Hex(
            "v2\u{1E}oyee.answer.Approve\u{1F}Approve\u{1F}r\u{1E}oyee.answer.Reject\u{1F}Reject\u{1F}r"
                + "\u{1E}oyee.answer.Wait\u{1F}Wait\u{1F}r\u{1E}reply\u{1F}Reply…"))

        // Another ask with the same buttons shares the category; the links' URLs don't matter either.
        var same = try v2("ask-open")
        same.id = "other"
        same.title = "Another question"
        #expect(NotificationCategories.plan(for: same)?.id == id)
        var relinked = try v2("inform-full")
        relinked.content = .inform(InformBlock(links: [
            LinkButton(label: "Dashboard", url: "https://elsewhere.dev"), LinkButton(label: "Runbook", url: "https://x.dev"),
        ]))
        #expect(NotificationCategories.plan(for: relinked)?.id == NotificationCategories.plan(for: try v2("inform-full"))?.id)

        var reordered = ask
        reordered.content = .ask(AskBlock(options: ["Reject", "Approve", "Wait"], allowText: true, replyPlaceholder: "Reply…"))
        var noReply = ask
        noReply.content = .ask(AskBlock(options: ["Approve", "Reject", "Wait"]))
        let links = try v2("inform-full")
        let ids = [ask, reordered, noReply, links].compactMap { NotificationCategories.plan(for: $0)?.id }
        #expect(Set(ids).count == 4)
    }

    @Test func buttonIdentifiersMapBack() {
        #expect(NotificationCategories.answerOption(from: "oyee.answer.Ship it") == "Ship it")
        #expect(NotificationCategories.answerOption(from: "oyee.link.0") == nil)
        #expect(NotificationCategories.linkIndex(from: "oyee.link.2") == 2)
        #expect(NotificationCategories.linkIndex(from: "oyee.link.x") == nil)
        #expect(NotificationCategories.linkIndex(from: "oyee.answer.0") == nil)
    }
}

@Suite("Rendering")
struct RenderingTests {
    @Test func progressTextMatchesSchema() {
        #expect(Rendering.progressText(ProgressBlock(value: 3, max: 7)) == "▓▓▓▓░░░░░░ 3/7")
        #expect(Rendering.progressText(ProgressBlock(value: 50)) == "▓▓▓▓▓░░░░░ 50%")
        #expect(Rendering.progressText(ProgressBlock(value: 0)) == "░░░░░░░░░░ 0%")
        #expect(Rendering.progressText(ProgressBlock(value: 150)) == "▓▓▓▓▓▓▓▓▓▓ 100%")
        #expect(Rendering.progressText(ProgressBlock(value: 3, max: 7, label: "3/7 checks")) == "▓▓▓▓░░░░░░ 3/7 checks")
        // Math.round(2.5) == 3 in JS (round half up).
        #expect(Rendering.progressText(ProgressBlock(value: 0.25, max: 1)) == "▓▓▓░░░░░░░ 0.25/1")
        #expect(Rendering.progressText(ProgressBlock(value: 12.5)) == "▓░░░░░░░░░ 13%")
    }

    @Test func systemTextPerIntent() throws {
        // Same text as the browser popup (apps/web/src/lib/webpush.ts webPushBody).
        let inform = try v2("inform-full")
        #expect(Rendering.systemTitle(for: inform) == "💾 Disk 95% full on db-1")
        #expect(
            Rendering.systemBody(for: inform)
                == "Free space is below 5%. See the /var breakdown.\nNext check in 5 minutes.\nHost: db-1\nUsed: 95%")
        #expect(Rendering.systemBody(for: try v2("inform-minimal")) == "")

        let ask = try v2("ask-open")
        #expect(Rendering.systemTitle(for: ask) == "Deploy prod-api v1.4.2?")
        #expect(Rendering.systemBody(for: ask) == "Canary is green. 3 migrations pending.")

        #expect(Rendering.systemBody(for: try v2("progress-running")) == "▓▓▓▓░░░░░░ 3/7 checks")
        #expect(Rendering.systemBody(for: try v2("progress-running-percent")) == "▓▓▓▓░░░░░░ 40%")
        #expect(Rendering.systemBody(for: try v2("progress-done")) == "Done · 7/7 checks")
        #expect(Rendering.systemBody(for: try v2("progress-failed")) == "test:e2e failed.\nFailed · 4/7 checks")
        #expect(Rendering.systemBody(for: try v2("progress-stopped")) == "Stopped reporting after 40%")

        var urlIcon = inform
        urlIcon.content = .inform(InformBlock(icon: "https://x/icon.png"))
        #expect(Rendering.systemTitle(for: urlIcon) == "Disk 95% full on db-1")
    }
}

@Suite("Markdown subset")
struct MarkdownTests {
    typealias Run = MarkdownSubset.Run

    @Test func basicStyles() {
        #expect(
            MarkdownSubset.parse("CPU above **90%** for *5m* in `us-east-1`") == [
                Run(text: "CPU above "), Run(text: "90%", bold: true), Run(text: " for "),
                Run(text: "5m", italic: true), Run(text: " in "), Run(text: "us-east-1", code: true),
            ])
    }

    @Test func links() {
        let runs = MarkdownSubset.parse("See [the **console**](https://example.com/x) now")
        #expect(
            runs == [
                Run(text: "See "), Run(text: "the ", link: URL(string: "https://example.com/x")),
                Run(text: "console", bold: true, link: URL(string: "https://example.com/x")), Run(text: " now"),
            ])
        // Disallowed schemes stay literal.
        #expect(MarkdownSubset.plainText("[x](javascript:alert(1))") == "[x](javascript:alert(1))")
        #expect(MarkdownSubset.parse("[mail](mailto:a@b.c)").first?.link?.absoluteString == "mailto:a@b.c")
    }

    @Test func literalsAndEdgeCases() {
        #expect(MarkdownSubset.plainText("2 * 3 * 4") == "2 * 3 * 4")
        #expect(MarkdownSubset.plainText("**unclosed") == "**unclosed")
        #expect(MarkdownSubset.plainText("snake_case_name") == "snake_case_name")
        #expect(MarkdownSubset.plainText("<b>raw html</b> & <script>x</script>") == "<b>raw html</b> & <script>x</script>")
        #expect(MarkdownSubset.plainText(#"\*not italic\*"#) == "*not italic*")
        #expect(MarkdownSubset.plainText("`**not bold**`") == "**not bold**")
        #expect(MarkdownSubset.parse("`**not bold**`") == [Run(text: "**not bold**", code: true)])
        #expect(MarkdownSubset.plainText("line 1\nline 2\r\nline 3") == "line 1\nline 2\nline 3")
        #expect(MarkdownSubset.plainText("# Heading") == "# Heading")
        #expect(MarkdownSubset.plainText("") == "")
    }

    @Test func nestedItalicInsideBoldAndViceVersa() {
        #expect(
            MarkdownSubset.parse("**bold *both***") == [
                Run(text: "bold ", bold: true), Run(text: "both", bold: true, italic: true),
            ])
        #expect(
            MarkdownSubset.parse("*it **both** it*") == [
                Run(text: "it ", italic: true), Run(text: "both", bold: true, italic: true),
                Run(text: " it", italic: true),
            ])
    }

    @Test func attributedStringCarriesIntents() {
        let attributed = MarkdownSubset.attributed("a **b** [c](https://x.dev)")
        let runs = Array(attributed.runs)
        #expect(runs.count == 4)
        #expect(String(attributed.characters) == "a b c")
        #expect(runs[1].inlinePresentationIntent == .stronglyEmphasized)
        #expect(runs[3].link == URL(string: "https://x.dev"))
    }
}

@Suite("Backoff and sync cursor")
struct BackoffTests {
    @Test func rawDelaysDoubleAndCap() {
        let backoff = Backoff()
        let delays = (0..<9).map { backoff.rawDelay(forAttempt: $0) }
        #expect(delays == [1, 2, 4, 8, 16, 32, 60, 60, 60])
        #expect(backoff.rawDelay(forAttempt: 10_000) == 60)
    }

    @Test func jitterBoundsAndReset() {
        var low = Backoff()
        var high = Backoff()
        var lowDelays: [TimeInterval] = []
        var highDelays: [TimeInterval] = []
        for _ in 0..<8 {
            lowDelays.append(low.nextDelay(random: { 0 }))
            highDelays.append(high.nextDelay(random: { 1 }))
        }
        #expect(lowDelays == [1, 1, 2, 4, 8, 16, 30, 30])
        #expect(highDelays == [1, 2, 4, 8, 16, 32, 60, 60])
        #expect(low.attempt == 8)
        low.reset()
        #expect(low.attempt == 0)
        #expect(low.nextDelay(random: { 0.5 }) == 1)

        var random = Backoff()
        for _ in 0..<50 {
            let d = random.nextDelay()
            #expect(d >= 1 && d <= 60)
        }
    }

    @Test func syncStateAppliesCursorAndPaging() throws {
        var state = SyncState()
        #expect(state.syncMessage == .sync(since: nil))
        #expect(state.updatedSinceParameter == nil)

        let n1 = OyeeNotification(id: "a", title: "A", createdAt: iso("2026-10-28T10:00:00Z"), updatedAt: iso("2026-10-28T10:05:00Z"))
        let n2 = OyeeNotification(id: "b", title: "B", createdAt: iso("2026-10-28T10:01:00Z"), updatedAt: iso("2026-10-28T10:02:00Z"))
        let followUp = state.apply(SyncResult(notifications: [n1, n2], deletedIds: [], cursor: "c1", hasMore: true))
        #expect(followUp == .sync(since: "c1"))
        #expect(state.cursor == "c1")
        #expect(state.lastUpdatedAt == iso("2026-10-28T10:05:00Z"))
        #expect(state.updatedSinceParameter == "2026-10-28T10:05:00.000Z")

        let done = state.apply(SyncResult(notifications: [], deletedIds: ["x"], cursor: "c2", hasMore: false))
        #expect(done == nil)
        #expect(state.cursor == "c2")
        // A missing/empty cursor keeps the previous one.
        state.apply(SyncResult(notifications: [], deletedIds: [], cursor: nil, hasMore: false))
        #expect(state.cursor == "c2")
        #expect(state.syncMessage == .sync(since: "c2"))

        // Persisted as JSON.
        let data = try OyeeJSON.makeEncoder().encode(state)
        #expect(try OyeeJSON.makeDecoder().decode(SyncState.self, from: data) == state)
    }
}

@Suite("Relative time")
struct RelativeTimeTests {
    @Test func recentAndSlightlyFutureTimesReadNow() {
        let now = Date()
        #expect(RelativeTime.short(now, now: now) == "now")
        #expect(RelativeTime.short(now.addingTimeInterval(-30), now: now) == "now")
        // Server clock a little ahead of this Mac: never "in 0 sec".
        #expect(RelativeTime.short(now.addingTimeInterval(5), now: now) == "now")
        #expect(RelativeTime.named(now.addingTimeInterval(3), now: now) == "just now")
        #expect(RelativeTime.short(now.addingTimeInterval(-600), now: now) != "now")
        #expect(!RelativeTime.named(now.addingTimeInterval(-600), now: now).hasPrefix("in "))
    }
}
