import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { Action, Notification, NotificationStatus, Severity } from "@herald/schema";
import { ApiError, errorMessage } from "../lib/api";
import { flattenPages, groupByThread, type InboxFilters } from "../lib/cache";
import { relativeTime } from "../lib/format";
import { markdownToPlainText } from "../lib/markdown";
import {
  useDeleteNotification,
  useMarkAllRead,
  useMarkRead,
  useNotification,
  useNotificationList,
  useResolve,
  useRespond,
  useSources,
} from "../lib/queries";
import { SEVERITIES, SEVERITY_STYLES } from "../lib/severity";
import {
  CheckCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InboxIcon,
  LayersIcon,
  PlugIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  XIcon,
} from "../components/Icons";
import { NotificationCard } from "../components/NotificationCard";
import { NotificationIcon, ProgressBar } from "../components/NotificationParts";
import { useToast } from "../components/Toast";
import { Button, EmptyState, ErrorBanner, Segmented, Select, Spinner, buttonClasses, cx } from "../components/ui";

const GROUP_KEY = "herald:inbox:group";

function useFilters(): [InboxFilters, (patch: Partial<Record<"source" | "severity" | "status" | "thread" | "q", string | null>>) => void, URLSearchParams] {
  const [params, setParams] = useSearchParams();
  const filters: InboxFilters = {
    source: params.get("source") ?? undefined,
    severity: (SEVERITIES as string[]).includes(params.get("severity") ?? "") ? (params.get("severity") as Severity) : undefined,
    status: params.get("status") === "active" || params.get("status") === "resolved" ? (params.get("status") as NotificationStatus) : undefined,
    threadId: params.get("thread") ?? undefined,
    q: params.get("q") ?? undefined,
  };
  const update = (patch: Partial<Record<"source" | "severity" | "status" | "thread" | "q", string | null>>) => {
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:text-zinc-100",
      )}
    >
      {children}
    </button>
  );
}

