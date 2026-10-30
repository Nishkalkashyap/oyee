/** Tool-result text for `ask` and `wait_for_response` (shape in ./text.ts): no date maths needed, next step included. */
import { formatDuration, type AskAnswer, type McpWaitResult } from "@oyee/schema";
import type { AskResult } from "../inbox/ask";
import { ago, resultText } from "./text";

/** Time left as an agent reads it, to the nearest unit: "40s", "30m", "1h", "23h 59m". */
export function timeLeft(toIso: string, now = Date.now()): string {
  return formatDuration(Date.parse(toIso) - now, "span");
}

const nextStep = (id: string) => `Call wait_for_response with id "${id}" to get the answer.`;

export function askResultText(r: AskResult, now = Date.now()): string {
  const { id, createdAt, ask } = r.notification;
  const expires = `expires in ${timeLeft(ask.expiresAt, now)}`;
  if (r.outcome === "reused") {
    return resultText(
      "reused",
      id,
      `Already asked ${ago(createdAt, now)} ago, still waiting (${expires}); the user was not alerted again. ${nextStep(id)}`,
    );
  }
  return resultText("created", id, `Asked the user (${expires}). ${nextStep(id)}`);
}

function answerText(a: AskAnswer): string {
  const from = a.deviceName ? ` from ${a.deviceName}` : "";
  if (a.option !== null && a.text !== null) return `The user answered ${JSON.stringify(a.option)}${from}, adding: ${JSON.stringify(a.text)}`;
  if (a.option !== null) return `The user answered ${JSON.stringify(a.option)}${from}.`;
  return `The user replied${from}: ${JSON.stringify(a.text ?? "")}`;
}

export function waitResultText(id: string, r: McpWaitResult, now = Date.now()): string {
  if (r.status === "answered") return resultText("answered", id, answerText(r.answer));
  const asked = `asked ${ago(r.askedAt, now)} ago`;
  if (r.status === "expired") {
    return resultText(
      "expired",
      id,
      `The ask expired without an answer (${asked}); it was removed from the user's devices. Ask again if you still need a decision.`,
    );
  }
  if (r.status === "withdrawn") {
    return resultText("withdrawn", id, `The ask was withdrawn without an answer (${asked}); nothing more will arrive for it.`);
  }
  const expires = r.expiresAt ? `, expires in ${timeLeft(r.expiresAt, now)}` : "";
  return resultText(
    "pending",
    id,
    `No answer yet: ${asked}${expires}. Call wait_for_response again with id "${id}" to keep waiting.`,
  );
}
