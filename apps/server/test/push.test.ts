/** Push fan-out against mocked FCM / push-service endpoints, using the throwaway keys from vitest.config.ts. */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { b64urlDecode, b64urlDecodeString, b64urlEncode, utf8 } from "../src/lib/encoding";
import { decryptPayload } from "../src/push/webpush";
import { call, devLogin, eventually, pairDevice, sleep } from "./helpers";

afterEach(() => vi.restoreAllMocks());

interface Captured {
  url: string;
  headers: Headers;
  body: Uint8Array;
}

/** Intercepts fetches whose URL starts with one of `prefixes`; `reply` decides the response. */
function intercept(prefixes: string[], reply: (req: Captured, index: number) => Response) {
  const realFetch = globalThis.fetch;
  const seen: Captured[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const req = new Request(input as RequestInfo, init as RequestInit);
    if (prefixes.some((p) => req.url.startsWith(p))) {
      const c = { url: req.url, headers: req.headers, body: new Uint8Array(await req.arrayBuffer()) };
      seen.push(c);
      return reply(c, seen.length - 1);
    }
    return realFetch(input as RequestInfo, init as RequestInit);
  });
  return seen;
}

describe("Web Push fan-out", () => {
  it("sends encrypted, VAPID-signed pushes per §8 and removes gone subscriptions", async () => {
    const cookie = await devLogin();
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const p256dh = b64urlEncode((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer);
    const uaJwk = (await crypto.subtle.exportKey("jwk", ua.privateKey)) as JsonWebKey;
    const auth = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const endpoint = `https://push.example.net/sub/${crypto.randomUUID()}`;
    const dev = await call("POST", "/api/devices/web", { cookie }, { name: "Firefox", subscription: { endpoint, keys: { p256dh, auth } } });
    expect(dev.status).toBe(201);

    let gone = false;
    const seen = intercept(["https://push.example.net/"], () => new Response(null, { status: gone ? 410 : 201 }));
    const decrypt = async (i: number) =>
      JSON.parse(new TextDecoder().decode(await decryptPayload(seen[i]!.body, uaJwk, p256dh, auth)));

    const sent = await call("POST", "/api/notifications", { cookie }, { title: "Push me", severity: "critical" });
    await eventually(() => seen.length === 1);
    const first = seen[0]!;
    expect(first.url).toBe(endpoint);
    expect(first.headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(first.headers.get("Urgency")).toBe("high");
    expect(first.headers.get("Topic")).toBe(sent.body.id);
    expect(Number(first.headers.get("TTL"))).toBeGreaterThan(0);

    // VAPID: ES256 JWT for the push service origin, verifiable with VAPID_PUBLIC_KEY
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(first.headers.get("Authorization") ?? "")!;
    expect(m[4]).toBe(env.VAPID_PUBLIC_KEY);
    expect(JSON.parse(b64urlDecodeString(m[2]!))).toMatchObject({ aud: "https://push.example.net", sub: "mailto:test@herald.test" });
    const vapidKey = await crypto.subtle.importKey("raw", b64urlDecode(env.VAPID_PUBLIC_KEY!), { name: "ECDSA", namedCurve: "P-256" }, false, [
      "verify",
    ]);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, vapidKey, b64urlDecode(m[3]!), utf8(`${m[1]}.${m[2]}`))).toBe(true);

    const payload = await decrypt(0);
    expect(payload).toMatchObject({ type: "notification.created", id: sent.body.id, notification: { title: "Push me" } });

    // Silent update → no push; resolve → push (close-worthy)
    await call("PATCH", `/api/notifications/${sent.body.id}`, { cookie }, { body: "quiet change" });
    await call("POST", `/api/notifications/${sent.body.id}/resolve`, { cookie });
    await eventually(() => seen.length === 2);
    await sleep(100);
    expect(seen).toHaveLength(2);
    expect(await decrypt(1)).toMatchObject({ type: "notification.updated", notification: { status: "resolved", body: "quiet change" } });

    // 410 Gone → the web device is removed
    gone = true;
    await call("DELETE", `/api/notifications/${sent.body.id}`, { cookie });
    await eventually(() => seen.length === 3);
    expect(await decrypt(2)).toEqual({ type: "notification.deleted", id: sent.body.id, notification: null });
    await eventually(async () => (await call("GET", "/api/devices", { cookie })).body.items.length === 0);
  });
});

