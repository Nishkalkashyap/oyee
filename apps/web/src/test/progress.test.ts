import type { Notification } from "@oyee/schema";
import { describe, expect, it } from "vitest";
import fixtures from "../../../../packages/schema/fixtures/notifications.v2.json";
import { inboxSections } from "../lib/inbox";
import { progressView } from "../lib/progress";

type ProgressFixture = Extract<Notification, { intent: "progress" }>;
const fx = (name: keyof typeof fixtures) => fixtures[name] as unknown as ProgressFixture;

describe("progressView (shared v2 fixtures)", () => {
  it("running with a label: the label, the share done and a quiet ink bar", () => {
    expect(progressView(fx("progress-running"))).toEqual({
      state: "running",
      stateLabel: "Running",
      amount: "3/7 checks",
      percent: (3 / 7) * 100,
      tone: "ink",
    });
  });

  it("running without a label shows the percent", () => {
    expect(progressView(fx("progress-running-percent"))).toMatchObject({ stateLabel: "Running", amount: "40%", percent: 40 });
  });

  it("done is full and green", () => {
    expect(progressView(fx("progress-done"))).toEqual({
      state: "done",
      stateLabel: "Done",
      amount: "7/7 checks",
      percent: 100,
      tone: "success",
    });
  });

  it("failed keeps where it stopped and is amber", () => {
    expect(progressView(fx("progress-failed"))).toMatchObject({ stateLabel: "Failed", amount: "4/7 checks", tone: "warning" });
  });

  it("stopped reporting says how far it got", () => {
    expect(progressView(fx("progress-stopped"))).toMatchObject({
      stateLabel: "Stopped reporting after 40%",
      tone: "muted",
    });
  });

  it("stopped reporting names the sender's last label, else the percent", () => {
    const n = fx("progress-stopped");
    expect(progressView({ ...n, progress: { ...n.progress, value: 3, max: 7, label: "3/7 checks" } })).toMatchObject({
      stateLabel: "Stopped reporting after 3/7 checks",
      amount: "3/7 checks",
    });
    expect(progressView({ ...n, progress: { ...n.progress, value: 3, max: 7 } }).stateLabel).toBe("Stopped reporting after 43%");
  });

  it("a value past max is clamped to a full bar", () => {
    const n = fx("progress-running-percent");
    expect(progressView({ ...n, progress: { ...n.progress, value: 250 } }).percent).toBe(100);
  });
});

describe("inbox section of a progress", () => {
  it("a failed progress has ended, so it isn't In progress even though its bar isn't full", () => {
    expect(inboxSections([fx("progress-failed")])[0]!.id).toBe("updates");
    expect(inboxSections([fx("progress-running")])[0]!.id).toBe("in-progress");
  });
});

describe("progressView edge cases", () => {
  it("clamps a value past max", () => {
    const n = fx("progress-running-percent");
    expect(progressView({ ...n, progress: { ...n.progress, value: 250 } }).percent).toBe(100);
  });
});
