/** Composer form state → SendNotificationInput. Pure, so it's unit-testable. */
import type { ActionStyle, SendNotificationInput, Severity } from "@herald/schema";
import type { Vars } from "./card";

export interface ComposerAction {
  id: string;
  label: string;
  style: ActionStyle;
  url: string;
  resolves: boolean;
}

export interface ComposerState {
  title: string;
  body: string;
  severity: Severity;
  source: string;
  threadId: string;
  icon: string;
  image: string;
  url: string;
  tags: string;
  silent: boolean;
  replaceKey: string;
  /** Target device ids; empty = every device. */
  devices: string[];
  fields: { label: string; value: string }[];
  progressOn: boolean;
  progress: { value: number; max: number; label: string; indeterminate: boolean };
  actions: ComposerAction[];
  replyOn: boolean;
  reply: { placeholder: string; buttonLabel: string };
  template: string;
}

export const emptyComposer: ComposerState = {
  title: "",
  body: "",
  severity: "info",
  source: "",
  threadId: "",
  icon: "",
  image: "",
  url: "",
  tags: "",
  silent: false,
  replaceKey: "",
  devices: [],
  fields: [],
  progressOn: false,
  progress: { value: 30, max: 100, label: "", indeterminate: false },
  actions: [],
  replyOn: false,
  reply: { placeholder: "", buttonLabel: "" },
  template: "",
};

const t = (s: string) => s.trim();

/**
 * Builds the request body, omitting empty values. With a template selected, `severity` is only sent when it differs
 * from "info" (so the template's severity isn't overridden by the form default).
 */
export function buildSendInput(s: ComposerState, vars: Vars = {}): SendNotificationInput {
  const out: SendNotificationInput = {};
  if (t(s.title)) out.title = t(s.title);
  if (t(s.body)) out.body = s.body;
  if (!s.template || s.severity !== "info") out.severity = s.severity;
  if (t(s.source)) out.source = t(s.source);
  if (t(s.threadId)) out.threadId = t(s.threadId);
  if (t(s.icon)) out.icon = t(s.icon);
  if (t(s.image)) out.image = t(s.image);
  if (t(s.url)) out.url = t(s.url);
  const tags = s.tags
    .split(",")
    .map(t)
    .filter(Boolean);
  if (tags.length) out.tags = tags;
  if (s.silent) out.silent = true;
  if (t(s.replaceKey)) out.replaceKey = t(s.replaceKey);
  if (s.devices?.length) out.devices = s.devices;
  const fields = s.fields.filter((f) => t(f.label)).map((f) => ({ label: t(f.label), value: f.value }));
  if (fields.length) out.fields = fields;
  if (s.progressOn) {
    out.progress = {
      value: Number(s.progress.value) || 0,
      max: Number(s.progress.max) > 0 ? Number(s.progress.max) : 100,
      indeterminate: s.progress.indeterminate,
      ...(t(s.progress.label) ? { label: t(s.progress.label) } : {}),
    };
  }
  const actions = s.actions
    .filter((a) => t(a.label))
    .map((a, i) => ({
      id: t(a.id) || `action_${i + 1}`,
      label: t(a.label),
      style: a.style,
      resolves: a.resolves,
      ...(t(a.url) ? { url: t(a.url) } : {}),
    }));
  if (actions.length) out.actions = actions;
  if (s.replyOn) {
    out.reply = {
      ...(t(s.reply.placeholder) ? { placeholder: t(s.reply.placeholder) } : {}),
      ...(t(s.reply.buttonLabel) ? { buttonLabel: t(s.reply.buttonLabel) } : {}),
    };
  }
  if (t(s.template)) {
    out.template = t(s.template);
    if (Object.keys(vars).length) out.vars = vars;
  }
  return out;
}

/** Example cards for quick testing. */
export const COMPOSER_PRESETS: { id: string; label: string; state: Partial<ComposerState> }[] = [
  {
    id: "deploy",
    label: "Deploy progress",
    state: {
      title: "Deploying prod-api v1.4.2",
      body: "Rolling update in progress. Watch the **canary**.",
      severity: "info",
      source: "ci",
      threadId: "deploy-142",
      replaceKey: "deploy-142",
      icon: "🚀",
      fields: [
        { label: "Region", value: "us-east-1" },
        { label: "Commit", value: "a1b2c3d" },
      ],
      progressOn: true,
      progress: { value: 3, max: 7, label: "3/7 pods", indeterminate: false },
      actions: [{ id: "rollback", label: "Roll back", style: "destructive", url: "", resolves: true }],
    },
  },
  {
    id: "question",
    label: "Agent question",
    state: {
      title: "Should I run the migration?",
      body: "`0042_add_index` locks `orders` for ~30s.",
      severity: "warning",
      source: "claude-code",
      icon: "🤖",
      actions: [
        { id: "option_1", label: "Yes, run it", style: "primary", url: "", resolves: true },
        { id: "option_2", label: "Not now", style: "default", url: "", resolves: true },
      ],
      replyOn: true,
      reply: { placeholder: "Tell the agent…", buttonLabel: "Send" },
    },
  },
  {
    id: "alert",
    label: "Critical alert",
    state: {
      title: "prod-api CPU high",
      body: "CPU above **90%** for 5m. See https://grafana.example.com/d/cpu",
      severity: "critical",
      source: "aws-monitor",
      icon: "🔥",
      url: "https://grafana.example.com/d/cpu",
      tags: "prod, aws",
      fields: [
        { label: "Instance", value: "i-0abc123" },
        { label: "Value", value: "93.4%" },
      ],
      actions: [
        { id: "ack", label: "Acknowledge", style: "primary", url: "", resolves: true },
        { id: "open", label: "Open console", style: "default", url: "https://console.aws.amazon.com/", resolves: false },
      ],
    },
  },
];
