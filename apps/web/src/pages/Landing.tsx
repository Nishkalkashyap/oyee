/**
 * The public front page, shown at / and /login to signed-out visitors. It reads like a README: what Oyee does in one
 * line, the two commands that set it up, the card those commands produce (try answering it), and the sign-in button.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Notification } from "@oyee/schema";
import { isMockMode } from "../lib/env";
import { loginErrorMessage, safeRedirect } from "../lib/login";
import { qk, useConfig, useMe } from "../lib/queries";
import { useTheme } from "../lib/theme";
import { LATEST, REPO } from "../components/HelpDialog";
import { ArrowRightIcon, ChevronDownIcon, MoonIcon, SunIcon } from "../components/Icons";
import { NotificationCard } from "../components/NotificationCard";
import { BrandMark, Button, Input, buttonClasses, cx } from "../components/ui";

// ─── Sign in ────────────────────────────────────────────────────────────────

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

/** Google sign-in (or "demo data" in mock mode), keeping the ?redirect= the auth gate sent us here with. */
function SignInButton({ size = "lg", label, className }: { size?: "md" | "lg"; label?: string; className?: string }) {
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get("redirect"));
  const qc = useQueryClient();
  const navigate = useNavigate();

  if (isMockMode()) {
    return (
      <Button
        variant="brand"
        size={size}
        className={className}
        onClick={() => {
          localStorage.removeItem("oyee:mock-logged-out");
          void qc.invalidateQueries({ queryKey: qk.me });
          navigate(redirect, { replace: true });
        }}
      >
        {label ?? "Continue with demo data"}
      </Button>
    );
  }
  return (
    <a
      href={`/auth/google/login?redirect=${encodeURIComponent(redirect)}`}
      className={buttonClasses("brand", size, cx("gap-2.5", className))}
    >
      <span className="flex size-6 items-center justify-center rounded-full bg-white">
        <GoogleIcon />
      </span>
      {label ?? "Start free with Google"}
    </a>
  );
}

/** Sign-in errors from the OAuth callback, and the dev-login form when the server allows it. */
function SignInExtras() {
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get("redirect"));
  const loginError = params.get("error");
  const config = useConfig();
  const [email, setEmail] = useState("dev@example.com");
  const mock = isMockMode();

  return (
    <>
      {loginError && (
        <div role="alert" className="mt-5 max-w-md rounded-2xl bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
          {loginErrorMessage(loginError)}
        </div>
      )}
      {!mock && config.data?.devLogin && (
        <form method="GET" action="/auth/dev-login" className="mt-5 flex max-w-md gap-2">
          <input type="hidden" name="redirect" value={redirect} />
          <Input
            type="email"
            name="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Dev login email"
          />
          <Button type="submit" variant="primary" className="h-10">
            Dev login
          </Button>
        </form>
      )}
    </>
  );
}

// ─── The card the commands produce ──────────────────────────────────────────

const DEMO_OPTIONS = ["Ship it", "Not now"];

function demoCard(answer: string | null): Notification {
  const at = new Date().toISOString();
  return {
    id: "ntf_demo",
    source: "claude-code",
    key: null,
    title: "Deploy api@4f2c1a to prod?",
    body: "12 commits, all checks green.",
    severity: "info",
    status: answer ? "resolved" : "active",
    url: null,
    version: answer ? 2 : 1,
    createdAt: at,
    updatedAt: at,
    readAt: null,
    resolvedAt: answer ? at : null,
    targetDeviceIds: null,
    intent: "ask",
    ask: {
      options: DEMO_OPTIONS,
      allowText: false,
      replyPlaceholder: null,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      answer: answer ? { option: answer, text: null, deviceId: null, deviceName: "This browser", at } : null,
      state: answer ? "answered" : "open",
    },
  };
}

