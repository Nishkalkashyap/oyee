import { describe, expect, it } from "vitest";
import { pushSubscribeHint } from "../lib/push";

describe("pushSubscribeHint", () => {
  it("explains the Brave setting", () => {
    expect(pushSubscribeHint(new Error("Registration failed - push service error"), true)).toMatch(/brave:\/\/settings\/privacy/);
  });
  it("keeps the browser's message elsewhere", () => {
    expect(pushSubscribeHint(new Error("push service error"), false)).toMatch(/^Registration failed: push service error/);
  });
});
