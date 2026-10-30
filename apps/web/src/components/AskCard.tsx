import type { ReactNode } from "react";
import type { Notification } from "@oyee/schema";
import { askView } from "../lib/ask";
import { formatDateTime, relativeTime } from "../lib/format";
import { SEVERITY_STYLES } from "../lib/severity";
import { CheckIcon, ExternalLinkIcon } from "./Icons";
import { Markdown } from "./Markdown";
import { ReplyComposer, TargetBadge } from "./NotificationCard";
import { Badge, Button, cx } from "./ui";

export type AskNotification = Extract<Notification, { intent: "ask" }>;

const warning = SEVERITY_STYLES.warning;

/**
 * The ask as a message bubble: the question, its answer buttons and reply box, and a status pill that says how long
 * it has been waiting or who answered it ("Answered: Approve · Pixel 9"). Once answered nothing is pressable.
 */
export function AskCard({
  notification: n,
  inThread,
  onAnswer,
  onReply,
  pendingOption,
  replyBusy,
  focusReply,
  footer,
  className,
}: {
  notification: AskNotification;
  /** Inside the conversation view: no meta line, and the reply box is the conversation's composer. */
  inThread?: boolean;
  onAnswer?: (option: string) => void;
  onReply?: (text: string) => Promise<unknown> | void;
  pendingOption?: string | null;
  replyBusy?: boolean;
  focusReply?: boolean;
  footer?: ReactNode;
  className?: string;
}) {
  const view = askView(n);
  return (
    <article
      className={cx(
        "rounded-[22px] bg-bubble p-4 text-foreground sm:p-5",
        inThread ? "rounded-bl-md" : "ring-1 ring-zinc-200/70 dark:ring-zinc-800",
        className,
      )}
    >
      {!inThread && (
        <div className="mb-2 flex flex-wrap items-center gap-x-1.5 text-[13px] text-zinc-500 dark:text-zinc-400">
          <span className="font-semibold text-secondary-label">{n.source}</span>
          <span aria-hidden>·</span>
          <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
            {relativeTime(n.createdAt)}
          </time>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {view.state === "answered" ? (
          <Badge className="bg-foreground text-background">
            <CheckIcon size={11} /> {view.status}
          </Badge>
        ) : view.open ? (
          // An ask always alerts at warning: the same soft pill as the warning severity, saying how long it has waited.
          <span className={cx("inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold", warning.soft)}>
            <span className={cx("size-1.5 rounded-full", warning.dot)} />
            {view.status}
          </span>
        ) : (
          <Badge>{view.status}</Badge>
        )}
        {n.targetDeviceIds && <TargetBadge ids={n.targetDeviceIds} />}
      </div>

      <h2 className="mt-2.5 text-[18px] leading-snug font-bold tracking-[-0.02em] break-words">{n.title}</h2>

      {n.body && <Markdown text={n.body} className="mt-1.5 text-[14.5px] leading-relaxed break-words text-secondary-label" />}

      {n.url && (
        <a
          href={n.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3.5 inline-flex max-w-full items-center gap-1.5 text-[13px] font-medium text-foreground underline decoration-zinc-300 underline-offset-[3px] hover:decoration-foreground dark:decoration-zinc-600"
        >
          <ExternalLinkIcon size={13} />
          <span className="truncate">{n.url}</span>
        </a>
      )}

      {view.options.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {view.options.map((o, i) => (
            <Button
              key={o.label}
              variant={o.chosen || (view.open && i === 0) ? "primary" : "secondary"}
              icon={o.chosen ? <CheckIcon size={14} /> : undefined}
              loading={pendingOption === o.label}
              disabled={!view.open || !!pendingOption}
              onClick={() => onAnswer?.(o.label)}
              className={cx(!view.open && o.chosen && "disabled:opacity-100")}
            >
              {o.label}
            </Button>
          ))}
        </div>
      )}

      {!inThread && view.reply && (
        <ReplyComposer className="mt-4" placeholder={view.reply.placeholder} busy={replyBusy} onSend={onReply} focus={focusReply} />
      )}

      {footer && <div className="mt-4 border-t border-zinc-200/80 pt-3.5 dark:border-zinc-700/70">{footer}</div>}
    </article>
  );
}
