import { describe, expect, it } from "vitest";
import { flatSections, inProgress, inboxSections, needsAnswer } from "../lib/inbox";
import { makeNotification, minute } from "./fixtures";

const ask = (id: string, extra = {}) =>
  makeNotification({ id, actions: [{ id: "yes", label: "Yes", style: "primary", resolves: true }], ...extra });

describe("inbox sections", () => {
  it("needsAnswer: callback buttons or a reply box, unanswered and active", () => {
    expect(needsAnswer(ask("a"))).toBe(true);
    expect(needsAnswer(makeNotification({ id: "b", reply: { placeholder: "Why?" } }))).toBe(true);
    expect(needsAnswer(makeNotification({ id: "c" }))).toBe(false);
    // Link buttons aren't questions.
    expect(
      needsAnswer(makeNotification({ id: "d", actions: [{ id: "open", label: "Open", style: "default", url: "https://x.dev", resolves: false }] })),
    ).toBe(false);
    expect(needsAnswer(ask("e", { responses: [{ actionId: "yes", text: null, deviceId: null, deviceName: null, at: minute(1) }] }))).toBe(false);
    expect(needsAnswer(ask("f", { status: "resolved" }))).toBe(false);
  });

  it("inProgress: unfinished or indeterminate progress", () => {
    expect(inProgress(makeNotification({ id: "a", progress: { value: 2, max: 7, indeterminate: false } }))).toBe(true);
    expect(inProgress(makeNotification({ id: "b", progress: { value: 7, max: 7, indeterminate: false } }))).toBe(false);
    expect(inProgress(makeNotification({ id: "c", progress: { value: 0, max: 100, indeterminate: true } }))).toBe(true);
  });

  it("orders Needs you, In progress, Updates and drops empty sections", () => {
    const s = inboxSections([
      makeNotification({ id: "u1" }),
      makeNotification({ id: "p1", progress: { value: 1, max: 3, indeterminate: false } }),
      ask("q1"),
    ]);
    expect(s.map((x) => [x.id, x.stacks.map((st) => st.items.map((n) => n.id))])).toEqual([
      ["needs-you", [["q1"]]],
      ["in-progress", [["p1"]]],
      ["updates", [["u1"]]],
    ]);
    expect(inboxSections([makeNotification({ id: "only" })]).map((x) => x.id)).toEqual(["updates"]);
  });

  it("stacks repeats in Updates by thread, else by source + title, ordered by newest", () => {
    const s = inboxSections([
      makeNotification({ id: "w1", source: "archiver", title: "Warning" }),
      makeNotification({ id: "t1", threadId: "deploy" }),
      makeNotification({ id: "w2", source: "archiver", title: "Warning" }),
      makeNotification({ id: "x", source: "other", title: "Warning" }),
      makeNotification({ id: "t2", threadId: "deploy", title: "Something else" }),
    ]);
    expect(s[0]!.stacks.map((st) => st.items.map((n) => n.id))).toEqual([["w1", "w2"], ["t1", "t2"], ["x"]]);
  });

  it("keeps a running job with buttons under In progress", () => {
    const s = inboxSections([ask("job", { progress: { value: 1, max: 5, indeterminate: false } })]);
    expect(s.map((x) => x.id)).toEqual(["in-progress"]);
  });

  it("never stacks questions or live progress", () => {
    const s = inboxSections([ask("q1", { threadId: "t" }), ask("q2", { threadId: "t" })]);
    expect(s[0]!.stacks).toHaveLength(2);
  });

  it("flatSections keeps one row per item", () => {
    const items = [makeNotification({ id: "a", title: "Same" }), makeNotification({ id: "b", title: "Same" })];
    expect(flatSections(items)[0]!.stacks.map((st) => st.key)).toEqual(["a", "b"]);
    expect(flatSections([])).toEqual([]);
  });
});
