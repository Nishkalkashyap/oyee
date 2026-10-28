import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { isMockMode } from "../lib/env";
import { qk, useConfig, useMe } from "../lib/queries";
import { Logo } from "../components/Layout";
import { Button, Input, buttonClasses } from "../components/ui";

const LOGIN_ERRORS: Record<string, string> = {
  not_allowed: "This email isn't allowed on this Herald instance. Ask the admin to add it to ALLOWED_EMAILS.",
  access_denied: "Google sign-in was cancelled.",
  invalid_state: "The sign-in session expired or was tampered with. Please try again.",
  oauth_failed: "Google sign-in failed. Please try again.",
  not_configured: "Google sign-in isn't configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).",
};

export function loginErrorMessage(code: string): string {
  return LOGIN_ERRORS[code] ?? `Sign-in failed (${code}). Please try again.`;
}

/** Only allow same-origin relative redirects. */
function safeRedirect(r: string | null): string {
  return r && r.startsWith("/") && !r.startsWith("//") ? r : "/";
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get("redirect"));
  const loginError = params.get("error");
  const config = useConfig();
  const me = useMe();
  const [email, setEmail] = useState("dev@example.com");
  const mock = isMockMode();
  const qc = useQueryClient();
  const navigate = useNavigate();

  if (me.data && !me.isError) return <Navigate to={redirect} replace />;

  const mockSignIn = () => {
    localStorage.removeItem("herald:mock-logged-out");
    void qc.invalidateQueries({ queryKey: qk.me });
    navigate(redirect, { replace: true });
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.15),transparent_60%)]" />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="text-lg" />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">Sign in to Herald</h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            One inbox for AI agents, scripts and webhooks: live, actionable notifications on every device.
          </p>
        </div>

        <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
          {loginError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {loginErrorMessage(loginError)}
            </div>
          )}
          {mock ? (
            <Button variant="primary" size="lg" className="w-full" onClick={mockSignIn}>
              Continue with demo data
            </Button>
          ) : (
            <a
              href={`/auth/google/login?redirect=${encodeURIComponent(redirect)}`}
              className={buttonClasses("secondary", "lg", "w-full gap-2")}
            >
              <GoogleIcon />
              Sign in with Google
            </a>
          )}

          {!mock && config.data?.devLogin && (
            <>
              <div className="flex items-center gap-3 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                Dev login
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>
              <form method="GET" action="/auth/dev-login" className="space-y-2">
                <input type="hidden" name="redirect" value={redirect} />
                <Input
                  type="email"
                  name="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-label="Email"
                />
                <Button type="submit" variant="primary" className="w-full">
                  Sign in as this email
                </Button>
                <p className="text-[11px] text-zinc-500">
                  Enabled because the server runs with <code>DEV_LOGIN=true</code>. Never enable it in production.
                </p>
              </form>
            </>
          )}
          {config.isError && !mock && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Couldn't load server config. Is the API running? You can also try{" "}
              <a href="/?mock=1" className="underline">
                mock mode
              </a>
              .
            </p>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-zinc-500">Free and open source. MIT licensed.</p>
      </div>
    </div>
  );
}
