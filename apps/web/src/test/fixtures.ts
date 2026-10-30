import type { Notification } from "@oyee/schema";

type Shared = Omit<Extract<Notification, { intent: "inform" }>, "intent" | "inform">;

/** A plain inform (override any shared field); spread in an intent block for an ask or a progress. */
export function makeNotification(p: Partial<Shared> & { id: string }): Notification {
  const at = p.createdAt ?? "2026-10-28T10:00:00.000Z";
  return {
    source: "test",
    key: null,
    title: `Title ${p.id}`,
    body: null,
    severity: "info",
    status: "active",
    url: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
    readAt: null,
    resolvedAt: null,
    targetDeviceIds: null,
    ...p,
    intent: "inform",
    inform: { links: [], fields: [], image: null, icon: null, cooldown: null },
  };
}

/** createdAt N minutes after 10:00. */
export const minute = (n: number) => new Date(Date.parse("2026-10-28T10:00:00.000Z") + n * 60_000).toISOString();
