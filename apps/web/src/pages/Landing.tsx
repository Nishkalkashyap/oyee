/**
 * The public front page, shown at / and /login to signed-out visitors: a live demo of a card that updates in place
 * and asks a question, what Oyee plugs into, the platforms, copy-paste setup and the sign-in button.
 */
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Action, Notification } from "@oyee/schema";
import { isMockMode } from "../lib/env";
import { loginErrorMessage, safeRedirect } from "../lib/login";
import { qk, useConfig, useMe } from "../lib/queries";
import { mcpSnippets, webhookSnippets } from "../lib/snippets";
import { useTheme } from "../lib/theme";
import { BRAND_ICONS, BrandIcon, isInk, type BrandIconName } from "../components/BrandIcons";
import { CopyButton } from "../components/Code";
import { LATEST, REPO, useLatestRelease } from "../components/HelpDialog";
import {
  CheckIcon,
  CodeIcon,
  DownloadIcon,
  GlobeIcon,
  LaptopIcon,
  LayersIcon,
  MoonIcon,
  SendIcon,
  SmartphoneIcon,
  SunIcon,
  type IconProps,
} from "../components/Icons";
import { NotificationCard } from "../components/NotificationCard";
import { ProgressBar, SeverityBadge } from "../components/NotificationParts";
import { AndroidPreview, ApplePreview, WebPushPreview } from "../components/PlatformPreviews";
import { Avatar, BrandMark, Button, Input, OyeeMark, Segmented, buttonClasses, cx } from "../components/ui";

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

// ─── Hero demo: an agent sends a card, updates it in place, then asks ─────────────

const DEMO_TOTAL = 12;
const DEMO_ACTIONS: Action[] = [
  { id: "option_1", label: "Drop it", style: "primary", resolves: true },
  { id: "option_2", label: "Keep for now", style: "default", resolves: true },
];

type DemoStage = "progress" | "ask" | "answered";

function demoCard(p: Partial<Notification>, at: string): Notification {
  return {
    id: "ntf_demo",
    source: "claude-code",
    threadId: "users-migration",
    title: "",
    body: null,
    severity: "info",
    status: "active",
    icon: null,
    image: null,
    url: null,
    fields: [],
    progress: null,
    actions: [],
    reply: null,
    tags: [],
    silent: false,
    template: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
    readAt: null,
    resolvedAt: null,
    responses: [],
    ...p,
  };
}

function useDemo() {
  const [stage, setStage] = useState<DemoStage>("progress");
  const [value, setValue] = useState(0);
  const [answer, setAnswer] = useState<{ label: string; device: string } | null>(null);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    if (stage === "progress") {
      t = value < DEMO_TOTAL ? setTimeout(() => setValue((v) => v + 1), value === 0 ? 900 : 320) : setTimeout(() => setStage("ask"), 700);
    } else if (stage === "ask") {
      t = setTimeout(() => {
        setAnswer({ label: "Drop it", device: "Pixel 9" });
        setStage("answered");
      }, 5200);
    } else {
      t = setTimeout(() => {
        setAnswer(null);
        setValue(0);
        setStage("progress");
        setCycle((c) => c + 1);
      }, 4800);
    }
    return () => clearTimeout(t);
  }, [stage, value]);

  const answerWith = (a: Action) => {
    if (stage !== "ask") return;
    setAnswer({ label: a.label, device: "this browser" });
    setStage("answered");
  };

  return { stage, value, answer, cycle, answerWith };
}

function TerminalLine({ children, tone = "plain", show = true }: { children: ReactNode; tone?: "plain" | "tool" | "dim" | "in"; show?: boolean }) {
  if (!show) return null;
  return (
    <div
      className={cx(
        "rise-in flex gap-2 whitespace-pre-wrap",
        tone === "dim" && "text-white/45",
        tone === "in" && "text-[#fdba8c]",
      )}
    >
      {children}
    </div>
  );
}

