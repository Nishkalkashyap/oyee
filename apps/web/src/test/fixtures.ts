import { inferIntent, type FlatNotification, type Notification } from "@oyee/schema";

export function makeNotification(p: Partial<FlatNotification> & { id: string }): Notification {
  const at = p.createdAt ?? "2026-10-28T10:00:00.000Z";
  return inferIntent({
    source: "test",
    threadId: null,
    title: `Title ${p.id}`,
    body: null,
    severity: "info",
    status: "active",
    icon: null,
    image: null,
    url: null,
    fields: [],
    progress: null,
    actions: [],
    reply: null,
    tags: [],
    silent: false,
    template: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
    readAt: null,
    resolvedAt: null,
    responses: [],
    ...p,
  });
}

/** createdAt N minutes after 10:00. */
export const minute = (n: number) => new Date(Date.parse("2026-10-28T10:00:00.000Z") + n * 60_000).toISOString();
