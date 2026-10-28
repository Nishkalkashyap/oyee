import type { InboxDO } from "./inbox/do";

/** Bindings, vars and secrets (see PLAN.md §6 and wrangler.jsonc). */
export interface Env {
  DB: D1Database;
  INBOX: DurableObjectNamespace<InboxDO>;
  ASSETS?: Fetcher;

  PUBLIC_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  ALLOWED_EMAILS?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  FCM_SERVICE_ACCOUNT_JSON?: string;
  DEV_LOGIN?: string;
}

type OyeeEnv = Env;
declare global {
  namespace Cloudflare {
    // Types `env` from "cloudflare:test" / "cloudflare:workers".
    interface Env extends OyeeEnv {}
  }
}

export const SERVER_VERSION = "0.1.0";

export function isDevLogin(env: Env): boolean {
  return env.DEV_LOGIN === "true";
}

/** Public origin, e.g. https://oyee.example.workers.dev (no trailing slash). Falls back to the request origin. */
export function publicUrl(env: Env, req: Request): string {
  const configured = env.PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(req.url).origin;
}
