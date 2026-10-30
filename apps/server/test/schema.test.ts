/** Unit tests for @oyee/schema helpers the server relies on. */
import { ClientMessage, InformInput, RespondInput, progressText } from "@oyee/schema";
import { describe, expect, it } from "vitest";

describe("progressText", () => {
  it("formats bars", () => {
    expect(progressText({ value: 3, max: 7 })).toBe("▓▓▓▓░░░░░░ 3/7");
    expect(progressText({ value: 50 })).toBe("▓▓▓▓▓░░░░░ 50%");
    expect(progressText({ value: 3, max: 7, label: "3 of 7 checks" })).toBe("▓▓▓▓░░░░░░ 3 of 7 checks");
    expect(progressText({ value: 200, max: 100 })).toBe("▓▓▓▓▓▓▓▓▓▓ 100%");
  });
});

describe("schemas", () => {
  it("validates URLs and limits", () => {
    expect(InformInput.safeParse({ title: "x", url: "not a url" }).success).toBe(false);
    const link = { label: "x", url: "https://example.com" };
    expect(InformInput.safeParse({ title: "x", links: [link, link, link, link] }).success).toBe(false);
  });

  it("RespondInput needs an option or text", () => {
    expect(RespondInput.safeParse({}).success).toBe(false);
    expect(RespondInput.safeParse({ text: "hi" }).success).toBe(true);
    expect(RespondInput.safeParse({ option: "Approve" }).success).toBe(true);
  });

  it("ClientMessage discriminates", () => {
    expect(ClientMessage.parse({ type: "sync", since: null })).toEqual({ type: "sync", since: null });
    expect(ClientMessage.safeParse({ type: "nope" }).success).toBe(false);
  });
});
