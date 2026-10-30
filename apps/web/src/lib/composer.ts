/**
 * The Send page's form: an inform or a progress with the same fields agents and webhooks use (docs/protocol.md §3.1).
 * Pure, so it's unit-testable.
 */
import {
  LIMITS,
  type Field,
  type IntentSendBody,
  type Severity,
  type LinkButton,
  type Notification,
  type ProgressStatus,
} from "@oyee/schema";

export type ComposerIntent = "inform" | "progress";

export interface ComposerState {
  intent: ComposerIntent;
  // shared
  title: string;
  body: string;
  url: string;
  key: string;
  source: string;
  /** Target device ids; empty = every device. */
  devices: string[];
  // inform
  severity: Severity;
  icon: string;
  image: string;
  cooldown: string;
  fields: Field[];
  links: LinkButton[];
  // progress
  /** null = leave it to the server (0, or `max` when done). */
  value: number | null;
  /** null = 100. */
  max: number | null;
  label: string;
  status: ProgressStatus;
  staleAfter: string;
}

export const emptyComposer: ComposerState = {
  intent: "inform",
  title: "",
  body: "",
  url: "",
  key: "",
  source: "",
  devices: [],
  severity: "info",
  icon: "",
  image: "",
  cooldown: "",
  fields: [],
  links: [],
  value: null,
  max: null,
  label: "",
  status: "running",
  staleAfter: "",
};

const t = (s: string) => s.trim();

/** The request body for `POST /api/notifications`: the chosen intent's fields only, without empty values. */
export function buildSendInput(s: ComposerState): IntentSendBody {
  const shared = {
    title: t(s.title),
    ...(t(s.body) ? { body: s.body } : {}),
    ...(t(s.url) ? { url: t(s.url) } : {}),
    ...(t(s.key) ? { key: t(s.key) } : {}),
    ...(t(s.source) ? { source: t(s.source) } : {}),
    ...(s.devices.length ? { devices: s.devices } : {}),
  };
  if (s.intent === "progress") {
    return {
      intent: "progress",
      ...shared,
      key: shared.key as string, // required: validation reports it when empty
      ...(s.value !== null ? { value: s.value } : {}),
      ...(s.max !== null ? { max: s.max } : {}),
      ...(t(s.label) ? { label: t(s.label) } : {}),
      status: s.status,
      ...(t(s.staleAfter) ? { staleAfter: t(s.staleAfter) } : {}),
    };
  }
  const fields = s.fields.filter((f) => t(f.label)).map((f) => ({ label: t(f.label), value: f.value }));
  const links = s.links.filter((l) => t(l.label) && t(l.url)).map((l) => ({ label: t(l.label), url: t(l.url) }));
  return {
    intent: "inform",
    ...shared,
    severity: s.severity,
    ...(t(s.cooldown) ? { cooldown: t(s.cooldown) } : {}),
    ...(t(s.icon) ? { icon: t(s.icon) } : {}),
    ...(t(s.image) ? { image: t(s.image) } : {}),
    ...(fields.length ? { fields } : {}),
    ...(links.length ? { links } : {}),
  };
}

const PROGRESS_SEVERITY: Record<ProgressStatus, Severity> = { running: "info", done: "success", failed: "warning" };

/**
 * The notification a send body would create, for the live preview (and mock mode).
 */
export function previewNotification(input: IntentSendBody, now = new Date().toISOString()): Notification {
  const shared = {
    id: "ntf_preview",
    source: input.source ?? "web",
    key: input.key ?? null,
    title: input.title.trim() ? input.title : "Untitled notification",
    body: input.body ?? null,
    status: "active" as const,
    url: input.url ?? null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    readAt: null,
    resolvedAt: null,
    targetDeviceIds: null,
  };
  if (input.intent === "progress") {
    const status = input.status ?? "running";
    const max = input.max ?? 100;
    return {
      ...shared,
      intent: "progress",
      severity: PROGRESS_SEVERITY[status],
      progress: {
        value: input.value ?? (status === "done" ? max : 0),
        max,
        ...(input.label ? { label: input.label } : {}),
        state: status,
        staleAfter: input.staleAfter ?? LIMITS.defaultStaleAfter,
        lastReportAt: now,
      },
    };
  }
  return {
    ...shared,
    intent: "inform",
    severity: input.severity ?? "info",
    inform: {
      links: input.links ?? [],
      fields: input.fields ?? [],
      image: input.image ?? null,
      icon: input.icon ?? null,
      cooldown: input.cooldown ?? null,
    },
  };
}

/** Example sends for quick testing, one per thing senders commonly mean. */
export const COMPOSER_PRESETS: { id: string; label: string; state: Partial<ComposerState> }[] = [
  {
    id: "deploy",
    label: "Deploy progress",
    state: {
      intent: "progress",
      title: "Deploying prod-api v1.4.2",
      body: "Rolling update in progress. Watch the **canary**.",
      source: "ci",
      key: "deploy-142",
      url: "https://ci.example.com/deploys/142",
      value: 3,
      max: 7,
      label: "3/7 pods",
    },
  },
  {
    id: "finished",
    label: "Task finished",
    state: {
      intent: "inform",
      title: "Nightly backup finished",
      body: "Snapshot uploaded in **4m 12s**.",
      severity: "success",
      source: "backup",
      icon: "💾",
      fields: [
        { label: "Size", value: "18.4 GB" },
        { label: "Target", value: "s3://backups/nightly" },
      ],
      links: [{ label: "View logs", url: "https://logs.example.com/backup" }],
    },
  },
  {
    id: "alert",
    label: "Critical alert",
    state: {
      intent: "inform",
      title: "prod-api CPU high",
      body: "CPU above **90%** for 5m.",
      severity: "critical",
      source: "aws-monitor",
      key: "prod-api-cpu",
      cooldown: "1h",
      icon: "🔥",
      url: "https://grafana.example.com/d/cpu",
      fields: [
        { label: "Instance", value: "i-0abc123" },
        { label: "Value", value: "93.4%" },
      ],
      links: [{ label: "Open console", url: "https://console.aws.amazon.com/" }],
    },
  },
];
