import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Action, Notification } from "@herald/schema";
import { formatDateTime, relativeTime } from "../lib/format";
import { SEVERITY_STYLES } from "../lib/severity";
import { CheckCheckIcon, CheckIcon, ExternalLinkIcon, LayersIcon, ReplyIcon, TrashIcon } from "./Icons";
import { Markdown } from "./Markdown";
import { NotificationIcon, ProgressBar, SeverityBadge } from "./NotificationParts";
import { Badge, Button, cx } from "./ui";
import { useDevices } from "../lib/queries";

/** "→ MacBook Pro" — the devices a targeted notification alerted (others only list it in their inbox). */
function TargetBadge({ ids, preview }: { ids: string[]; preview?: boolean }) {
  const devices = useDevices({ enabled: !preview });
  const names = ids.map((id) => devices.data?.find((d) => d.id === id)?.name ?? (preview ? id : "removed device"));
  return (
    <span title="Only these devices were alerted">
      <Badge className="bg-violet-500/10 text-violet-700 dark:text-violet-300">→ {names.join(", ")}</Badge>
    </span>
  );
}

export interface NotificationCardProps {
  notification: Notification;
  /** Non-interactive rendering (template/composer previews). */
  preview?: boolean;
  onAction?: (action: Action) => void;
  onReply?: (text: string) => Promise<unknown> | void;
  onMarkRead?: () => void;
  onResolve?: () => void;
  onDelete?: () => void;
  onThreadClick?: (threadId: string) => void;
  onSourceClick?: (source: string) => void;
  pendingActionId?: string | null;
  busy?: { read?: boolean; resolve?: boolean; delete?: boolean; reply?: boolean };
  focusReply?: boolean;
  className?: string;
}

const ACTION_VARIANT = {
  primary: "primary",
  destructive: "danger",
  default: "secondary",
} as const;

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase dark:text-zinc-500">{label}</dt>
      <dd className="mt-0.5 truncate text-xs text-zinc-700 dark:text-zinc-300">{children}</dd>
    </div>
  );
}

