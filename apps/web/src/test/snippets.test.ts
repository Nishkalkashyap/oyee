import { InformInput, IntentSendInput } from "@oyee/schema";
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

  it("curl JSON body is a valid inform (the default intent) with a key, cooldown, rows and a link", () => {
    const code = byId(s, "curl-json").code;
    const body = InformInput.parse(JSON.parse(code.slice(code.indexOf("-d '") + 4, code.lastIndexOf("'"))));
    expect(body).toMatchObject({ key: "disk/db-1", cooldown: "15m" });
    expect([body.fields?.length, body.links?.length]).toEqual([2, 1]);
  });

  it("live progress reports a progress under one key and finishes it with status done", () => {
    const code = byId(s, "curl-progress").code;
    const line = code.split("\n").find((l) => l.includes("-d "))!;
    const json = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"')).replace(/\\"/g, '"').replace("$i", "5").replace("$status", "done");
    expect(IntentSendInput.parse(JSON.parse(json))).toMatchObject({ intent: "progress", key: "nightly", value: 5, max: 5, status: "done" });
  });

  it("no snippet uses a protocol v1 field", () => {
    for (const x of s) expect(x.code, x.id).not.toMatch(/replaceKey|threadId|"actions"|"tags"|tags=|Tags:/);
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
