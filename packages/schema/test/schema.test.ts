import { describe, expect, it } from "vitest";
import { SendNotificationInput, TemplateCard, progressText, renderTemplateValue } from "../src/index";

describe("TemplateCard", () => {
  it("accepts {{var}} placeholders in URL fields", () => {
    const card = {
      title: "{{service}} down",
      image: "{{img}}",
      url: "{{link|https://example.com}}",
      actions: [{ id: "open", label: "Open", url: "{{link}}" }],
    };
    expect(TemplateCard.safeParse(card).success).toBe(true);
  });

  it("rendered output is validated as a real send input", () => {
    const card = TemplateCard.parse({ title: "{{service}} down", image: "{{img}}" });
    const ok = renderTemplateValue(card, { service: "api", img: "https://example.com/a.png" });
    expect(SendNotificationInput.safeParse(ok).success).toBe(true);
    const bad = renderTemplateValue(card, { service: "api", img: "not a url" });
    expect(SendNotificationInput.safeParse(bad).success).toBe(false);
  });
});

describe("renderTemplateValue", () => {
  it("uses fallbacks and empties missing vars", () => {
    expect(renderTemplateValue({ a: "{{x|dflt}}", b: ["{{y}}!"] }, {})).toEqual({ a: "dflt", b: ["!"] });
  });
});

describe("progressText", () => {
  it("formats ratio, percent and indeterminate", () => {
    expect(progressText({ value: 3, max: 7 })).toBe("▓▓▓▓░░░░░░ 3/7");
    expect(progressText({ value: 50 })).toBe("▓▓▓▓▓░░░░░ 50%");
    expect(progressText({ value: 0, indeterminate: true, label: "Deploying" })).toBe("Deploying");
  });
});
