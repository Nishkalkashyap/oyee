/**
 * Markdown subset used for notification bodies (protocol §1.1):
 * **bold** / __bold__, *italic* / _italic_, `code`, [link](https://…), bare https:// autolinks, line breaks.
 * Everything else is plain text. The parser builds a tiny AST; rendering never uses raw HTML, so all text is escaped
 * by React. Link targets are restricted to http(s) and mailto.
 */

export type MdNode =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "strong"; children: MdNode[] }
  | { type: "em"; children: MdNode[] }
  | { type: "link"; href: string; children: MdNode[] }
  | { type: "br" };

const ESCAPABLE = new Set(["\\", "`", "*", "_", "[", "]", "(", ")", "~"]);
const AUTOLINK = /^https?:\/\/[^\s<>"'`]+/i;
const TRAILING_PUNCT = /[.,;:!?)\]'"]+$/;

/** Returns the URL if it is safe to use as a link target, else null. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  // Strip control characters/whitespace that browsers ignore inside schemes ("java\nscript:").
  const normalized = href.replace(/[\u0000- \u007f]/g, "").toLowerCase();
  if (normalized.startsWith("https://") || normalized.startsWith("http://") || normalized.startsWith("mailto:")) {
    try {
      new URL(href);
      return href;
    } catch {
      return null;
    }
  }
  return null;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/** Finds the closing delimiter for emphasis starting at `from`, or -1. */
function findClosing(s: string, delim: string, from: number): number {
  let i = from;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      // Skip code spans so delimiters inside code don't close emphasis.
      const end = s.indexOf("`", i + 1);
      if (end !== -1) {
        i = end + 1;
        continue;
      }
    }
    if (s.startsWith(delim, i)) {
      // For single delimiters, don't match half of a double one.
      if (delim.length === 1 && s[i + 1] === delim) {
        i += 2;
        continue;
      }
      const before = s[i - 1];
      if (before !== undefined && /\s/.test(before)) {
        i += delim.length;
        continue;
      }
      // `_` must not be followed by a word char (avoids snake_case_names).
      if (delim[0] === "_" && isWordChar(s[i + delim.length])) {
        i += delim.length;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

interface InlineOptions {
  links: boolean;
}

function parseInline(s: string, opts: InlineOptions = { links: true }): MdNode[] {
  const out: MdNode[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      const last = out[out.length - 1];
      if (last && last.type === "text") last.value += buf;
      else out.push({ type: "text", value: buf });
      buf = "";
    }
  };
  const push = (n: MdNode) => {
    flush();
    out.push(n);
  };

  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;

    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.has(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        push({ type: "code", value: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (ch === "[" && opts.links) {
      const close = s.indexOf("](", i + 1);
      if (close !== -1) {
        const end = s.indexOf(")", close + 2);
        if (end !== -1) {
          const text = s.slice(i + 1, close);
          const href = safeHref(s.slice(close + 2, end));
          if (text && href) {
            push({ type: "link", href, children: parseInline(text, { links: false }) });
            i = end + 1;
            continue;
          }
          // Unsafe or empty: render the label only (drop the target entirely).
          if (text && !href) {
            buf += text;
            i = end + 1;
            continue;
          }
        }
      }
    }

    if ((ch === "*" || ch === "_") && s[i + 1] === ch) {
      const delim = ch + ch;
      const canOpen = !(ch === "_" && isWordChar(s[i - 1])) && s[i + 2] !== undefined && !/\s/.test(s[i + 2]!);
      if (canOpen) {
        const end = findClosing(s, delim, i + 2);
        if (end > i + 2) {
          push({ type: "strong", children: parseInline(s.slice(i + 2, end), opts) });
          i = end + 2;
          continue;
        }
      }
    }

    if (ch === "*" || ch === "_") {
      const canOpen = !(ch === "_" && isWordChar(s[i - 1])) && s[i + 1] !== undefined && !/\s/.test(s[i + 1]!);
      if (canOpen) {
        const end = findClosing(s, ch, i + 1);
        if (end > i + 1) {
          push({ type: "em", children: parseInline(s.slice(i + 1, end), opts) });
          i = end + 1;
          continue;
        }
      }
    }

    if (opts.links && (ch === "h" || ch === "H") && !isWordChar(s[i - 1])) {
      const m = AUTOLINK.exec(s.slice(i));
      if (m) {
        let url = m[0];
        const trail = TRAILING_PUNCT.exec(url);
        if (trail) url = url.slice(0, url.length - trail[0].length);
        const href = safeHref(url);
        if (href) {
          push({ type: "link", href, children: [{ type: "text", value: url }] });
          i += url.length;
          continue;
        }
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** Parses a body string into AST nodes. Lines are separated by `br` nodes. */
export function parseMarkdown(input: string | null | undefined): MdNode[] {
  if (!input) return [];
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const out: MdNode[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) out.push({ type: "br" });
    out.push(...parseInline(line));
  });
  return out;
}

function nodesToText(nodes: MdNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.value;
        case "br":
          return "\n";
        default:
          return nodesToText(n.children);
      }
    })
    .join("");
}

/** Strips the markdown subset to plain text (for system-notification previews). */
export function markdownToPlainText(input: string | null | undefined): string {
  return nodesToText(parseMarkdown(input));
}
