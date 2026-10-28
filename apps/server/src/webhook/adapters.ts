/** Webhook payload adapters (docs/protocol.md §4): Alertmanager, Grafana, AWS SNS, text/plain + ntfy headers. */
import { LIMITS, type SendNotificationInput, type Severity, type UpdateNotificationInput } from "@oyee/schema";
import { z } from "zod";

export type HookAction =
  | { kind: "send"; input: SendNotificationInput }
  | {
      kind: "resolve";
      replaceKey: string;
      patch: UpdateNotificationInput;
      /** Used if nothing active matches: create the card (silently) and resolve it right away. */
      fallback: SendNotificationInput;
    }
  | { kind: "sns-confirm"; subscribeUrl: string }
  | { kind: "ignore"; reason: string };

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const validUrl = (v: unknown): string | undefined => {
  const s = str(v);
  return s && z.string().url().max(2048).safeParse(s).success && /^https?:/i.test(s) ? s : undefined;
};

// ─── Severity mapping ───────────────────────────────────────────────────────

export function severityFromLabel(label: string | undefined, fallback: Severity = "warning"): Severity {
  switch (label?.toLowerCase().trim()) {
    case "critical":
    case "crit":
    case "page":
    case "error":
    case "high":
    case "emergency":
    case "alert":
    case "fatal":
    case "p1":
      return "critical";
    case "warning":
    case "warn":
    case "medium":
    case "p2":
      return "warning";
    case "info":
    case "informational":
    case "notice":
    case "low":
    case "none":
    case "p3":
    case "p4":
      return "info";
    case "debug":
      return "debug";
    case "success":
    case "ok":
      return "success";
    default:
      return fallback;
  }
}

/** ntfy-style priority: 1–2 → debug/info, 3 → info, 4 → warning, 5 → critical (names min/low/default/high/max too). */
export function severityFromPriority(p: string | undefined): Severity | undefined {
  if (!p) return undefined;
  switch (p.toLowerCase().trim()) {
    case "1":
    case "min":
      return "debug";
    case "2":
    case "low":
    case "3":
    case "default":
      return "info";
    case "4":
    case "high":
      return "warning";
    case "5":
    case "max":
    case "urgent":
      return "critical";
    default:
      return undefined;
  }
}

// ─── Alertmanager / Grafana ─────────────────────────────────────────────────

export function isAlertmanager(body: unknown): body is Json {
  return isObj(body) && Array.isArray(body.alerts) && (body.version !== undefined || body.groupKey !== undefined);
}

export function isGrafana(body: unknown): body is Json {
  return isObj(body) && Array.isArray(body.alerts) && (body.orgId !== undefined || body.state !== undefined);
}

