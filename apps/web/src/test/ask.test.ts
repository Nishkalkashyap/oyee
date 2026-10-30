import { Notification } from "@oyee/schema";
import { describe, expect, it } from "vitest";
import fixtures from "../../../../packages/schema/fixtures/notifications.v2.json";
import { askView, type AskLike } from "../lib/ask";

/** A shared protocol v2 fixture (packages/schema/fixtures), decoded the way the web reads the wire. */
function fixture(name: keyof typeof fixtures): AskLike {
  const n = Notification.parse(fixtures[name]);
  if (n.intent !== "ask") throw new Error(`${name} is not an ask`);
  return n;
}

const at = (iso: string) => Date.parse(iso);

describe("ask card view", () => {
  it("an open ask offers its answer buttons and reply box and says how long it has been waiting", () => {
    const view = askView(fixture("ask-open"), at("2026-10-30T09:12:00.000Z"));
    expect(view).toEqual({
      state: "open",
      open: true,
      options: [
        { label: "Approve", chosen: false },
        { label: "Reject", chosen: false },
        { label: "Wait", chosen: false },
      ],
      reply: { placeholder: "Reply…" },
      status: "Waiting 12m",
      expiry: "Expires in 48m",
      note: null,
    });
  });

  it("an ask that takes text without a placeholder shows the app's own", () => {
    const v = askView(fixture("ask-open-text-no-placeholder"), at("2026-10-30T09:12:00.000Z"));
    expect(v).toMatchObject({ open: true, options: [], reply: { placeholder: "Reply…" } });
  });

  it("a fresh ask is just asked", () => {
    expect(askView(fixture("ask-open"), at("2026-10-30T09:00:20.000Z")).status).toBe("Just asked");
    expect(askView(fixture("ask-open"), at("2026-10-30T09:45:00.000Z")).status).toBe("Waiting 45m");
  });

  it("an answered ask shows the answer and the device, with the chosen button marked and nothing left to press", () => {
    const view = askView(fixture("ask-answered-option"), at("2026-10-30T09:30:00.000Z"));
    expect(view).toEqual({
      state: "answered",
      open: false,
      options: [
        { label: "Approve", chosen: true },
        { label: "Reject", chosen: false },
      ],
      reply: null,
      status: "Answered: Approve · Pixel 9",
      expiry: null,
      note: null,
    });
  });

  it("a text answer is shown as the answer", () => {
    const view = askView(fixture("ask-answered-text"), at("2026-10-30T09:30:00.000Z"));
    expect(view).toMatchObject({ open: false, options: [], reply: null, status: "Answered: release/1.4 · MacBook Pro" });
  });

  it("expired and withdrawn asks can't be answered", () => {
    expect(askView(fixture("ask-expired"), at("2026-10-30T09:30:00.000Z"))).toMatchObject({
      open: false,
      reply: null,
      status: "Expired",
      options: [
        { label: "Rotate", chosen: false },
        { label: "Skip", chosen: false },
      ],
    });
    expect(askView(fixture("ask-withdrawn"), at("2026-10-30T09:30:00.000Z"))).toMatchObject({ open: false, status: "Withdrawn" });
  });

  it("says when an open ask expires, down to the last minute", () => {
    expect(askView(fixture("ask-open"), at("2026-10-30T09:00:20.000Z")).expiry).toBe("Expires in 1h");
    expect(askView(fixture("ask-open"), at("2026-10-30T09:59:20.000Z")).expiry).toBe("Expires in 1m");
    expect(askView(fixture("ask-open"), at("2026-10-30T09:59:45.000Z")).expiry).toBe("Expires in under a minute");
  });

  it("explains why an expired or withdrawn ask can't be answered", () => {
    expect(askView(fixture("ask-expired"), at("2026-10-30T09:30:00.000Z"))).toMatchObject({
      state: "expired",
      expiry: null,
      note: "Nobody answered within 1h, so the question was closed on every device.",
    });
    expect(askView(fixture("ask-withdrawn"), at("2026-10-30T09:30:00.000Z"))).toMatchObject({
      state: "withdrawn",
      expiry: null,
      note: "The sender withdrew this question before it was answered.",
    });
  });

  it("an open ask past its expiry shows as expired before the server says so", () => {
    expect(askView(fixture("ask-open"), at("2026-10-30T10:00:00.000Z"))).toMatchObject({
      state: "expired",
      open: false,
      reply: null,
      status: "Expired",
      expiry: null,
    });
  });
});
