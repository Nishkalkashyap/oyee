import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Usage, User } from "@oyee/schema";
import { api } from "../lib/api";
import { isMockMode } from "../lib/env";
import { useUnreadCount, useUsage } from "../lib/queries";
import { useTheme, type ThemePref } from "../lib/theme";
import { HelpDialog } from "./HelpDialog";
import {
  DevicesIcon,
  HelpIcon,
  InboxIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PlugIcon,
  SendIcon,
  SunIcon,
  TemplateIcon,
  type IconProps,
} from "./Icons";
import { ConnectionIndicator, useLiveMessages } from "./LiveProvider";
import { useToast } from "./Toast";
import { Avatar, BrandMark, CountBadge, cx } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<IconProps>;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/inbox", label: "Inbox", icon: InboxIcon },
  { to: "/", label: "Connect", icon: PlugIcon, end: true },
  { to: "/devices", label: "Devices", icon: DevicesIcon },
  { to: "/templates", label: "Templates", icon: TemplateIcon },
  { to: "/send", label: "Send", icon: SendIcon },
];

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 text-[17px] font-bold tracking-[-0.02em]", className)}>
      <BrandMark />
      Oyee
    </span>
  );
}

/** Quotas shown in the account menu (reads and pairing codes are rarely close to their limits). */
const SHOWN_QUOTAS = new Set(["send", "update", "respond"]);

