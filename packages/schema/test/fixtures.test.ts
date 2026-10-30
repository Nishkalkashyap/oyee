/** The shared protocol v2 example notifications (fixtures/notifications.v2.json) that every client decodes in its tests. */
import { describe, expect, it } from "vitest";
import fixtures from "../fixtures/notifications.v2.json";
import { AskState, IntentNotification, ProgressState, durationMs } from "../src/index";

const entries = Object.entries(fixtures as Record<string, unknown>);

describe("protocol v2 fixtures", () => {
  it.each(entries)("%s is a valid v2 notification, unchanged by parsing", (_name, raw) => {
    const parsed = IntentNotification.safeParse(raw);
    expect(parsed.error).toBeUndefined();
    expect(parsed.data).toEqual(raw);
  });

  it("cover every intent in every state", () => {
    const parsed = entries.map(([, raw]) => IntentNotification.parse(raw));
    const states = new Set(
      parsed.map((n) =>
        n.intent === "ask" ? `ask:${n.ask.state}` : n.intent === "progress" ? `progress:${n.progress.state}` : `inform:${n.status}`,
      ),
    );
    expect([...states].sort()).toEqual(
      [
        "inform:active",
        "inform:resolved",
        ...AskState.options.map((s) => `ask:${s}`),
        ...ProgressState.options.map((s) => `progress:${s}`),
      ].sort(),
    );
    expect(new Set(parsed.filter((n) => n.intent === "inform").map((n) => n.severity))).toEqual(
      new Set(["info", "success", "warning", "critical"]),
    );
  });
});

describe("durationMs", () => {
  it("reads seconds, minutes and hours", () => {
    expect(durationMs("45s")).toBe(45_000);
    expect(durationMs("30m")).toBe(1_800_000);
    expect(durationMs("24h")).toBe(86_400_000);
  });
});
