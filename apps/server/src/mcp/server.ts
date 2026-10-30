/** MCP over stateless Streamable HTTP (docs/protocol.md §5). A fresh server + transport per request. */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AskInput, LIMITS, McpListInput, McpWaitInput, ProgressInput, type Notification } from "@oyee/schema";
import { z } from "zod";
import { listDevices, toDevice, type TokenRecord } from "../db";
import { SERVER_VERSION, type Env } from "../env";
import { ApiError, rpc } from "../lib/errors";
import type { Actor } from "../inbox/model";
import { progressResultText } from "../inbox/progress";
import { inbox } from "../routes/api";
import { askResultText, waitResultText } from "./ask";
import { registerInformTool } from "./inform";
import { listItem, resultText } from "./text";

/** Read by the client once per session: which of the three intents to pick, in a few lines. */
const INSTRUCTIONS = [
  "Oyee notifies the user on their phone, laptop and browser. Pick the tool by what you mean:",
  "- inform: something the user should know (a build finished, an alert fired, a summary is ready). One-way, no answer.",
  "- ask: you need a decision or text from the user. Then call wait_for_response with the returned id until it is answered.",
  "- progress: long-running work, shown as a bar. Call it repeatedly with the same key; finish with status done or failed.",
  "Give inform and ask a key so sending again updates the same notification instead of nagging. resolve withdraws a " +
    "notification that no longer matters, list_notifications shows what you already sent, and list_devices names the " +
    "devices you can target.",
].join("\n");

/** For listing tools: compact JSON. */
function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function fail(err: unknown): CallToolResult {
  const api = ApiError.fromUnknown(err);
  const message = api ? `${api.code}: ${api.message}` : err instanceof Error ? err.message : String(err);
  if (!api) console.error("MCP tool error", err);
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Runs a tool body; its result (text in the shape of ./text.ts, or JSON for listings) or the error as `isError`. */
async function run(fn: () => Promise<string | CallToolResult>): Promise<CallToolResult> {
  try {
    const r = await fn();
    return typeof r === "string" ? { content: [{ type: "text", text: r }] } : r;
  } catch (e) {
    return fail(e);
  }
}

function resolveResultText(n: Notification): string {
  const title = JSON.stringify(n.title);
  if (n.intent === "ask" && n.ask.state === "withdrawn") {
    return resultText("withdrawn", n.id, `Withdrew the ask ${title}: it can no longer be answered and is gone from the user's devices.`);
  }
  return resultText("resolved", n.id, `Resolved ${title}: it is gone from the user's devices.`);
}

export function buildMcpServer(env: Env, token: TokenRecord): McpServer {
  const server = new McpServer(
    { name: "oyee", version: SERVER_VERSION },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator(), instructions: INSTRUCTIONS },
  );
  const stub = () => inbox(env, token.userId);
  const actor: Actor = {
    userId: token.userId,
    deviceId: null,
    deviceName: null,
    tokenId: token.id,
    defaultSource: (token.defaultSource ?? token.label).slice(0, 64),
  };

  registerInformTool(server, stub, actor);

  server.registerTool(
    "ask",
    {
      title: "Ask the user",
      description:
        "Ask the user a question when you need a decision or text from them: up to 3 answer buttons (`options`) " +
        "and/or a typed answer (`allowText`). It alerts every paired device (or only `devices` / `platforms`); the " +
        "first answer from any device closes it everywhere. Then call wait_for_response with the returned id. Give " +
        "it a `key` so asking again while it is open returns the same ask instead of alerting again.",
      inputSchema: AskInput,
    },
    (input) => run(async () => askResultText(await rpc(stub().ask(actor, input)))),
  );

  server.registerTool(
    "wait_for_response",
    {
      title: "Wait for response",
      description:
        `Wait up to ${LIMITS.askWaitSeconds} s for the user's answer to an ask. Returns the answer and the device it ` +
        "came from as soon as it arrives, or says it is still pending: then call again with the same id.",
      inputSchema: McpWaitInput,
    },
    ({ id, timeoutSeconds }) =>
      run(async () => waitResultText(id, await rpc(stub().waitForResponse(id, timeoutSeconds ?? LIMITS.askWaitSeconds)))),
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
    (input) => run(async () => progressResultText(await rpc(stub().progress(actor, input)))),
  );

  server.registerTool(
    "resolve",
    {
      title: "Resolve",
      description:
        "Withdraw a notification that no longer matters (an inform that is settled, an ask you no longer need " +
        "answered): it is removed from every device and an open ask can no longer be answered. Takes the id returned " +
        "by inform, ask or progress (list_notifications with `key` finds it).",
      inputSchema: z.object({ id: z.string().describe("Notification id (ntf_…).") }),
    },
    ({ id }) => run(async () => resolveResultText(await rpc(stub().resolve(actor, id)))),
  );

  server.registerTool(
    "list_notifications",
    {
      title: "List notifications",
      description:
        "List notifications already sent to the user, newest first, filtered by `key`, `intent`, `status` and " +
        "`source`. Each item is compact: id, intent, key, title, status, state, answer, createdAt and `ago` " +
        `(e.g. "12m"). Returns ${LIMITS.defaultListPage} items unless you set \`limit\`; pass \`nextCursor\` as ` +
        "`cursor` for older ones.",
      inputSchema: McpListInput,
    },
    ({ limit, ...filters }) =>
      run(async () => {
        const page = await rpc(stub().list({ ...filters, limit: limit ?? LIMITS.defaultListPage }));
        const now = Date.now();
        return json({ items: page.items.map((n) => listItem(n, now)), nextCursor: page.nextCursor });
      }),
  );

  server.registerTool(
    "list_devices",
    {
      title: "List devices",
      description:
        "List the user's paired devices (id, name, platform, transports). Use a name or id in the `devices` field of " +
        "inform, ask or progress to alert only that device.",
      inputSchema: z.object({}),
    },
    () => run(async () => json({ items: (await listDevices(env.DB, token.userId)).map(toDevice) })),
  );

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