describe("FCM fan-out", () => {
  it("sends data-only messages with a service-account token and drops UNREGISTERED tokens", async () => {
    const cookie = await devLogin();
    const dev = await pairDevice(cookie, "Pixel 9", "android");
    expect((await call("PUT", "/api/devices/self", { bearer: dev.token }, { fcmToken: "fcm-token-1" })).status).toBe(200);

    let unregistered = false;
    const seen = intercept(["https://oauth2.googleapis.com/token", "https://fcm.googleapis.com/"], (req) => {
      if (req.url.startsWith("https://oauth2.googleapis.com/")) {
        return Response.json({ access_token: "ya29.test-token", expires_in: 3600, token_type: "Bearer" });
      }
      if (unregistered) {
        return Response.json(
          {
            error: {
              code: 404,
              status: "NOT_FOUND",
              details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }],
            },
          },
          { status: 404 },
        );
      }
      return Response.json({ name: "projects/herald-test/messages/1" });
    });
    const fcmCalls = () => seen.filter((s) => s.url.startsWith("https://fcm.googleapis.com/"));

    const sent = await call("POST", "/api/notifications", { cookie }, { title: "Disk full", severity: "warning" });
    await eventually(() => fcmCalls().length === 1);

    // OAuth: JWT bearer assertion signed RS256 by the service account
    const tokenReq = seen.find((s) => s.url.startsWith("https://oauth2.googleapis.com/"));
    expect(tokenReq).toBeDefined();
    {
      const form = new URLSearchParams(new TextDecoder().decode(tokenReq!.body));
      expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      const [h, c, sig] = form.get("assertion")!.split(".");
      expect(JSON.parse(b64urlDecodeString(h!))).toEqual({ alg: "RS256", typ: "JWT" });
      expect(JSON.parse(b64urlDecodeString(c!))).toMatchObject({
        iss: "fcm@herald-test.iam.gserviceaccount.com",
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
      });
      const pem = (env as unknown as { TEST_FCM_PUBLIC_KEY_PEM: string }).TEST_FCM_PUBLIC_KEY_PEM;
      const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, "")), (ch) => ch.charCodeAt(0));
      const pub = await crypto.subtle.importKey("spki", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pub, b64urlDecode(sig!), utf8(`${h}.${c}`))).toBe(true);
    }

    const call1 = fcmCalls()[0]!;
    expect(call1.url).toBe("https://fcm.googleapis.com/v1/projects/herald-test/messages:send");
    expect(call1.headers.get("Authorization")).toBe("Bearer ya29.test-token");
    const msg = JSON.parse(new TextDecoder().decode(call1.body)).message;
    expect(msg.token).toBe("fcm-token-1");
    expect(msg.notification).toBeUndefined(); // data-only
    expect(msg.android).toEqual({ priority: "HIGH", collapse_key: sent.body.id });
    expect(msg.data).toMatchObject({ type: "notification.created", id: sent.body.id, version: "1", alert: "true" });
    expect(Object.values(msg.data).every((v) => typeof v === "string")).toBe(true);
    expect(JSON.parse(msg.data.notification).title).toBe("Disk full");

    // UNREGISTERED → token dropped
    unregistered = true;
    await call("PATCH", `/api/notifications/${sent.body.id}`, { cookie }, { title: "Disk still full", alert: true });
    await eventually(() => fcmCalls().length === 2);
    const update = JSON.parse(new TextDecoder().decode(fcmCalls()[1]!.body)).message;
    expect(update.data).toMatchObject({ type: "notification.updated", version: "2", alert: "true" });
    await eventually(async () => {
      const devices = (await call("GET", "/api/devices", { cookie })).body.items as { transports: string[] }[];
      return devices.length === 1 && !devices[0]!.transports.includes("fcm");
    });
  });
});
