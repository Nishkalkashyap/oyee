import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type MdNode } from "../lib/markdown";

function render(nodes: MdNode[], keyPrefix = ""): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}${i}`;
    switch (n.type) {
      case "text":
        return <Fragment key={key}>{n.value}</Fragment>;
      case "br":
        return <br key={key} />;
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {n.value}
          </code>
        );
      case "strong":
        return (
          <strong key={key} className="font-semibold text-zinc-900 dark:text-zinc-50">
            {render(n.children, `${key}.`)}
          </strong>
        );
      case "em":
        return <em key={key}>{render(n.children, `${key}.`)}</em>;
      case "link":
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="font-medium text-foreground underline decoration-zinc-300 underline-offset-[3px] hover:decoration-foreground dark:decoration-zinc-600"
            onClick={(e) => e.stopPropagation()}
          >
            {render(n.children, `${key}.`)}
          </a>
        );
    }
  });
}

/** Renders the notification markdown subset. Never uses raw HTML. */
export function Markdown({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  return <div className={className}>{render(parseMarkdown(text))}</div>;
}