function HeroDemo() {
  const { stage, value, answer, cycle, answerWith } = useDemo();
  const [at] = useState(() => new Date().toISOString());

  const n =
    stage === "progress"
      ? demoCard(
          {
            title: "Migrating users → users_v2",
            body: "Backfilling in batches of 4,000 rows. Writes stay on.",
            progress: { value, max: DEMO_TOTAL, label: `${value}/${DEMO_TOTAL} batches`, indeterminate: false },
            version: value + 1,
          },
          at,
        )
      : demoCard(
          {
            title: "Migration done. Drop the old table?",
            body: "All rows copied and verified. `users_old` is still around as a backup.",
            severity: stage === "answered" ? "success" : "warning",
            status: stage === "answered" ? "resolved" : "active",
            fields: [
              { label: "Rows", value: "48,210" },
              { label: "Errors", value: "0" },
            ],
            actions: DEMO_ACTIONS,
            responses: answer
              ? [{ actionId: DEMO_ACTIONS.find((a) => a.label === answer.label)?.id ?? null, text: null, deviceId: null, deviceName: answer.device, at }]
              : [],
            version: DEMO_TOTAL + 2,
          },
          at,
        );

  return (
    <div className="relative mx-auto min-h-[620px] w-full max-w-[520px] min-[360px]:min-h-[540px]" aria-label="Demo: an AI agent sends a live notification and asks a question">
      {/* The agent's terminal */}
      <div className="rounded-[22px] bg-[#1c1b19] p-4 pb-12 font-mono text-[12px] leading-[1.7] text-[#f1ede6] shadow-[0_30px_60px_-30px_rgba(28,27,25,0.55)] ring-1 ring-black/5 sm:text-[12.5px] dark:bg-[#0c0b0a] dark:ring-white/8">
        <div className="mb-3 flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="ml-2 font-sans text-[11px] font-medium text-white/40">claude · ~/api</span>
        </div>
        <div key={cycle} className="min-h-[8.2rem]">
          <TerminalLine tone="dim">{"> migrate users to users_v2, ask me before dropping anything"}</TerminalLine>
          <TerminalLine tone="tool">
            <span className="text-[#ff6b1a]">●</span>
            <span>
              oyee.send_notification <span className="text-white/45">"Migrating users"</span>
            </span>
          </TerminalLine>
          <TerminalLine tone="tool" show={value > 0}>
            <span className="text-[#ff6b1a]">●</span>
            <span>
              oyee.update_notification{" "}
              <span className="text-white/45 tabular-nums">
                progress {value}/{DEMO_TOTAL}
              </span>
            </span>
          </TerminalLine>
          <TerminalLine tone="tool" show={stage !== "progress"}>
            <span className="text-[#ff6b1a]">●</span>
            <span>
              oyee.ask <span className="text-white/45">"Drop the old table?"</span>
            </span>
          </TerminalLine>
          <TerminalLine tone="dim" show={stage === "ask"}>
            <span className="animate-pulse">◌ waiting for your answer…</span>
          </TerminalLine>
          {answer && (
            <>
              <TerminalLine tone="in">
                ← "{answer.label}" from {answer.device}
              </TerminalLine>
              <TerminalLine tone="plain">
                <span className="text-[#4ade80]">✓</span>
                {answer.label === "Drop it" ? "Dropped users_old. All done." : "Keeping users_old. All done."}
              </TerminalLine>
            </>
          )}
        </div>
      </div>

      {/* The card it produces, overlapping the terminal like it just landed */}
      <div className="relative -mt-8 ml-4 sm:ml-10">
        <NotificationCard
          notification={n}
          onAction={answerWith}
          className="shadow-[0_24px_48px_-24px_rgba(28,27,25,0.35)] ring-zinc-200 transition-colors dark:shadow-black/60"
        />
        <div
          className={cx(
            "absolute -bottom-4 left-5 inline-flex items-center gap-1.5 rounded-full bg-chip px-3 py-1.5 text-[12px] font-semibold text-chip-foreground shadow-sm transition-all duration-300",
            answer ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1 opacity-0",
          )}
        >
          <CheckIcon size={12} /> {answer?.label ?? "Drop it"} · {answer?.device ?? "Pixel 9"}
        </div>
      </div>

      {/* A lock-screen style banner while the question is open */}
      <div
        className={cx(
          "absolute -top-6 -right-4 hidden w-64 items-start gap-2.5 rounded-2xl bg-white/90 p-3 text-[#1d1d1f] shadow-xl ring-1 ring-black/5 backdrop-blur transition-all duration-500 ease-[var(--ease-emphasized)] lg:flex xl:-right-12 dark:bg-[#323232]/90 dark:text-white dark:ring-white/10",
          stage === "ask" ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0",
        )}
        aria-hidden
      >
        <BrandMark className="size-8 rounded-[9px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[12.5px] font-semibold">claude-code</span>
            <span className="text-[10.5px] text-black/45 dark:text-white/45">now</span>
          </div>
          <div className="text-[12px] leading-snug text-black/70 dark:text-white/75">Migration done. Drop the old table?</div>
        </div>
      </div>
    </div>
  );
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function Section({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx("mx-auto w-full max-w-6xl scroll-mt-20 px-5 sm:px-8", className)}>
      {children}
    </section>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-semibold tracking-wide text-brand uppercase">{children}</p>;
}

function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-[32px] leading-[1.1] font-extrabold tracking-[-0.03em] text-balance sm:text-[42px]">{title}</h2>
      {children && <p className="mt-4 text-[16px] leading-relaxed text-pretty text-zinc-500 sm:text-[17px] dark:text-zinc-400">{children}</p>}
    </div>
  );
}

