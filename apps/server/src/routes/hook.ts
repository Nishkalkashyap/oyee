/** POST|GET /hook/:token — webhook ingestion (docs/protocol.md §4). */
import { SendNotificationInput } from "@oyee/schema";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../app";
import { findTokenBySecret } from "../db";
import { badRequest, parseOrThrow, rpc, unauthorized } from "../lib/errors";
import { readBodyText } from "../lib/http";
import type { Actor } from "../inbox/model";
import { fromAlertmanager, fromSns, fromTextRequest, isAlertmanager, isGrafana, isSns, type HookAction } from "../webhook/adapters";
import { inbox } from "./api";

export const hook = new Hono<AppEnv>();

async function parseHook(c: Context<AppEnv>): Promise<HookAction> {
  const query = c.req.query();
  if (c.req.method === "GET" || c.req.method === "HEAD") return { kind: "send", input: fromTextRequest(query, c.req.raw.headers, null) };

  const text = await readBodyText(c);
  const contentType = (c.req.header("Content-Type") ?? "").toLowerCase();
  const snsType = c.req.header("x-amz-sns-message-type");
  const looksJson = contentType.includes("json") || snsType !== undefined;

  if (looksJson) {
    let body: unknown;
    try {
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw badRequest("Body is not valid JSON");
    }
    if (isSns(body, snsType)) return fromSns(body);
    if (isAlertmanager(body)) return fromAlertmanager(body, isGrafana(body) ? "grafana" : "alertmanager");
    if (isGrafana(body)) return fromAlertmanager(body, "grafana");
    return { kind: "send", input: parseOrThrow(SendNotificationInput, body) };
  }
  return { kind: "send", input: fromTextRequest(query, c.req.raw.headers, text) };
}

/** `?devices=macbook,pixel` / `?platforms=android` target devices for any payload type (JSON bodies may also set them). */
function withQueryTargets(input: SendNotificationInput, query: Record<string, string>): SendNotificationInput {
  const list = (v: string | undefined) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
  const devices = input.devices ?? list(query.devices);
  const platforms = input.platforms ?? list(query.platforms);
  if (!devices && !platforms) return input;
  return parseOrThrow(SendNotificationInput, { ...input, devices, platforms });
}

hook.on(["GET", "POST", "PUT"], "/:token", async (c) => {
  const token = await findTokenBySecret(c.env.DB, c.req.param("token"), "webhook");
  if (!token) throw unauthorized("Invalid or revoked webhook token");
  const actor: Actor = {
    userId: token.userId,
    deviceId: null,
    deviceName: null,
    tokenId: token.id,
    defaultSource: (token.defaultSource ?? token.label).slice(0, 64),
  };
  const action = await parseHook(c);
  const stub = inbox(c.env, token.userId);

  switch (action.kind) {
    case "send": {
      const input = withQueryTargets(action.input, c.req.query());
      const n = await rpc(stub.send(actor, input, { titleFallback: true, rateLimit: true }));
      return c.json({ id: n.id, version: n.version });
    }
    case "resolve": {
      let n = await rpc(stub.resolveByReplaceKey(actor, action.replaceKey, action.patch));
      if (!n) {
        const created = await rpc(stub.send(actor, action.fallback, { titleFallback: true }));
        n = await rpc(stub.resolve(actor, created.id));
      }
      return c.json({ id: n.id, version: n.version });
    }
    case "sns-confirm": {
      const res = await fetch(action.subscribeUrl, { method: "GET" });
      await res.arrayBuffer().catch(() => undefined);
      if (!res.ok) throw badRequest(`SNS subscription confirmation failed (${res.status})`);
      return c.json({ ok: true, confirmed: true });
    }
    case "ignore":
      return c.json({ ok: true, ignored: action.reason });
  }
});
