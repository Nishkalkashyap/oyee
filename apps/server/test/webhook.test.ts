import type { Notification } from "@oyee/schema";
import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromTextRequest, severityFromPriority } from "../src/webhook/adapters";
import { BASE, call, createToken, devLogin } from "./helpers";

afterEach(() => vi.restoreAllMocks());

async function setup(label = "hooks") {
  const cookie = await devLogin();
  const tok = await createToken(cookie, "webhook", label);
  const get = async (id: string) => (await call("GET", `/api/notifications/${id}`, { cookie })).body as Notification;
  return { cookie, secret: tok.secret, get };
}

describe("webhook: text and GET", () => {
  it("maps ntfy headers on text/plain", async () => {
    const { secret, get } = await setup();
    const res = await SELF.fetch(`${BASE}/hook/${secret}?threadId=run-1`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Title": "Backup", "X-Priority": "5", Tags: "nas, backup", Click: "https://nas.local.example.com/" },
      body: "Backup failed",
    });
    expect(res.status).toBe(200);
    const n = await get(((await res.json()) as { id: string }).id);
    expect(n).toMatchObject({
      title: "Backup",
      body: "Backup failed",
      severity: "critical",
      tags: ["nas", "backup"],
      url: "https://nas.local.example.com/",
      threadId: "run-1",
      source: "hooks",
    });
  });

  it("uses the first body line as the title when missing", async () => {
    const { secret, get } = await setup();
    const res = await SELF.fetch(`${BASE}/hook/${secret}`, { method: "POST", body: "\nFirst line\nsecond line" });
    const n = await get(((await res.json()) as { id: string }).id);
    expect(n.title).toBe("First line");
    expect(n.severity).toBe("info");

    const empty = await SELF.fetch(`${BASE}/hook/${secret}`, { method: "POST", headers: { "Content-Type": "text/plain" } });
    expect((await get(((await empty.json()) as { id: string }).id)).title).toBe("Notification");
  });

  it("accepts GET with query params", async () => {
    const { secret, get } = await setup();
    const r = await call("GET", `/hook/${secret}?title=Hi&body=There&severity=warning&tags=a,b&source=cron`, null);
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(1);
    expect(await get(r.body.id)).toMatchObject({ title: "Hi", body: "There", severity: "warning", tags: ["a", "b"], source: "cron" });
  });

  it("validates JSON bodies and limits", async () => {
    const { secret } = await setup();
    const bad = await call("POST", `/hook/${secret}`, null, { title: "x", severity: "nope" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/severity/);
    const notJson = await call("POST", `/hook/${secret}`, null, "{oops", { "Content-Type": "application/json" });
    expect(notJson.status).toBe(400);
    const big = await call("POST", `/hook/${secret}`, null, "x".repeat(70 * 1024), { "Content-Type": "text/plain" });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe("payload_too_large");
    expect((await call("POST", "/hook/oyee_wh_invalid", null, { title: "x" })).status).toBe(401);
  });

  it("rate limits per token", async () => {
    const { secret } = await setup();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await call("GET", `/hook/${secret}?title=n${i}`, null)).status;
    expect(last).toBe(429);
  });

  it("maps ntfy priorities", () => {
    expect(["1", "2", "3", "4", "5", "urgent", "x"].map(severityFromPriority)).toEqual([
      "debug",
      "info",
      "info",
      "warning",
      "critical",
      "critical",
      undefined,
    ]);
    expect(fromTextRequest({ "var.service": "api", template: "t" }, new Headers(), "")).toEqual({
      template: "t",
      vars: { service: "api" },
    });
  });
});