/** A peach highlighter stroke behind the lower part of a phrase; the text stays ink. */
function Marker({ children }: { children: ReactNode }) {
  return (
    <span className="relative isolate whitespace-nowrap">
      <span aria-hidden className="absolute inset-x-[-0.08em] bottom-[0.06em] -z-10 h-[0.4em] rounded-[0.1em] bg-chip" />
      {children}
    </span>
  );
}

function Tile({
  title,
  children,
  visual,
  className,
}: {
  title: string;
  children: ReactNode;
  visual?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col overflow-hidden rounded-[22px] bg-background p-6 sm:p-7", className)}>
      <h3 className="text-[19px] font-bold tracking-[-0.02em]">{title}</h3>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{children}</p>
      {visual && <div className="mt-6 flex flex-1 flex-col justify-end">{visual}</div>}
    </div>
  );
}

// ─── Integrations ─────────────────────────────────────────────────────────────

const INTEGRATIONS: { icon: BrandIconName; name: string; how: string }[] = [
  { icon: "claude", name: "Claude Code", how: "MCP server, one command" },
  { icon: "cursor", name: "Cursor", how: "MCP server" },
  { icon: "mcp", name: "Any MCP client", how: "Send, ask, wait for answers" },
  { icon: "homeassistant", name: "Home Assistant", how: "REST notify platform" },
  { icon: "prometheus", name: "Alertmanager", how: "Webhook, understood natively" },
  { icon: "grafana", name: "Grafana", how: "Contact point, understood natively" },
  { icon: "githubactions", name: "GitHub Actions", how: "One curl step" },
  { icon: "n8n", name: "n8n", how: "HTTP Request node" },
  { icon: "nodered", name: "Node-RED", how: "HTTP request node" },
  { icon: "curl", name: "curl & scripts", how: "Plain text, JSON or headers" },
];

