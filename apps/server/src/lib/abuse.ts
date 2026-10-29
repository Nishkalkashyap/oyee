/** Per-IP protections for unauthenticated traffic (docs/protocol.md §3.1). Skipped when the client IP is unknown. */
import { LIMITS } from "@oyee/schema";
import type { Context } from "hono";
import type { AppEnv } from "../app";
import { bumpIpCounter, userExists } from "../db";
import { hmacSha256, toHex } from "./encoding";
import { rateLimited, type ApiError } from "./errors";

const clientIp = (c: Context<AppEnv>) => c.req.header("CF-Connecting-IP") ?? null;

/**
 * Call with the error for a bad token or pairing code. Past LIMITS.authFailuresPerIpPerMinute failures from one IP
 * the caller gets a 429 instead (Workers Rate Limiting binding; per Cloudflare location, so approximate).
 */
export async function authFailure(c: Context<AppEnv>, err: ApiError): Promise<ApiError> {
  const ip = clientIp(c);
  if (!ip || !c.env.AUTH_FAILURES) return err;
  const { success } = await c.env.AUTH_FAILURES.limit({ key: ip });
  return success ? err : rateLimited("Too many failed attempts from your network: try again in a minute", 60);
}

/** New accounts are limited to LIMITS.signupsPerIpPerDay per IP per UTC day; existing users can always sign in. */
export async function signupAllowed(c: Context<AppEnv>, email: string): Promise<boolean> {
  const ip = clientIp(c);
  if (!ip || (await userExists(c.env.DB, email))) return true;
  const key = toHex(await hmacSha256(c.env.SESSION_SECRET ?? "oyee", `signup:${ip}`));
  const count = await bumpIpCounter(c.env.DB, key, Math.floor(Date.now() / 86_400_000));
  return count <= LIMITS.signupsPerIpPerDay;
}
