/** Device targeting: `devices` / `platforms` on send, ask and webhooks; push fan-out only reaches targeted devices. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTargets } from "../src/inbox/model";
import { call, createToken, devLogin, eventually, pairDevice, sleep } from "./helpers";

afterEach(() => vi.restoreAllMocks());

const DEVICES = [
  { id: "dev_mac", name: "Nishkal’s MacBook Pro", platform: "macos" as const },
  { id: "dev_phone", name: "Galaxy S23 Ultra", platform: "android" as const },
  { id: "dev_web", name: "Brave on macOS", platform: "web" as const },
];

describe("resolveTargets", () => {
  it("returns null (= everywhere) when nothing is requested", () => {
    expect(resolveTargets(DEVICES, {})).toBeNull();
    expect(resolveTargets(DEVICES, { devices: [], platforms: [] })).toBeNull();
  });

  it("matches ids, exact names (curly quotes folded) and unique partial names", () => {
    expect(resolveTargets(DEVICES, { devices: ["dev_phone"] })).toEqual(["dev_phone"]);
    expect(resolveTargets(DEVICES, { devices: ["nishkal's macbook pro"] })).toEqual(["dev_mac"]);
    expect(resolveTargets(DEVICES, { devices: ["MacBook"] })).toEqual(["dev_mac"]);
    expect(resolveTargets(DEVICES, { devices: ["galaxy"], platforms: ["web"] })).toEqual(["dev_phone", "dev_web"]);
  });

  it("rejects ambiguous and unknown targets with the device list", () => {
    expect(() => resolveTargets(DEVICES, { devices: ["mac"] })).toThrow(/matches several devices/);
    expect(() => resolveTargets(DEVICES, { devices: ["iphone"] })).toThrow(/Paired devices: Nishkal’s MacBook Pro \(macos, dev_mac\)/);
    expect(() => resolveTargets(DEVICES, { platforms: ["ios"] })).toThrow(/no ios device is paired/);
  });
});

function interceptFcm() {
  const realFetch = globalThis.fetch;
  const tokens: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init as RequestInit);
    if (req.url.startsWith("https://oauth2.googleapis.com/")) {
      return Response.json({ access_token: "ya29.test", expires_in: 3600, token_type: "Bearer" });
    }
    if (req.url.startsWith("https://fcm.googleapis.com/")) {
      tokens.push((await req.json<{ message: { token: string } }>()).message.token);
      return Response.json({ name: "projects/oyee-test/messages/1" });
    }
    return realFetch(input as RequestInfo, init as RequestInit);
  });
  return tokens;
}

describe("targeted delivery", () => {
  it("pushes only to the targeted device but keeps the item in every inbox", async () => {
    const cookie = await devLogin();
    const phone = await pairDevice(cookie, "Galaxy S23 Ultra", "android");
    const tablet = await pairDevice(cookie, "Galaxy Tab", "android");
    await call("PUT", "/api/devices/self", { bearer: phone.token }, { fcmToken: "fcm-phone" });
    await call("PUT", "/api/devices/self", { bearer: tablet.token }, { fcmToken: "fcm-tablet" });
    const fcm = interceptFcm();

    const sent = await call("POST", "/api/notifications", { cookie }, { intent: "progress", key: "only-phone", title: "Only the phone", devices: ["s23"] });
    expect(sent.status).toBe(201);
    expect(sent.body.notification.targetDeviceIds).toEqual([phone.device.id]);
    await eventually(() => fcm.length === 1);
    await sleep(100);
    expect(fcm).toEqual(["fcm-phone"]);

    // Updates follow the original targets.
    await call("POST", "/api/notifications", { cookie }, { intent: "progress", key: "only-phone", title: "Still only the phone", status: "done" });
    await eventually(() => fcm.length === 2);
    expect(fcm[1]).toBe("fcm-phone");

    // The other device still sees it in its inbox.
    const list = await call("GET", "/api/notifications", { bearer: tablet.token });
    expect(list.body.items.map((n: { id: string }) => n.id)).toContain(sent.body.id);

    // Untargeted sends reach both.
    await call("POST", "/api/notifications", { cookie }, { title: "Everyone" });
    await eventually(() => fcm.length === 4);
    expect(fcm.slice(2).sort()).toEqual(["fcm-phone", "fcm-tablet"]);
  });

  it("MCP inform/ask accept targets and explain unknown devices", async () => {
    const cookie = await devLogin();
    await pairDevice(cookie, "Nishkal’s MacBook Pro", "macos");
    const { secret } = await createToken(cookie, "mcp", "Agent");
    const tool = async (name: string, args: unknown) => {
      const res = await call("POST", `/mcp/${secret}`, null, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, {
        Accept: "application/json, text/event-stream",
      });
      return res.body.result as { isError?: boolean; content: { text: string }[] };
    };

    const ok = await tool("inform", { title: "Mac only", devices: ["macbook"] });
    expect(ok.isError).toBeFalsy();
    const id = /^id: (ntf_\w+)$/m.exec(ok.content[0]!.text)![1];
    expect((await call("GET", `/api/notifications/${id}`, { cookie })).body.targetDeviceIds).toHaveLength(1);

    const asked = await tool("ask", { title: "Mac question?", options: ["Yes"], platforms: ["macos"] });
    expect(asked.isError).toBeFalsy();

    const bad = await tool("inform", { title: "Nope", devices: ["pixel"] });
    expect(bad.isError).toBe(true);
    expect(bad.content[0]!.text).toMatch(/no paired device matches "pixel".*MacBook Pro \(macos/);
  });

  it("webhooks take ?devices= / ?platforms=", async () => {
    const cookie = await devLogin();
    const mac = await pairDevice(cookie, "Studio Mac", "macos");
    const { secret } = await createToken(cookie, "webhook", "HA");
    const res = await call("POST", `/hook/${secret}?title=Door&platforms=macos`, null, "Front door opened", { "Content-Type": "text/plain" });
    expect(res.status).toBe(200);
    const n = await call("GET", `/api/notifications/${res.body.id}`, { cookie });
    expect(n.body.targetDeviceIds).toEqual([mac.device.id]);
  });

  it("devices can be renamed from the web session", async () => {
    const cookie = await devLogin();
    const phone = await pairDevice(cookie, "SM-S918B", "android");
    const r = await call("PATCH", `/api/devices/${phone.device.id}`, { cookie }, { name: "Galaxy S23 Ultra" });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe("Galaxy S23 Ultra");
    expect((await call("PATCH", `/api/devices/${phone.device.id}`, { bearer: phone.token }, { name: "x" })).status).toBe(403);
  });
});
