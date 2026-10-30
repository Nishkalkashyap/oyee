/** The MCP `inform` tool: one-way notifications, answered with plain text a model can follow. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { InformInput } from "@oyee/schema";
import type { InformResult } from "../inbox/inform";
import type { Actor } from "../inbox/model";
import { rpc } from "../lib/errors";
import type { inbox } from "../routes/api";
import { fail } from "./server";
import { resultText } from "./text";

/** In the shared result shape (./text.ts): outcome and id lines, then the reason in words. */
export function informResultText(r: InformResult): string {
  return resultText(r.outcome, r.notification.id, r.reason);
}

export function registerInformTool(server: McpServer, stub: () => ReturnType<typeof inbox>, actor: Actor) {
  server.registerTool(
    "inform",
    {
      title: "Inform the user",
      description:
        "Tell the user something they should know (a build finished, an alert fired, a summary is ready). One-way: " +
        "it has no answer buttons (use ask for a decision). Only `title` is required. Set `key` to update the same " +
        "notification on later sends instead of creating duplicates.",
      inputSchema: InformInput,
    },
    async (input): Promise<CallToolResult> => {
      try {
        return { content: [{ type: "text", text: informResultText(await rpc(stub().inform(actor, input))) }] };
      } catch (e) {
        return fail(e);
      }
    },
  );
}
