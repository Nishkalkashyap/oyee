import { Hono } from "hono";
import type { Principal } from "./auth/principal";
import { findTokenBySecret } from "./db";
import type { Env } from "./env";
import { ApiError, errorResponse, notFound, unauthorized } from "./lib/errors";
import { handleMcpRequest } from "./mcp/server";
import { api } from "./routes/api";
import { authRoutes } from "./routes/auth";
import { hook } from "./routes/hook";

export type AppEnv = { Bindings: Env; Variables: { principal: Principal } };

export const app = new Hono<AppEnv>();

app.onError((err, c) => {
  const api = ApiError.fromUnknown(err);
  if (api) return errorResponse(api);
  console.error(`Unhandled error on ${c.req.method} ${c.req.path}`, err);
  return errorResponse(new ApiError("internal", "Internal server error"));
});

app.notFound(async (c) => {
  const path = c.req.path;
  const isServerPath = ["/api", "/auth", "/hook", "/mcp", "/healthz"].some((p) => path === p || path.startsWith(`${p}/`));
  if (!isServerPath && c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return errorResponse(notFound(`No route for ${c.req.method} ${path}`));
});

app.get("/healthz", (c) => c.json({ ok: true }));

app.route("/auth", authRoutes);
app.route("/api", api);
app.route("/hook", hook);

// MCP: token in the path, or `Authorization: Bearer oyee_mcp_…` on /mcp.
async function mcp(c: import("hono").Context<AppEnv>, secret: string | null) {
  if (!secret) throw unauthorized("MCP token required: use /mcp/<token> or Authorization: Bearer <token>");
  const token = await findTokenBySecret(c.env.DB, secret, "mcp");
  if (!token) throw unauthorized("Invalid or revoked MCP token");
  return handleMcpRequest(c.req.raw, c.env, token);
}

app.all("/mcp", (c) => {
  const m = /^Bearer\s+(.+)$/i.exec(c.req.header("Authorization") ?? "");
  return mcp(c, m ? m[1]!.trim() : null);
});
app.all("/mcp/:token", (c) => mcp(c, c.req.param("token")));