/** An agent's question you can actually answer: the tap comes back as the agent's tool result. */
function DemoCard() {
  const [answer, setAnswer] = useState<string | null>(null);
  return (
    <div>
      <NotificationCard notification={demoCard(answer)} onAnswer={setAnswer} />
      <div className={cx("mt-3 flex items-start gap-2.5 font-mono text-[12.5px] leading-relaxed", answer ? "text-secondary-label" : "text-zinc-400 dark:text-zinc-500")}>
        <span className="mt-px select-none">{answer ? "✓" : "◌"}</span>
        <span aria-live="polite">
          {answer ? (
            <>
              ask → <span className="text-foreground">"{answer}"</span>{" "}
              <span className="text-zinc-400 dark:text-zinc-500">· back in Claude Code, it {answer === "Ship it" ? "deploys" : "waits"}</span>
            </>
          ) : (
            "claude-code is waiting for your answer. Tap one."
          )}
        </span>
      </div>
    </div>
  );
}

/** One command with the secret part shown as a placeholder (the real URL comes after sign-in). */
function Command({ label, before, after = "" }: { label: string; before: string; after?: string }) {
  return (
    <div>
      <div className="mb-2 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="overflow-x-auto rounded-2xl bg-background px-4 py-3 font-mono text-[13px] whitespace-nowrap text-secondary-label [scrollbar-width:none]">
        {before}
        <span className="text-brand">your-token</span>
        {after}
      </div>
    </div>
  );
}

function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[14px] font-semibold">{title}</div>
      <div className="mt-0.5 text-[13.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{children}</div>
    </div>
  );
}

const linkCls = "underline decoration-zinc-300 underline-offset-[3px] hover:text-foreground hover:decoration-foreground dark:decoration-zinc-600";

// ─── Page ─────────────────────────────────────────────────────────────────────

function ThemeToggle() {
  const [pref, setPref] = useTheme();
  const dark = pref === "dark" || (pref === "system" && document.documentElement.classList.contains("dark"));
  return (
    <button
      type="button"
      onClick={() => setPref(dark ? "light" : "dark")}
      className="flex size-9 items-center justify-center rounded-full text-secondary-label transition-colors hover:bg-zinc-200/70 hover:text-foreground dark:hover:bg-zinc-800"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <SunIcon size={17} /> : <MoonIcon size={17} />}
    </button>
  );
}

function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.82 1.19 3.08 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function Nav() {
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get("redirect"));
  return (
    <header>
      <nav className="mx-auto flex h-16 max-w-5xl items-center gap-1 px-5 sm:px-8">
        <span className="mr-auto inline-flex items-center gap-2 text-[18px] font-extrabold tracking-[-0.03em]">
          <BrandMark className="size-8 rounded-[10px]" />
          Oyee
        </span>
        <a
          href={`${REPO}/blob/main/docs/protocol.md`}
          target="_blank"
          rel="noreferrer"
          className="hidden rounded-full px-3 py-2 text-[14px] font-medium text-secondary-label hover:text-foreground sm:block"
        >
          Docs
        </a>
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className="flex size-9 items-center justify-center rounded-full text-secondary-label hover:bg-zinc-200/70 hover:text-foreground dark:hover:bg-zinc-800"
          aria-label="Source on GitHub"
        >
          <GitHubIcon size={17} />
        </a>
        <ThemeToggle />
        {isMockMode() ? (
          <SignInButton size="md" label="Demo" className="ml-1" />
        ) : (
          <a href={`/auth/google/login?redirect=${encodeURIComponent(redirect)}`} className={buttonClasses("secondary", "md", "ml-1 bg-background!")}>
            Sign in
          </a>
        )}
      </nav>
    </header>
  );
}

/** /login: the landing page, or straight through to ?redirect= when already signed in. */
export function LoginPage() {
  const [params] = useSearchParams();
  const me = useMe();
  if (me.data && !me.isError) return <Navigate to={safeRedirect(params.get("redirect"))} replace />;
  return <LandingPage />;
}

