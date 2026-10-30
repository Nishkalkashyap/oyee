import type { Notification } from "@oyee/schema";
import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InboxDO } from "../src/inbox/do";
import { fromTextRequest, severityFromLabel, severityFromPriority } from "../src/webhook/adapters";
import { BASE, call, createToken, devLogin } from "./helpers";

afterEach(() => vi.restoreAllMocks());

async function setup(label = "hooks") {
  const cookie = await devLogin();
  const tok = await createToken(cookie, "webhook", label);
  const get = async (id: string) => (await call("GET", `/api/notifications/${id}`, { cookie })).body as Notification;
  return { cookie, secret: tok.secret, get };
}

/** The user's inbox Durable Object, to backdate a stored progress and fire its alarm (spec "Time-based rules"). */
async function inboxOf(cookie: string) {
  const me = (await call<{ id: string }>("GET", "/api/me", { cookie })).body;
  return env.INBOX.get(env.INBOX.idFromName(me.id));
}

describe("webhook: JSON intents", () => {
  it("a bare title is an inform, answered with the outcome", async () => {
    const { secret, get } = await setup();
    const r = await call("POST", `/hook/${secret}`, null, { title: "Backup done" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: expect.stringMatching(/^ntf_/), version: 1, outcome: "created", reason: expect.any(String) });
    expect(await get(r.body.id)).toMatchObject({ intent: "inform", title: "Backup done", severity: "info", source: "hooks" });
  });

  it("key and cooldown work as for agents: a repeat inside the cooldown updates silently", async () => {
    const { secret, get } = await setup();
    const first = await call("POST", `/hook/${secret}`, null, { title: "Disk 91%", key: "disk", cooldown: "1h", severity: "warning" });
    expect(first.body.outcome).toBe("created");
    const again = await call("POST", `/hook/${secret}`, null, { intent: "inform", title: "Disk 95%", key: "disk", cooldown: "1h" });
    expect(again.body).toMatchObject({ id: first.body.id, version: 2, outcome: "updated_silently" });
    expect(again.body.reason).toMatch(/without alerting/);
    expect(await get(first.body.id)).toMatchObject({ title: "Disk 95%", key: "disk", inform: { cooldown: "1h" } });
  });

  it("reports progress by key and finishes it", async () => {
    const { secret, get } = await setup("ci");
    const start = await call("POST", `/hook/${secret}`, null, { intent: "progress", key: "deploy", title: "Deploying api", value: 3, max: 7 });
    expect(start.body).toMatchObject({ outcome: "created", version: 1 });
    expect(start.body.reason).toMatch(/Send again with key "deploy"/);
    const done = await call("POST", `/hook/${secret}`, null, { intent: "progress", key: "deploy", title: "Deployed api", status: "done" });
    expect(done.body).toMatchObject({ id: start.body.id, version: 2, outcome: "alerted" });
    expect(await get(start.body.id)).toMatchObject({
      intent: "progress",
      key: "deploy",
      title: "Deployed api",
      severity: "success",
      progress: { value: 7, max: 7, state: "done" },
    });
  });

  it("a webhook progress that goes quiet past staleAfter is marked stopped when the alarm fires", async () => {
    const { cookie, secret, get } = await setup("ci");
    const r = await call("POST", `/hook/${secret}`, null, { intent: "progress", key: "nightly", title: "Nightly build", value: 40, staleAfter: "10m" });
    const stub = await inboxOf(cookie);
    const alarmAt = await runInDurableObject(stub, (_i: InboxDO, state) => state.storage.getAlarm());
    expect(alarmAt).toBe(Date.parse((await get(r.body.id)).updatedAt) + 10 * 60_000);
    await runInDurableObject(stub, async (_i: InboxDO, state) => {
      state.storage.sql.exec(
        "UPDATE notifications SET data = json_set(data, '$.progress.lastReportAt', ?) WHERE id = ?",
        new Date(Date.now() - 11 * 60_000).toISOString(),
        r.body.id,
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await get(r.body.id)).toMatchObject({ severity: "warning", progress: { value: 40, state: "stopped", staleAfter: "10m" } });
  });

  it("rejects an ask: asks are for agents over MCP", async () => {
    const { cookie, secret } = await setup();
    const r = await call("POST", `/hook/${secret}`, null, { intent: "ask", title: "Deploy?", options: ["Yes", "No"] });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/agents over MCP/);
    expect((await call("POST", `/hook/${secret}`, null, { intent: "nudge", title: "x" })).body.error.message).toMatch(/inform.*progress/);
    expect((await call("GET", "/api/notifications", { cookie })).body.items).toHaveLength(0);
  });

  it("rejects a key held by a running progress with a conflict naming it", async () => {
    const { secret } = await setup();
    await call("POST", `/hook/${secret}`, null, { intent: "progress", key: "build", title: "Building" });
    const r = await call("POST", `/hook/${secret}`, null, { title: "Build broke", key: "build" });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/key "build" belongs to a running progress/);
  });

  it("validates JSON bodies and limits", async () => {
    const { secret } = await setup();
    const bad = await call("POST", `/hook/${secret}`, null, { title: "x", severity: "nope" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/severity/);
    expect((await call("POST", `/hook/${secret}`, null, { body: "no title" })).status).toBe(400);
    expect((await call("POST", `/hook/${secret}`, null, { title: "x", cooldown: "soon" })).body.error.message).toMatch(/cooldown/);
    const notJson = await call("POST", `/hook/${secret}`, null, "{oops", { "Content-Type": "application/json" });
    expect(notJson.status).toBe(400);
    const big = await call("POST", `/hook/${secret}`, null, "x".repeat(70 * 1024), { "Content-Type": "text/plain" });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe("payload_too_large");
    expect((await call("POST", "/hook/oyee_wh_invalid", null, { title: "x" })).status).toBe(401);
  });
});

describe("webhook: text and GET", () => {
  it("maps ntfy headers on text/plain to an inform", async () => {
    const { secret, get } = await setup();
    const res = await SELF.fetch(`${BASE}/hook/${secret}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Title": "Backup", "X-Priority": "5", Tags: "nas, backup", Click: "https://nas.local.example.com/" },
      body: "Backup failed",
    });
    expect(res.status).toBe(200);
    const n = await get(((await res.json()) as { id: string }).id);
    expect(n).toMatchObject({
      intent: "inform",
      title: "Backup",
      body: "Backup failed",
      severity: "critical",
      url: "https://nas.local.example.com/",
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

  it("accepts GET with query params as an inform, with key and cooldown", async () => {
    const { secret, get } = await setup();
    const q = "title=Hi&body=There&severity=warning&source=cron&icon=%F0%9F%94%A5&key=cron-hi&cooldown=30m";
    const r = await call("GET", `/hook/${secret}?${q}`, null);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ version: 1, outcome: "created" });
    expect(await get(r.body.id)).toMatchObject({
      intent: "inform",
      title: "Hi",
      body: "There",
      severity: "warning",
      source: "cron",
      key: "cron-hi",
      inform: { icon: "🔥", cooldown: "30m" },
    });
    const again = await call("GET", `/hook/${secret}?${q}`, null);
    expect(again.body).toMatchObject({ id: r.body.id, outcome: "updated_silently" });
  });

  it("?intent=progress reports progress by key from query parameters", async () => {
    const { secret, get } = await setup();
    const r = await call("GET", `/hook/${secret}?intent=progress&key=backup&title=Backing%20up&value=3&max=7&label=3%2F7%20disks`, null);
    expect(r.body.outcome).toBe("created");
    expect(await get(r.body.id)).toMatchObject({ intent: "progress", key: "backup", progress: { value: 3, max: 7, label: "3/7 disks", state: "running" } });
    const failed = await SELF.fetch(`${BASE}/hook/${secret}?intent=progress&key=backup&status=failed`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Title: "Backup failed" },
      body: "disk 4 is full",
    });
    expect(await failed.json()).toMatchObject({ id: r.body.id, outcome: "alerted" });
    expect(await get(r.body.id)).toMatchObject({ title: "Backup failed", body: "disk 4 is full", progress: { value: 3, state: "failed" } });
    expect((await call("GET", `/hook/${secret}?intent=progress&key=backup&value=lots`, null)).body.error.message).toMatch(/value/);
  });

  it("rejects protocol v1 card fields in JSON bodies instead of dropping them", async () => {
    const { secret } = await setup();
    const actions = await call("POST", `/hook/${secret}`, null, { title: "Scale?", actions: [{ id: "ok", label: "OK" }] });
    expect(actions.status).toBe(400);
    expect(actions.body.error.message).toMatch(/use links/);
    const rk = await call("POST", `/hook/${secret}`, null, { title: "x", replaceKey: "a" });
    expect(rk.body.error.message).toMatch(/use key/);
  });

  it("ignores the removed threadId and tags parameters and ntfy Tags headers, so old one-liners keep working", async () => {
    const { secret, get } = await setup();
    const r = await call("GET", `/hook/${secret}?title=Backup%20done&threadId=nightly&tags=nas,backup`, null);
    expect(r.status).toBe(200);
    expect(await get(r.body.id)).toMatchObject({ intent: "inform", title: "Backup done" });
    const res = await SELF.fetch(`${BASE}/hook/${secret}?threadId=nightly`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Title": "Backup", "X-Tags": "nas", Ta: "backup" },
      body: "Backup failed",
    });
    expect(res.status).toBe(200);
    expect(await get(((await res.json()) as { id: string }).id)).toMatchObject({ title: "Backup", body: "Backup failed" });
    // A JSON body is checked strictly: removed fields there still get a 400 saying what to use.
    const json = await call("POST", `/hook/${secret}`, null, { title: "x", threadId: "t" });
    expect(json.status).toBe(400);
  });

  it("rejects ?intent=ask and the removed replaceKey and template parameters", async () => {
    const { secret } = await setup();
    const ask = await call("GET", `/hook/${secret}?intent=ask&title=Deploy%3F`, null);
    expect(ask.status).toBe(400);
    expect(ask.body.error.message).toMatch(/agents over MCP/);
    const rk = await call("GET", `/hook/${secret}?title=x&replaceKey=a`, null);
    expect(rk.status).toBe(400);
    expect(rk.body.error.message).toMatch(/use key/);
    const template = await call("GET", `/hook/${secret}?template=t`, null);
    expect(template.status).toBe(400);
    expect(template.body.error.message).toMatch(/key/);
  });

  it("rate limits per token", async () => {
    const { secret } = await setup();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await call("GET", `/hook/${secret}?title=n${i}`, null)).status;
    expect(last).toBe(429);
  });

  it("maps ntfy priorities and severity labels; below-info levels are info", () => {
    expect(["1", "2", "3", "4", "5", "urgent", "x"].map(severityFromPriority)).toEqual([
      "info",
      "info",
      "info",
      "warning",
      "critical",
      "critical",
      undefined,
    ]);
    expect(["debug", "trace", "page", "ok", "weird"].map((l) => severityFromLabel(l))).toEqual(["info", "info", "critical", "success", "warning"]);
    expect(fromTextRequest({ severity: "debug" }, new Headers({ Tags: "a,b" }), "hello")).toEqual({
      intent: "inform",
      title: "hello",
      body: "hello",
      severity: "info",
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

  it("maps Alertmanager firing → an inform keyed by the group, resolved → resolves it", async () => {
    const { cookie, secret, get } = await setup("prometheus");
    const fire = await call("POST", `/hook/${secret}`, null, amPayload("firing"));
    expect(fire.status).toBe(200);
    expect(fire.body.outcome).toBe("created");
    const n = await get(fire.body.id);
    expect(n).toMatchObject({
      intent: "inform",
      key: 'am:{}:{alertname="HighCPU"}',
      title: "[FIRING:2] HighCPU",
      severity: "critical",
      status: "active",
      body: "• CPU > 90% on a\n• CPU > 90% on b",
      inform: { fields: [{ label: "cluster", value: "prod" }] },
      url: "https://alertmanager.example.com",
    });

    // Repeat notification → the same inform, alerted again (the key is the group key)
    const again = await call("POST", `/hook/${secret}`, null, amPayload("firing"));
    expect(again.body).toMatchObject({ id: fire.body.id, version: 2, outcome: "alerted" });

    const resolved = await call("POST", `/hook/${secret}`, null, amPayload("resolved"));
    expect(resolved.body).toMatchObject({ id: fire.body.id, version: 3, status: "resolved" });
    const r = await get(fire.body.id);
    expect(r).toMatchObject({ intent: "inform", status: "resolved", title: "[RESOLVED] HighCPU", severity: "success" });
    expect((await call("GET", "/api/notifications", { cookie })).body.items).toHaveLength(1);

    // Firing again after the resolution → a new inform for the group
    const refire = await call("POST", `/hook/${secret}`, null, amPayload("firing"));
    expect(refire.body).toMatchObject({ outcome: "created", version: 1 });
    expect(refire.body.id).not.toBe(fire.body.id);

    // Resolved with nothing active → a resolved inform is recorded
    const orphan = await call("POST", `/hook/${secret}`, null, { ...amPayload("resolved"), groupKey: "other" });
    expect(await get(orphan.body.id)).toMatchObject({ intent: "inform", key: "am:other", status: "resolved", title: "[RESOLVED] HighCPU" });
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
      intent: "inform",
      key: "grafana:grafana-group",
      title: "[FIRING:1] DiskFull",
      severity: "warning",
      body: "• Disk 95% full",
      url: "https://grafana.example.com/d/abc?viewPanel=2",
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
    expect(await get(note.body.id)).toMatchObject({ intent: "inform", title: "ALARM: CPU", body: "CPU above threshold", source: "aws" });
  });
});
