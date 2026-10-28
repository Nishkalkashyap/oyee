import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { User } from "@herald/schema";
import { api } from "../lib/api";
import { isMockMode } from "../lib/env";
import { useUnreadCount } from "../lib/queries";
import { useTheme, type ThemePref } from "../lib/theme";
import {
  BellIcon,
  DevicesIcon,
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
import { Avatar, cx } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<IconProps>;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "Connect", icon: PlugIcon, end: true },
  { to: "/inbox", label: "Inbox", icon: InboxIcon },
  { to: "/devices", label: "Devices", icon: DevicesIcon },
  { to: "/templates", label: "Templates", icon: TemplateIcon },
  { to: "/send", label: "Send", icon: SendIcon },
];

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span className="inline-flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
        <BellIcon size={15} strokeWidth={2.4} />
      </span>
      Herald
    </span>
  );
}

function UnreadBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cx(
        "inline-flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] leading-5 font-semibold text-white tabular-nums",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function UserMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();

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
        className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/70"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={user.name ?? user.email} src={user.avatarUrl} />
        <span className="hidden min-w-0 flex-1 md:block">
          <span className="block truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">{user.name ?? user.email}</span>
          {user.name && <span className="block truncate text-[11px] text-zinc-500">{user.email}</span>}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 bottom-auto z-40 mt-2 w-60 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl md:right-auto md:bottom-full md:left-0 md:mt-0 md:mb-2 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="px-2.5 py-2">
            <div className="truncate text-sm font-medium">{user.name ?? "Signed in"}</div>
            <div className="truncate text-xs text-zinc-500">{user.email}</div>
          </div>
          <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
          <div className="px-2.5 py-1.5">
            <div className="mb-1.5 text-[11px] font-medium text-zinc-500">Theme</div>
            <div className="grid grid-cols-3 gap-1">
              {themes.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTheme(t.value)}
                  className={cx(
                    "flex flex-col items-center gap-1 rounded-md py-1.5 text-[11px]",
                    theme === t.value
                      ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                      : "text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50",
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
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <LogOutIcon size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
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
    document.title = unread > 0 ? `(${unread}) Herald` : "Herald";
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
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Sidebar (md+) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50/70 px-3 py-4 md:flex dark:border-zinc-800/80 dark:bg-zinc-950">
        <div className="px-2 pb-5">
          <Logo />
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-white font-medium text-zinc-900 shadow-xs ring-1 ring-zinc-200 dark:bg-zinc-800/80 dark:text-white dark:ring-zinc-700/50"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/50 dark:hover:text-zinc-100",
                )
              }
            >
              <item.icon size={16} />
              <span className="flex-1">{item.label}</span>
              {item.to === "/inbox" && <UnreadBadge count={unread} />}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2">
          {mock && (
            <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              Mock mode: demo data, no backend. <a className="underline" href="?mock=0">Exit</a>
            </div>
          )}
          <ConnectionIndicator />
          <UserMenu user={user} />
        </div>
      </aside>

      {/* Top bar (mobile) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-200 bg-white/85 px-4 py-2.5 backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-950/85">
        <Logo />
        <div className="flex items-center gap-1">
          <ConnectionIndicator compact />
          <UserMenu user={user} />
        </div>
      </header>
      {mock && (
        <div className="bg-amber-50 px-4 py-1.5 text-center text-[11px] text-amber-800 md:hidden dark:bg-amber-500/10 dark:text-amber-300">
          Mock mode: demo data. <a className="underline" href="?mock=0">Exit</a>
        </div>
      )}

      <main className="min-w-0 flex-1 pb-16 md:pb-0">
        <Outlet />
      </main>

      {/* Bottom tabs (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-zinc-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-950/90">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cx(
                "relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
                isActive ? "text-zinc-900 dark:text-white" : "text-zinc-500",
              )
            }
          >
            <item.icon size={19} />
            {item.label}
            {item.to === "/inbox" && <UnreadBadge count={unread} className="absolute top-1 left-1/2 ml-1.5" />}
          </NavLink>
        ))}
      </nav>
      <LiveSideEffects />
    </div>
  );
}

export function PageContainer({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={cx("mx-auto w-full px-4 py-6 sm:px-6 lg:py-10", wide ? "max-w-6xl" : "max-w-4xl")}>{children}</div>;
}
