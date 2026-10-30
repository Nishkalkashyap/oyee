import { describe, expect, it } from "vitest";
import { IntentSendInput, Notification } from "@oyee/schema";
import { buildSendInput, COMPOSER_PRESETS, emptyComposer, previewNotification } from "../lib/composer";

describe("buildSendInput", () => {
  it("an inform with just a title", () => {
    expect(buildSendInput({ ...emptyComposer, title: "  Backup done " })).toEqual({ intent: "inform", title: "Backup done", severity: "info" });
  });

  it("an inform with every intent field, dropping empty rows and links", () => {
    const input = buildSendInput({
      ...emptyComposer,
      title: "Deploy finished",
      body: "All **green**",
      severity: "success",
      source: " ci ",
      key: "deploy-prod",
      cooldown: "1h",
      icon: "🚀",
      image: "https://example.com/chart.png",
      url: "https://ci.example.com/42",
      devices: ["dev_1"],
      fields: [
        { label: "Env", value: "prod" },
        { label: " ", value: "dropped" },
      ],
      links: [
        { label: "Build log", url: "https://ci.example.com/42/log" },
        { label: "", url: "https://dropped.example.com" },
      ],
      // progress-only state is ignored for an inform
      value: 5,
      status: "done",
    });
    expect(input).toEqual({
      intent: "inform",
      title: "Deploy finished",
      body: "All **green**",
      severity: "success",
      source: "ci",
      key: "deploy-prod",
      cooldown: "1h",
      icon: "🚀",
      image: "https://example.com/chart.png",
      url: "https://ci.example.com/42",
      devices: ["dev_1"],
      fields: [{ label: "Env", value: "prod" }],
      links: [{ label: "Build log", url: "https://ci.example.com/42/log" }],
    });
    expect(IntentSendInput.safeParse(input).success).toBe(true);
  });

  it("a progress with its intent fields and none of the inform ones", () => {
    const input = buildSendInput({
      ...emptyComposer,
      intent: "progress",
      title: "Deploying",
      key: "deploy",
      value: 3,
      max: 7,
      label: "3/7 pods",
      status: "running",
      staleAfter: "1h",
      severity: "critical",
      icon: "🚀",
      cooldown: "1h",
      fields: [{ label: "Env", value: "prod" }],
    });
    expect(input).toEqual({ intent: "progress", title: "Deploying", key: "deploy", value: 3, max: 7, label: "3/7 pods", status: "running", staleAfter: "1h" });
    expect(IntentSendInput.safeParse(input).success).toBe(true);
  });

  it("a progress without a key is invalid, with an issue on key", () => {
    const r = IntentSendInput.safeParse(buildSendInput({ ...emptyComposer, intent: "progress", title: "x" }));
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join("."))).toContain("key");
  });

  it("all presets produce valid send bodies, covering both intents", () => {
    for (const p of COMPOSER_PRESETS) {
      const r = IntentSendInput.safeParse(buildSendInput({ ...emptyComposer, ...p.state }));
      expect(r.error, p.id).toBeUndefined();
    }
    expect(new Set(COMPOSER_PRESETS.map((p) => p.state.intent ?? "inform"))).toEqual(new Set(["inform", "progress"]));
  });
});

describe("previewNotification", () => {
  it("draws an inform as the stored notification would look", () => {
    const n = previewNotification(
      buildSendInput({ ...emptyComposer, title: "Hi", severity: "warning", links: [{ label: "Open", url: "https://x.io" }] }),
    );
    expect(n).toMatchObject({
      intent: "inform",
      title: "Hi",
      severity: "warning",
      source: "web",
      status: "active",
      inform: { links: [{ label: "Open", url: "https://x.io" }], fields: [], image: null, icon: null, cooldown: null },
    });
    expect(Notification.safeParse(n).error).toBeUndefined();
  });

  it("draws a progress in its state; done fills the bar and finishes at success", () => {
    const running = previewNotification(buildSendInput({ ...emptyComposer, intent: "progress", title: "Sync", key: "s", value: 2, max: 8 }));
    expect(running).toMatchObject({ intent: "progress", severity: "info", progress: { value: 2, max: 8, state: "running", staleAfter: "30m" } });
    expect(Notification.safeParse(running).error).toBeUndefined();
    const done = previewNotification(buildSendInput({ ...emptyComposer, intent: "progress", title: "Sync", key: "s", max: 8, status: "done" }));
    expect(done).toMatchObject({ severity: "success", progress: { value: 8, state: "done" } });
    const failed = previewNotification(buildSendInput({ ...emptyComposer, intent: "progress", title: "Sync", key: "s", status: "failed" }));
    expect(failed).toMatchObject({ severity: "warning", progress: { state: "failed" } });
  });

  it("falls back to a placeholder title so an empty form still renders", () => {
    expect(previewNotification(buildSendInput(emptyComposer)).title).toBe("Untitled notification");
  });
});
