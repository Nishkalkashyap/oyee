/** /auth/*: Google OAuth (authorization code + state + PKCE), dev login, logout. */
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { AppEnv } from "../app";
import { isDevLogin } from "../env";
import { consumeOAuthState, createSession, deleteSession, saveOAuthState, upsertUser } from "../db";
import { signupAllowed } from "../lib/abuse";
import { b64urlDecodeString, b64urlEncode, randomBytes, timingSafeEqual, utf8 } from "../lib/encoding";
import { badRequest, forbidden, notFound } from "../lib/errors";
import {
  clearSessionCookie,
  emailAllowed,
  isSecureRequest,
  safeRedirect,
  SESSION_COOKIE,
  setSessionCookie,
} from "../auth/principal";

const STATE_COOKIE = "oyee_oauth_state";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

export const authRoutes = new Hono<AppEnv>();

function loginError(code: string): string {
  return `/login?error=${encodeURIComponent(code)}`;
}

authRoutes.get("/google/login", async (c) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return c.redirect(loginError("not_configured"));
  const redirect = safeRedirect(c.req.query("redirect"));
  const state = b64urlEncode(randomBytes(24));
  const verifier = b64urlEncode(randomBytes(32));
  const challenge = b64urlEncode(await crypto.subtle.digest("SHA-256", utf8(verifier)));
  await saveOAuthState(c.env.DB, state, verifier, redirect);

  // Binds the flow to this browser (login-CSRF protection) in addition to the server-side state row.
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: "Lax",
    path: "/auth",
    maxAge: 600,
  });
  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${new URL(c.req.url).origin}/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return c.redirect(url.toString(), 302);
});

const IdTokenClaims = z.object({
  iss: z.string(),
  aud: z.string(),
  sub: z.string(),
  exp: z.number(),
  email: z.string().email(),
  email_verified: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

authRoutes.get("/google/callback", async (c) => {
  const env = c.env;
  const q = c.req.query();
  if (q.error) return c.redirect(loginError(q.error), 302);
  if (!q.code || !q.state) return c.redirect(loginError("invalid_request"), 302);

  const cookieState = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: "/auth" });
  if (!cookieState || !timingSafeEqual(cookieState, q.state)) return c.redirect(loginError("state_mismatch"), 302);
  const saved = await consumeOAuthState(env.DB, q.state);
  if (!saved) return c.redirect(loginError("state_expired"), 302);

  const tokenRes = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: q.code,
      client_id: env.GOOGLE_CLIENT_ID ?? "",
      client_secret: env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: `${new URL(c.req.url).origin}/auth/google/callback`,
      grant_type: "authorization_code",
      code_verifier: saved.codeVerifier,
    }),
  });
  if (!tokenRes.ok) {
    console.warn("Google token exchange failed", tokenRes.status, await tokenRes.text());
    return c.redirect(loginError("token_exchange_failed"), 302);
  }
  const tokens = (await tokenRes.json()) as { id_token?: string };
  // The ID token comes straight from Google's token endpoint over TLS, so its claims can be trusted without
  // verifying the signature (OIDC Core §3.1.3.7); we still check iss/aud/exp.
  const parsed = IdTokenClaims.safeParse(
    (() => {
      try {
        return JSON.parse(b64urlDecodeString(tokens.id_token?.split(".")[1] ?? ""));
      } catch {
        return null;
      }
    })(),
  );
  if (!parsed.success) return c.redirect(loginError("invalid_id_token"), 302);
  const claims = parsed.data;
  if (
    !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) ||
    claims.aud !== env.GOOGLE_CLIENT_ID ||
    claims.exp * 1000 < Date.now()
  ) {
    return c.redirect(loginError("invalid_id_token"), 302);
  }
  if (claims.email_verified === false || claims.email_verified === "false") {
    return c.redirect(loginError("email_not_verified"), 302);
  }
  if (!emailAllowed(env.ALLOWED_EMAILS, claims.email)) return c.redirect(loginError("not_allowed"), 302);
  if (!(await signupAllowed(c, claims.email))) return c.redirect(loginError("too_many_signups"), 302);

  const user = await upsertUser(env.DB, {
    email: claims.email,
    name: claims.name ?? null,
    avatarUrl: claims.picture ?? null,
    googleSub: claims.sub,
  });
  setSessionCookie(c, await createSession(env.DB, user.id, c.req.header("User-Agent") ?? null));
  return c.redirect(safeRedirect(saved.redirect), 302);
});

authRoutes.get("/dev-login", async (c) => {
  if (!isDevLogin(c.env)) throw notFound();
  const email = (c.req.query("email") ?? "dev@example.com").trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) throw badRequest("email: invalid");
  if (!emailAllowed(c.env.ALLOWED_EMAILS, email)) throw forbidden("Email not allowed on this instance");
  if (!(await signupAllowed(c, email))) throw forbidden("Too many new accounts from your network today");
  const user = await upsertUser(c.env.DB, { email, name: c.req.query("name") ?? email.split("@")[0] ?? null });
  setSessionCookie(c, await createSession(c.env.DB, user.id, c.req.header("User-Agent") ?? null));
  return c.redirect(safeRedirect(c.req.query("redirect")), 302);
});

authRoutes.post("/logout", async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) await deleteSession(c.env.DB, sid);
  clearSessionCookie(c);
  return c.body(null, 204);
});