function UsageMeter({ usage }: { usage: Usage }) {
  const hours = Math.max(1, Math.round((Date.parse(usage.resetsAt) - Date.now()) / 3_600_000));
  return (
    <div className="px-2.5 py-1.5">
      <div className="mb-1.5 flex items-baseline justify-between text-[11px] font-medium text-zinc-500">
        <span>Today</span>
        <span className="font-normal">Resets in {hours}h</span>
      </div>
      <div className="flex flex-col gap-2">
        {usage.items
          .filter((i) => SHOWN_QUOTAS.has(i.kind))
          .map((i) => {
            const pct = Math.min(100, (i.used / i.limit) * 100);
            return (
              <div key={i.kind}>
                <div className="flex justify-between text-xs">
                  <span className="text-secondary-label">{i.label}</span>
                  <span className="tabular-nums">
                    {i.used.toLocaleString()} <span className="text-zinc-400">/ {i.limit.toLocaleString()}</span>
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className={cx("h-full rounded-full", pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-brand")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

function UserMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const usage = useUsage(open).data;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const logout = async () => {
    try {
      await api.logout();
    } catch {
      /* clear locally anyway */
    }
    qc.clear();
    navigate("/login", { replace: true });
  };

  const themes: { value: ThemePref; icon: ComponentType<IconProps>; label: string }[] = [
    { value: "light", icon: SunIcon, label: "Light" },
    { value: "dark", icon: MoonIcon, label: "Dark" },
    { value: "system", icon: MonitorIcon, label: "System" },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center rounded-full transition-[scale] active:scale-95"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
      >
        <Avatar name={user.name ?? user.email} src={user.avatarUrl} size={36} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-64 rounded-2xl bg-background p-1.5 shadow-xl ring-1 ring-black/5 md:right-auto md:bottom-0 md:left-full md:mt-0 md:ml-2 dark:ring-white/10"
        >
          <div className="px-2.5 py-2">
            <div className="truncate text-sm font-medium">{user.name ?? "Signed in"}</div>
            <div className="truncate text-xs text-zinc-500">{user.email}</div>
          </div>
          <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
          {usage && (
            <>
              <UsageMeter usage={usage} />
              <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
            </>
          )}
          <div className="px-2.5 py-1.5">
            <div className="mb-1.5 text-[11px] font-medium text-zinc-500">Theme</div>
            <div className="grid grid-cols-3 gap-1">
              {themes.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTheme(t.value)}
                  className={cx(
                    "flex flex-col items-center gap-1 rounded-xl py-1.5 text-[11px]",
                    theme === t.value
                      ? "bg-chip font-semibold text-chip-foreground"
                      : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  )}
                >
                  <t.icon size={14} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-secondary-label hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <LogOutIcon size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Help button: downloads for every platform, docs and support links. */
function HelpButton({ rail }: { rail?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Help and downloads"
        title="Help and downloads"
        className={cx(
          "flex items-center justify-center text-secondary-label transition-[background-color,scale] duration-150 active:scale-95",
          rail ? "size-[54px] flex-col gap-0.5 rounded-2xl text-[11px] font-medium hover:bg-foreground/5" : "size-9 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800",
        )}
      >
        <HelpIcon size={20} />
        {rail && "Help"}
      </button>
      <HelpDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Toasts for notifications created while the tab is open, + routes requested by the service worker. */
function LiveSideEffects() {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const unread = useUnreadCount();

  useLiveMessages((msg) => {
    if (msg.type !== "notification.created") return;
    const n = msg.notification;
    // Skip when already looking at it, when silent, or on the composer (which shows its own "sent" toast).
    if (location.pathname === `/inbox/${n.id}` || location.pathname === "/send" || n.silent) return;
    toast.show({ kind: "info", title: n.title, description: n.source, onClick: () => navigate(`/inbox/${n.id}`) });
  });

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) Oyee` : "Oyee";
  }, [unread]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | null;
      if (data?.type === "navigate" && data.url?.startsWith("/")) navigate(data.url);
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [navigate]);

  return null;
}

export function Layout({ user }: { user: User }) {
  const unread = useUnreadCount();
  const mock = isMockMode();

  return (
    <div className="flex h-dvh flex-col md:flex-row md:py-2 md:pr-2">
      {/* Rail (md+): Gluon's 76px rail; the active section sits on a white tile. */}
      <nav aria-label="Sections" className="hidden w-[76px] shrink-0 flex-col items-center gap-1.5 py-2 md:flex">
        <BrandMark className="mb-3.5 size-10 rounded-xl text-xl" />
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cx(
                "relative flex size-[54px] flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] transition-[background-color,scale] duration-150 active:scale-95",
                isActive
                  ? "bg-background font-semibold text-foreground shadow-sm"
                  : "font-medium text-secondary-label hover:bg-foreground/5",
              )
            }
          >
            <item.icon size={20} />
            {item.label}
            {item.to === "/inbox" && <CountBadge count={unread} size="sm" className="absolute top-1 right-1" />}
          </NavLink>
        ))}
        <div className="mt-auto flex flex-col items-center gap-3">
          <ConnectionIndicator compact />
          <HelpButton rail />
          <UserMenu user={user} />
        </div>
      </nav>

      {/* Top bar (mobile) */}
      <header className="flex items-center justify-between bg-background px-4 pt-3 pb-1 md:hidden">
        <Logo />
        <div className="flex items-center gap-1">
          <ConnectionIndicator compact />
          <HelpButton />
          <UserMenu user={user} />
        </div>
      </header>
      {mock && (
        <div className="bg-amber-500/10 px-4 py-1.5 text-center text-[11px] text-amber-800 md:hidden dark:text-amber-300">
          Mock mode: demo data. <a className="underline" href="?mock=0">Exit</a>
        </div>
      )}

      {/* Content: the white panel with 22px corners on the warm ground. */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background md:rounded-[22px]">
        {mock && (
          <div className="hidden bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-800 md:block dark:text-amber-300">
            Mock mode: demo data, no backend. <a className="underline" href="?mock=0">Exit</a>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>

      {/* Bottom tabs (mobile): a light-blue pill marks the active icon. */}
      <nav className="grid shrink-0 grid-cols-5 border-t border-zinc-200 bg-background pt-2 pb-[max(env(safe-area-inset-bottom),10px)] md:hidden dark:border-zinc-800">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cx(
                "group relative flex flex-col items-center gap-1 text-[11px]",
                isActive ? "font-semibold text-foreground" : "font-medium text-secondary-label",
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cx(
                    "flex h-7.5 w-14 items-center justify-center rounded-full transition-[background-color,scale] duration-150 group-active:scale-90",
                    isActive && "bg-chip text-chip-foreground",
                  )}
                >
                  <item.icon size={20} />
                </span>
                {item.label}
                {item.to === "/inbox" && <CountBadge count={unread} size="sm" className="absolute -top-1 left-1/2 ml-2" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <LiveSideEffects />
    </div>
  );
}

export function PageContainer({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={cx("mx-auto w-full px-4 py-6 sm:px-7 lg:py-8", wide ? "max-w-6xl" : "max-w-4xl")}>{children}</div>;
}
