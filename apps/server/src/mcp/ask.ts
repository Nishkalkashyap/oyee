/** Tool-result text for `ask` and `wait_for_response`: what happened plus the agent's next step, no date maths needed. */
import type { AskAnswer, McpWaitResult } from "@oyee/schema";
import type { AskResult } from "../inbox/ask";

/** Elapsed time as an agent reads it: "45s", "12m", "3h", "2d". */
export function ago(fromIso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

const nextStep = (id: string) => `Call wait_for_response with id "${id}" to get the answer.`;

export function askResultText(r: AskResult, now = Date.now()): string {
  const { id, createdAt } = r.notification;
  if (r.outcome === "reused") {
    return `Already asked ${ago(createdAt, now)} ago, still waiting (id ${id}); the user was not alerted again. ${nextStep(id)}`;
  }
  return `Asked the user (id ${id}). ${nextStep(id)}`;
}

function answerText(a: AskAnswer): string {
  const from = a.deviceName ? ` from ${a.deviceName}` : "";
  if (a.option !== null && a.text !== null) return `The user answered ${JSON.stringify(a.option)}${from}, adding: ${JSON.stringify(a.text)}`;
  if (a.option !== null) return `The user answered ${JSON.stringify(a.option)}${from}.`;
  return `The user replied${from}: ${JSON.stringify(a.text ?? "")}`;
}

export function waitResultText(id: string, r: McpWaitResult, now = Date.now()): string {
  if (r.status === "answered") return answerText(r.answer);
  return `No answer yet: asked ${ago(r.askedAt, now)} ago. Call wait_for_response again with id "${id}" to keep waiting.`;
}
