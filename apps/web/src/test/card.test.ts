import { describe, expect, it } from "vitest";
import { SendNotificationInput, TemplateCard } from "@oyee/schema";
import { composeCard, parseVars, templateVariables, toPreviewNotification } from "../lib/card";
import { buildSendInput, COMPOSER_PRESETS, emptyComposer } from "../lib/composer";

describe("composeCard", () => {
  const tpl: TemplateCard = {
    title: "{{service}} {{metric}} high",
    severity: "warning",
    fields: [{ label: "Region", value: "{{region|us-east-1}}" }],
  };
  it("renders vars + fallbacks, then shallow-merges explicit fields", () => {
    expect(composeCard(tpl, { service: "api", metric: "CPU" }, { severity: "critical", title: undefined })).toEqual({
      title: "api CPU high",
      severity: "critical",
      fields: [{ label: "Region", value: "us-east-1" }],
    });
  });
  it("works without a template", () => {
    expect(composeCard(null, {}, { title: "x" })).toEqual({ title: "x" });
  });
});

describe("toPreviewNotification", () => {
  it("fills defaults so the card can render", () => {
    const n = toPreviewNotification({ title: "Hi", progress: { value: 2, max: 100, indeterminate: false } });
    expect(n.severity).toBe("info");
    expect(n.source).toBe("web");
    // On a progress intent the v1 bar is the v2 progress block, which adds state, staleAfter and lastReportAt.
    expect(n.progress).toMatchObject({ value: 2, max: 100, label: undefined, indeterminate: false });
    expect(n.actions).toEqual([]);
    expect(toPreviewNotification({}).title).toBe("Untitled notification");
  });
});

describe("parseVars / templateVariables", () => {
  it("parses a flat JSON object of primitives", () => {
    expect(parseVars('{"a":"x","b":2,"c":true}')).toEqual({ vars: { a: "x", b: 2, c: true }, error: null });
    expect(parseVars("")).toEqual({ vars: {}, error: null });
    expect(parseVars("[1]").error).toMatch(/object/);
    expect(parseVars('{"a":{}}').error).toMatch(/"a"/);
    expect(parseVars("{bad").error).toBeTruthy();
  });
  it("lists placeholders anywhere in a card", () => {
    expect(templateVariables({ title: "{{a}} {{ b | x }}", fields: [{ label: "L", value: "{{c}}{{a}}" }] })).toEqual(["a", "b", "c"]);
  });
});

describe("buildSendInput", () => {
  it("omits empty values", () => {
    expect(buildSendInput({ ...emptyComposer, title: "  Hello " })).toEqual({ title: "Hello", severity: "info" });
  });

  it("does not override a template's severity with the default", () => {
    expect(buildSendInput({ ...emptyComposer, template: "aws-alarm" }, { service: "api" })).toEqual({
      template: "aws-alarm",
      vars: { service: "api" },
    });
  });

  it("builds a full, schema-valid card", () => {
    const input = buildSendInput({
      ...emptyComposer,
      title: "T",
      tags: "a, b,,",
      fields: [
        { label: "K", value: "V" },
        { label: " ", value: "dropped" },
      ],
      progressOn: true,
      progress: { value: 3, max: 7, label: "", indeterminate: false },
      actions: [
        { id: "", label: "Go", style: "primary", url: "https://x.io", resolves: false },
        { id: "no", label: "", style: "default", url: "", resolves: false },
      ],
      replyOn: true,
      reply: { placeholder: "Say", buttonLabel: "" },
    });
    expect(input).toEqual({
      title: "T",
      severity: "info",
      tags: ["a", "b"],
      fields: [{ label: "K", value: "V" }],
      progress: { value: 3, max: 7, indeterminate: false },
      actions: [{ id: "action_1", label: "Go", style: "primary", resolves: false, url: "https://x.io" }],
      reply: { placeholder: "Say" },
    });
    expect(SendNotificationInput.safeParse(input).success).toBe(true);
  });

  it("all presets produce valid send inputs", () => {
    for (const p of COMPOSER_PRESETS) {
      const r = SendNotificationInput.safeParse(buildSendInput({ ...emptyComposer, ...p.state }));
      expect(r.success, p.id).toBe(true);
    }
  });
});