function Integrations() {
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {INTEGRATIONS.map((i) => {
        const { hex } = BRAND_ICONS[i.icon];
        return (
          <li
            key={i.name}
            className="group flex flex-col rounded-[20px] bg-background p-4 transition-[translate,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-20px_rgba(28,27,25,0.35)] sm:flex-row sm:items-center sm:gap-4 sm:p-5 lg:flex-col lg:items-start lg:gap-0"
          >
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-zinc-100 dark:bg-zinc-800"
              style={isInk(hex) ? undefined : { backgroundColor: `color-mix(in oklab, ${hex} 13%, transparent)` }}
            >
              <BrandIcon name={i.icon} size={22} />
            </span>
            <span className="mt-4 flex min-w-0 flex-col sm:mt-0 lg:mt-4">
              <span className="text-[15px] font-bold tracking-[-0.01em]">{i.name}</span>
              <span className="mt-0.5 text-[13px] leading-snug text-zinc-500 dark:text-zinc-400">{i.how}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Feature visuals ──────────────────────────────────────────────────────────

/** A progress bar that keeps filling and restarting, for the "updated in place" tile. */
function LoopingProgress() {
  const [v, setV] = useState(18);
  useEffect(() => {
    const t = setInterval(() => setV((x) => (x >= 100 ? 6 : Math.min(100, x + 7))), 700);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="rounded-[18px] bg-zinc-50 p-4 dark:bg-zinc-800/60">
      <div className="flex items-center gap-2">
        <SeverityBadge severity={v >= 100 ? "success" : "info"} />
        <span className="text-[12px] text-zinc-500 tabular-nums">v{Math.round(v / 7) + 1}</span>
      </div>
      <div className="mt-2 text-[15px] font-bold tracking-[-0.01em]">{v >= 100 ? "Export finished" : "Encoding 4K export"}</div>
      <ProgressBar className="mt-3" progress={{ value: v, max: 100, label: `${v}%` }} />
    </div>
  );
}

function ButtonsVisual() {
  return (
    <div className="space-y-2.5">
      <div className="rounded-[18px] rounded-bl-md bg-zinc-50 p-4 dark:bg-zinc-800/60">
        <div className="text-[14.5px] font-bold tracking-[-0.01em]">Deploy api@4f2c1a to prod?</div>
        <div className="mt-3 flex gap-2">
          <span className={buttonClasses("primary", "sm", "pointer-events-none")}>
            <CheckIcon size={13} /> Ship it
          </span>
          <span className={buttonClasses("secondary", "sm", "pointer-events-none bg-zinc-200/70 dark:bg-zinc-700")}>Not now</span>
        </div>
      </div>
      <div className="ml-auto w-fit rounded-[18px] rounded-br-md bg-chip px-3.5 py-2 text-[13px] font-medium text-chip-foreground">
        Ship it · Galaxy S23
      </div>
    </div>
  );
}

function ReplyVisual() {
  return (
    <div className="space-y-2.5">
      <div className="w-fit max-w-[85%] rounded-[18px] rounded-bl-md bg-zinc-50 px-3.5 py-2.5 text-[13.5px] dark:bg-zinc-800/60">
        Tests need a database. Which one should I use?
      </div>
      <div className="flex items-center gap-2 rounded-full bg-zinc-50 py-1.5 pr-1.5 pl-4 dark:bg-zinc-800/60">
        <span className="flex-1 text-[13.5px] text-foreground">
          The staging one, read-only
          <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse bg-foreground" />
        </span>
        <span className="flex size-8 items-center justify-center rounded-full bg-brand text-brand-foreground">
          <SendIcon size={14} />
        </span>
      </div>
    </div>
  );
}

function SeverityVisual() {
  return (
    <div className="flex flex-wrap gap-2">
      <SeverityBadge severity="critical" />
      <SeverityBadge severity="warning" />
      <SeverityBadge severity="success" />
      <SeverityBadge severity="info" />
      <SeverityBadge severity="debug" />
    </div>
  );
}

function WebhookVisual() {
  const rows = [
    { from: "Alertmanager", to: "[FIRING:2] DiskFull", sev: "critical" as const },
    { from: "GitHub Actions", to: "deploy: success", sev: "success" as const },
    { from: "Home Assistant", to: "The washer is done 🧺", sev: "info" as const },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.from} className="flex items-center gap-3 rounded-2xl bg-zinc-50 px-3 py-2.5 dark:bg-zinc-800/60">
          <span className="relative">
            <Avatar name={r.from} size={30} />
            <span
              className={cx(
                "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-zinc-50 dark:ring-zinc-800",
                r.sev === "critical" ? "bg-red-500" : r.sev === "success" ? "bg-green-500" : "bg-blue-500",
              )}
            />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-zinc-500">{r.from}</div>
            <div className="truncate text-[13.5px] font-semibold">{r.to}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Platforms ────────────────────────────────────────────────────────────────

const PLATFORM_CARD = demoCard(
  {
    source: "home-assistant",
    threadId: null,
    title: "Front door unlocked for 10 min",
    body: "Nobody is home. Lock it?",
    severity: "warning",
    actions: [
      { id: "lock", label: "Lock it", style: "primary", resolves: true },
      { id: "ignore", label: "Ignore", style: "default", resolves: true },
    ],
  },
  "2026-10-29T08:00:00.000Z",
);

function PlatformColumn({
  icon: Icon,
  name,
  meta,
  preview,
  action,
  className,
}: {
  icon: ComponentType<IconProps>;
  name: string;
  meta: string;
  preview: ReactNode;
  action: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col rounded-[22px] bg-background p-5 sm:p-6", className)}>
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-zinc-100 text-secondary-label dark:bg-zinc-800">
          <Icon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-bold tracking-[-0.01em]">{name}</div>
          <div className="text-[13px] text-zinc-500 dark:text-zinc-400">{meta}</div>
        </div>
      </div>
      <div className="landing-dots my-5 flex flex-1 items-center rounded-2xl bg-zinc-100 p-3 sm:p-4 dark:bg-zinc-900 [&_p]:hidden">
        <div className="mx-auto w-full max-w-sm">{preview}</div>
      </div>
      {action}
    </div>
  );
}

function Platforms() {
  const latest = useLatestRelease(true).data;
  const version = latest ? ` · v${latest.version}` : "";
  const download = (href: string | undefined, label: string) => (
    <a
      href={href ?? LATEST}
      target={href ? undefined : "_blank"}
      rel="noreferrer"
      className={buttonClasses("secondary", "md", "w-full")}
    >
      <DownloadIcon size={15} />
      {label}
    </a>
  );
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <PlatformColumn
        icon={SmartphoneIcon}
        name="Android"
        meta={`Native app, FCM push${version}`}
        preview={<AndroidPreview n={PLATFORM_CARD} />}
        action={download(latest?.apk, "Download APK")}
      />
      <PlatformColumn
        icon={LaptopIcon}
        name="macOS"
        meta={`Menu-bar app, updates itself${version}`}
        preview={<ApplePreview n={PLATFORM_CARD} platform="macos" />}
        action={download(latest?.mac, "Download for Mac")}
      />
      <PlatformColumn
        icon={GlobeIcon}
        className="sm:col-span-2 lg:col-span-1"
        name="Web"
        meta="Push in any modern browser"
        preview={<WebPushPreview n={PLATFORM_CARD} />}
        action={<SignInButton size="md" label="Open the web app" className="w-full" />}
      />
    </div>
  );
}

// ─── Setup snippets ───────────────────────────────────────────────────────────

type SnippetTab = "mcp" | "curl" | "home-assistant" | "alertmanager" | "github-actions";

function Setup() {
  const [tab, setTab] = useState<SnippetTab>("mcp");
  const origin = typeof window !== "undefined" ? window.location.origin : "https://oyee.app";
  const hooks = webhookSnippets(`${origin}/hook/oyee_your_token`);
  const byId = (id: string) => hooks.find((s) => s.id === id)!;
  const snippets: Record<SnippetTab, { label: string; note: string; code: string }> = {
    mcp: {
      label: "Claude Code",
      note: "Add Oyee as an MCP server. Your agent gets send, update, ask and wait_for_response.",
      code: `${mcpSnippets(`${origin}/mcp/oyee_your_token`)[0]!.code}\n\n# then just say:\n# "Ping my phone when the tests pass, and ask before you push."`,
    },
    curl: { label: "curl", note: byId("curl-text").description ?? "", code: byId("curl-text").code },
    "home-assistant": { label: "Home Assistant", note: byId("home-assistant").description ?? "", code: byId("home-assistant").code },
    alertmanager: { label: "Alertmanager", note: byId("alertmanager").description ?? "", code: byId("alertmanager").code },
    "github-actions": { label: "GitHub Actions", note: byId("github-actions").description ?? "", code: byId("github-actions").code },
  };
  const s = snippets[tab];

  return (
    <div className="overflow-hidden rounded-[22px] bg-background">
      <div className="overflow-x-auto px-5 pt-5 sm:px-6">
        <div className="w-max whitespace-nowrap">
          <Segmented<SnippetTab>
            value={tab}
            onChange={setTab}
            options={(Object.keys(snippets) as SnippetTab[]).map((k) => ({ value: k, label: snippets[k].label }))}
          />
        </div>
      </div>
      <p className="px-5 pt-4 text-[14px] text-zinc-500 sm:px-6 dark:text-zinc-400">{s.note}</p>
      <div className="relative m-3 mt-4 rounded-[18px] bg-[#1c1b19] dark:bg-[#0c0b0a]">
        <CopyButton
          text={s.code}
          compact
          className="absolute top-2.5 right-2.5 text-white/50 hover:bg-white/10 hover:text-white dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
        />
        <pre className="min-h-[220px] overflow-x-auto p-5 pr-12 font-mono text-[12.5px] leading-relaxed text-[#f1ede6]">
          <code>{s.code}</code>
        </pre>
      </div>
    </div>
  );
}

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
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get("redirect"));
  return (
    <header
      className={cx(
        "sticky top-0 z-30 transition-[background-color,box-shadow] duration-200",
        scrolled && "bg-ground/80 shadow-[0_1px_0_var(--color-zinc-200)] backdrop-blur-xl dark:shadow-[0_1px_0_var(--color-zinc-800)]",
      )}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-5 sm:px-8">
        <a href="#top" className="mr-auto inline-flex items-center gap-2 text-[18px] font-extrabold tracking-[-0.03em]">
          <BrandMark className="size-8 rounded-[10px]" />
          Oyee
        </a>
        <div className="hidden items-center gap-1 text-[14px] font-medium text-secondary-label md:flex">
          <a href="#features" className="rounded-full px-3 py-2 hover:text-foreground">Features</a>
          <a href="#platforms" className="rounded-full px-3 py-2 hover:text-foreground">Apps</a>
          <a href="#setup" className="rounded-full px-3 py-2 hover:text-foreground">Setup</a>
          <a href={`${REPO}/blob/main/docs/protocol.md`} target="_blank" rel="noreferrer" className="rounded-full px-3 py-2 hover:text-foreground">
            Docs
          </a>
        </div>
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
          <a href={`/auth/google/login?redirect=${encodeURIComponent(redirect)}`} className={buttonClasses("primary", "md", "ml-1")}>
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
    document.title = "Oyee: notifications that talk back";
    return () => {
      document.title = "Oyee";
    };
  }, []);

  return (
    <div id="top" className="landing min-h-dvh overflow-x-clip">
      <Nav />

      {/* Hero */}
      <Section className="grid grid-cols-1 items-center gap-14 pt-10 pb-12 sm:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-10 lg:pt-16 lg:pb-16">
        <div className="rise-in">
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-background py-1 pr-3.5 pl-1 text-[13px] font-medium text-secondary-label transition-colors hover:text-foreground"
          >
            <span className="rounded-full bg-chip px-2 py-0.5 text-[11.5px] font-bold text-chip-foreground">MIT</span>
            Free and open source, no paid tier
          </a>
          <h1 className="mt-8 text-[44px] leading-[1.06] font-extrabold tracking-[-0.035em] sm:text-[58px] lg:text-[64px]">
            Notifications
            <br />
            that <Marker>talk back.</Marker>
          </h1>
          <p className="mt-7 max-w-[34rem] text-[17px] leading-relaxed text-pretty text-zinc-500 sm:text-[18px] dark:text-zinc-400">
            One inbox for your AI agents, webhooks and scripts. Send live cards with progress, buttons and replies to your
            phone, Mac and browser. Update them in place, or wait for an answer.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <SignInButton />
            <a href="#setup" className={buttonClasses("ghost", "lg", "bg-background! text-foreground hover:opacity-80")}>
              <CodeIcon size={16} />
              See the setup
            </a>
          </div>
          <SignInExtras />
        </div>
        <div className="rise-in [animation-delay:120ms] lg:pl-6">
          <HeroDemo />
        </div>
      </Section>

      {/* Integrations */}
      <Section className="pb-28">
        <p className="mb-6 text-center text-[13px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          Plugs into what you already run
        </p>
        <Integrations />
      </Section>

      {/* Features */}
      <Section id="features" className="pb-28">
        <SectionTitle eyebrow="Features" title={<>A ping is a dead end. A card is a conversation.</>}>
          Push services stop at "something happened". Oyee cards keep going: they update, ask, take answers and close themselves when
          the job is done.
        </SectionTitle>
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
          <Tile className="lg:col-span-3" title="Updated in place" visual={<LoopingProgress />}>
            Send once, then patch progress, fields and status. Every device redraws the same card instead of stacking twelve.
          </Tile>
          <Tile className="lg:col-span-3" title="Buttons that call back" visual={<ButtonsVisual />}>
            Agents call <code className="font-mono text-[13px]">ask</code> and{" "}
            <code className="font-mono text-[13px]">wait_for_response</code>. You tap on your lock screen; the agent carries on.
          </Tile>
          <Tile className="lg:col-span-2" title="Answer in words" visual={<ReplyVisual />}>
            Add a reply box and type the answer from your notification shade.
          </Tile>
          <Tile className="lg:col-span-2" title="Webhooks, understood" visual={<WebhookVisual />}>
            Alertmanager, Grafana and AWS SNS work as-is. Anything else: JSON, plain text or ntfy-style headers.
          </Tile>
          <Tile className="md:col-span-2 lg:col-span-2" title="Loud when it matters" visual={<SeverityVisual />}>
            Critical alerts stay until dismissed, debug stays silent, and threads group a deploy into one conversation.
          </Tile>
        </div>
      </Section>

      {/* Platforms */}
      <Section id="platforms" className="pb-28">
        <SectionTitle eyebrow="Apps" title="On every screen you look at.">
          Native apps on Android and macOS, push in the browser, and one shared inbox. Answer on whichever is closest; the rest
          catch up instantly.
        </SectionTitle>
        <div className="mt-12">
          <Platforms />
        </div>
      </Section>

      {/* Setup */}
      <Section id="setup" className="grid grid-cols-1 gap-10 pb-28 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start">
        <div className="lg:sticky lg:top-24">
          <SectionTitle eyebrow="Setup" title="One line to hook it up.">
            Sign in, create a token, paste it. Your agent gets MCP tools; everything else gets a webhook URL.
          </SectionTitle>
          <ol className="mt-8 space-y-4">
            {[
              ["Sign in with Google", "No forms, no credit card."],
              ["Create a token", "One per agent or service, revocable any time."],
              ["Pair your devices", "Scan a QR code with the Android or Mac app."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-[13px] font-bold text-background">
                  {i + 1}
                </span>
                <div>
                  <div className="text-[15px] font-semibold">{t}</div>
                  <div className="text-[14px] text-zinc-500 dark:text-zinc-400">{d}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <Setup />
      </Section>

      {/* Open source */}
      <Section className="pb-28">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { icon: <CodeIcon size={19} />, title: "MIT licensed", text: "Every line of the server, web app and native apps is on GitHub." },
            { icon: <LayersIcon size={19} />, title: "Self-host it", text: "One Cloudflare Worker with a Durable Object per user. Bring it up in an afternoon." },
            { icon: <OyeeMark className="size-[19px]" />, title: "No business model", text: "No ads, no tracking, no paid tier. Generous daily limits keep it fair." },
          ].map((f) => (
            <div key={f.title} className="rounded-[22px] bg-background p-6">
              <span className="flex size-10 items-center justify-center rounded-xl bg-chip text-chip-foreground">
                {f.icon}
              </span>
              <div className="mt-4 text-[17px] font-bold tracking-[-0.01em]">{f.title}</div>
              <p className="mt-1 text-[14.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{f.text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Final call to action */}
      <Section className="pb-16">
        <div className="relative overflow-hidden rounded-[28px] bg-foreground px-6 py-16 text-center text-background sm:px-12 sm:py-20">
          <OyeeMark className="pointer-events-none absolute -top-10 -right-10 size-64 text-background/[0.06]" />
          <OyeeMark className="pointer-events-none absolute -bottom-16 -left-12 size-56 -scale-x-100 text-background/[0.05]" />
          <h2 className="relative mx-auto max-w-2xl text-[36px] leading-[1.02] font-extrabold tracking-[-0.045em] text-balance sm:text-[54px]">
            Stop tailing logs. Let them tap you on the shoulder.
          </h2>
          <p className="relative mx-auto mt-5 max-w-lg text-[16px] text-background/60 sm:text-[17px]">
            Free forever. Takes a minute to set up.
          </p>
          <div className="relative mt-9 flex flex-wrap justify-center gap-3">
            <SignInButton />
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className={buttonClasses("ghost", "lg", "bg-background/12! text-background! hover:bg-background/20!")}
            >
              <GitHubIcon />
              Star on GitHub
            </a>
          </div>
        </div>
      </Section>

      <footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 pb-10 text-[13px] text-zinc-500 sm:flex-row sm:px-8 dark:text-zinc-400">
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
