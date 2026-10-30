import { describe, expect, it } from "vitest";
import { InformInput, RespondInput, Severity, progressText, stoppedReportingLabel } from "../src/index";

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
