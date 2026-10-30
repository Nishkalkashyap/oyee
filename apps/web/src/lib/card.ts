import {
  inferIntent,
  renderTemplateValue,
  type FlatNotification,
  type Notification,
  type SendNotificationInput,
  type TemplateCard,
} from "@oyee/schema";

export type Vars = Record<string, string | number | boolean>;

/**
 * What the server does on send with a template (protocol §1.4): render the template card with vars, then shallow-merge
 * the explicit send fields on top. Used for local previews.
 */
export function composeCard(
  template: TemplateCard | null | undefined,
  vars: Vars | undefined,
  overrides: Partial<TemplateCard>,
): TemplateCard {
  const rendered = template ? renderTemplateValue(template, vars ?? {}) : {};
  const explicit = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  return { ...rendered, ...explicit } as TemplateCard;
}

/** Builds a full Notification from a (partial) card so it can be rendered by previews / NotificationCard. */
export function toPreviewNotification(
  card: Partial<SendNotificationInput>,
  extra: Partial<FlatNotification> = {},
): Notification {
  const now = new Date().toISOString();
  return inferIntent({
    id: "ntf_preview",
    source: card.source ?? "web",
    threadId: card.threadId ?? null,
    title: card.title?.trim() ? card.title : "Untitled notification",
    body: card.body ?? null,
    severity: card.severity ?? "info",
    status: "active",
    icon: card.icon ?? null,
    image: card.image ?? null,
    url: card.url ?? null,
    fields: card.fields ?? [],
    progress: card.progress
      ? {
          value: card.progress.value ?? 0,
          max: card.progress.max ?? 100,
          label: card.progress.label,
          indeterminate: card.progress.indeterminate ?? false,
        }
      : null,
    actions: (card.actions ?? []).map((a) => ({ ...a, style: a.style ?? "default", resolves: a.resolves ?? false })),
    reply: card.reply ?? null,
    tags: card.tags ?? [],
    silent: card.silent ?? false,
    template: card.template ?? null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    readAt: null,
    resolvedAt: null,
    responses: [],
    ...extra,
  });
}

/** Parses a JSON object of template vars; returns an error message instead of throwing. */
export function parseVars(text: string): { vars: Vars; error: string | null } {
  if (!text.trim()) return { vars: {}, error: null };
  try {
    const v: unknown = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) return { vars: {}, error: "Vars must be a JSON object" };
    const out: Vars = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") out[k] = val;
      else return { vars: {}, error: `"${k}" must be a string, number or boolean` };
    }
    return { vars: out, error: null };
  } catch (e) {
    return { vars: {}, error: e instanceof Error ? e.message : "Invalid JSON" };
  }
}

/** Lists the `{{placeholder}}` names used anywhere in a value. */
export function templateVariables(value: unknown): string[] {
  const names = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*(?:\|[^}]*)?\}\}/g)) names.add(m[1]!);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return [...names];
}