export function LandingPage() {
  useEffect(() => {
    document.title = "Oyee: ping your phone from anything, get an answer back";
    return () => {
      document.title = "Oyee";
    };
  }, []);
  const origin = window.location.origin;

  return (
    <div className="landing min-h-dvh overflow-x-clip">
      <Nav />

      <main className="mx-auto w-full max-w-[42rem] px-5 pt-10 pb-20 sm:px-8 sm:pt-16">
        <h1 className="rise-in text-[40px] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance sm:text-[54px]">
          Ping your phone from anything.
          <span className="block text-zinc-400 dark:text-zinc-500">Get an answer back.</span>
        </h1>
        <p className="rise-in mt-5 text-[17px] leading-relaxed text-zinc-500 [animation-delay:60ms] dark:text-zinc-400">
          Your AI agents, webhooks and scripts send notifications to your phone, Mac and browser. Tap a button or type a
          reply, and it goes straight back to whatever asked.
        </p>

        <div className="rise-in mt-10 space-y-5 [animation-delay:120ms]">
          <Command label="From Claude Code, Codex, Cursor or any MCP client" before={`claude mcp add --transport http oyee ${origin}/mcp/`} />
          <Command label="From anything else" before={`curl -d "Backup finished" ${origin}/hook/`} />
        </div>

        <div className="rise-in mt-8 [animation-delay:180ms]">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">
            <ChevronDownIcon size={15} />
            Lands on your phone, Mac and browser as
          </div>
          <DemoCard />
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2">
          <SignInButton label="Sign in to get your URL" />
          <span className="text-[13.5px] text-zinc-500 dark:text-zinc-400">Free. No card, no paid tier.</span>
        </div>
        <SignInExtras />

        <div className="mt-14 grid gap-6 border-t border-zinc-200 pt-8 sm:grid-cols-3 dark:border-zinc-800">
          <Fact title="Webhooks, understood">Alertmanager, Grafana and AWS SNS work as they are. So do JSON, plain text and ntfy-style headers.</Fact>
          <Fact title="Android, macOS, web">
            Answer on whichever is closest.{" "}
            <a href={LATEST} target="_blank" rel="noreferrer" className={linkCls}>
              Get the apps
            </a>
            .
          </Fact>
          <Fact title="MIT licensed">
            No ads, no tracking.{" "}
            <a href={`${REPO}/blob/main/docs/setup.md`} target="_blank" rel="noreferrer" className={linkCls}>
              Self-host it
            </a>{" "}
            on Cloudflare.
          </Fact>
        </div>

        <a
          href={`${REPO}/blob/main/docs/protocol.md`}
          target="_blank"
          rel="noreferrer"
          className="mt-8 inline-flex items-center gap-1.5 text-[14px] font-semibold text-secondary-label hover:text-foreground"
        >
          Read the docs: cards, buttons, replies, progress and MCP tools <ArrowRightIcon size={15} />
        </a>
      </main>

      <footer className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-5 pb-10 text-[13px] text-zinc-500 sm:flex-row sm:px-8 dark:text-zinc-400">
        <span className="inline-flex items-center gap-2">
          <BrandMark className="size-5 rounded-md" />
          Oyee · MIT licensed
        </span>
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-1">
          <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-foreground">GitHub</a>
          <a href={`${REPO}/blob/main/docs/protocol.md`} target="_blank" rel="noreferrer" className="hover:text-foreground">API &amp; MCP</a>
          <a href={`${REPO}/blob/main/docs/setup.md`} target="_blank" rel="noreferrer" className="hover:text-foreground">Self-host</a>
          <a href={LATEST} target="_blank" rel="noreferrer" className="hover:text-foreground">Releases</a>
          <a href={`${REPO}/issues/new`} target="_blank" rel="noreferrer" className="hover:text-foreground">Report a problem</a>
        </div>
      </footer>
    </div>
  );
}
