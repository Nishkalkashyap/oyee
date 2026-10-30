import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Notification } from "@oyee/schema";
import { AskCard } from "./AskCard";
import { ReplyIcon } from "./Icons";
import { InformCard } from "./InformCard";
import { ProgressCard } from "./ProgressCard";
import { Badge, cx } from "./ui";
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
  /** Non-interactive rendering (composer previews). */
  preview?: boolean;
  /** Inside the conversation view: no meta line; an ask's reply box is the conversation's composer. */
  inThread?: boolean;
  onSourceClick?: (source: string) => void;
  /** An ask's answer button was pressed. */
  onAnswer?: (option: string) => void;
  /** An ask's reply box sent text. */
  onReply?: (text: string) => Promise<unknown> | void;
  /** The answer button whose answer is being sent. */
  pendingOption?: string | null;
  replyBusy?: boolean;
  focusReply?: boolean;
  /** Bottom row under a hairline: the card's own controls (Resolve), kept apart from the sender's buttons. */
  footer?: ReactNode;
  className?: string;
}

/** The purpose-built card for the notification's intent: inform, ask or progress. */
export function NotificationCard(props: NotificationCardProps) {
  const { notification: n, preview, inThread, onSourceClick, footer, className } = props;
  if (n.intent === "inform") {
    return <InformCard notification={n} preview={preview} inThread={inThread} onSourceClick={onSourceClick} footer={footer} className={className} />;
  }
  if (n.intent === "progress") {
    return <ProgressCard notification={n} preview={preview} inThread={inThread} onSourceClick={onSourceClick} footer={footer} className={className} />;
  }
  return (
    <AskCard
      notification={n}
      inThread={inThread}
      onAnswer={props.onAnswer}
      onReply={props.onReply}
      pendingOption={props.pendingOption}
      replyBusy={props.replyBusy}
      focusReply={props.focusReply}
      footer={footer}
      className={className}
    />
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
