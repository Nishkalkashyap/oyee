/**
 * Rows stored before protocol v2, converted once by the InboxDO's storage migration (spec "Storage migration"). Two
 * shapes exist: protocol v1 flat cards (no `intent`), and v2 notifications stored while both protocols overlapped,
 * which still carry the flat fields. Both become a v2 notification: shared fields plus one intent block, `debug`
 * severity as `info`, tags / threadId / template / silent dropped. Pure: the InboxDO reads and writes the rows.
 */
import { LIMITS, durationMs, type AskAnswer, type Notification, type Severity } from "@oyee/schema";

/** A protocol v1 button: a link when it only opens a URL, otherwise an answer button. */
interface LegacyAction {
  id: string;
  label: string;
  url?: string;
  callback?: unknown;
}

/** What a stored row may hold: any mix of v1 flat-card fields and v2 intent fields. */
type StoredData = Record<string, unknown> & {
  id: string;
  source: string;
  title: string;
  status: "active" | "resolved";
  createdAt: string;
  updatedAt: string;
};

const isLink = (a: LegacyAction): a is LegacyAction & { url: string } => typeof a.url === "string" && !a.callback;

function severity(v: unknown): Severity {
  return v === "success" || v === "warning" || v === "critical" ? v : "info";
}

/**
 * A closed v1 card leaves the inbox and the tray: the ask it became can't be answered and the progress can't finish,
 * so it is resolved (at its last update, if it wasn't already). That also keeps it out of the expiry sweep and frees
 * its key for the next send.
 */
function closed<T extends { status: "active" | "resolved"; resolvedAt: string | null; updatedAt: string }>(shared: T): T {
  return { ...shared, status: "resolved", resolvedAt: shared.resolvedAt ?? shared.updatedAt };
}

/**
 * The v2 notification for a stored row. `replaceKey` is the row's v1 replace key (its v2 `key` when the row has none).
 * A v1 card's sender can no longer act on it, so an unanswered ask becomes expired and an unfinished progress stopped,
 * both resolved; an answered ask is resolved like any answered ask.
 */
export function fromStored(raw: unknown, replaceKey: string | null): Notification {
  const d = raw as StoredData;
  const shared = {
    id: d.id,
    source: d.source,
    key: (d.key as string | null | undefined) ?? replaceKey,
    title: d.title,
    body: (d.body as string | null | undefined) ?? null,
    severity: severity(d.severity),
    status: d.status,
    url: (d.url as string | null | undefined) ?? null,
    version: (d.version as number | undefined) ?? 1,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    readAt: (d.readAt as string | null | undefined) ?? null,
    resolvedAt: (d.resolvedAt as string | null | undefined) ?? null,
    targetDeviceIds: (d.targetDeviceIds as string[] | null | undefined) ?? null,
  };

  // Stored while both protocols overlapped: the intent block is already there.
  if (d.intent === "inform" && d.inform) return { ...shared, intent: "inform", inform: d.inform as never };
  if (d.intent === "ask" && d.ask) return { ...shared, intent: "ask", ask: d.ask as never };
  if (d.intent === "progress" && d.progress) {
    const { indeterminate: _, ...progress } = d.progress as Record<string, unknown>;
    return { ...shared, intent: "progress", progress: progress as never };
  }

  // A protocol v1 flat card.
  const actions = (d.actions as LegacyAction[] | undefined) ?? [];
  const reply = (d.reply as { placeholder?: string } | null | undefined) ?? null;
  const responses = (d.responses as { actionId: string | null; text: string | null; deviceId: string | null; deviceName: string | null; at: string }[] | undefined) ?? [];
  const answers = actions.filter((a) => !isLink(a));
  if (answers.length || reply) {
    const last = responses[responses.length - 1];
    const answer: AskAnswer | null = last
      ? {
          option: last.actionId === null ? null : (actions.find((a) => a.id === last.actionId)?.label ?? last.actionId),
          text: last.text,
          deviceId: last.deviceId,
          deviceName: last.deviceName,
          at: last.at,
        }
      : null;
    return {
      ...closed(shared),
      intent: "ask",
      ask: {
        options: answers.map((a) => a.label),
        allowText: reply !== null,
        replyPlaceholder: reply?.placeholder ?? null,
        expiresAt: new Date(Date.parse(d.createdAt) + durationMs(LIMITS.defaultAskExpiry)).toISOString(),
        answer,
        state: answer ? "answered" : "expired",
      },
    };
  }
  const p = d.progress as { value: number; max?: number; label?: string; indeterminate?: boolean } | null | undefined;
  if (p) {
    const max = p.max ?? 100;
    const done = !p.indeterminate && p.value >= max;
    return {
      ...(done ? shared : closed(shared)),
      intent: "progress",
      progress: {
        value: p.value,
        max,
        ...(p.label !== undefined ? { label: p.label } : {}),
        state: done ? "done" : "stopped",
        staleAfter: LIMITS.defaultStaleAfter,
        lastReportAt: d.updatedAt,
      },
    };
  }
  return {
    ...shared,
    intent: "inform",
    inform: {
      links: actions.filter(isLink).map((a) => ({ label: a.label, url: a.url })),
      fields: (d.fields as { label: string; value: string }[] | undefined) ?? [],
      image: (d.image as string | null | undefined) ?? null,
      icon: (d.icon as string | null | undefined) ?? null,
      cooldown: null,
    },
  };
}
