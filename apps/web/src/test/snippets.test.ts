import { describe, expect, it } from "vitest";
import { mcpSnippets, shellQuote, webhookSnippets, withQuery } from "../lib/snippets";

const MCP = "https://oyee.example.com/mcp/oyee_mcp_abc123";
const HOOK = "https://oyee.example.com/hook/oyee_wh_xyz789";

const byId = <T extends { id: string }>(xs: T[], id: string) => {
  const x = xs.find((s) => s.id === id);
  if (!x) throw new Error(`missing snippet ${id}`);
  return x;
};

describe("shell helpers", () => {
  it("shellQuote escapes single quotes", () => {
    expect(shellQuote("a'b")).toBe(`'a'"'"'b'`);
    expect(shellQuote("https://x/y?a=1&b=2")).toBe("'https://x/y?a=1&b=2'");
  });
  it("withQuery appends with ? or &", () => {
    expect(withQuery("https://x/h", { title: "A B", severity: "info" })).toBe("https://x/h?title=A+B&severity=info");
    expect(withQuery("https://x/h?a=1", { b: "2" })).toBe("https://x/h?a=1&b=2");
  });
});

describe("mcpSnippets", () => {
  const s = mcpSnippets(MCP);
  it("Claude Code command", () => {
    expect(byId(s, "claude-code").code).toBe(`claude mcp add --transport http oyee '${MCP}'`);
  });
  it("Codex TOML", () => {
    expect(byId(s, "codex").code).toBe(`[mcp_servers.oyee]\nurl = "${MCP}"`);
  });
  it("generic JSON is valid and has the http server", () => {
    expect(JSON.parse(byId(s, "json").code)).toEqual({ mcpServers: { oyee: { type: "http", url: MCP } } });
  });
});

describe("webhookSnippets", () => {
  const s = webhookSnippets(HOOK);
  it("includes all integrations and the URL everywhere", () => {
    expect(s.map((x) => x.id)).toEqual([
      "curl-text",
      "curl-json",
      "curl-query",
      "curl-progress",
      "home-assistant",
      "home-assistant-automation",
      "alertmanager",
      "grafana",
      "github-actions",
    ]);
    for (const x of s.filter((x) => !["home-assistant-automation", "github-actions"].includes(x.id))) {
      expect(x.code, x.id).toContain(HOOK);
    }
  });

  it("curl text uses query params for metadata", () => {
    expect(byId(s, "curl-text").code).toContain(`curl -d "Backup finished in 4m12s" '${HOOK}?title=Backup&severity=success'`);
  });

  it("curl JSON body is valid JSON with progress, fields and actions", () => {
    const code = byId(s, "curl-json").code;
    const json = code.slice(code.indexOf("-d '") + 4, code.lastIndexOf("'"));
    const body = JSON.parse(json);
    expect(body.progress).toEqual({ value: 3, max: 7, label: "3/7 pods" });
    expect(body.actions).toHaveLength(2);
    expect(body.replaceKey).toBe("deploy-142");
  });

  it("Home Assistant notify platform uses the documented keys", () => {
    const ha = byId(s, "home-assistant").code;
    expect(ha).toContain("platform: rest");
    expect(ha).toContain(`resource: ${HOOK}`);
    expect(ha).toContain("method: POST_JSON");
    expect(ha).toContain("title_param_name: title");
    expect(ha).toContain("message_param_name: body");
    expect(byId(s, "home-assistant-automation").code).toContain("action: notify.oyee");
  });

  it("Alertmanager receiver sends resolved alerts", () => {
    const am = byId(s, "alertmanager").code;
    expect(am).toContain(`- url: ${HOOK}`);
    expect(am).toContain("send_resolved: true");
  });

  it("GitHub Actions step reads the URL from a secret", () => {
    const gh = byId(s, "github-actions").code;
    expect(gh).toContain("${{ secrets.OYEE_WEBHOOK_URL }}");
    expect(gh).not.toContain(HOOK);
  });
});
