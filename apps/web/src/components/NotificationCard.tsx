import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Action, Notification } from "@oyee/schema";
import { formatDateTime, relativeTime } from "../lib/format";
import { CheckIcon, ExternalLinkIcon, LayersIcon, ReplyIcon } from "./Icons";
import { InformCard } from "./InformCard";
import { Markdown } from "./Markdown";
import { ProgressBar, SeverityBadge } from "./NotificationParts";
import { Badge, Button, cx } from "./ui";
import { useDevices } from "../lib/queries";

/** "→ MacBook Pro": the devices a targeted notification alerted (others only list it in their inbox). */
export function TargetBadge({ ids, preview }: { ids: string[]; preview?: boolean }) {
  const devices = useDevices({ enabled: !preview });
  const names = ids.map((id) => devices.data?.find((d) => d.id === id)?.name ?? (preview ? id : "removed device"));
  return (
    <span title="Only these devices were alerted">
      <Badge className="bg-chip text-chip-foreground">→ {names.join(", ")}</Badge>
    </span>
  );
}

export interface NotificationCardProps {
  notification: Notification;
  /** Non-interactive rendering (template/composer previews). */
  preview?: boolean;
  /** Inside the conversation view: no meta line, replies and responses are rendered by the thread. */
  inThread?: boolean;
  onAction?: (action: Action) => void;
  onReply?: (text: string) => Promise<unknown> | void;
  onThreadClick?: (threadId: string) => void;
  onSourceClick?: (source: string) => void;
  pendingActionId?: string | null;
  busy?: { reply?: boolean };
  focusReply?: boolean;
  /** Bottom row under a hairline: the card's own controls (Resolve), kept apart from the agent's buttons. */
  footer?: ReactNode;
  className?: string;
}

const ACTION_VARIANT = {
  primary: "primary",
  destructive: "danger",
  default: "secondary",
} as const;

/** The notification as a message bubble: severity pill, bold title, body, fields, progress and pill actions. */
export function NotificationCard({
  notification: n,
  preview,
  inThread,
  onAction,
  onReply,
  onThreadClick,
  onSourceClick,
  pendingActionId,
  busy = {},
  focusReply,
  footer,
  className,
}: NotificationCardProps) {
  if (n.intent === "inform") {
    return <InformCard notification={n} preview={preview} inThread={inThread} onSourceClick={onSourceClick} footer={footer} className={className} />;
  }
  const resolved = n.status === "resolved";
  const chosen = new Set(n.responses.map((r) => r.actionId).filter(Boolean));

  return (
    <article
      className={cx(
        "rounded-[22px] bg-bubble p-4 text-foreground sm:p-5",
        inThread ? "rounded-bl-md" : "ring-1 ring-zinc-200/70 dark:ring-zinc-800",
        className,
      )}
    >
      {!inThread && (
        <div className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-zinc-500 dark:text-zinc-400">
          {onSourceClick && !preview ? (
            <button type="button" className="font-semibold text-secondary-label hover:text-foreground" onClick={() => onSourceClick(n.source)}>
              {n.source}
            </button>
          ) : (
            <span className="font-semibold text-secondary-label">{n.source}</span>
          )}
          {n.threadId && (
            <>
              <span aria-hidden>·</span>
              {onThreadClick && !preview ? (
                <button
                  type="button"
                  onClick={() => onThreadClick(n.threadId!)}
                  className="inline-flex items-center gap-1 hover:text-foreground"
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
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={n.severity} />
        {resolved && (
          <Badge className="bg-foreground text-background">
            <CheckIcon size={11} /> Resolved
          </Badge>
        )}
        {n.silent && <Badge>Silent</Badge>}
        {n.targetDeviceIds && <TargetBadge ids={n.targetDeviceIds} preview={preview} />}
        {n.tags.map((t) => (
          <Badge key={t}>#{t}</Badge>
        ))}
      </div>

      <h2 className="mt-2.5 text-[18px] leading-snug font-bold tracking-[-0.02em] break-words">{n.title}</h2>

      {n.body && <Markdown text={n.body} className="mt-1.5 text-[14.5px] leading-relaxed break-words text-secondary-label" />}

      {n.image && (
        <a
          href={preview ? undefined : n.image}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3.5 block overflow-hidden rounded-2xl"
        >
          <img src={n.image} alt="" loading="lazy" className="max-h-80 w-full bg-zinc-100 object-cover dark:bg-zinc-800" />
        </a>
      )}

      {n.fields.length > 0 && (
        <dl className="mt-3.5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[13.5px]">
          {n.fields.map((f, i) => (
            <div key={`${f.label}-${i}`} className="contents">
              <dt className="text-zinc-500 dark:text-zinc-400">{f.label}</dt>
              <dd className="min-w-0 font-medium break-words">{f.value || "—"}</dd>
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
          className="mt-3.5 inline-flex max-w-full items-center gap-1.5 text-[13px] font-medium text-foreground underline decoration-zinc-300 underline-offset-[3px] hover:decoration-foreground dark:decoration-zinc-600"
        >
          <ExternalLinkIcon size={13} />
          <span className="truncate">{n.url}</span>
        </a>
      )}

      {n.actions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {n.actions.map((a) => (
            <Button
              key={a.id}
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

      {!inThread && n.reply && (
        <ReplyComposer
          className="mt-4"
          placeholder={n.reply.placeholder || "Write a reply…"}
          disabled={preview}
          busy={busy.reply}
          onSend={onReply}
          focus={focusReply}
        />
      )}

      {footer && <div className="mt-4 border-t border-zinc-200/80 pt-3.5 dark:border-zinc-700/70">{footer}</div>}
    </article>
  );
}

/** Gluon's composer: a rounded bubble field with a blue send button. ⌘/Ctrl+Enter sends. */
export function ReplyComposer({
  placeholder,
  disabled,
  busy,
  onSend,
  focus,
  className,
}: {
  placeholder: string;
  disabled?: boolean;
  busy?: boolean;
  onSend?: (text: string) => Promise<unknown> | void;
  focus?: boolean;
  className?: string;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  const submit = async () => {
    const t = text.trim();
    if (!t || !onSend) return;
    await onSend(t);
    setText("");
  };
  return (
    <form
      className={cx(
        "flex items-end gap-2 rounded-3xl bg-bubble py-1.5 pr-1.5 pl-4 shadow-[0_1px_3px_rgba(0,0,0,0.06)] ring-1 ring-zinc-200/70 focus-within:ring-brand/40 dark:ring-zinc-800",
        className,
      )}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={text}
        disabled={disabled || busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={placeholder}
        maxLength={2000}
        className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-2 text-[14.5px] placeholder:text-zinc-400 focus:outline-none"
      />
      <button
        type="submit"
        aria-label="Send reply"
        disabled={disabled || busy || !text.trim()}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground transition-[opacity,scale] active:scale-90 disabled:opacity-40"
      >
        <ReplyIcon size={16} className="-scale-x-100" />
      </button>
    </form>
  );
}
