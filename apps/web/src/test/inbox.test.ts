import { IntentNotification } from "@oyee/schema";
import { describe, expect, it } from "vitest";
import fixtures from "../../../../packages/schema/fixtures/notifications.v2.json";
import { flatSections, inboxSections, toastsOnArrival } from "../lib/inbox";

type Name = keyof typeof fixtures;

/** A shared protocol v2 fixture (packages/schema/fixtures), decoded the way the web reads the wire. */
const fx = (name: Name, patch: Partial<IntentNotification> = {}): IntentNotification =>
  ({ ...IntentNotification.parse(fixtures[name]), ...patch }) as IntentNotification;

/** Section id → stacks → item ids, the shape the inbox renders. */
const layout = (items: IntentNotification[]) => inboxSections(items).map((s) => [s.id, s.stacks.map((st) => st.items.map((n) => n.id))]);
const sectionOf = (n: IntentNotification) => inboxSections([n])[0]!.id;

describe("inbox sections come from intent and state", () => {
  it("Needs you holds open asks only", () => {
    expect(sectionOf(fx("ask-open"))).toBe("needs-you");
    for (const name of ["ask-answered-option", "ask-answered-text", "ask-expired", "ask-withdrawn"] as const) {
      expect([name, sectionOf(fx(name))]).toEqual([name, "updates"]);
    }
  });

  it("In progress holds running and stopped progress; done and failed are Updates", () => {
    expect(sectionOf(fx("progress-running"))).toBe("in-progress");
    expect(sectionOf(fx("progress-running-percent"))).toBe("in-progress");
    expect(sectionOf(fx("progress-stopped"))).toBe("in-progress");
    expect(sectionOf(fx("progress-done"))).toBe("updates");
    expect(sectionOf(fx("progress-failed"))).toBe("updates");
  });

  it("every inform is an Update, whatever its severity or links", () => {
    for (const name of ["inform-minimal", "inform-full", "inform-warning", "inform-resolved"] as const) {
      expect([name, sectionOf(fx(name))]).toEqual([name, "updates"]);
    }
  });

  it("orders Needs you, In progress, Updates and drops empty sections", () => {
    expect(layout([fx("inform-minimal"), fx("progress-running"), fx("ask-open")])).toEqual([
      ["needs-you", [["ntf_01JBXA0000000000000000ASK1"]]],
      ["in-progress", [["ntf_01JBXA0000000000000000PRG1"]]],
      ["updates", [["ntf_01JBXA0000000000000000INF1"]]],
    ]);
    expect(inboxSections([fx("inform-minimal")]).map((s) => s.id)).toEqual(["updates"]);
    expect(inboxSections([])).toEqual([]);
  });
});

describe("stacking in Updates", () => {
  it("notifications with the same (source, key) stack as one, newest first", () => {
    const a = fx("inform-full", { id: "a", title: "Disk 95% full on db-1" });
    const b = fx("inform-full", { id: "b", title: "Disk 91% full on db-1" });
    expect(layout([a, fx("inform-minimal"), b])).toEqual([["updates", [["a", "b"], ["ntf_01JBXA0000000000000000INF1"]]]]);
  });

  it("the same key from another source is a different notification", () => {
    const a = fx("inform-full", { id: "a" });
    const b = fx("inform-full", { id: "b", source: "grafana" });
    expect(layout([a, b])).toEqual([["updates", [["a"], ["b"]]]]);
  });

  it("without a key, repeats stack by source and title", () => {
    const a = fx("inform-warning", { id: "a" });
    const b = fx("inform-warning", { id: "b" });
    const other = fx("inform-warning", { id: "c", title: "Back door left open" });
    expect(layout([a, other, b])).toEqual([["updates", [["a", "b"], ["c"]]]]);
  });

  it("a keyed notification doesn't stack with an unkeyed one of the same title", () => {
    const keyed = fx("inform-warning", { id: "a", key: "front-door" });
    const plain = fx("inform-warning", { id: "b" });
    expect(layout([keyed, plain])).toEqual([["updates", [["a"], ["b"]]]]);
  });

  it("finished asks and progress stack with earlier notifications of their key", () => {
    const done = fx("progress-done", { id: "run-2" });
    const failed = fx("progress-failed", { id: "run-1", key: "ci-run-811" });
    expect(layout([done, failed])).toEqual([["updates", [["run-2", "run-1"]]]]);
  });

  it("never stacks open asks or live progress", () => {
    const q1 = fx("ask-open", { id: "q1", key: null });
    const q2 = fx("ask-open", { id: "q2", key: null });
    const p1 = fx("progress-running", { id: "p1" });
    const p2 = fx("progress-stopped", { id: "p2", source: "github-actions", key: "ci-run-812" });
    expect(layout([q1, p1, q2, p2])).toEqual([
      ["needs-you", [["q1"], ["q2"]]],
      ["in-progress", [["p1"], ["p2"]]],
    ]);
  });
});

describe("flatSections", () => {
  it("keeps one row per item, for search results and the resolved archive", () => {
    const items = [fx("inform-warning", { id: "a" }), fx("inform-warning", { id: "b" })];
    expect(flatSections(items)[0]!.stacks.map((st) => st.key)).toEqual(["a", "b"]);
    expect(flatSections([])).toEqual([]);
  });
});

describe("in-app toast on arrival", () => {
  it("a running progress appears without a toast; everything else announces itself", () => {
    expect(toastsOnArrival(fx("progress-running"))).toBe(false);
    expect(toastsOnArrival(fx("progress-done"))).toBe(true);
    expect(toastsOnArrival(fx("ask-open"))).toBe(true);
    expect(toastsOnArrival(fx("inform-minimal"))).toBe(true);
  });
});
