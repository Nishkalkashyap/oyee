import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { Action, Notification, NotificationStatus, Severity } from "@oyee/schema";
import { ApiError, errorMessage } from "../lib/api";
import { flattenPages, type InboxFilters } from "../lib/cache";
import { relativeTime } from "../lib/format";
import { flatSections, inboxSections, type InboxSection, type InboxStack } from "../lib/inbox";
import { markdownToPlainText } from "../lib/markdown";
import { useDeleteNotification, useMarkAllRead, useMarkRead, useNotification, useNotificationList, useResolve, useRespond, useSources } from "../lib/queries";
import { SEVERITIES, SEVERITY_STYLES } from "../lib/severity";
import {
  CheckCheckIcon,
  CheckIcon,
  TrashIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InboxIcon,
  PlugIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  XIcon,
} from "../components/Icons";
import { NotificationCard, ReplyComposer } from "../components/NotificationCard";
import { AskCard } from "../components/AskCard";
import { showsAsAsk } from "../lib/ask";
import { ProgressBar } from "../components/NotificationParts";
import { useToast } from "../components/Toast";
import { Avatar, Button, EmptyState, ErrorBanner, Spinner, buttonClasses, cx } from "../components/ui";
import { formatDateTime } from "../lib/format";
import { useDevices } from "../lib/queries";

/** The inbox shows active notifications by default; `?status=resolved` and `?status=all` open the other lists. */
function statusFromParam(v: string | null): NotificationStatus | undefined {
  if (v === "resolved") return "resolved";
  if (v === "all") return undefined;
  return "active";
}

type FilterKey = "source" | "severity" | "status" | "q";

function useFilters(): [InboxFilters, (patch: Partial<Record<FilterKey, string | null>>) => void, URLSearchParams] {
  const [params, setParams] = useSearchParams();
  const filters: InboxFilters = {
    source: params.get("source") ?? undefined,
    severity: (SEVERITIES as string[]).includes(params.get("severity") ?? "") ? (params.get("severity") as Severity) : undefined,
    status: statusFromParam(params.get("status")),
    q: params.get("q") ?? undefined,
  };
  const update = (patch: Partial<Record<FilterKey, string | null>>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        next.delete("reply");
        return next;
      },
      { replace: true },
    );
  };
  return [filters, update, params];
}

const isUnread = (n: Notification) => !n.readAt && n.status === "active";

/** Wide screens open the next notification after resolving; phones go back to the list. */
const wideLayout = () => window.matchMedia("(min-width: 1024px)").matches;

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-zinc-300 px-1.5 py-px font-mono text-[10.5px] text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">{children}</kbd>;
}

