import Foundation
import Testing

@testable import OyeeKit

@Suite("Inbox sections")
struct InboxSectionsTests {
    let yes = Action(id: "yes", label: "Yes")

    func n(_ id: String, source: String = "test", title: String? = nil, thread: String? = nil) -> OyeeNotification {
        OyeeNotification(id: id, source: source, threadId: thread, title: title ?? "Title \(id)")
    }

    @Test func needsAnswer() {
        var a = n("a"); a.actions = [yes]
        #expect(a.needsAnswer)
        var b = n("b"); b.reply = Reply(placeholder: nil, buttonLabel: nil)
        #expect(b.needsAnswer)
        #expect(!n("c").needsAnswer)
        var d = n("d"); d.actions = [Action(id: "open", label: "Open", url: "https://x.dev")]
        #expect(!d.needsAnswer)
        var e = a; e.responses = [Response(actionId: "yes", text: nil, deviceId: nil, deviceName: nil, at: Date())]
        #expect(!e.needsAnswer)
        var f = a; f.status = .resolved
        #expect(!f.needsAnswer)
    }

    @Test func inProgress() {
        var a = n("a"); a.progress = Progress(value: 2, max: 7)
        #expect(a.isInProgress)
        var b = n("b"); b.progress = Progress(value: 7, max: 7)
        #expect(!b.isInProgress)
        var c = n("c"); c.progress = Progress(value: 0, indeterminate: true)
        #expect(c.isInProgress)
    }

    @Test func orderAndRunningJobs() {
        var p = n("p1"); p.progress = Progress(value: 1, max: 3); p.actions = [yes]
        var q = n("q1"); q.actions = [yes]
        let s = InboxSection.split([n("u1"), p, q])
        #expect(s.map(\.kind) == [.needsYou, .inProgress, .updates])
        #expect(s[0].stacks.map(\.head.id) == ["q1"])
        #expect(s[1].stacks.map(\.head.id) == ["p1"])
        #expect(InboxSection.split([n("only")]).map(\.kind) == [.updates])
    }

    @Test func stacking() {
        let s = InboxSection.split([
            n("w1", source: "archiver", title: "Warning"),
            n("t1", thread: "deploy"),
            n("w2", source: "archiver", title: "Warning"),
            n("x", source: "other", title: "Warning"),
            n("t2", title: "Something else", thread: "deploy"),
        ])
        #expect(s.count == 1)
        #expect(s[0].stacks.map { $0.items.map(\.id) } == [["w1", "w2"], ["t1", "t2"], ["x"]])
    }

    @Test func questionsNeverStackAndFlatKeepsRows() {
        var a = n("a", thread: "t"); a.actions = [yes]
        var b = n("b", thread: "t"); b.actions = [yes]
        #expect(InboxSection.split([a, b])[0].stacks.count == 2)
        #expect(InboxSection.flat([n("a", title: "Same"), n("b", title: "Same")])[0].stacks.map(\.id) == ["a", "b"])
        #expect(InboxSection.flat([]).isEmpty)
    }
}
