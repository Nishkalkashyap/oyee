/** Tool-result text for `ask` and `wait_for_response` (shape in ./text.ts): no date maths needed, next step included. */
import type { AskAnswer, McpWaitResult } from "@oyee/schema";
import type { AskResult } from "../inbox/ask";
import { ago, resultText } from "./text";

const nextStep = (id: string) => `Call wait_for_response with id "${id}" to get the answer.`;

export function askResultText(r: AskResult, now = Date.now()): string {
  const { id, createdAt } = r.notification;
  if (r.outcome === "reused") {
    return resultText(
      "reused",
      id,
      `Already asked ${ago(createdAt, now)} ago, still waiting; the user was not alerted again. ${nextStep(id)}`,
    );
  }
  return resultText("created", id, `Asked the user. ${nextStep(id)}`);
}

function answerText(a: AskAnswer): string {
  const from = a.deviceName ? ` from ${a.deviceName}` : "";
  if (a.option !== null && a.text !== null) return `The user answered ${JSON.stringify(a.option)}${from}, adding: ${JSON.stringify(a.text)}`;
  if (a.option !== null) return `The user answered ${JSON.stringify(a.option)}${from}.`;
  return `The user replied${from}: ${JSON.stringify(a.text ?? "")}`;
}

export function waitResultText(id: string, r: McpWaitResult, now = Date.now()): string {
  if (r.status === "answered") return resultText("answered", id, answerText(r.answer));
  return resultText(
    "pending",
    id,
    `No answer yet: asked ${ago(r.askedAt, now)} ago. Call wait_for_response again with id "${id}" to keep waiting.`,
  );
}