async function shortKey(prefix: string, key: string): Promise<string> {
  if (prefix.length + key.length <= 128) return prefix + key;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return prefix + Array.from(digest.slice(0, 24), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function fromAlertmanager(body: Json, flavor: "alertmanager" | "grafana"): Promise<HookAction> {
  const alerts = (body.alerts as unknown[]).filter(isObj);
  const labelsOf = (a: Json): Json => (isObj(a.labels) ? a.labels : {});
  const annotationsOf = (a: Json): Json => (isObj(a.annotations) ? a.annotations : {});
  const common = isObj(body.commonLabels) ? body.commonLabels : {};
  const groupLabels = isObj(body.groupLabels) ? body.groupLabels : {};
  const firing = alerts.filter((a) => a.status !== "resolved");
  const resolved = body.status === "resolved" || (alerts.length > 0 && firing.length === 0);

  const alertname =
    str(common.alertname) ?? str(groupLabels.alertname) ?? str(alerts[0] && labelsOf(alerts[0]).alertname) ?? "Alert";
  const sevLabel = str(common.severity) ?? str(firing[0] && labelsOf(firing[0]).severity) ?? str(alerts[0] && labelsOf(alerts[0]).severity);
  const severity = severityFromLabel(sevLabel);

  const lines = (resolved ? alerts : firing).slice(0, 10).map((a) => {
    const ann = annotationsOf(a);
    const text = str(ann.summary) ?? str(ann.description) ?? str(ann.message) ?? str(labelsOf(a).instance) ?? alertname;
    return `• ${text}`;
  });
  const more = (resolved ? alerts : firing).length - lines.length;
  if (more > 0) lines.push(`…and ${more} more`);
  const commonAnn = isObj(body.commonAnnotations) ? body.commonAnnotations : {};
  const description = str(commonAnn.description);
  let text = lines.join("\n");
  if (description && alerts.length > 1) text = `${description}\n\n${text}`;

  const fields = Object.entries(common)
    .filter(([k, v]) => k !== "alertname" && k !== "severity" && typeof v === "string")
    .slice(0, LIMITS.maxFields)
    .map(([k, v]) => ({ label: clip(k, 40), value: clip(String(v), 200) }));

  const url =
    validUrl(alerts[0]?.panelURL) ??
    validUrl(alerts[0]?.dashboardURL) ??
    validUrl(alerts[0]?.generatorURL) ??
    validUrl(body.externalURL);
  const groupKey = str(body.groupKey) ?? `${alertname}:${JSON.stringify(groupLabels)}`;
  const replaceKey = await shortKey(`${flavor === "grafana" ? "grafana" : "am"}:`, groupKey);

  const count = firing.length || alerts.length;
  const firingTitle = clip(`[FIRING:${count}] ${alertname}`, 200);
  const resolvedTitle = clip(`[RESOLVED] ${alertname}`, 200);
  const base: SendNotificationInput = {
    title: resolved ? resolvedTitle : firingTitle,
    body: clip(text, 4000) || undefined,
    severity: resolved ? "success" : severity,
    fields,
    tags: [flavor],
    url,
    replaceKey,
  };
  if (!resolved) return { kind: "send", input: base };
  return {
    kind: "resolve",
    replaceKey,
    patch: { title: resolvedTitle, severity: "success", ...(base.body ? { body: base.body } : {}) },
    fallback: { ...base, silent: true },
  };
}

// ─── AWS SNS ────────────────────────────────────────────────────────────────

export function isSns(body: unknown, messageTypeHeader: string | undefined): body is Json {
  if (!isObj(body)) return false;
  if (messageTypeHeader) return true;
  return (
    typeof body.Type === "string" &&
    ["SubscriptionConfirmation", "Notification", "UnsubscribeConfirmation"].includes(body.Type) &&
    typeof body.TopicArn === "string"
  );
}

const SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export function fromSns(body: Json): HookAction {
  const type = str(body.Type);
  if (type === "SubscriptionConfirmation") {
    const u = str(body.SubscribeURL);
    let ok = false;
    try {
      const parsed = new URL(u ?? "");
      ok = parsed.protocol === "https:" && SNS_HOST.test(parsed.hostname);
    } catch {
      ok = false;
    }
    if (!ok || !u) return { kind: "ignore", reason: "invalid SubscribeURL" };
    return { kind: "sns-confirm", subscribeUrl: u };
  }
  if (type === "Notification") {
    const message = typeof body.Message === "string" ? body.Message : JSON.stringify(body.Message ?? "");
    const subject = str(body.Subject);
    const firstLine = message.split(/\r?\n/).find((l) => l.trim() !== "");
    return {
      kind: "send",
      input: {
        title: clip(subject ?? firstLine ?? "AWS SNS notification", 200),
        body: clip(message, 4000) || undefined,
        tags: ["sns"],
      },
    };
  }
  return { kind: "ignore", reason: `SNS ${type ?? "message"} ignored` };
}

// ─── text/plain, GET, ntfy headers ──────────────────────────────────────────

const splitTags = (s: string | undefined) =>
  s
    ? s
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, LIMITS.maxTags)
        .map((t) => t.slice(0, 32))
    : undefined;

/** Builds a send input from query params + ntfy-style headers, with `body` from the request body (or `?body=`). */
export function fromTextRequest(query: Record<string, string>, headers: Headers, bodyText: string | null): SendNotificationInput {
  const h = (...names: string[]) => {
    for (const n of names) {
      const v = headers.get(n);
      if (v !== null && v.trim() !== "") return v.trim();
    }
    return undefined;
  };
  const q = (name: string) => (query[name] !== undefined && query[name] !== "" ? query[name] : undefined);

  const severityParam = q("severity");
  const severity =
    (severityParam ? severityFromLabel(severityParam, "info") : undefined) ??
    severityFromPriority(q("priority") ?? h("Priority", "X-Priority", "P"));
  const body = bodyText !== null && bodyText.trim() !== "" ? bodyText : q("body") ?? q("message");
  const input: SendNotificationInput = {
    title: q("title") ?? h("Title", "X-Title", "T"),
    body: body ? body.slice(0, 4000) : undefined,
    severity,
    source: q("source"),
    threadId: q("threadId"),
    tags: splitTags(q("tags") ?? h("Tags", "X-Tags", "Ta")),
    url: q("url") ?? q("click") ?? h("Click", "X-Click"),
    icon: q("icon") ?? h("Icon", "X-Icon"),
    template: q("template"),
    replaceKey: q("replaceKey"),
  };
  // Template variables: `?var.service=api` (extension; plain query params stay reserved for metadata).
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) if (k.startsWith("var.")) vars[k.slice(4)] = v;
  if (Object.keys(vars).length) input.vars = vars;
  for (const k of Object.keys(input) as (keyof SendNotificationInput)[]) if (input[k] === undefined) delete input[k];
  return input;
}