function InboxRow({ n, selected, search, indent }: { n: Notification; selected: boolean; search: string; indent?: boolean }) {
  const unread = !n.readAt;
  const preview = markdownToPlainText(n.body).replace(/\s+/g, " ").trim();
  return (
    <Link
      to={`/inbox/${encodeURIComponent(n.id)}${search}`}
      className={cx(
        "group relative flex gap-3 border-b border-zinc-100 px-4 py-3 transition-colors dark:border-zinc-800/70",
        indent && "pl-8",
        selected ? "bg-blue-50/80 dark:bg-blue-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-900/60",
      )}
      aria-current={selected ? "true" : undefined}
    >
      {unread && <span className="absolute top-1/2 left-1.5 size-1.5 -translate-y-1/2 rounded-full bg-blue-500" aria-label="Unread" />}
      <NotificationIcon notification={n} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={cx(
              "min-w-0 flex-1 truncate text-sm",
              unread ? "font-semibold text-zinc-900 dark:text-zinc-50" : "text-zinc-600 dark:text-zinc-400",
              n.status === "resolved" && !unread && "line-through decoration-zinc-300 dark:decoration-zinc-700",
            )}
          >
            {n.title}
          </span>
          <time className="shrink-0 text-[11px] text-zinc-400 tabular-nums" dateTime={n.createdAt}>
            {relativeTime(n.createdAt)}
          </time>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
          <span className={cx("size-1.5 shrink-0 rounded-full", SEVERITY_STYLES[n.severity].dot)} title={n.severity} />
          <span className="shrink-0 font-medium">{n.source}</span>
          {preview && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{preview}</span>
            </>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
            {n.responses.length > 0 && (
              <span className="inline-flex items-center gap-0.5" title={`${n.responses.length} response(s)`}>
                <ReplyIcon size={11} />
                {n.responses.length}
              </span>
            )}
            {n.status === "resolved" && <CheckIcon size={12} className="text-emerald-500" aria-label="Resolved" />}
          </span>
        </div>
        {n.progress && n.status === "active" && <ProgressBar progress={n.progress} severity={n.severity} compact className="mt-2" />}
      </div>
    </Link>
  );
}

function ThreadGroupRows({
  threadId,
  items,
  selectedId,
  search,
  onFilter,
}: {
  threadId: string;
  items: Notification[];
  selectedId?: string;
  search: string;
  onFilter: () => void;
}) {
  const [open, setOpen] = useState(true);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 px-4 py-1.5 text-xs dark:border-zinc-800/70 dark:bg-zinc-900/40">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
          {open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
          <LayersIcon size={12} />
          <span className="truncate font-medium">{threadId}</span>
          <span className="text-zinc-400">
            {items.length}
            {unread > 0 && <span className="text-blue-600 dark:text-blue-400"> · {unread} unread</span>}
          </span>
        </button>
        <button type="button" onClick={onFilter} className="text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200">
          Only this
        </button>
      </div>
      {open && items.map((n) => <InboxRow key={n.id} n={n} selected={n.id === selectedId} search={search} indent />)}
    </div>
  );
}

function NotificationDetail({
  id,
  search,
  focusReply,
  onFilter,
}: {
  id: string;
  search: string;
  focusReply: boolean;
  onFilter: (patch: { thread?: string; source?: string }) => void;
}) {
  const q = useNotification(id);
  const markRead = useMarkRead();
  const respond = useRespond(id);
  const resolve = useResolve();
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

  return (
    <NotificationCard
      notification={n}
      onAction={onAction}
      onReply={(text) =>
        respond.mutateAsync({ text }).then(
          () => toast.success("Reply sent"),
          (e: unknown) => {
            toast.error("Couldn't send reply", errorMessage(e));
            throw e;
          },
        )
      }
      onMarkRead={() => markRead.mutate(n.id, { onError: (e) => toast.error("Couldn't mark read", errorMessage(e)) })}
      onResolve={() => resolve.mutate(n.id, { onError: (e) => toast.error("Couldn't resolve", errorMessage(e)) })}
      onDelete={() => {
        if (!confirm("Delete this notification on every device?")) return;
        del.mutate(n.id, {
          onSuccess: () => {
            toast.success("Notification deleted");
            navigate(`/inbox${search}`, { replace: true });
          },
          onError: (e) => toast.error("Couldn't delete", errorMessage(e)),
        });
      }}
      onThreadClick={(thread) => onFilter({ thread })}
      onSourceClick={(source) => onFilter({ source })}
      pendingActionId={respond.isPending && respond.variables?.actionId ? respond.variables.actionId : null}
      busy={{
        read: markRead.isPending && markRead.variables === n.id,
        resolve: resolve.isPending,
        delete: del.isPending,
        reply: respond.isPending && !!respond.variables?.text,
      }}
      focusReply={focusReply}
    />
  );
}

export function InboxPage() {
  const { id } = useParams();
  const [filters, setFilter, params] = useFilters();
  const navigate = useNavigate();
  const sources = useSources();
  const list = useNotificationList(filters);
  const markAll = useMarkAllRead();
  const toast = useToast();
  const [grouped, setGrouped] = useState(() => localStorage.getItem(GROUP_KEY) === "1");
  const [searchText, setSearchText] = useState(filters.q ?? "");
  const sentinel = useRef<HTMLDivElement>(null);

  const listParams = new URLSearchParams(params);
  listParams.delete("reply");
  const search = listParams.toString() ? `?${listParams.toString()}` : "";
  const items = useMemo(() => flattenPages(list.data), [list.data]);
  const groups = useMemo(() => (grouped ? groupByThread(items) : null), [grouped, items]);
  const hasFilters = !!(filters.source || filters.severity || filters.status || filters.threadId || filters.q);

  // Debounced search → URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.q ?? "") !== searchText.trim()) setFilter({ q: searchText.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  useEffect(() => localStorage.setItem(GROUP_KEY, grouped ? "1" : "0"), [grouped]);

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

  const filterFromDetail = (patch: { thread?: string; source?: string }) => {
    const next = new URLSearchParams(listParams);
    if (patch.thread) next.set("thread", patch.thread);
    if (patch.source) next.set("source", patch.source);
    navigate(`/inbox?${next.toString()}`);
  };

  const sourceItems = sources.data ?? [];
  const unreadInScope = filters.source
    ? (sourceItems.find((s) => s.source === filters.source)?.unread ?? 0)
    : sourceItems.reduce((a, s) => a + s.unread, 0);

  return (
    <div className="flex lg:h-dvh lg:overflow-hidden">
      {/* List pane */}
      <section
        className={cx(
          "w-full shrink-0 flex-col border-zinc-200 lg:flex lg:w-[400px] lg:overflow-y-auto lg:border-r xl:w-[440px] dark:border-zinc-800",
          id ? "hidden" : "flex",
        )}
      >
        <div className="z-20 space-y-2.5 border-b border-zinc-200 bg-white/90 px-4 pt-4 pb-3 backdrop-blur md:sticky md:top-0 dark:border-zinc-800 dark:bg-zinc-950/90">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Inbox</h1>
            {unreadInScope > 0 && <span className="text-xs text-zinc-500">{unreadInScope} unread</span>}
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant={grouped ? "secondary" : "ghost"}
                icon={<LayersIcon size={13} />}
                onClick={() => setGrouped((g) => !g)}
                aria-pressed={grouped}
                title="Group by thread"
              >
                Threads
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<CheckCheckIcon size={13} />}
                loading={markAll.isPending}
                disabled={unreadInScope === 0}
                onClick={() =>
                  markAll.mutate(filters.source, {
                    onSuccess: (r) => toast.success(`Marked ${r.updated} as read`),
                    onError: (e) => toast.error("Couldn't mark all read", errorMessage(e)),
                  })
                }
                title={filters.source ? `Mark all from ${filters.source} read` : "Mark all read"}
              >
                Read all
              </Button>
            </div>
          </div>

          <div className="relative">
            <SearchIcon size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search notifications"
              className="h-8 w-full rounded-lg border border-zinc-200 bg-zinc-50 pr-3 pl-8 text-sm placeholder:text-zinc-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:focus:bg-zinc-950"
            />
          </div>

          {sourceItems.length > 0 && (
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
              <Chip active={!filters.source} onClick={() => setFilter({ source: null })}>
                All
              </Chip>
              {sourceItems.map((s) => (
                <Chip key={s.source} active={filters.source === s.source} onClick={() => setFilter({ source: filters.source === s.source ? null : s.source })}>
                  {s.source}
                  {s.unread > 0 && <span className="rounded-full bg-blue-500/15 px-1.5 text-[10px] text-blue-600 dark:text-blue-400">{s.unread}</span>}
                </Chip>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Segmented<"all" | NotificationStatus>
              size="sm"
              value={filters.status ?? "all"}
              onChange={(v) => setFilter({ status: v === "all" ? null : v })}
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "Active" },
                { value: "resolved", label: "Resolved" },
              ]}
            />
            <Select
              aria-label="Severity"
              value={filters.severity ?? ""}
              onChange={(e) => setFilter({ severity: e.target.value || null })}
              className="h-7 w-auto py-0 pl-2 text-xs"
            >
              <option value="">Any severity</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_STYLES[s].label}
                </option>
              ))}
            </Select>
            {filters.threadId && (
              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pr-1 pl-2 text-xs dark:bg-zinc-800">
                <LayersIcon size={11} /> {filters.threadId}
                <button type="button" aria-label="Clear thread filter" onClick={() => setFilter({ thread: null })} className="rounded-full p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700">
                  <XIcon size={11} />
                </button>
              </span>
            )}
            {hasFilters && (
              <button
                type="button"
                className="ml-auto text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                onClick={() => {
                  setSearchText("");
                  setFilter({ source: null, severity: null, status: null, thread: null, q: null });
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="flex-1">
          {list.isPending ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : list.error ? (
            <div className="p-4">
              <ErrorBanner onRetry={() => void list.refetch()}>{errorMessage(list.error)}</ErrorBanner>
            </div>
          ) : items.length === 0 ? (
            hasFilters ? (
              <EmptyState icon={<SearchIcon size={20} />} title="Nothing matches these filters">
                Try a different source, severity or search.
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
                Create an MCP server URL or a webhook on the Connect page, then send your first notification. It shows up
                here instantly.
              </EmptyState>
            )
          ) : groups ? (
            groups.map((g) =>
              g.threadId && g.items.length > 1 ? (
                <ThreadGroupRows
                  key={g.key}
                  threadId={g.threadId}
                  items={g.items}
                  selectedId={id}
                  search={search}
                  onFilter={() => setFilter({ thread: g.threadId })}
                />
              ) : (
                <InboxRow key={g.key} n={g.items[0]!} selected={g.items[0]!.id === id} search={search} />
              ),
            )
          ) : (
            items.map((n) => <InboxRow key={n.id} n={n} selected={n.id === id} search={search} />)
          )}
          <div ref={sentinel} />
          {list.hasNextPage && (
            <div className="flex justify-center py-4">
              <Button size="sm" variant="ghost" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                Load more
              </Button>
            </div>
          )}
          {!list.hasNextPage && items.length > 20 && <p className="py-6 text-center text-xs text-zinc-400">That's everything.</p>}
        </div>
      </section>

      {/* Detail pane */}
      <section className={cx("min-w-0 flex-1 lg:block lg:overflow-y-auto", id ? "block" : "hidden")}>
        {id ? (
          <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6 lg:py-8">
            <Link
              to={`/inbox${search}`}
              className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 lg:hidden dark:hover:text-zinc-100"
            >
              <ChevronLeftIcon size={16} /> Inbox
            </Link>
            <NotificationDetail
              key={id}
              id={id}
              search={search}
              focusReply={params.get("reply") === "1"}
              onFilter={filterFromDetail}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={<InboxIcon size={20} />} title="Select a notification">
              Pick one from the list to see the full card, act on it, or reply.
            </EmptyState>
          </div>
        )}
      </section>
    </div>
  );
}
