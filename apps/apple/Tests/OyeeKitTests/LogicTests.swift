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

@Suite("Category ids")
struct CategoryTests {
    let actions = [
        Action(id: "ack", label: "Acknowledge", style: .primary, resolves: true),
        Action(id: "open", label: "Open", url: "https://example.com"),
    ]

    @Test func fnvTestVectors() {
        #expect(NotificationCategories.fnv1a64Hex("") == "cbf29ce484222325")
        #expect(NotificationCategories.fnv1a64Hex("a") == "af63dc4c8601ec8c")
        #expect(NotificationCategories.fnv1a64Hex("foobar") == "85944171f73967e8")
    }

    @Test func stableAcrossCallsAndPinned() {
        let a = NotificationCategories.categoryIdentifier(actions: actions, reply: Reply(placeholder: "Say"))
        let b = NotificationCategories.categoryIdentifier(actions: actions, reply: Reply(placeholder: "Say"))
        #expect(a == b)
        #expect(a?.hasPrefix("oyee.cat.") == true)
        #expect(a?.count == "oyee.cat.".count + 16)
        // Pinned value: changing the canonical form breaks categories registered by older builds.
        let pinned = NotificationCategories.categoryIdentifier(
            actions: [Action(id: "ack", label: "Acknowledge")], reply: nil)
        #expect(pinned == "oyee.cat." + NotificationCategories.fnv1a64Hex("v1\u{1E}a\u{1F}ack\u{1F}Acknowledge\u{1F}default\u{1F}r"))
    }

    @Test func differsWhenAnythingVisibleChanges() {
        let base = NotificationCategories.categoryIdentifier(actions: actions, reply: nil)
        var relabeled = actions
        relabeled[0].label = "Ack"
        var restyled = actions
        restyled[0].style = .destructive
        var urlChanged = actions
        urlChanged[1].url = nil
        let ids: [String?] = [
            base,
            NotificationCategories.categoryIdentifier(actions: relabeled, reply: nil),
            NotificationCategories.categoryIdentifier(actions: restyled, reply: nil),
            NotificationCategories.categoryIdentifier(actions: urlChanged, reply: nil),
            NotificationCategories.categoryIdentifier(actions: actions.reversed(), reply: nil),
            NotificationCategories.categoryIdentifier(actions: actions, reply: Reply()),
            NotificationCategories.categoryIdentifier(actions: actions, reply: Reply(buttonLabel: "Go")),
        ]
        #expect(Set(ids.compactMap { $0 }).count == ids.count)
    }

    @Test func sameActionSetSharesCategoryEvenIfURLDiffers() {
        var other = actions
        other[1].url = "https://another.example.com"
        #expect(
            NotificationCategories.categoryIdentifier(actions: actions, reply: nil)
                == NotificationCategories.categoryIdentifier(actions: other, reply: nil))
    }

    @Test func noButtonsNoCategory() {
        #expect(NotificationCategories.categoryIdentifier(actions: [], reply: nil) == nil)
        #expect(NotificationCategories.categoryIdentifier(actions: [], reply: Reply()) != nil)
    }

    @Test func actionIdentifierMapping() {
        #expect(NotificationCategories.actionIdentifier(for: "ack") == "oyee.action.ack")
        #expect(NotificationCategories.oyeeActionId(from: "oyee.action.ack") == "ack")
        #expect(NotificationCategories.oyeeActionId(from: "something") == nil)
    }
}

@Suite("Rendering")
struct RenderingTests {
    @Test func progressTextMatchesSchema() {
        #expect(Rendering.progressText(Progress(value: 3, max: 7)) == "▓▓▓▓░░░░░░ 3/7")
        #expect(Rendering.progressText(Progress(value: 50)) == "▓▓▓▓▓░░░░░ 50%")
        #expect(Rendering.progressText(Progress(value: 0)) == "░░░░░░░░░░ 0%")
        #expect(Rendering.progressText(Progress(value: 150)) == "▓▓▓▓▓▓▓▓▓▓ 100%")
        #expect(Rendering.progressText(Progress(value: 3, max: 7, label: "3/7 checks")) == "▓▓▓▓░░░░░░ 3/7 checks")
        // Math.round(2.5) == 3 in JS (round half up).
        #expect(Rendering.progressText(Progress(value: 0.25, max: 1)) == "▓▓▓░░░░░░░ 0.25/1")
        #expect(Rendering.progressText(Progress(value: 12.5)) == "▓░░░░░░░░░ 13%")
        #expect(Rendering.progressText(Progress(value: 1, indeterminate: true)) == "In progress…")
        #expect(Rendering.progressText(Progress(value: 1, label: "Deploying", indeterminate: true)) == "Deploying")
    }

    @Test func systemBodyComposition() throws {
        let n = try decode(OyeeNotification.self, fixture: "notification_full")
        #expect(Rendering.systemBody(for: n) == "CPU above 90% for 5m\nRegion: us-east-1\n▓▓▓▓░░░░░░ 3/7 checks")
        #expect(Rendering.systemTitle(for: n) == "🔥 prod-api CPU high")

        let bare = OyeeNotification(id: "ntf_x", title: "Hi")
        #expect(Rendering.systemBody(for: bare) == "")
        let fieldsOnly = OyeeNotification(
            id: "ntf_y", title: "Hi", fields: [Field(label: "A", value: "1"), Field(label: "B", value: "2")],
            progress: Progress(value: 1, indeterminate: true))
        #expect(Rendering.systemBody(for: fieldsOnly) == "A: 1\nB: 2\nIn progress…")
        let urlIcon = OyeeNotification(id: "ntf_z", title: "Hi", icon: "https://x/icon.png")
        #expect(Rendering.systemTitle(for: urlIcon) == "Hi")
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
