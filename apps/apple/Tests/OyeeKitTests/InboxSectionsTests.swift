import Foundation
import Testing

@testable import OyeeKit

@Suite("Inbox sections")
struct InboxSectionsTests {
    func inform(_ id: String, source: String = "test", key: String? = nil, title: String? = nil) -> OyeeNotification {
        OyeeNotification(id: id, source: source, key: key, title: title ?? "Title \(id)")
    }

    func ask(_ id: String, _ state: AskState, key: String? = nil) -> OyeeNotification {
        OyeeNotification(id: id, key: key, title: "Ask", content: .ask(AskBlock(options: ["Yes"], state: state)))
    }

    func progress(_ id: String, _ state: ProgressState, key: String = "job") -> OyeeNotification {
        OyeeNotification(id: id, key: key, title: "Job", content: .progress(ProgressBlock(value: 1, state: state)))
    }

    @Test func sharedFixturesLandInTheirSections() throws {
        let names = [
            "ask-open", "progress-running", "inform-full", "ask-expired", "progress-stopped", "progress-done",
            "progress-failed", "ask-answered-option", "ask-withdrawn", "inform-minimal",
        ]
        let s = InboxSection.split(try names.map(v2))
        #expect(s.map(\.kind) == [.needsYou, .inProgress, .updates])
        #expect(s.map(\.title) == ["Needs you", "In progress", "Updates"])
        #expect(s[0].stacks.map(\.head.id) == ["ntf_01JBXA0000000000000000ASK1"])
        #expect(s[1].stacks.map(\.head.id) == ["ntf_01JBXA0000000000000000PRG1", "ntf_01JBXA0000000000000000PRG5"])
        #expect(s[2].stacks.count == 7)
    }

    @Test func sectionsFollowIntentAndStateOnly() {
        // Open asks need you; running and stopped progress are in progress; answered, expired and withdrawn asks,
        // finished progress and every inform are updates.
        let s = InboxSection.split([
            inform("i"), ask("open", .open), ask("answered", .answered), ask("expired", .expired),
            ask("withdrawn", .withdrawn), progress("running", .running, key: "a"), progress("stopped", .stopped, key: "b"),
            progress("done", .done, key: "c"), progress("failed", .failed, key: "d"),
        ])
        #expect(s.map { $0.stacks.flatMap { $0.items.map(\.id) } } == [
            ["open"], ["running", "stopped"], ["i", "answered", "expired", "withdrawn", "done", "failed"],
        ])
        #expect(InboxSection.split([inform("only")]).map(\.kind) == [.updates])
        #expect(InboxSection.split([]).isEmpty)
    }

    @Test func updatesStackBySourceAndKeyElseSourceAndTitle() {
        let s = InboxSection.split([
            inform("w1", source: "archiver", title: "Warning"),
            inform("k1", source: "disk", key: "db1", title: "Disk 90%"),
            inform("w2", source: "archiver", title: "Warning"),
            inform("x", source: "other", title: "Warning"),
            inform("k2", source: "disk", key: "db1", title: "Disk 95%"),
            inform("k3", source: "elsewhere", key: "db1", title: "Disk 95%"),
        ])
        #expect(s.count == 1)
        #expect(s[0].stacks.map { $0.items.map(\.id) } == [["w1", "w2"], ["k1", "k2"], ["x"], ["k3"]])
    }

    @Test func openAsksAndLiveProgressNeverStack() {
        let s = InboxSection.split([ask("a", .open, key: "q"), ask("b", .open, key: "q"), progress("p1", .running), progress("p2", .stopped)])
        #expect(s.map { $0.stacks.count } == [2, 2])
        // Finished progress with one key stacks like any update.
        #expect(InboxSection.split([progress("d1", .done), progress("d2", .failed)])[0].stacks.map(\.items.count) == [2])
    }

    @Test func flatKeepsEveryRow() {
        #expect(InboxSection.flat([inform("a", title: "Same"), inform("b", title: "Same")])[0].stacks.map(\.id) == ["a", "b"])
        #expect(InboxSection.flat([]).isEmpty)
    }
}
