import { describe, expect, it } from "vitest";
import {
  InformInput,
  RespondInput,
  Severity,
  formatDuration,
  isLiveProgress,
  isOpenAsk,
  isQuietProgress,
  progressAmount,
  progressText,
  stoppedReportingLabel,
} from "../src/index";

describe("progressText", () => {
  it("formats a ratio or a percent", () => {
    expect(progressText({ value: 3, max: 7 })).toBe("▓▓▓▓░░░░░░ 3/7");
    expect(progressText({ value: 50 })).toBe("▓▓▓▓▓░░░░░ 50%");
    expect(progressText({ value: 2, max: 4, label: "2/4 pods" })).toBe("▓▓▓▓▓░░░░░ 2/4 pods");
  });
});

describe("stoppedReportingLabel", () => {
  it("uses the sender's label, else the percent", () => {
    expect(stoppedReportingLabel({ value: 3, max: 7, label: "3/7 checks" })).toBe("Stopped reporting after 3/7 checks");
    expect(stoppedReportingLabel({ value: 3, max: 7 })).toBe("Stopped reporting after 43%");
  });
});

describe("progressAmount", () => {
  it("is the sender's label, else a percent when max is 100, else value/max", () => {
    expect(progressAmount({ value: 3, max: 7, label: "3/7 checks" })).toBe("3/7 checks");
    expect(progressAmount({ value: 40, max: 100 })).toBe("40%");
    expect(progressAmount({ value: 42 })).toBe("42%");
    expect(progressAmount({ value: 33.4 })).toBe("33%");
    expect(progressAmount({ value: 250 })).toBe("100%"); // clamped
    expect(progressAmount({ value: 3, max: 7 })).toBe("3/7");
    expect(progressAmount({ value: 2.5, max: 20 })).toBe("2.5/20");
  });
});

describe("formatDuration", () => {
  const S = 1000;
  const M = 60 * S;
  const H = 60 * M;
  it("elapsed: whole units, rounded down", () => {
    expect(formatDuration(45 * S)).toBe("45s");
    expect(formatDuration(12 * M + 59 * S)).toBe("12m");
    expect(formatDuration(2 * H + 59 * M)).toBe("2h");
    expect(formatDuration(49 * H)).toBe("2d");
    expect(formatDuration(-5 * S)).toBe("0s");
  });

  it("span: to the nearest second or minute, hours with their leftover minutes", () => {
    expect(formatDuration(40 * S, "span")).toBe("40s");
    expect(formatDuration(59.6 * S, "span")).toBe("1m");
    expect(formatDuration(48 * M + 20 * S, "span")).toBe("48m");
    expect(formatDuration(H, "span")).toBe("1h");
    expect(formatDuration(2 * H + 30 * M, "span")).toBe("2h 30m");
    expect(formatDuration(24 * H - 30 * S, "span")).toBe("24h");
    expect(formatDuration(168 * H, "span")).toBe("168h");
  });
});

describe("intent predicates", () => {
  const now = Date.parse("2026-10-30T10:00:00.000Z");
  const ask = (state: "open" | "answered", expiresAt: string, status: "active" | "resolved" = "active") =>
    ({ intent: "ask", status, ask: { state, expiresAt } }) as const;
  const progress = (state: "running" | "done" | "failed" | "stopped", status: "active" | "resolved" = "active") =>
    ({ intent: "progress", status, progress: { state } }) as const;

  it("an open ask is open, active and not past its expiry", () => {
    expect(isOpenAsk(ask("open", "2026-10-30T10:00:01.000Z"), now)).toBe(true);
    expect(isOpenAsk(ask("open", "2026-10-30T10:00:00.000Z"), now)).toBe(false);
    expect(isOpenAsk(ask("answered", "2026-10-30T11:00:00.000Z"), now)).toBe(false);
    expect(isOpenAsk(ask("open", "2026-10-30T11:00:00.000Z", "resolved"), now)).toBe(false);
    expect(isOpenAsk({ intent: "inform" }, now)).toBe(false);
    expect(isOpenAsk(null, now)).toBe(false);
  });

  it("a live progress is running or stopped and still active", () => {
    expect([progress("running"), progress("stopped"), progress("done"), progress("failed")].map((n) => isLiveProgress(n))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(isLiveProgress(progress("stopped", "resolved"))).toBe(false);
    expect(isLiveProgress({ intent: "progress", progress: { state: "running" } })).toBe(true); // no status: an inbox item
  });

  it("only a running progress is quiet", () => {
    expect([progress("running"), progress("stopped"), progress("done")].map((n) => isQuietProgress(n))).toEqual([true, false, false]);
    expect(isQuietProgress({ intent: "inform" })).toBe(false);
  });
});

describe("protocol v2 inputs", () => {
  it("has no debug severity", () => {
    expect(Severity.options).toEqual(["info", "success", "warning", "critical"]);
    expect(InformInput.safeParse({ title: "x", severity: "debug" }).success).toBe(false);
  });

  it("answers an ask by option label or text", () => {
    expect(RespondInput.safeParse({ option: "Approve" }).success).toBe(true);
    expect(RespondInput.safeParse({ text: "main" }).success).toBe(true);
    expect(RespondInput.safeParse({ actionId: "option_1" }).success).toBe(false);
  });
});
