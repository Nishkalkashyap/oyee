/** MCP over stateless Streamable HTTP (docs/protocol.md §5). A fresh server + transport per request. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  ListNotificationsQuery,
  McpAskInput,
  McpWaitInput,
  ProgressInput,
  SendNotificationInput,
  TemplateCard,
  TemplateName,
  UpdateNotificationInput,
  type SendNotificationInput as SendInput,
} from "@oyee/schema";
import { z } from "zod";
import { listDevices, toDevice, type TokenRecord } from "../db";
import { SERVER_VERSION, type Env } from "../env";
import { ApiError, rpc } from "../lib/errors";
import type { Actor } from "../inbox/model";
import { progressResultText } from "../inbox/progress";
import { inbox } from "../routes/api";
import { registerInformTool } from "./inform";

const IdInput = z.object({ id: z.string().describe("Notification id (ntf_…)") });

function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function fail(err: unknown): CallToolResult {
  const api = ApiError.fromUnknown(err);
  const message = api ? `${api.code}: ${api.message}` : err instanceof Error ? err.message : String(err);
  if (!api) console.error("MCP tool error", err);
  return { content: [{ type: "text", text: message }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(e);
  }
}

export function buildMcpServer(env: Env, token: TokenRecord): McpServer {
  const server = new McpServer(
    { name: "oyee", version: SERVER_VERSION },
    {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      instructions:
        "Oyee delivers notifications to the user's phone, laptop and browser. Use send_notification for one-way " +
        "messages (update_notification to change them in place, e.g. progress), and ask + wait_for_response when you " +
        "need a decision from the human.",
    },
  );
  const stub = () => inbox(env, token.userId);
  const actor: Actor = {
    userId: token.userId,
    deviceId: null,
    deviceName: null,
    tokenId: token.id,
    defaultSource: (token.defaultSource ?? token.label).slice(0, 64),
  };

  server.registerTool(
    "send_notification",
    {
      title: "Send notification",
      description:
        "Send a notification card. By default it alerts every paired device; to reach specific ones, set `devices` " +
        "(device names or ids from list_devices — a unique partial name such as \"macbook\" works) and/or `platforms` " +
        "(android, macos, web, ios). Returns the stored Notification (keep its id to update it). " +
        "Use `replaceKey` to update an existing active notification instead of creating a duplicate, and " +
        "`template` + `vars` to render a saved template.",
      inputSchema: SendNotificationInput,
    },
    (input) => run(() => rpc(stub().send(actor, input))),
  );

  server.registerTool(
    "update_notification",
    {
      title: "Update notification",
      description:
        "Patch a notification in place (title, body, progress, fields, actions…). `null` clears a field. Silent unless `alert: true`.",
      inputSchema: UpdateNotificationInput.extend({ id: z.string() }),
    },
    ({ id, ...patch }) => run(() => rpc(stub().update(actor, id, patch))),
  );

  server.registerTool(
    "resolve_notification",
    {
      title: "Resolve notification",
      description: "Mark a notification as resolved; it is removed from the system notification tray on every device.",
      inputSchema: IdInput,
    },
    ({ id }) => run(() => rpc(stub().resolve(actor, id))),
  );

  server.registerTool(
    "ask",
    {
      title: "Ask the user",
      description:
        "Send a question with up to 3 option buttons and/or a text reply box. Returns { id }; then call " +
        "wait_for_response with that id (repeat while it returns pending). `devices` / `platforms` target specific " +
        "devices, as in send_notification.",
      inputSchema: McpAskInput,
    },
    (input) =>
      run(async () => {
        const send: SendInput = {
          title: input.title,
          body: input.body,
          severity: input.severity ?? "info",
          source: input.source,
          threadId: input.threadId,
          actions: (input.options ?? []).map((label, i) => ({
            id: `option_${i + 1}`,
            label,
            style: i === 0 ? "primary" : "default",
            resolves: true,
          })),
          reply: input.allowText ? { placeholder: "Reply…", buttonLabel: "Send" } : undefined,
          devices: input.devices,
          platforms: input.platforms,
        };
        if (!send.actions?.length && !send.reply) send.reply = { placeholder: "Reply…", buttonLabel: "Send" };
        const n = await rpc(stub().send(actor, send));
        return { id: n.id };
      }),
  );

  server.registerTool(
    "wait_for_response",
    {
      title: "Wait for response",
      description:
        "Long-poll (up to 55 s) for the user's response to a notification. Returns { status: 'answered', response } " +
        "or { status: 'pending' } — call again if pending.",
      inputSchema: McpWaitInput,
    },
    ({ id, timeoutSeconds }) => run(() => rpc(stub().waitForResponse(id, timeoutSeconds ?? 50))),
  );

  server.registerTool(
    "progress",
    {
      title: "Report progress",
      description:
        "Report long-running work as a progress bar on the user's devices. Call it repeatedly with the same `key`: " +
        "the first report appears without sound, later ones update it silently, and status done or failed alerts the " +
        "user once. Omitted fields keep the previous report's value.",
      inputSchema: ProgressInput,
    },
    async (input) => {
      try {
        return { content: [{ type: "text", text: progressResultText(await rpc(stub().progress(actor, input))) }] };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_notification",
    { title: "Get notification", description: "Fetch a notification by id, including responses.", inputSchema: IdInput },
    ({ id }) => run(() => rpc(stub().get(id))),
  );

  server.registerTool(
    "list_notifications",
    {
      title: "List notifications",
      description: "List notifications, newest first, with optional filters. Paginate with `cursor`.",
      inputSchema: ListNotificationsQuery.omit({ updatedSince: true }).extend({
        limit: z.number().int().min(1).max(200).optional(),
      }),
    },
    (q) => run(() => rpc(stub().list({ ...q, limit: q.limit ?? 50 }))),
  );

  server.registerTool(
    "list_templates",
    { title: "List templates", description: "List the user's saved notification templates.", inputSchema: z.object({}) },
    () => run(async () => ({ items: await rpc(stub().listTemplates()) })),
  );

  server.registerTool(
    "upsert_template",
    {
      title: "Create or update template",
      description:
        "Save a reusable partial card. Strings may contain {{var}} or {{var|fallback}} placeholders, rendered from `vars` at send time.",
      inputSchema: z.object({ name: TemplateName, description: z.string().max(500).optional(), card: TemplateCard }),
    },
    ({ name, description, card }) => run(() => rpc(stub().upsertTemplate(name, { description, card }))),
  );

  server.registerTool(
    "delete_template",
    { title: "Delete template", description: "Delete a template by name.", inputSchema: z.object({ name: TemplateName }) },
    ({ name }) =>
      run(async () => {
        await rpc(stub().deleteTemplate(name));
        return { ok: true };
      }),
  );

  server.registerTool(
    "list_devices",
    {
      title: "List devices",
      description:
        "List the user's paired devices (id, name, platform, transports). Use a name or id in the `devices` field of " +
        "send_notification / ask to notify only that device.",
      inputSchema: z.object({}),
    },
    () => run(async () => ({ items: (await listDevices(env.DB, token.userId)).map(toDevice) })),
  );

  registerInformTool(server, stub, actor);

  return server;
}

export async function handleMcpRequest(req: Request, env: Env, token: TokenRecord): Promise<Response> {
  if (req.method === "GET" || req.method === "DELETE") {
    // Stateless server: no standalone SSE stream and no sessions to terminate.
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server: use POST)" }, id: null },
      { status: 405, headers: { Allow: "POST" } },
    );
  }
  const server = buildMcpServer(env, token);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}
