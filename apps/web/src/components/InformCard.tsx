import type { ReactNode } from "react";
import { formatDateTime, relativeTime } from "../lib/format";
import { informView, type InformNotification } from "../lib/inform";
import { CheckIcon, ExternalLinkIcon } from "./Icons";
import { Markdown } from "./Markdown";
import { TargetBadge } from "./NotificationCard";
import { SeverityBadge, SeverityIcon } from "./NotificationParts";
import { SEVERITY_STYLES } from "../lib/severity";
import { Badge, buttonClasses, cx } from "./ui";

export interface InformCardProps {
  notification: InformNotification;
  /** Non-interactive rendering (composer previews). */
  preview?: boolean;
  /** Inside the conversation view: the header already names the source. */
  inThread?: boolean;
  onSourceClick?: (source: string) => void;
  /** Bottom row under a hairline: the card's own controls (Resolve), kept apart from the sender's links. */
  footer?: ReactNode;
  className?: string;
}

/**
 * Inform: something the user should know. Icon and severity pill, the title, the markdown body, an image, label/value
 * rows in a soft inset, and up to three link buttons. One-way, so nothing on it answers back.
 */
export function InformCard({ notification: n, preview, inThread, onSourceClick, footer, className }: InformCardProps) {
  const v = informView(n);
  const href = (url: string) => (preview ? undefined : url);
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
          {onSourceClick && !preview ? (
            <button type="button" className="font-semibold text-secondary-label hover:text-foreground" onClick={() => onSourceClick(n.source)}>
              {n.source}
            </button>
          ) : (
            <span className="font-semibold text-secondary-label">{n.source}</span>
          )}
          <span aria-hidden>·</span>
          <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
            {relativeTime(n.createdAt)}
          </time>
        </div>
      )}

      <div className="flex items-start gap-3">
        <span
          className={cx(
            "inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-lg",
            SEVERITY_STYLES[v.severity].soft,
          )}
          aria-hidden
        >
          {v.icon?.kind === "image" ? (
            <img src={v.icon.src} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
          ) : v.icon ? (
            <span className="leading-none">{v.icon.text}</span>
          ) : (
            <SeverityIcon severity={v.severity} size={18} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={v.severity} />
            {v.resolved && (
              <Badge className="bg-foreground text-background">
                <CheckIcon size={11} /> Resolved
              </Badge>
            )}
            {n.targetDeviceIds && <TargetBadge ids={n.targetDeviceIds} preview={preview} />}
          </div>
          <h2 className="mt-1.5 text-[18px] leading-snug font-bold tracking-[-0.02em] break-words">{v.title}</h2>
        </div>
      </div>

      {v.body && <Markdown text={v.body} className="mt-2.5 text-[14.5px] leading-relaxed break-words text-secondary-label" />}

      {v.image && (
        <a href={href(v.image)} target="_blank" rel="noopener noreferrer" className="mt-3.5 block overflow-hidden rounded-2xl">
          <img src={v.image} alt="" loading="lazy" className="max-h-80 w-full bg-zinc-100 object-cover dark:bg-zinc-800" />
        </a>
      )}

      {v.rows.length > 0 && (
        <dl className="mt-3.5 divide-y divide-zinc-200/80 rounded-2xl bg-card px-4 text-[13.5px] dark:divide-zinc-700/70">
          {v.rows.map((r, i) => (
            <div key={`${r.label}-${i}`} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="shrink-0 text-zinc-500 dark:text-zinc-400">{r.label}</dt>
              <dd className="min-w-0 text-right font-medium break-words">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(v.links.length > 0 || v.open) && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {v.links.map((l, i) => (
            <a
              key={`${l.url}-${i}`}
              href={href(l.url)}
              target="_blank"
              rel="noopener noreferrer"
              title={l.url}
              className={buttonClasses(i === 0 ? "primary" : "secondary", "sm", cx(preview && "pointer-events-none"))}
            >
              {l.label}
              <ExternalLinkIcon size={13} />
            </a>
          ))}
          {v.open && (
            <a
              href={href(v.open.url)}
              target="_blank"
              rel="noopener noreferrer"
              title={v.open.url}
              className="ml-auto inline-flex max-w-full items-center gap-1 text-[13px] font-medium text-zinc-500 hover:text-foreground dark:text-zinc-400"
            >
              <span className="truncate">{v.open.host}</span>
              <ExternalLinkIcon size={12} />
            </a>
          )}
        </div>
      )}

      {footer && <div className="mt-4 border-t border-zinc-200/80 pt-3.5 dark:border-zinc-700/70">{footer}</div>}
    </article>
  );
}