/** Round icon button for the list header (search, mark all read). */
function HeaderButton({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx(
        "flex size-9 items-center justify-center rounded-full transition-[background-color,scale] duration-150 active:scale-95",
        pressed ? "bg-chip text-chip-foreground" : "bg-zinc-100 text-secondary-label hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Touch only: drag a row right past the threshold to resolve it (the Mail/Gmail gesture). Vertical scrolling is left
 * to the browser; a swipe swallows the click that would otherwise open the row.
 */
function SwipeToResolve({ onResolve, children }: { onResolve?: () => void; children: ReactNode }) {
  const THRESHOLD = 96;
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; swiping: boolean; dx: number } | null>(null);
  const swallowClick = useRef(false);
  if (!onResolve) return <>{children}</>;

  // Only a finished drag resolves; a cancelled one (the browser took over the gesture) just snaps back.
  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    setDx(0);
    if (!d?.swiping) return;
    swallowClick.current = true;
    if (commit && d.dx >= THRESHOLD) onResolve();
  };

  return (
    <div
      className="relative overflow-hidden rounded-2xl touch-pan-y"
      onPointerDown={(e) => {
        if (e.pointerType !== "touch") return;
        swallowClick.current = false;
        drag.current = { x: e.clientX, y: e.clientY, swiping: false, dx: 0 };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const mx = e.clientX - d.x;
        const my = e.clientY - d.y;
        if (!d.swiping) {
          if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
            drag.current = null;
            return;
          }
          if (mx < 12 || mx < Math.abs(my) * 1.5) return;
          d.swiping = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        d.dx = Math.max(0, mx);
        setDx(d.dx);
      }}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
      onClickCapture={(e) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div
        aria-hidden
        className={cx(
          "absolute inset-0 flex items-center gap-2 pl-5 text-[14px] font-semibold text-white transition-colors",
          dx >= THRESHOLD ? "bg-emerald-600" : "bg-emerald-600/60",
          dx === 0 && "invisible",
        )}
      >
        <CheckIcon size={18} /> Resolve
      </div>
      <div
        className="relative bg-background"
        style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? "transform 220ms var(--ease-emphasized)" : "none" }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * A list row: the source's avatar (with a red or amber mark only for critical and warning), title, time and preview.
 * Blue means unread and nothing else. `count` > 1 makes it the head of a stack of repeats.
 */
function InboxRow({
  n,
  count = 1,
  unread = isUnread(n),
  selected,
  href,
  onClick,
  onResolve,
  resolving,
  child,
  below,
}: {
  n: Notification;
  count?: number;
  unread?: boolean;
  selected: boolean;
  href: string;
  onClick?: () => void;
  onResolve?: () => void;
  resolving?: boolean;
  child?: boolean;
  below?: ReactNode;
}) {
  const preview = markdownToPlainText(n.body).replace(/\s+/g, " ").trim();
  const loud = n.severity === "critical" || n.severity === "warning";
  // On hover the resolve button takes the time's place (as Gmail's row actions replace the date).
  const yieldToHover = onResolve ? "pointer-fine:group-hover:invisible" : undefined;
  return (
    <div className={cx("group relative", child && "ml-7")}>
      <SwipeToResolve onResolve={onResolve}>
        <Link
          to={href}
          onClick={onClick}
          className={cx(
            "flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-[background-color,scale] duration-150 active:scale-[0.985]",
            selected ? "bg-row-selected" : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
          )}
          aria-current={selected ? "true" : undefined}
        >
          <span className="relative shrink-0">
            <Avatar name={n.source} size={child ? 34 : 44} />
            {loud && (
              <span
                className={cx("absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-[2.5px] border-background", SEVERITY_STYLES[n.severity].dot)}
                title={SEVERITY_STYLES[n.severity].label}
              />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span
                className={cx(
                  "min-w-0 truncate text-[15px] tracking-[-0.005em]",
                  unread ? "font-semibold text-foreground" : "font-medium text-secondary-label",
                  n.status === "resolved" && !unread && "text-zinc-500 dark:text-zinc-400",
                )}
              >
                {n.title}
              </span>
              {count > 1 && (
                <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 text-[11px] leading-[18px] font-semibold text-zinc-500 tabular-nums dark:bg-zinc-800 dark:text-zinc-400" title={`${count} in this stack`}>
                  {count}
                </span>
              )}
              <time
                className={cx(
                  "ml-auto shrink-0 pl-1 text-xs tabular-nums",
                  unread ? "font-semibold text-brand" : "text-zinc-500 dark:text-zinc-400",
                  yieldToHover,
                )}
                dateTime={n.createdAt}
              >
                {relativeTime(n.createdAt)}
              </time>
            </span>
            <span className="mt-0.5 flex items-center gap-2">
              <span className={cx("min-w-0 flex-1 truncate text-[13.5px]", unread ? "text-secondary-label" : "text-zinc-500 dark:text-zinc-400")}>
                {child ? preview || n.source : `${n.source}${preview ? ` · ${preview}` : ""}`}
              </span>
              {n.intent === "ask" && n.ask.answer && (
                <span className="shrink-0 text-zinc-500" title="Answered">
                  <ReplyIcon size={12} />
                </span>
              )}
              {n.status === "resolved" && <CheckIcon size={13} className="shrink-0 text-emerald-600" aria-label="Resolved" />}
              {unread && <span className={cx("size-2.5 shrink-0 rounded-full bg-brand", yieldToHover)} aria-label="Unread" />}
            </span>
            {n.intent === "progress" && n.status === "active" && (
              <ProgressBar progress={n.progress} severity={n.severity} muted={n.progress.state === "stopped"} compact className="mt-2" />
            )}
          </span>
        </Link>
      </SwipeToResolve>
      {/* Mouse: shows on hover. Touch: swipe instead, but kept for screen readers (visually hidden, not removed). */}
      {onResolve && (
        <button
          type="button"
          onClick={onResolve}
          disabled={resolving}
          aria-label={count > 1 ? `Resolve all ${count}` : "Resolve"}
          title={count > 1 ? `Resolve all ${count}` : "Resolve (E)"}
          className={cx(
            "absolute right-3 flex size-8 items-center justify-center rounded-full bg-foreground text-background opacity-0 shadow-sm transition-[opacity,scale] duration-150 group-hover:opacity-100 focus-visible:opacity-100 active:scale-90 disabled:opacity-60 pointer-coarse:sr-only",
            child ? "top-3" : "top-4",
          )}
        >
          {resolving ? <Spinner size={13} className="text-background" /> : <CheckIcon size={15} />}
        </button>
      )}
      {below}
    </div>
  );
}

/** An open ask's answer buttons right in the list, so answering doesn't need a detour through the conversation. */
function QuickAnswer({ n, href }: { n: Notification; href: string }) {
  const respond = useRespond(n.id);
  const toast = useToast();
  if (n.intent !== "ask" || n.ask.state !== "open") return null;
  return (
    <div className="flex flex-wrap gap-2 pr-3 pb-2 pl-[68px]">
      {n.ask.options.map((option, i) => (
        <Button
          key={option}
          size="sm"
          variant={i === 0 ? "primary" : "secondary"}
          loading={respond.isPending && respond.variables?.option === option}
          disabled={respond.isPending}
          onClick={() =>
            respond.mutate(
              { option },
              {
                onSuccess: () => toast.success(`Sent “${option}”`, n.source),
                onError: (e) => toast.error("Couldn't send answer", errorMessage(e)),
              },
            )
          }
        >
          {option}
        </Button>
      ))}
      {n.ask.allowText && (
        <Link to={`${href}${href.includes("?") ? "&" : "?"}reply=1`} className={buttonClasses("secondary", "sm")}>
          <ReplyIcon size={13} /> Reply
        </Link>
      )}
    </div>
  );
}

function NotificationDetail({
  id,
  search,
  focusReply,
  onFilter,
  onResolve,
  resolving,
}: {
  id: string;
  search: string;
  focusReply: boolean;
  onFilter: (patch: { source?: string }) => void;
  onResolve: (n: Notification) => void;
  resolving: boolean;
}) {
  const q = useNotification(id);
  const markRead = useMarkRead();
  const respond = useRespond(id);
  const del = useDeleteNotification();
  const toast = useToast();
  const navigate = useNavigate();
  const autoRead = useRef<string | null>(null);
  const n = q.data;

  // Opening a notification marks it read (once per id).
  useEffect(() => {
    if (n && !n.readAt && !q.isPlaceholderData && autoRead.current !== n.id) {
      autoRead.current = n.id;
      markRead.mutate(n.id);
    }
  }, [n, q.isPlaceholderData, markRead]);

  if (q.isPending) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }
  if (q.error && !n) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <EmptyState
        icon={<InboxIcon size={20} />}
        title={notFound ? "Notification not found" : "Couldn't load notification"}
        actions={
          <Link to={`/inbox${search}`} className={buttonClasses("secondary")}>
            Back to inbox
          </Link>
        }
      >
        {notFound ? "It may have been deleted or expired." : errorMessage(q.error)}
      </EmptyState>
    );
  }
  if (!n) return null;

  const onAction = (a: Action) => {
    if (a.url) {
      window.open(a.url, "_blank", "noopener,noreferrer");
      return;
    }
    respond.mutate(
      { actionId: a.id },
      {
        onSuccess: () => toast.success(`Sent “${a.label}”`),
        onError: (e) => toast.error("Couldn't send response", errorMessage(e)),
      },
    );
  };
  const resolved = n.status === "resolved";
  // The ask's answer (from any device) and whether it still takes a typed one.
  const answer = n.intent === "ask" ? n.ask.answer : null;
  const takesText = n.intent === "ask" && n.ask.state === "open" && n.ask.allowText;
  const cardFooter = !resolved && (
    <div className="flex items-center gap-3">
      <Button size="sm" variant="primary" icon={<CheckIcon size={14} />} loading={resolving} onClick={() => onResolve(n)}>
        Resolve
      </Button>
      <span className="hidden text-xs text-zinc-400 pointer-fine:inline dark:text-zinc-500">
        or press <Kbd>E</Kbd>
      </span>
    </div>
  );
  const onDelete = () => {
    if (!confirm("Delete this notification on every device?")) return;
    del.mutate(n.id, {
      onSuccess: () => {
        toast.success("Notification deleted");
        navigate(`/inbox${search}`, { replace: true });
      },
      onError: (e) => toast.error("Couldn't delete", errorMessage(e)),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-thread">
      {/* Header: who sent it and where it went. Resolve lives on the card, next to what you just read. */}
      <header className="flex h-[62px] shrink-0 items-center gap-3 border-b border-zinc-200 bg-background px-3 sm:px-4 dark:border-zinc-800">
        <Link to={`/inbox${search}`} className="-ml-1 rounded-full p-1.5 text-secondary-label hover:bg-zinc-100 lg:hidden dark:hover:bg-zinc-800" aria-label="Back to inbox">
          <ChevronLeftIcon size={20} />
        </Link>
        <Avatar name={n.source} size={34} />
        <div className="min-w-0 flex-1">
          <button type="button" className="block max-w-full truncate text-[15px] font-bold hover:underline" onClick={() => onFilter({ source: n.source })}>
            {n.source}
          </button>
          <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            <Recipients ids={n.targetDeviceIds ?? null} />
          </div>
        </div>
        <Button size="sm" variant="ghost" icon={<TrashIcon size={14} />} loading={del.isPending} onClick={onDelete} aria-label="Delete" title="Delete" />
      </header>

      {/* Conversation: the agent's card, quiet updates, your answers as light-blue bubbles. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-2.5 px-3 py-5 sm:px-5">
          <SystemLine>{formatDateTime(n.createdAt)}</SystemLine>
          {showsAsAsk(n) ? (
            <AskCard
              notification={n}
              inThread
              className="mr-6 sm:mr-12"
              onAnswer={(option) =>
                respond.mutate(
                  { option },
                  {
                    onSuccess: () => toast.success(`Sent “${option}”`),
                    onError: (e) => toast.error("Couldn't send answer", errorMessage(e)),
                  },
                )
              }
              pendingOption={respond.isPending ? (respond.variables?.option ?? null) : null}
              footer={cardFooter}
            />
          ) : (
            <NotificationCard
              notification={n}
              inThread
              className="mr-6 sm:mr-12"
              onAction={onAction}
              pendingActionId={respond.isPending && respond.variables?.actionId ? respond.variables.actionId : null}
              footer={cardFooter}
            />
          )}
          {n.version > 1 && n.updatedAt !== n.createdAt && (
            <SystemLine>
              Updated {relativeTime(n.updatedAt)} · v{n.version}
            </SystemLine>
          )}
          {answer && (
            <div className="flex flex-col items-end">
              <div className="ml-12 max-w-[80%] rounded-[22px] rounded-br-md bg-chip px-4 py-2.5 text-[14.5px] break-words whitespace-pre-wrap text-foreground">
                {answer.option && <span className="font-semibold">{answer.option}</span>}
                {answer.option && answer.text && " · "}
                {answer.text}
              </div>
              <span className="mt-1 mr-1 text-xs text-zinc-500 dark:text-zinc-400">
                {answer.deviceName ?? "Unknown device"} · <time title={formatDateTime(answer.at)}>{relativeTime(answer.at)}</time>
              </span>
            </div>
          )}
          {resolved && n.resolvedAt && (
            <SystemLine>
              <CheckIcon size={12} /> Resolved {relativeTime(n.resolvedAt)}
            </SystemLine>
          )}
          <details className="mt-2 self-center text-xs text-zinc-500 dark:text-zinc-400">
            <summary className="cursor-pointer list-none rounded-full px-3 py-1 text-center hover:bg-zinc-200/60 dark:hover:bg-zinc-800">Details</summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-2xl bg-background px-4 py-3">
              <dt>Read</dt>
              <dd>{formatDateTime(n.readAt)}</dd>
              <dt>Key</dt>
              <dd className="font-mono">{n.key ?? "—"}</dd>
              <dt>ID</dt>
              <dd className="font-mono">{n.id}</dd>
            </dl>
          </details>
        </div>
      </div>

      {takesText && (
        <div className="mx-auto w-full max-w-2xl shrink-0 px-3 pb-4 sm:px-5">
          <ReplyComposer
            placeholder={(n.intent === "ask" && n.ask.replyPlaceholder) || `Reply to ${n.source}…`}
            busy={respond.isPending && !!respond.variables?.text}
            focus={focusReply}
            onSend={(text) =>
              respond.mutateAsync({ text }).then(
                () => toast.success("Reply sent"),
                (e: unknown) => {
                  toast.error("Couldn't send reply", errorMessage(e));
                  throw e;
                },
              )
            }
          />
        </div>
      )}
    </div>
  );
}

function SystemLine({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-center gap-1.5 py-1 text-xs text-zinc-500 dark:text-zinc-400">{children}</div>;
}

/** "To Galaxy S23 Ultra, MacBook Pro" or "All devices". */
function Recipients({ ids }: { ids: string[] | null }) {
  const devices = useDevices({ enabled: !!ids });
  if (!ids) return <>All devices</>;
  const names = ids.map((id) => devices.data?.find((d) => d.id === id)?.name ?? "removed device");
  return <>To {names.join(", ")}</>;
}

/** A dismissible pill for a filter set from elsewhere (a source clicked in the conversation, a ?severity link). */
function FilterPill({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-chip pr-1 pl-2.5 text-xs font-semibold text-chip-foreground">
      <span className="truncate">{children}</span>
      <button type="button" aria-label="Clear filter" onClick={onClear} className="rounded-full p-0.5 hover:bg-black/5 dark:hover:bg-white/10">
        <XIcon size={11} />
      </button>
    </span>
  );
}

export function InboxPage() {
  const { id } = useParams();
  const [filters, setFilter, params] = useFilters();
  const navigate = useNavigate();
  const sources = useSources();
  const list = useNotificationList(filters);
  const markAll = useMarkAllRead();
  const resolve = useResolve();
  const toast = useToast();
  const [searchText, setSearchText] = useState(filters.q ?? "");
  const [searchOpen, setSearchOpen] = useState(!!filters.q);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [resolving, setResolving] = useState<Set<string>>(() => new Set());
  const sentinel = useRef<HTMLDivElement>(null);

  const listParams = new URLSearchParams(params);
  listParams.delete("reply");
  const search = listParams.toString() ? `?${listParams.toString()}` : "";
  const items = useMemo(() => flattenPages(list.data), [list.data]);
  const narrowed = !!(filters.source || filters.severity || filters.q);
  const activeView = filters.status === "active";
  // Sections and stacks for the everyday view; a plain list for search results and the resolved archive.
  const sections: InboxSection<Notification>[] = useMemo(
    () => (activeView && !filters.q ? inboxSections(items) : flatSections(items)),
    [activeView, filters.q, items],
  );
  const isExpanded = (s: InboxStack<Notification>) => expanded.has(s.key) || s.items.slice(1).some((n) => n.id === id);
  // Row order on screen, for J/K and "open the next one after resolving".
  const order = sections.flatMap((sec) => sec.stacks.flatMap((s) => (isExpanded(s) ? s.items : s.items.slice(0, 1)))).map((n) => n.id);

  // Debounced search → URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.q ?? "") !== searchText.trim()) setFilter({ q: searchText.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage, items.length]);

  const filterFromDetail = (patch: { source?: string }) => {
    const next = new URLSearchParams(listParams);
    if (patch.source) next.set("source", patch.source);
    navigate(`/inbox?${next.toString()}`);
  };

  const open = (nid: string | undefined) => navigate(nid ? `/inbox/${encodeURIComponent(nid)}${search}` : `/inbox${search}`);

  /** Resolves one row or a whole stack. If the open notification goes, the next one opens (or the list, on phones). */
  const resolveAll = (ns: Notification[]) => {
    const targets = ns.filter((n) => n.status === "active" && !resolving.has(n.id));
    if (!targets.length) return;
    const ids = new Set(targets.map((n) => n.id));
    setResolving((prev) => new Set([...prev, ...ids]));
    if (id && ids.has(id) && activeView) {
      const at = order.indexOf(id);
      const next = [...order.slice(at + 1), ...order.slice(0, Math.max(0, at)).reverse()].find((x) => !ids.has(x));
      open(wideLayout() ? next : undefined);
    }
    void Promise.allSettled(targets.map((n) => resolve.mutateAsync(n.id))).then((results) => {
      setResolving((prev) => new Set([...prev].filter((x) => !ids.has(x))));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) toast.error("Couldn't resolve", errorMessage(failed.reason));
      else toast.success(targets.length > 1 ? `Resolved ${targets.length}` : "Resolved", targets[0]!.title);
    });
  };

  // Keyboard: J / K move through the list, E resolves the open notification.
  const keys = useRef({ order, id, items, resolveAll });
  keys.current = { order, id, items, resolveAll };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']") || document.querySelector("dialog[open]")) return;
      const k = keys.current;
      const key = e.key.toLowerCase();
      if (key === "j" || key === "k") {
        const at = k.id ? k.order.indexOf(k.id) : -1;
        const next = key === "j" ? k.order[at + 1] : k.order[at === -1 ? 0 : at - 1];
        if (next) {
          e.preventDefault();
          open(next);
        }
      } else if (key === "e" && k.id) {
        const n = k.items.find((x) => x.id === k.id);
        if (n?.status === "active") {
          e.preventDefault();
          k.resolveAll([n]);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const sourceItems = sources.data ?? [];
  const unreadInScope = filters.source
    ? (sourceItems.find((s) => s.source === filters.source)?.unread ?? 0)
    : sourceItems.reduce((a, s) => a + s.unread, 0);
  const withStatus = (status: string | null) => {
    const next = new URLSearchParams(listParams);
    if (status) next.set("status", status);
    else next.delete("status");
    const qs = next.toString();
    return `/inbox${qs ? `?${qs}` : ""}`;
  };
  const showSectionTitles = sections.length > 1;

  return (
    <div className="flex h-full min-h-0">
      {/* List pane */}
      <section
        className={cx(
          "min-h-0 w-full shrink-0 flex-col overflow-y-auto border-zinc-200 lg:flex lg:w-[380px] lg:border-r xl:w-[400px] dark:border-zinc-800",
          id ? "hidden" : "flex",
        )}
      >
        <div className="sticky top-0 z-20 space-y-3 bg-background px-4 pt-5 pb-2">
          <div className="flex items-center gap-2">
            {!activeView && (
              <Link to={withStatus(null)} className="-ml-1.5 rounded-full p-1 text-secondary-label hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Back to inbox">
                <ChevronLeftIcon size={22} />
              </Link>
            )}
            <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.035em] md:text-2xl md:font-bold md:tracking-tight">
              {filters.status === "resolved" ? "Resolved" : activeView ? "Inbox" : "Everything"}
            </h1>
            {activeView && unreadInScope > 0 && <span className="text-[13px] font-semibold text-brand">{unreadInScope} unread</span>}
            <div className="ml-auto flex items-center gap-1.5">
              {activeView && unreadInScope > 0 && (
                <HeaderButton
                  label={filters.source ? `Mark all from ${filters.source} read` : "Mark all read"}
                  onClick={() =>
                    markAll.mutate(filters.source, {
                      onSuccess: (r) => toast.success(`Marked ${r.updated} as read`),
                      onError: (e) => toast.error("Couldn't mark all read", errorMessage(e)),
                    })
                  }
                >
                  {markAll.isPending ? <Spinner size={14} /> : <CheckCheckIcon size={16} />}
                </HeaderButton>
              )}
              <HeaderButton
                label="Search"
                pressed={searchOpen}
                onClick={() => {
                  if (searchOpen) {
                    setSearchText("");
                    setFilter({ q: null });
                  }
                  setSearchOpen((o) => !o);
                }}
              >
                <SearchIcon size={16} />
              </HeaderButton>
            </div>
          </div>

          {searchOpen && (
            <input
              type="search"
              autoFocus
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                setSearchText("");
                setFilter({ q: null });
                setSearchOpen(false);
              }}
              placeholder="Search titles, text and rows"
              className="h-10 w-full rounded-full bg-zinc-100 px-4 text-[14px] placeholder:text-zinc-500 focus:bg-background focus:ring-2 focus:ring-brand/30 focus:outline-none dark:bg-zinc-800"
            />
          )}

          {(filters.source || filters.severity) && (
            <div className="flex flex-wrap gap-1.5">
              {filters.source && <FilterPill onClear={() => setFilter({ source: null })}>{filters.source}</FilterPill>}
              {filters.severity && <FilterPill onClear={() => setFilter({ severity: null })}>{SEVERITY_STYLES[filters.severity].label}</FilterPill>}
            </div>
          )}
        </div>

        <div className="flex-1 px-2 pb-4">
          {list.isPending ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : list.error ? (
            <div className="p-4">
              <ErrorBanner onRetry={() => void list.refetch()}>{errorMessage(list.error)}</ErrorBanner>
            </div>
          ) : items.length === 0 ? (
            narrowed ? (
              <EmptyState icon={<SearchIcon size={20} />} title="Nothing matches">
                Try a different search, or clear the filter.
              </EmptyState>
            ) : filters.status === "resolved" ? (
              <EmptyState icon={<CheckIcon size={20} />} title="Nothing resolved yet">
                Notifications you resolve move here, out of your inbox.
              </EmptyState>
            ) : activeView && sourceItems.some((s) => s.count > 0) ? (
              <EmptyState
                icon={<CheckIcon size={20} />}
                title="All caught up"
                actions={
                  <Link to={withStatus("resolved")} className={buttonClasses("secondary")}>
                    View resolved
                  </Link>
                }
              >
                Nothing needs your attention.
              </EmptyState>
            ) : (
              <EmptyState
                icon={<InboxIcon size={20} />}
                title="No notifications yet"
                actions={
                  <>
                    <Link to="/" className={buttonClasses("primary")}>
                      <PlugIcon size={14} /> Connect an agent or webhook
                    </Link>
                    <Link to="/send" className={buttonClasses("secondary")}>
                      <SendIcon size={14} /> Send a test
                    </Link>
                  </>
                }
              >
                Create an MCP server URL or a webhook on the Home page, then send your first notification. It shows up
                here instantly.
              </EmptyState>
            )
          ) : (
            sections.map((sec) => (
              <div key={sec.id} className="pb-1">
                {showSectionTitles && (
                  <h2 className="flex items-center gap-1.5 px-3 pt-3 pb-1 text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">
                    {sec.title}
                    {sec.id === "needs-you" && <span className="text-brand">{sec.stacks.length}</span>}
                  </h2>
                )}
                {sec.stacks.map((s) => {
                  const head = s.items[0]!;
                  const href = `/inbox/${encodeURIComponent(head.id)}${search}`;
                  const canResolve = head.status === "active";
                  const showAll = isExpanded(s);
                  return (
                    <div key={s.key}>
                      <InboxRow
                        n={head}
                        count={s.items.length}
                        unread={s.items.some(isUnread)}
                        selected={head.id === id}
                        href={href}
                        onClick={
                          s.items.length > 1
                            ? () =>
                                setExpanded((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(s.key)) next.delete(s.key);
                                  else next.add(s.key);
                                  return next;
                                })
                            : undefined
                        }
                        onResolve={canResolve ? () => resolveAll(s.items) : undefined}
                        resolving={s.items.some((n) => resolving.has(n.id))}
                        below={sec.id === "needs-you" ? <QuickAnswer n={head} href={href} /> : undefined}
                      />
                      {showAll &&
                        s.items.slice(1).map((n) => (
                          <InboxRow
                            key={n.id}
                            n={n}
                            child
                            selected={n.id === id}
                            href={`/inbox/${encodeURIComponent(n.id)}${search}`}
                            onResolve={n.status === "active" ? () => resolveAll([n]) : undefined}
                            resolving={resolving.has(n.id)}
                          />
                        ))}
                    </div>
                  );
                })}
              </div>
            ))
          )}
          <div ref={sentinel} />
          {list.hasNextPage && (
            <div className="flex justify-center py-4">
              <Button size="sm" variant="ghost" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                Load more
              </Button>
            </div>
          )}
          {activeView && !list.hasNextPage && items.length > 0 && (
            <Link
              to={withStatus("resolved")}
              className="mt-2 flex items-center justify-between rounded-2xl px-3 py-3 text-[14px] font-semibold text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-foreground dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Resolved
              <ChevronRightIcon size={16} />
            </Link>
          )}
        </div>
      </section>

      {/* Detail pane */}
      <section className={cx("min-h-0 min-w-0 flex-1 lg:block", id ? "block" : "hidden")}>
        {id ? (
          <NotificationDetail
            key={id}
            id={id}
            search={search}
            focusReply={params.get("reply") === "1"}
            onFilter={filterFromDetail}
            onResolve={(n) => resolveAll([n])}
            resolving={resolving.has(id)}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-thread">
            <EmptyState icon={<InboxIcon size={20} />} title="Select a notification">
              Pick one from the list to see the full card, act on it, or reply.
              <div className="mt-4 hidden justify-center gap-4 text-xs pointer-fine:flex">
                <span>
                  <Kbd>J</Kbd> <Kbd>K</Kbd> move
                </span>
                <span>
                  <Kbd>E</Kbd> resolve
                </span>
              </div>
            </EmptyState>
          </div>
        )}
      </section>
    </div>
  );
}
