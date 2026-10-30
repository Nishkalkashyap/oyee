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
  const json = JSON.stringify({ mcpServers: { oyee: { type: "http", url } } }, null, 2);
  return [
    {
      id: "claude-code",
      title: "Claude Code",
      language: "bash",
      description: "Run once in your terminal. Add --scope user to make it available in every project.",
      code: `claude mcp add --transport http oyee ${shellQuote(url)}`,
    },
    {
      id: "codex",
      title: "Codex",
      language: "toml",
      description: "Add to ~/.codex/config.toml.",
      code: `[mcp_servers.oyee]\nurl = ${JSON.stringify(url)}`,
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
  const informBody = {
    title: "Disk 95% full on db-1",
    body: "Free space is **below 5%**.",
    severity: "warning",
    key: "disk/db-1",
    cooldown: "15m",
    fields: [
      { label: "Host", value: "db-1" },
      { label: "Used", value: "95%" },
    ],
    links: [{ label: "Dashboard", url: "https://grafana.example.com/d/disk" }],
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
        "# or with headers (Priority 1-3 is info, 4 warning, 5 critical)",
        `curl -H "Title: Disk almost full" -H "Priority: 4" \\`,
        `  -d "/volume1 is at 92%" ${shellQuote(url)}`,
      ].join("\n"),
    },
    {
      id: "curl-json",
      title: "curl: JSON inform",
      language: "bash",
      description:
        "Rows and link buttons. Sending again with the same key updates that notification in place; cooldown keeps a repeat from alerting again within 15 minutes.",
      code: `curl -X POST ${shellQuote(url)} \\\n  -H "Content-Type: application/json" \\\n  -d ${shellQuote(JSON.stringify(informBody, null, 2))}`,
    },
    {
      id: "curl-query",
      title: "curl: query params (GET)",
      language: "bash",
      description: "Everything in the URL, for tools that can only call a link.",
      code: `curl ${shellQuote(withQuery(url, { title: "Hello from curl", body: "It works!", severity: "warning", key: "hello" }))}`,
    },
    {
      id: "curl-progress",
      title: "curl: live progress",
      language: "bash",
      description: "Reports one progress under its key, quietly; status done finishes it and alerts once.",
      code: [
        "for i in 1 2 3 4 5; do",
        `  status=running; [ $i = 5 ] && status=done`,
        `  curl -s -X POST ${shellQuote(url)} -H "Content-Type: application/json" \\`,
        `    -d "{\\"intent\\":\\"progress\\",\\"key\\":\\"nightly\\",\\"title\\":\\"Nightly job\\",\\"value\\":$i,\\"max\\":5,\\"status\\":\\"$status\\"}"`,
        "  sleep 2",
        "done",
      ].join("\n"),
    },
    {
      id: "home-assistant",
      title: "Home Assistant",
      language: "yaml",
      description: "configuration.yaml: a REST notify platform. Restart Home Assistant, then call notify.oyee.",
      code: [
        "notify:",
        "  - name: oyee",
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
        "    - action: notify.oyee",
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
        "  - name: oyee",
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
      description: "Store the URL as a repository secret named OYEE_WEBHOOK_URL, then add this step at the end of a job.",
      code: [
        "- name: Notify Oyee",
        "  if: always()",
        "  env:",
        "    OYEE_URL: ${{ secrets.OYEE_WEBHOOK_URL }}",
        "  run: |",
        '    curl -fsS -X POST "$OYEE_URL" -H "Content-Type: application/json" -d @- <<EOF',
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
