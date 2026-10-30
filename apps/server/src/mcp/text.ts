/**
 * How MCP tool results read. Every tool that acts (inform, ask, progress, wait_for_response, resolve) answers in one
 * shape: an "outcome: …" line and an "id: …" line (stable for a model to read back), then what happened and the next
 * step in words. Listing tools (list_notifications, list_devices) return compact JSON.
 */
import type { McpListItem, Notification } from "@oyee/schema";

/** Elapsed time as an agent reads it: "45s", "12m", "3h", "2d". */
export function ago(fromIso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

export function resultText(outcome: string, id: string, message: string): string {
  return `outcome: ${outcome}\nid: ${id}\n${message}`;
}

export function listItem(n: Notification, now = Date.now()): McpListItem {
  const a = n.intent === "ask" ? n.ask.answer : null;
  return {
    id: n.id,
    intent: n.intent,
    key: n.key,
    title: n.title,
    status: n.status,
    state: n.intent === "ask" ? n.ask.state : n.intent === "progress" ? n.progress.state : null,
    answer: a ? { option: a.option, text: a.text, device: a.deviceName } : null,
    createdAt: n.createdAt,
    ago: ago(n.createdAt, now),
  };
}
