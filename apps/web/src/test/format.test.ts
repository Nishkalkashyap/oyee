import { describe, expect, it } from "vitest";
import {
  fieldLines,
  formatCountdown,
  formatPairingCode,
  progressLabel,
  progressPercent,
  relativeTime,
  systemNotificationBody,
} from "../lib/format";

describe("progress formatting", () => {
  it("computes percentages with default max 100 and clamps", () => {
    expect(progressPercent({ value: 42 })).toBe(42);
    expect(progressPercent({ value: 3, max: 7 })).toBeCloseTo(42.857, 2);
    expect(progressPercent({ value: 12, max: 10 })).toBe(100);
    expect(progressPercent({ value: -5 })).toBe(0);
    expect(progressPercent({ value: Number.NaN })).toBe(0);
    expect(progressPercent({ value: 5, max: 0 })).toBe(5); // invalid max falls back to 100
  });

  it("labels: explicit label, else % for max 100, else value/max", () => {
    expect(progressLabel({ value: 3, max: 7, label: "3/7 checks" })).toBe("3/7 checks");
    expect(progressLabel({ value: 42.4 })).toBe("42%");
    expect(progressLabel({ value: 3, max: 7 })).toBe("3/7");
    expect(progressLabel({ value: 0, indeterminate: true })).toBe("");
    expect(progressLabel({ value: 0, indeterminate: true, label: "Waiting" })).toBe("Waiting");
  });
});

describe("fields", () => {
  it("formats Label: value lines", () => {
    expect(fieldLines([{ label: "Region", value: "us-east-1" }, { label: "Pods", value: "3" }])).toEqual([
      "Region: us-east-1",
      "Pods: 3",
    ]);
    expect(fieldLines(undefined)).toEqual([]);
  });
});

describe("systemNotificationBody", () => {
  it("strips markdown and appends fields and the text progress bar", () => {
    expect(
      systemNotificationBody({
        body: "CPU **90%** on `api` ([graph](https://g.io))",
        fields: [{ label: "Region", value: "us-east-1" }],
        progress: { value: 3, max: 7, label: "3/7", indeterminate: false },
      }),
    ).toBe("CPU 90% on api (graph)\nRegion: us-east-1\n▓▓▓▓░░░░░░ 3/7");
  });

  it("handles empty body, indeterminate progress", () => {
    expect(systemNotificationBody({ body: null, fields: [], progress: { value: 0, max: 100, indeterminate: true } })).toBe(
      "In progress…",
    );
    expect(systemNotificationBody({ body: null, fields: [], progress: null })).toBe("");
  });
});

describe("misc formatting", () => {
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  it("relativeTime", () => {
    expect(relativeTime("2026-10-28T11:59:50.000Z", now)).toBe("now");
    expect(relativeTime("2026-10-28T11:55:00.000Z", now)).toBe("5m");
    expect(relativeTime("2026-10-28T09:00:00.000Z", now)).toBe("3h");
    expect(relativeTime("2026-10-26T12:00:00.000Z", now)).toBe("2d");
    expect(relativeTime(null, now)).toBe("");
    expect(relativeTime("garbage", now)).toBe("");
  });

  it("formatPairingCode", () => {
    expect(formatPairingCode("k7q29xma")).toBe("K7Q2-9XMA");
    expect(formatPairingCode("K7Q2-9XMA")).toBe("K7Q2-9XMA");
  });

  it("formatCountdown", () => {
    expect(formatCountdown(600_000)).toBe("10:00");
    expect(formatCountdown(65_001)).toBe("1:06");
    expect(formatCountdown(-1)).toBe("0:00");
  });
});