export function NotificationCard({
  notification: n,
  preview,
  onAction,
  onReply,
  onMarkRead,
  onResolve,
  onDelete,
  onThreadClick,
  onSourceClick,
  pendingActionId,
  busy = {},
  focusReply,
  className,
}: NotificationCardProps) {
  const s = SEVERITY_STYLES[n.severity];
  const resolved = n.status === "resolved";
  const [reply, setReply] = useState("");
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const chosen = new Set(n.responses.map((r) => r.actionId).filter(Boolean));

  useEffect(() => {
    if (focusReply && n.reply) replyRef.current?.focus();
  }, [focusReply, n.reply, n.id]);

  const submitReply = async () => {
    const text = reply.trim();
    if (!text || !onReply) return;
    await onReply(text);
    setReply("");
  };

  return (
    <article
      className={cx(
        "overflow-hidden rounded-xl border border-l-[3px] border-zinc-200 bg-white shadow-xs dark:border-zinc-800 dark:bg-zinc-900/60",
        s.border,
        className,
      )}
    >
      <div className="p-4 sm:p-5">
        {/* Header */}
        <header className="flex items-start gap-3">
          <NotificationIcon notification={n} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              {onSourceClick && !preview ? (
                <button type="button" className="font-medium hover:text-zinc-900 dark:hover:text-zinc-100" onClick={() => onSourceClick(n.source)}>
                  {n.source}
                </button>
              ) : (
                <span className="font-medium">{n.source}</span>
              )}
              {n.threadId && (
                <>
                  <span aria-hidden>·</span>
                  {onThreadClick && !preview ? (
                    <button
                      type="button"
                      onClick={() => onThreadClick(n.threadId!)}
                      className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100"
                      title="Show this thread"
                    >
                      <LayersIcon size={12} />
                      {n.threadId}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <LayersIcon size={12} />
                      {n.threadId}
                    </span>
                  )}
                </>
              )}
              <span aria-hidden>·</span>
              <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
                {relativeTime(n.createdAt)}
              </time>
            </div>
            <h2 className="mt-1 text-[17px] leading-snug font-semibold break-words text-zinc-900 dark:text-zinc-50">
              {n.title}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <SeverityBadge severity={n.severity} />
              {resolved && (
                <Badge className="bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
                  <CheckIcon size={11} /> Resolved
                </Badge>
              )}
              {!preview && !n.readAt && <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">Unread</Badge>}
              {n.silent && <Badge>Silent</Badge>}
              {n.targetDeviceIds && <TargetBadge ids={n.targetDeviceIds} preview={preview} />}
              {n.tags.map((t) => (
                <Badge key={t}>#{t}</Badge>
              ))}
            </div>
          </div>
        </header>

        {/* Body */}
        {n.body && (
          <Markdown
            text={n.body}
            className="mt-4 text-sm leading-relaxed break-words text-zinc-700 dark:text-zinc-300"
          />
        )}

        {n.image && (
          <a
            href={preview ? undefined : n.image}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 block overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
          >
            <img src={n.image} alt="" loading="lazy" className="max-h-80 w-full bg-zinc-100 object-cover dark:bg-zinc-800" />
          </a>
        )}

        {n.fields.length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 sm:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-800">
            {n.fields.map((f, i) => (
              <div key={`${f.label}-${i}`} className="bg-white px-3 py-2 dark:bg-zinc-900">
                <dt className="truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400">{f.label}</dt>
                <dd className="mt-0.5 text-sm break-words text-zinc-900 dark:text-zinc-100">{f.value || "—"}</dd>
              </div>
            ))}
          </dl>
        )}

        {n.progress && <ProgressBar progress={n.progress} severity={n.severity} className="mt-4" />}

        {n.url && (
          <a
            href={preview ? undefined : n.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex max-w-full items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            <ExternalLinkIcon size={13} />
            <span className="truncate">{n.url}</span>
          </a>
        )}

        {/* Actions */}
        {n.actions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {n.actions.map((a) => (
              <Button
                key={a.id}
                size="md"
                variant={ACTION_VARIANT[a.style ?? "default"]}
                icon={a.url ? <ExternalLinkIcon size={14} /> : chosen.has(a.id) ? <CheckIcon size={14} /> : undefined}
                loading={pendingActionId === a.id}
                disabled={!preview && (resolved && !a.url ? true : !!pendingActionId)}
                onClick={preview ? undefined : () => onAction?.(a)}
                className={cx(preview && "pointer-events-none")}
                title={a.url ? a.url : a.resolves ? "Responds and resolves" : "Responds"}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}

        {/* Reply */}
        {n.reply && (
          <form
            className="mt-4 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submitReply();
            }}
          >
            <textarea
              ref={replyRef}
              rows={1}
              value={reply}
              disabled={preview || busy.reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submitReply();
                }
              }}
              placeholder={n.reply.placeholder || "Write a reply…"}
              maxLength={2000}
              className="min-h-9 flex-1 resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:placeholder:text-zinc-600"
            />
            <Button
              type="submit"
              variant="primary"
              icon={<ReplyIcon size={14} />}
              loading={busy.reply}
              disabled={preview || !reply.trim()}
            >
              {n.reply.buttonLabel || "Reply"}
            </Button>
          </form>
        )}

        {/* Responses */}
        {n.responses.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-[11px] font-medium tracking-wide text-zinc-400 uppercase dark:text-zinc-500">
              Responses
            </h3>
            <ol className="space-y-2">
              {n.responses.map((r, i) => {
                const action = n.actions.find((a) => a.id === r.actionId);
                return (
                  <li key={`${r.at}-${i}`} className="flex gap-2.5 text-sm">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600" />
                    <div className="min-w-0 flex-1">
                      <div className="text-zinc-800 dark:text-zinc-200">
                        {r.actionId && (
                          <span className="font-medium">
                            {action?.label ?? r.actionId}
                            {r.text ? " · " : ""}
                          </span>
                        )}
                        {r.text && <span className="break-words whitespace-pre-wrap">{r.text}</span>}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {r.deviceName ?? "Unknown device"} · <time title={formatDateTime(r.at)}>{relativeTime(r.at)}</time>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>

      {/* Footer: metadata + management */}
      {!preview && (
        <footer className="border-t border-zinc-100 bg-zinc-50/60 px-4 py-3 sm:px-5 dark:border-zinc-800 dark:bg-zinc-950/30">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Meta label="Created">{formatDateTime(n.createdAt)}</Meta>
            <Meta label="Updated">{formatDateTime(n.updatedAt)}</Meta>
            <Meta label="Read">{formatDateTime(n.readAt)}</Meta>
            <Meta label="Resolved">{formatDateTime(n.resolvedAt)}</Meta>
            <Meta label="Version">v{n.version}</Meta>
            <Meta label="Template">{n.template ?? "—"}</Meta>
            <Meta label="ID">
              <span className="font-mono" title={n.id}>
                {n.id}
              </span>
            </Meta>
          </dl>
          {(onMarkRead || onResolve || onDelete) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {onMarkRead && !n.readAt && (
                <Button size="sm" icon={<CheckCheckIcon size={13} />} loading={busy.read} onClick={onMarkRead}>
                  Mark read
                </Button>
              )}
              {onResolve && !resolved && (
                <Button size="sm" icon={<CheckIcon size={13} />} loading={busy.resolve} onClick={onResolve}>
                  Resolve
                </Button>
              )}
              {onDelete && (
                <Button
                  size="sm"
                  variant="outline-danger"
                  icon={<TrashIcon size={13} />}
                  loading={busy.delete}
                  onClick={onDelete}
                  className="ml-auto"
                >
                  Delete
                </Button>
              )}
            </div>
          )}
        </footer>
      )}
    </article>
  );
}
