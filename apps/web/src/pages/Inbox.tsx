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
  TrashIcon,
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
import { NotificationCard, ReplyComposer } from "../components/NotificationCard";
import { ProgressBar } from "../components/NotificationParts";
import { useToast } from "../components/Toast";
import { Avatar, Button, EmptyState, ErrorBanner, FilterChip, Segmented, Select, Spinner, buttonClasses, cx } from "../components/ui";
import { formatDateTime } from "../lib/format";
import { useDevices } from "../lib/queries";

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

/** Gluon's list row: the source's tinted avatar with a severity dot, title, time (orange while unread) and preview. */
function InboxRow({ n, selected, search, indent }: { n: Notification; selected: boolean; search: string; indent?: boolean }) {
  const unread = !n.readAt;
  const preview = markdownToPlainText(n.body).replace(/\s+/g, " ").trim();
  return (
    <Link
      to={`/inbox/${encodeURIComponent(n.id)}${search}`}
      className={cx(
        "flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-[background-color,scale] duration-150 active:scale-[0.985]",
        indent && "ml-5",
        selected ? "bg-row-selected" : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
      )}
      aria-current={selected ? "true" : undefined}
    >
      <span className="relative shrink-0">
        <Avatar name={n.source} size={44} />
        {n.severity !== "debug" && (
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
              "min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.005em]",
              n.status === "resolved" && !unread && "text-zinc-500 dark:text-zinc-400",
            )}
          >
            {n.title}
          </span>
          <time
            className={cx("shrink-0 text-xs tabular-nums", unread ? "font-semibold text-brand" : "text-zinc-500 dark:text-zinc-400")}
            dateTime={n.createdAt}
          >
            {relativeTime(n.createdAt)}
          </time>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cx("min-w-0 flex-1 truncate text-[13.5px]", unread ? "text-secondary-label" : "text-zinc-500 dark:text-zinc-400")}>
            {n.source}
            {preview && ` · ${preview}`}
          </span>
          {n.responses.length > 0 && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-zinc-500" title={`${n.responses.length} response(s)`}>
              <ReplyIcon size={12} />
              {n.responses.length}
            </span>
          )}
          {n.status === "resolved" && <CheckIcon size={13} className="shrink-0 text-emerald-600" aria-label="Resolved" />}
          {unread && <span className="size-2.5 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
        </span>
        {n.progress && n.status === "active" && <ProgressBar progress={n.progress} severity={n.severity} compact className="mt-2" />}
      </span>
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
      <div className="flex items-center gap-2 px-3 pt-3 pb-1 text-[13px]">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1.5 font-semibold text-secondary-label">
          {open ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
          <LayersIcon size={12} />
          <span className="truncate font-medium">{threadId}</span>
          <span className="text-zinc-400">
            {items.length}
            {unread > 0 && <span className="font-semibold text-brand"> · {unread} unread</span>}
          </span>
        </button>
        <button type="button" onClick={onFilter} className="text-zinc-500 hover:text-foreground">
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
  const resolved = n.status === "resolved";
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
      {/* Header: who sent it and where it went, plus resolve / delete. */}
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
            {n.threadId && (
              <>
                {" · "}
                <button type="button" className="hover:text-foreground" onClick={() => onFilter({ thread: n.threadId! })}>
                  {n.threadId}
                </button>
              </>
            )}
          </div>
        </div>
        {!n.readAt && (
          <Button size="sm" variant="ghost" icon={<CheckCheckIcon size={14} />} loading={markRead.isPending} onClick={() => markRead.mutate(n.id)}>
            <span className="hidden sm:inline">Mark read</span>
          </Button>
        )}
        {!resolved && (
          <Button
            size="sm"
            variant="secondary"
            icon={<CheckIcon size={14} />}
            loading={resolve.isPending}
            onClick={() => resolve.mutate(n.id, { onError: (e) => toast.error("Couldn't resolve", errorMessage(e)) })}
          >
            Resolve
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<TrashIcon size={14} />} loading={del.isPending} onClick={onDelete} aria-label="Delete" title="Delete" />
      </header>

      {/* Conversation: the agent's card, quiet updates, your answers as peach bubbles. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-2.5 px-3 py-5 sm:px-5">
          <SystemLine>{formatDateTime(n.createdAt)}</SystemLine>
          <NotificationCard
            notification={n}
            inThread
            className="mr-6 sm:mr-12"
            onAction={onAction}
            pendingActionId={respond.isPending && respond.variables?.actionId ? respond.variables.actionId : null}
          />
          {n.version > 1 && n.updatedAt !== n.createdAt && (
            <SystemLine>
              Updated {relativeTime(n.updatedAt)} · v{n.version}
            </SystemLine>
          )}
          {n.responses.map((r, i) => {
            const action = n.actions.find((a) => a.id === r.actionId);
            return (
              <div key={`${r.at}-${i}`} className="flex flex-col items-end">
                <div className="ml-12 max-w-[80%] rounded-[22px] rounded-br-md bg-chip px-4 py-2.5 text-[14.5px] break-words whitespace-pre-wrap text-foreground">
                  {r.actionId && <span className="font-semibold">{action?.label ?? r.actionId}</span>}
                  {r.actionId && r.text && " · "}
                  {r.text}
                </div>
                <span className="mt-1 mr-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {r.deviceName ?? "Unknown device"} · <time title={formatDateTime(r.at)}>{relativeTime(r.at)}</time>
                </span>
              </div>
            );
          })}
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
              <dt>Template</dt>
              <dd>{n.template ?? "—"}</dd>
              <dt>ID</dt>
              <dd className="font-mono">{n.id}</dd>
            </dl>
          </details>
        </div>
      </div>

      {n.reply && !resolved && (
        <div className="mx-auto w-full max-w-2xl shrink-0 px-3 pb-4 sm:px-5">
          <ReplyComposer
            placeholder={n.reply.placeholder || `Reply to ${n.source}…`}
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
    <div className="flex h-full min-h-0">
      {/* List pane */}
      <section
        className={cx(
          "min-h-0 w-full shrink-0 flex-col overflow-y-auto border-zinc-200 lg:flex lg:w-[380px] lg:border-r xl:w-[400px] dark:border-zinc-800",
          id ? "hidden" : "flex",
        )}
      >
        <div className="sticky top-0 z-20 space-y-3 bg-background px-4 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <h1 className="text-[30px] leading-tight font-extrabold tracking-[-0.035em] md:text-2xl md:font-bold md:tracking-tight">Inbox</h1>
            {unreadInScope > 0 && <span className="text-[13px] font-semibold text-brand">{unreadInScope} unread</span>}
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
            <SearchIcon size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search"
              className="h-10 w-full rounded-full bg-zinc-100 pr-4 pl-10 text-[14px] placeholder:text-zinc-500 focus:bg-background focus:ring-2 focus:ring-brand/30 focus:outline-none dark:bg-zinc-800"
            />
          </div>

          {sourceItems.length > 0 && (
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
              <FilterChip active={!filters.source} onClick={() => setFilter({ source: null })}>
                All
              </FilterChip>
              {sourceItems.map((s) => (
                <FilterChip key={s.source} active={filters.source === s.source} onClick={() => setFilter({ source: filters.source === s.source ? null : s.source })}>
                  {s.source}
                  {s.unread > 0 && <span className="text-[11px] opacity-75">{s.unread}</span>}
                </FilterChip>
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
              className="h-7 w-auto! rounded-full border-0 bg-zinc-100 py-0 pl-3 text-xs dark:bg-zinc-800"
            >
              <option value="">Any severity</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_STYLES[s].label}
                </option>
              ))}
            </Select>
            {filters.threadId && (
              <span className="inline-flex h-7 items-center gap-1 rounded-full bg-chip pr-1 pl-2.5 text-xs font-semibold text-chip-foreground">
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
      <section className={cx("min-h-0 min-w-0 flex-1 lg:block", id ? "block" : "hidden")}>
        {id ? (
          <NotificationDetail key={id} id={id} search={search} focusReply={params.get("reply") === "1"} onFilter={filterFromDetail} />
        ) : (
          <div className="flex h-full items-center justify-center bg-thread">
            <EmptyState icon={<InboxIcon size={20} />} title="Select a notification">
              Pick one from the list to see the full card, act on it, or reply.
            </EmptyState>
          </div>
        )}
      </section>
    </div>
  );
}
