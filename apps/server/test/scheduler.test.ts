import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { InboxDO } from "../src/inbox/do";
import { call, devLogin } from "./helpers";

const DAY = 86_400_000;

/** A user whose inbox has seen one send (which schedules the daily prune), and its Durable Object stub. */
async function inbox() {
  const cookie = await devLogin();
  const me = (await call("GET", "/api/me", { cookie })).body;
  await call("POST", "/api/notifications", { cookie }, { title: "hello" });
  return { cookie, stub: env.INBOX.get(env.INBOX.idFromName(me.id)) };
}

describe("deadline scheduler", () => {
  it("pulls the alarm forward to an earlier deadline and falls back to the prune when it is cleared", async () => {
    const { stub } = await inbox();
    await runInDurableObject(stub, async (inst: InboxDO, state) => {
      const prune = await state.storage.getAlarm();
      expect(prune).toBeGreaterThan(Date.now() + DAY - 60_000);

      const soon = Date.now() + 60_000;
      inst.scheduler.handle("probe", () => {});
      inst.scheduler.set("probe", "a", soon);
      inst.scheduler.set("probe", "b", soon + 5_000);
      expect(await state.storage.getAlarm()).toBe(soon);

      inst.scheduler.clear("probe", "a");
      expect(await state.storage.getAlarm()).toBe(soon + 5_000);

      inst.scheduler.clear("probe", "b");
      expect(await state.storage.getAlarm()).toBe(prune);
    });
  });

  it("runs every due deadline when the alarm fires and reschedules for the next one", async () => {
    const { stub } = await inbox();
    const fired: string[][] = [];
    const later = Date.now() + 10 * 60_000;
    const prune = await runInDurableObject(stub, async (inst: InboxDO, state) => {
      inst.scheduler.handle("probe", (refs) => void fired.push(refs));
      inst.scheduler.set("probe", "due-1", Date.now() + 60_000);
      inst.scheduler.set("probe", "due-2", Date.now() + 120_000);
      inst.scheduler.set("probe", "later", later);
      // Backdate the first two so they are overdue when the alarm fires.
      state.storage.sql.exec("UPDATE deadlines SET due_at = ? WHERE ref LIKE 'due-%'", Date.now() - 1_000);
      return state.storage.getAlarm();
    });

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(fired.map((refs) => refs.sort())).toEqual([["due-1", "due-2"]]);
    await runInDurableObject(stub, async (_inst: InboxDO, state) => {
      expect(await state.storage.getAlarm()).toBe(later);
    });

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(fired).toEqual([["due-1", "due-2"], ["later"]]);
    await runInDurableObject(stub, async (_inst: InboxDO, state) => {
      expect(await state.storage.getAlarm()).toBeGreaterThanOrEqual(prune!);
    });
  });

  it("keeps the daily prune scheduled after it runs", async () => {
    const { stub } = await inbox();
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (_inst: InboxDO, state) => {
      expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now() + DAY - 60_000);
    });
  });
});
