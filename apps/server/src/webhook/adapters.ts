/**
 * Webhook payload adapters (docs/protocol.md §4): Alertmanager, Grafana, AWS SNS, text/plain + query + ntfy headers.
 * Each turns a payload into an intent (inform, or progress for `?intent=progress`).
 */
import { LIMITS, type InformInput, type IntentSendInput, type IntentSeverity, type SendNotificationInput } from "@oyee/schema";
import { z } from "zod";
import { badRequest } from "../lib/errors";
import { parseIntentSend } from "../routes/send";

export type HookAction =
  | { kind: "send"; input: IntentSendInput }
  /** A protocol v1 flat card (JSON body with flat-only fields); removed with the flat card (ticket 15). */
  | { kind: "flat"; input: SendNotificationInput }
  /** Resolve the inform with this key, showing `input` as its final content (Alertmanager/Grafana group resolved). */
  | { kind: "resolve"; input: InformInput & { key: string } }
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

/** An alerting label (Alertmanager `severity`, `?severity=`) as a severity; below-info levels such as debug are info. */
export function severityFromLabel(label: string | undefined, fallback: IntentSeverity = "warning"): IntentSeverity {
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
    case "debug":
    case "trace":
    case "verbose":
      return "info";
    case "success":
    case "ok":
      return "success";
    default:
      return fallback;
  }
}

/** ntfy-style priority: 1–3 → info, 4 → warning, 5 → critical (names min/low/default/high/max too). */
export function severityFromPriority(p: string | undefined): IntentSeverity | undefined {
  if (!p) return undefined;
  switch (p.toLowerCase().trim()) {
    case "1":
    case "min":
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
  const key = await shortKey(`${flavor === "grafana" ? "grafana" : "am"}:`, groupKey);

  const count = firing.length || alerts.length;
  const input: InformInput & { key: string } = {
    title: clip(resolved ? `[RESOLVED] ${alertname}` : `[FIRING:${count}] ${alertname}`, 200),
    body: clip(text, 4000) || undefined,
    severity: resolved ? "success" : severity,
    fields,
    url,
    key,
  };
  return resolved ? { kind: "resolve", input } : { kind: "send", input: { intent: "inform", ...input } };
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
        intent: "inform",
        title: clip(subject ?? firstLine ?? "AWS SNS notification", 200),
        body: clip(message, 4000) || undefined,
      },
    };
  }
  return { kind: "ignore", reason: `SNS ${type ?? "message"} ignored` };
}

// ─── text/plain, GET, ntfy headers ──────────────────────────────────────────

/** Query parameters of removed features: a send using one is rejected, saying what to use instead. */
const REMOVED_PARAMS: Record<string, string> = {
  replaceKey: "replaceKey is no longer supported: use key (a later send with the same key updates the notification)",
  template: "template is no longer supported: send the fields themselves (title, body, severity…)",
};

/** The first non-empty line of a text body: the title for senders that only post text. */
const firstLine = (text: string | undefined) =>
  text
    ?.split(/\r?\n/)
    .find((l) => l.trim() !== "")
    ?.trim()
    .slice(0, 200);

/**
 * Builds an intent from query params + ntfy-style headers, with `body` from the request body (or `?body=`).
 * `?intent=` picks the intent (default inform). A missing title falls back to the body's first line.
 */
export function fromTextRequest(query: Record<string, string>, headers: Headers, bodyText: string | null): IntentSendInput {
  const h = (...names: string[]) => {
    for (const n of names) {
      const v = headers.get(n);
      if (v !== null && v.trim() !== "") return v.trim();
    }
    return undefined;
  };
  const q = (name: string) => (query[name] !== undefined && query[name] !== "" ? query[name] : undefined);
  const num = (name: string) => {
    const v = q(name);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw badRequest(`${name}: expected a number`);
    return n;
  };
  for (const [param, message] of Object.entries(REMOVED_PARAMS)) if (q(param) !== undefined) throw badRequest(message);

  const body = bodyText !== null && bodyText.trim() !== "" ? bodyText.slice(0, 4000) : (q("body") ?? q("message"));
  const intent = q("intent");
  const severityParam = q("severity");
  const input: Record<string, unknown> = {
    intent,
    title: q("title") ?? h("Title", "X-Title", "T") ?? firstLine(body) ?? "Notification",
    body,
    source: q("source"),
    url: q("url") ?? q("click") ?? h("Click", "X-Click"),
    key: q("key"),
    ...(intent === "progress"
      ? { value: num("value"), max: num("max"), label: q("label"), status: q("status") }
      : {
          severity:
            (severityParam ? severityFromLabel(severityParam, "info") : undefined) ??
            severityFromPriority(q("priority") ?? h("Priority", "X-Priority", "P")),
          icon: q("icon") ?? h("Icon", "X-Icon"),
          cooldown: q("cooldown"),
        }),
  };
  for (const k of Object.keys(input)) if (input[k] === undefined) delete input[k];
  return parseIntentSend(input);
}
