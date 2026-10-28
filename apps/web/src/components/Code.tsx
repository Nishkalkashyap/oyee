import { useState } from "react";
import { CheckIcon, CopyIcon } from "./Icons";
import { cx } from "./ui";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyButton({
  text,
  label = "Copy",
  className,
  compact,
}: {
  text: string;
  label?: string;
  className?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors",
        compact ? "p-1.5" : "px-2 py-1",
        "text-zinc-500 hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700/60 dark:hover:text-zinc-100",
        className,
      )}
      aria-label={label}
      title={label}
    >
      {copied ? <CheckIcon size={14} className="text-emerald-500" /> : <CopyIcon size={14} />}
      {!compact && (copied ? "Copied" : label)}
    </button>
  );
}

export function CodeBlock({ code, className, title }: { code: string; className?: string; title?: string }) {
  return (
    <div
      className={cx(
        "group relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900",
        className,
      )}
    >
      {title && (
        <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <span>{title}</span>
          <CopyButton text={code} />
        </div>
      )}
      {!title && <CopyButton text={code} compact className="absolute top-1.5 right-1.5 bg-zinc-50 dark:bg-zinc-900" />}
      <pre className="overflow-x-auto p-3 pr-10 font-mono text-[12.5px] leading-relaxed text-zinc-800 dark:text-zinc-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** A single-line secret/URL with a copy button. */
export function CopyField({ value, className }: { value: string; className?: string }) {
  return (
    <div
      className={cx(
        "flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 py-1 pr-1 pl-3 dark:border-zinc-800 dark:bg-zinc-900",
        className,
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-zinc-800 dark:text-zinc-200" title={value}>
        {value}
      </code>
      <CopyButton text={value} className="bg-white shadow-xs dark:bg-zinc-800" />
    </div>
  );
}