describe("webhook: Alertmanager / Grafana / SNS", () => {
  const amPayload = (status: "firing" | "resolved") => ({
    version: "4",
    groupKey: '{}:{alertname="HighCPU"}',
    status,
    receiver: "oyee",
    groupLabels: { alertname: "HighCPU" },
    commonLabels: { alertname: "HighCPU", severity: "critical", cluster: "prod" },
    commonAnnotations: {},
    externalURL: "https://alertmanager.example.com",
    alerts: [
      { status, labels: { alertname: "HighCPU", instance: "a:9100" }, annotations: { summary: "CPU > 90% on a" } },
      { status, labels: { alertname: "HighCPU", instance: "b:9100" }, annotations: { summary: "CPU > 90% on b" } },
    ],
  });

  it("maps Alertmanager firing → one notification per group, resolved → resolves it", async () => {
    const { cookie, secret, get } = await setup("prometheus");
    const fire = await call("POST", `/hook/${secret}`, null, amPayload("firing"));
    expect(fire.status).toBe(200);
    const n = await get(fire.body.id);
    expect(n).toMatchObject({
      title: "[FIRING:2] HighCPU",
      severity: "critical",
      status: "active",
      body: "• CPU > 90% on a\n• CPU > 90% on b",
      fields: [{ label: "cluster", value: "prod" }],
      url: "https://alertmanager.example.com",
      tags: ["alertmanager"],
    });

    // Repeat notification → same card (replaceKey = groupKey)
    const again = await call("POST", `/hook/${secret}`, null, amPayload("firing"));
    expect(again.body.id).toBe(fire.body.id);
    expect(again.body.version).toBe(2);

    const resolved = await call("POST", `/hook/${secret}`, null, amPayload("resolved"));
    expect(resolved.body.id).toBe(fire.body.id);
    const r = await get(fire.body.id);
    expect(r).toMatchObject({ status: "resolved", title: "[RESOLVED] HighCPU", severity: "success" });
    expect((await call("GET", "/api/notifications", { cookie })).body.items).toHaveLength(1);

    // Resolved with nothing active → a resolved card is recorded
    const orphan = await call("POST", `/hook/${secret}`, null, { ...amPayload("resolved"), groupKey: "other" });
    expect((await get(orphan.body.id)).status).toBe("resolved");
  });

  it("maps Grafana unified alerting payloads", async () => {
    const { secret, get } = await setup("grafana");
    const r = await call("POST", `/hook/${secret}`, null, {
      receiver: "oyee",
      status: "firing",
      orgId: 1,
      state: "alerting",
      groupKey: "grafana-group",
      commonLabels: { alertname: "DiskFull", severity: "warning" },
      alerts: [
        {
          status: "firing",
          labels: { alertname: "DiskFull" },
          annotations: { description: "Disk 95% full" },
          panelURL: "https://grafana.example.com/d/abc?viewPanel=2",
        },
      ],
      title: "[FIRING:1] DiskFull",
      message: "...",
    });
    expect(await get(r.body.id)).toMatchObject({
      title: "[FIRING:1] DiskFull",
      severity: "warning",
      body: "• Disk 95% full",
      url: "https://grafana.example.com/d/abc?viewPanel=2",
      tags: ["grafana"],
    });
  });

  it("confirms SNS subscriptions and maps SNS notifications", async () => {
    const { secret, get } = await setup("aws");
    const realFetch = globalThis.fetch;
    const fetched: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new Request(input as RequestInfo, init as RequestInit).url;
      if (url.startsWith("https://sns.us-east-1.amazonaws.com/")) {
        fetched.push(url);
        return new Response("<ConfirmSubscriptionResponse/>");
      }
      return realFetch(input as RequestInfo, init as RequestInit);
    });

    const subscribeUrl = "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:us-east-1:1:t&Token=abc";
    const confirm = await call(
      "POST",
      `/hook/${secret}`,
      null,
      JSON.stringify({ Type: "SubscriptionConfirmation", TopicArn: "arn:aws:sns:us-east-1:1:t", SubscribeURL: subscribeUrl, Token: "abc" }),
      { "Content-Type": "text/plain; charset=UTF-8", "x-amz-sns-message-type": "SubscriptionConfirmation" },
    );
    expect(confirm.status).toBe(200);
    expect(confirm.body).toEqual({ ok: true, confirmed: true });
    expect(fetched).toEqual([subscribeUrl]);

    // A SubscribeURL that isn't an SNS host is never fetched
    const evil = await call(
      "POST",
      `/hook/${secret}`,
      null,
      { Type: "SubscriptionConfirmation", TopicArn: "arn", SubscribeURL: "https://evil.example.com/x" },
    );
    expect(evil.body.ignored).toBeDefined();
    expect(fetched).toHaveLength(1);

    const note = await call(
      "POST",
      `/hook/${secret}`,
      null,
      JSON.stringify({ Type: "Notification", TopicArn: "arn:aws:sns:us-east-1:1:t", Subject: "ALARM: CPU", Message: "CPU above threshold" }),
      { "Content-Type": "text/plain; charset=UTF-8", "x-amz-sns-message-type": "Notification" },
    );
    expect(note.status).toBe(200);
    expect(await get(note.body.id)).toMatchObject({ title: "ALARM: CPU", body: "CPU above threshold", source: "aws" });
  });
});
