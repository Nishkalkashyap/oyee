import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../components/Markdown";
import { markdownToPlainText, parseMarkdown, safeHref } from "../lib/markdown";

const html = (s: string) => renderToStaticMarkup(<Markdown text={s} />);

describe("parseMarkdown", () => {
  it("parses bold, italic, code and links", () => {
    expect(parseMarkdown("CPU **90%** for *5m* in `us-east-1` [dash](https://x.io/a)")).toEqual([
      { type: "text", value: "CPU " },
      { type: "strong", children: [{ type: "text", value: "90%" }] },
      { type: "text", value: " for " },
      { type: "em", children: [{ type: "text", value: "5m" }] },
      { type: "text", value: " in " },
      { type: "code", value: "us-east-1" },
      { type: "text", value: " " },
      { type: "link", href: "https://x.io/a", children: [{ type: "text", value: "dash" }] },
    ]);
  });

  it("supports __bold__, _italic_ and nesting", () => {
    expect(parseMarkdown("__a *b*__ _c_")).toEqual([
      {
        type: "strong",
        children: [
          { type: "text", value: "a " },
          { type: "em", children: [{ type: "text", value: "b" }] },
        ],
      },
      { type: "text", value: " " },
      { type: "em", children: [{ type: "text", value: "c" }] },
    ]);
  });

  it("turns newlines (incl. CRLF) into line breaks", () => {
    expect(parseMarkdown("a\r\nb\nc")).toEqual([
      { type: "text", value: "a" },
      { type: "br" },
      { type: "text", value: "b" },
      { type: "br" },
      { type: "text", value: "c" },
    ]);
  });

  it("leaves snake_case, lone asterisks and unclosed markers alone", () => {
    expect(markdownToPlainText("my_var_name and 2 * 3 * 4 and **open")).toBe("my_var_name and 2 * 3 * 4 and **open");
    expect(parseMarkdown("my_var_name")).toEqual([{ type: "text", value: "my_var_name" }]);
  });

  it("does not format inside code spans", () => {
    expect(parseMarkdown("`**not bold**`")).toEqual([{ type: "code", value: "**not bold**" }]);
  });

  it("honours backslash escapes", () => {
    expect(markdownToPlainText("\\*literal\\* and \\`tick\\`")).toBe("*literal* and `tick`");
  });

  it("autolinks bare http(s) URLs without trailing punctuation", () => {
    const nodes = parseMarkdown("See https://example.com/x?a=1.");
    expect(nodes).toEqual([
      { type: "text", value: "See " },
      { type: "link", href: "https://example.com/x?a=1", children: [{ type: "text", value: "https://example.com/x?a=1" }] },
      { type: "text", value: "." },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(parseMarkdown(null)).toEqual([]);
    expect(parseMarkdown("")).toEqual([]);
  });
});

describe("safeHref", () => {
  it("allows http, https and mailto", () => {
    expect(safeHref("https://a.b/c")).toBe("https://a.b/c");
    expect(safeHref("http://a.b")).toBe("http://a.b");
    expect(safeHref("mailto:x@y.z")).toBe("mailto:x@y.z");
  });
  it("rejects script-ish and relative URLs", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\nscript:alert(1)", " javascript:alert(1)", "data:text/html,<b>", "vbscript:x", "/relative", "//evil.com", "https//nope"]) {
      expect(safeHref(bad), bad).toBeNull();
    }
  });
});

describe("<Markdown> rendering (XSS)", () => {
  it("escapes raw HTML", () => {
    const out = html('<script>alert("x")</script><img src=x onerror=alert(1)>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes HTML inside formatting and code", () => {
    const out = html("**<b>x</b>** `<i>y</i>`");
    expect(out).toContain("<strong");
    expect(out).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(out).toContain("&lt;i&gt;y&lt;/i&gt;");
    expect(out).not.toContain("<b>");
  });

  it("never emits javascript: links (label kept as text)", () => {
    const out = html("[click me](javascript:alert(document.cookie))");
    expect(out).not.toContain("href");
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain("click me");
  });

  it("can't break out of the href attribute", () => {
    const out = html('[x](https://a.com/"onmouseover="alert(1))');
    expect(out).not.toContain('" onmouseover');
    expect(out).not.toMatch(/<a[^>]* onmouseover=/);
  });

  it("renders safe links with target=_blank and rel=noopener", () => {
    const out = html("[docs](https://oyee.dev/docs)");
    expect(out).toMatch(/<a href="https:\/\/oyee.dev\/docs" target="_blank" rel="noopener noreferrer nofollow"/);
  });

  it("renders line breaks as <br/>", () => {
    expect(html("a\nb")).toContain("a<br/>b");
  });
});
