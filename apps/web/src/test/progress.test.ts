import type { IntentNotification } from "@oyee/schema";
import { describe, expect, it } from "vitest";
import fixtures from "../../../../packages/schema/fixtures/notifications.v2.json";
import { inProgress } from "../lib/inbox";
import { progressView, usesProgressCard } from "../lib/progress";
import { makeNotification } from "./fixtures";

type ProgressFixture = Extract<IntentNotification, { intent: "progress" }>;
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

  it("a value past max is clamped to a full bar", () => {
    const n = fx("progress-running-percent");
    expect(progressView({ ...n, progress: { ...n.progress, value: 250 } }).percent).toBe(100);
  });
});

describe("usesProgressCard", () => {
  it("draws progress sent with the progress tool as a progress card", () => {
    const n = makeNotification({ id: "ntf_p", progress: { value: 2, max: 5, indeterminate: false } });
    expect(n.intent).toBe("progress");
    expect(usesProgressCard(n)).toBe(true);
  });

  it("keeps the generic card for informs, asks and flat progress cards with parts a progress card has no room for", () => {
    const bar = { value: 2, max: 5, indeterminate: false };
    expect(usesProgressCard(makeNotification({ id: "ntf_i" }))).toBe(false);
    expect(usesProgressCard(makeNotification({ id: "ntf_f", progress: bar, fields: [{ label: "Env", value: "prod" }] }))).toBe(false);
    expect(
      usesProgressCard(makeNotification({ id: "ntf_l", progress: bar, actions: [{ id: "log", label: "Log", url: "https://ci.example.com", style: "default", resolves: false }] })),
    ).toBe(false);
    expect(usesProgressCard(makeNotification({ id: "ntf_x", progress: { value: 0, max: 100, indeterminate: true } }))).toBe(false);
  });
});

describe("inbox section of a progress", () => {
  it("a failed progress has ended, so it isn't In progress even though its bar isn't full", () => {
    const failed = makeNotification({ id: "ntf_x", progress: { value: 4, max: 7, indeterminate: false, state: "failed" } as never });
    expect(failed.intent === "progress" && failed.progress.state).toBe("failed");
    expect(inProgress(failed)).toBe(false);
    expect(inProgress(makeNotification({ id: "ntf_r", progress: { value: 4, max: 7, indeterminate: false } }))).toBe(true);
  });
});

describe("progressView edge cases", () => {
  it("clamps a value past max", () => {
    const n = fx("progress-running-percent");
    expect(progressView({ ...n, progress: { ...n.progress, value: 250 } }).percent).toBe(100);
  });
});
