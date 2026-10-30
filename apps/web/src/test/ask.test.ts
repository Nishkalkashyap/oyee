import { IntentNotification } from "@oyee/schema";
import { describe, expect, it } from "vitest";
import fixtures from "../../../../packages/schema/fixtures/notifications.v2.json";
import { askView, showsAsAsk, type AskLike } from "../lib/ask";
import { makeNotification } from "./fixtures";

/** A shared protocol v2 fixture (packages/schema/fixtures), decoded the way the web reads the wire. */
function fixture(name: keyof typeof fixtures): AskLike {
  const n = IntentNotification.parse(fixtures[name]);
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
    });
  });

  it("a fresh ask is just asked", () => {
    expect(askView(fixture("ask-open"), at("2026-10-30T09:00:20.000Z")).status).toBe("Just asked");
    expect(askView(fixture("ask-open"), at("2026-10-30T11:30:00.000Z")).status).toBe("Waiting 2h");
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
});

describe("which notifications get the ask card", () => {
  const question = { id: "q", actions: [{ id: "option_1", label: "Yes", style: "primary" as const, resolves: true }] };

  it("asks do", () => {
    expect(showsAsAsk(makeNotification(question))).toBe(true);
    expect(showsAsAsk(makeNotification({ id: "r", reply: { placeholder: "Why?" } }))).toBe(true);
  });

  it("other intents don't", () => {
    expect(showsAsAsk(makeNotification({ id: "i" }))).toBe(false);
  });

  it("v1 cards inferred as asks keep the full card while they carry what the ask card can't show", () => {
    expect(showsAsAsk(makeNotification({ ...question, progress: { value: 2, max: 7, indeterminate: false } }))).toBe(false);
    expect(showsAsAsk(makeNotification({ ...question, fields: [{ label: "Env", value: "prod" }] }))).toBe(false);
    expect(showsAsAsk(makeNotification({ ...question, image: "https://example.com/chart.png" }))).toBe(false);
    const link = { id: "log", label: "Log", style: "default" as const, url: "https://ci.example.com", resolves: false };
    expect(showsAsAsk(makeNotification({ ...question, actions: [...question.actions, link] }))).toBe(false);
  });
});
