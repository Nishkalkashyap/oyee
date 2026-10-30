import { describe, expect, it } from "vitest";
import type { TemplateCard } from "@oyee/schema";
import { composeCard, parseVars, templateVariables, toPreviewNotification } from "../lib/card";

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
