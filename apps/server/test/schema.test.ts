/** Unit tests for @herald/schema helpers (kept here so packages/schema stays untouched). */
import {
  Action,
  ClientMessage,
  Progress,
  RespondInput,
  SendNotificationInput,
  TemplateCard,
  progressText,
  renderTemplateString,
  renderTemplateValue,
} from "@herald/schema";
import { describe, expect, it } from "vitest";
import { resolveSendInput } from "../src/inbox/model";

describe("renderTemplateString", () => {
  it("substitutes vars, fallbacks and empty strings", () => {
    expect(renderTemplateString("{{service}} {{metric}} high", { service: "api", metric: "CPU" })).toBe("api CPU high");
    expect(renderTemplateString("{{region|us-east-1}}", {})).toBe("us-east-1");
    expect(renderTemplateString("[{{missing}}]", {})).toBe("[]");
    expect(renderTemplateString("{{ n }} / {{ok}}", { n: 3, ok: false })).toBe("3 / false");
    expect(renderTemplateString("{{a.b}}", { "a.b": "dotted" })).toBe("dotted");
  });
});

describe("renderTemplateValue", () => {
  it("renders every string deeply without touching other types", () => {
    const card = {
      title: "{{x}}",
      fields: [{ label: "L", value: "{{y|none}}" }],
      progress: { value: 3, max: 7 },
      silent: true,
    };
    expect(renderTemplateValue(card, { x: "X" })).toEqual({
      title: "X",
      fields: [{ label: "L", value: "none" }],
      progress: { value: 3, max: 7 },
      silent: true,
    });
    expect(card.title).toBe("{{x}}"); // not mutated
  });
});

describe("progressText", () => {
  it("formats bars", () => {
    expect(progressText({ value: 3, max: 7 })).toBe("▓▓▓▓░░░░░░ 3/7");
    expect(progressText({ value: 50 })).toBe("▓▓▓▓▓░░░░░ 50%");
    expect(progressText({ value: 3, max: 7, label: "3 of 7 checks" })).toBe("▓▓▓▓░░░░░░ 3 of 7 checks");
    expect(progressText({ value: 0, indeterminate: true })).toBe("In progress…");
    expect(progressText({ value: 200, max: 100 })).toBe("▓▓▓▓▓▓▓▓▓▓ 100%");
  });
});

describe("schemas", () => {
  it("applies defaults", () => {
    expect(Action.parse({ id: "ack", label: "OK" })).toEqual({ id: "ack", label: "OK", style: "default", resolves: false });
    expect(Progress.parse({ value: 1 })).toEqual({ value: 1, max: 100, indeterminate: false });
  });

  it("validates action ids, tags and URLs", () => {
    expect(Action.safeParse({ id: "Bad Id", label: "x" }).success).toBe(false);
    expect(SendNotificationInput.safeParse({ title: "x", tags: ["a".repeat(33)] }).success).toBe(false);
    expect(SendNotificationInput.safeParse({ title: "x", url: "not a url" }).success).toBe(false);
    expect(SendNotificationInput.safeParse({ title: "x", actions: [1, 2, 3, 4].map((i) => ({ id: `a${i}`, label: "x" })) }).success).toBe(false);
  });

  it("RespondInput needs actionId or text", () => {
    expect(RespondInput.safeParse({}).success).toBe(false);
    expect(RespondInput.safeParse({ text: "hi" }).success).toBe(true);
    expect(RespondInput.safeParse({ actionId: "ack" }).success).toBe(true);
  });

  it("ClientMessage discriminates", () => {
    expect(ClientMessage.parse({ type: "sync", since: null })).toEqual({ type: "sync", since: null });
    expect(ClientMessage.safeParse({ type: "nope" }).success).toBe(false);
  });

  it("TemplateCard has no template/vars", () => {
    expect(TemplateCard.parse({ title: "t", template: "x", vars: { a: 1 } })).toEqual({ title: "t" });
  });
});

describe("resolveSendInput (server template merge)", () => {
  const template = {
    id: "tpl_1",
    name: "aws",
    description: null,
    card: { title: "{{svc}} alarm", body: "{{detail}}", severity: "warning" as const, tags: ["aws"] },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("renders then shallow-merges explicit fields", () => {
    const r = resolveSendInput({ template: "aws", vars: { svc: "api" }, severity: "critical" }, template);
    expect(r).toMatchObject({ title: "api alarm", severity: "critical", tags: ["aws"], template: "aws" });
    expect(r.body).toBeUndefined(); // "{{detail}}" rendered empty → treated as absent
  });

  it("title fallback for webhooks", () => {
    expect(resolveSendInput({ body: "line one\nline two" }, null, { titleFallback: true }).title).toBe("line one");
    expect(resolveSendInput({}, null, { titleFallback: true }).title).toBe("Notification");
    expect(() => resolveSendInput({ body: "x" }, null)).toThrow(/title/);
  });
});
