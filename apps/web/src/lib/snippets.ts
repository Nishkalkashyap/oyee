/** Ready-to-paste snippets shown after creating a token. Pure functions of the secret URL. */

export interface Snippet {
  id: string;
  title: string;
  language: "bash" | "toml" | "json" | "yaml" | "text";
  description?: string;
  code: string;
}

/** Single-quotes a value for POSIX shells. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

/** The URL with an extra query string (handles URLs that already have one). */
export function withQuery(url: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return url + (url.includes("?") ? "&" : "?") + qs;
}

export function mcpSnippets(url: string): Snippet[] {
  const json = JSON.stringify({ mcpServers: { herald: { type: "http", url } } }, null, 2);
  return [
    {
      id: "claude-code",
      title: "Claude Code",
      language: "bash",
      description: "Run once in your terminal. Add --scope user to make it available in every project.",
      code: `claude mcp add --transport http herald ${shellQuote(url)}`,
    },
    {
      id: "codex",
      title: "Codex",
      language: "toml",
      description: "Add to ~/.codex/config.toml.",
      code: `[mcp_servers.herald]\nurl = ${JSON.stringify(url)}`,
    },
    {
      id: "json",
      title: "Generic JSON",
      language: "json",
      description: "For Cursor, Claude Desktop (via a remote-MCP bridge), VS Code and other clients that take an mcpServers map.",
      code: json,
    },
  ];
}

export function webhookSnippets(url: string): Snippet[] {
  const jsonBody = {
    title: "Deploy prod-api",
    body: "Rolling out **v1.4.2** to `prod`",
    severity: "info",
    threadId: "deploy-142",
    replaceKey: "deploy-142",
    progress: { value: 3, max: 7, label: "3/7 pods" },
    fields: [
      { label: "Region", value: "us-east-1" },
      { label: "Commit", value: "a1b2c3d" },
    ],
    actions: [
      { id: "rollback", label: "Roll back", style: "destructive" },
      { id: "logs", label: "Open logs", url: "https://example.com/logs" },
    ],
  };

  return [
    {
      id: "curl-text",
      title: "curl: plain text",
      language: "bash",
      description: "The request body becomes the notification body. Metadata comes from query params or ntfy-style headers.",
      code: [
        `curl -d "Backup finished in 4m12s" ${shellQuote(withQuery(url, { title: "Backup", severity: "success" }))}`,
        "",
        "# or with headers (Priority 1-5 maps to debug…critical)",
        `curl -H "Title: Disk almost full" -H "Priority: 4" -H "Tags: nas,storage" \\`,
        `  -d "/volume1 is at 92%" ${shellQuote(url)}`,
      ].join("\n"),
    },
    {
      id: "curl-json",
      title: "curl: JSON card",
      language: "bash",
      description:
        "Full card: fields, progress and actions. Sending again with the same replaceKey updates the active notification in place.",
      code: `curl -X POST ${shellQuote(url)} \\\n  -H "Content-Type: application/json" \\\n  -d ${shellQuote(JSON.stringify(jsonBody, null, 2))}`,
    },
    {
      id: "curl-query",
      title: "curl: query params (GET)",
      language: "bash",
      description: "Everything in the URL, for tools that can only call a link.",
      code: `curl ${shellQuote(
        withQuery(url, { title: "Hello from curl", body: "It works!", severity: "warning", tags: "test,cli" }),
      )}`,
    },
    {
      id: "curl-progress",
      title: "curl: live progress",
      language: "bash",
      description: "A loop that updates one notification in place with replaceKey.",
      code: [
        "for i in 1 2 3 4 5; do",
        `  curl -s -X POST ${shellQuote(url)} -H "Content-Type: application/json" \\`,
        `    -d "{\\"title\\":\\"Nightly job\\",\\"replaceKey\\":\\"nightly\\",\\"progress\\":{\\"value\\":$i,\\"max\\":5}}"`,
        "  sleep 2",
        "done",
      ].join("\n"),
    },
    {
      id: "home-assistant",
      title: "Home Assistant",
      language: "yaml",
      description: "configuration.yaml: a REST notify platform. Restart Home Assistant, then call notify.herald.",
      code: [
        "notify:",
        "  - name: herald",
        "    platform: rest",
        `    resource: ${url}`,
        "    method: POST_JSON",
        "    title_param_name: title",
        "    message_param_name: body",
        "    data:",
        "      source: home-assistant",
      ].join("\n"),
    },
    {
      id: "home-assistant-automation",
      title: "Home Assistant automation",
      language: "yaml",
      description: "automations.yaml example using the notifier above.",
      code: [
        '- alias: "Washer finished"',
        "  triggers:",
        "    - trigger: state",
        "      entity_id: sensor.washer_status",
        '      to: "complete"',
        "  actions:",
        "    - action: notify.herald",
        "      data:",
        '        title: "Laundry"',
        '        message: "The washer is done 🧺"',
      ].join("\n"),
    },
    {
      id: "alertmanager",
      title: "Prometheus Alertmanager",
      language: "yaml",
      description:
        "Alertmanager payloads are detected automatically: one notification per group, severity from labels.severity, resolved alerts resolve it.",
      code: [
        "receivers:",
        "  - name: herald",
        "    webhook_configs:",
        `      - url: ${url}`,
        "        send_resolved: true",
      ].join("\n"),
    },
    {
      id: "grafana",
      title: "Grafana",
      language: "text",
      description: "Grafana unified alerting payloads are detected automatically.",
      code: [
        "Alerting → Contact points → Add contact point",
        "  Integration: Webhook",
        `  URL:         ${url}`,
        "  HTTP Method: POST",
        "Then route your notification policy to this contact point.",
      ].join("\n"),
    },
    {
      id: "github-actions",
      title: "GitHub Actions",
      language: "yaml",
      description: "Store the URL as a repository secret named HERALD_WEBHOOK_URL, then add this step at the end of a job.",
      code: [
        "- name: Notify Herald",
        "  if: always()",
        "  env:",
        "    HERALD_URL: ${{ secrets.HERALD_WEBHOOK_URL }}",
        "  run: |",
        '    curl -fsS -X POST "$HERALD_URL" -H "Content-Type: application/json" -d @- <<EOF',
        "    {",
        '      "title": "${{ github.workflow }}: ${{ job.status }}",',
        '      "body": "${{ github.repository }}@${{ github.ref_name }}",',
        "      \"severity\": \"${{ job.status == 'success' && 'success' || 'critical' }}\",",
        '      "source": "github-actions",',
        '      "url": "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"',
        "    }",
        "    EOF",
      ].join("\n"),
    },
  ];
}
