import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ServerMessage } from "@herald/schema";
import { LiveConnection, type LiveState } from "../lib/live";
import { formatCountdown } from "../lib/format";
import { cx } from "./ui";

const LiveCtx = createContext<LiveConnection | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [conn] = useState(() => new LiveConnection(qc));
  useEffect(() => {
    conn.start();
    return () => conn.stop();
  }, [conn]);
  return <LiveCtx.Provider value={conn}>{children}</LiveCtx.Provider>;
}

function useConn(): LiveConnection {
  const c = useContext(LiveCtx);
  if (!c) throw new Error("useLive* must be used inside <LiveProvider>");
  return c;
}

export function useLiveState(): LiveState {
  const c = useConn();
  return useSyncExternalStore(c.subscribeState, c.getState);
}

/** Subscribe to raw server messages (e.g. to toast new notifications). */
export function useLiveMessages(fn: (msg: ServerMessage) => void): void {
  const c = useConn();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => c.onMessage((m) => ref.current(m)), [c]);
}

export function useReconnect(): () => void {
  const c = useConn();
  return () => c.reconnectNow();
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** Dot + label showing the live connection; click to reconnect immediately. */
export function ConnectionIndicator({ compact }: { compact?: boolean }) {
  const state = useLiveState();
  const reconnect = useReconnect();
  const now = useNow(state.status === "reconnecting" && !!state.retryAt);
  const { dot, label } = (() => {
    switch (state.status) {
      case "open":
        return { dot: "bg-emerald-500", label: "Live" };
      case "connecting":
        return { dot: "bg-amber-400 animate-pulse", label: "Connecting…" };
      case "reconnecting":
        return {
          dot: "bg-amber-500 animate-pulse",
          label: state.retryAt && state.retryAt > now ? `Reconnecting in ${formatCountdown(state.retryAt - now)}` : "Reconnecting…",
        };
      case "offline":
        return { dot: "bg-red-500", label: "Offline" };
      default:
        return { dot: "bg-zinc-400", label: "Disconnected" };
    }
  })();
  return (
    <button
      type="button"
      onClick={state.status === "open" ? undefined : reconnect}
      title={state.status === "open" ? "Receiving live updates" : "Click to reconnect now"}
      className={cx(
        "inline-flex items-center gap-2 rounded-full text-xs text-zinc-500 dark:text-zinc-400",
        compact ? "p-1.5" : "px-2 py-1",
        state.status !== "open" && "hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200",
      )}
      aria-live="polite"
    >
      <span className="relative flex size-2">
        {state.status === "open" && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-50" />}
        <span className={cx("relative inline-flex size-2 rounded-full", dot)} />
      </span>
      {!compact && <span className="tabular-nums">{label}</span>}
    </button>
  );
}
