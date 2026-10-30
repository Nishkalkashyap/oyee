import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlDecodeString, b64urlEncode, utf8 } from "../src/lib/encoding";
import { decryptPayload, encryptPayload, vapidAuthorization, vapidPrivateJwk } from "../src/push/webpush";
import { buildFcmData } from "../src/push/fcm";
import { shouldWebPush } from "../src/push/fanout";
import type { Notification } from "@oyee/schema";

/** RFC 8291 Appendix A test vector. */
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const ecdhJwk = (publicKey: string, privateKey: string): JsonWebKey => ({ ...vapidPrivateJwk({ publicKey, privateKey }) });

describe("Web Push encryption (RFC 8291, aes128gcm)", () => {
  it("matches the RFC 8291 Appendix A test vector", async () => {
    const body = await encryptPayload(utf8(RFC.plaintext), RFC.uaPublic, RFC.authSecret, {
      asKeyPair: { publicKey: b64urlDecode(RFC.asPublic), privateJwk: ecdhJwk(RFC.asPublic, RFC.asPrivate) },
      salt: b64urlDecode(RFC.salt),
    });
    expect(b64urlEncode(body)).toBe(RFC.body);
  });

  it("decrypts the RFC vector with the user agent key", async () => {
    const plain = await decryptPayload(b64urlDecode(RFC.body), ecdhJwk(RFC.uaPublic, RFC.uaPrivate), RFC.uaPublic, RFC.authSecret);
    expect(new TextDecoder().decode(plain)).toBe(RFC.plaintext);
  });

  it("round-trips with fresh keys (as a browser would decrypt)", async () => {
    const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const uaPublic = b64urlEncode((await crypto.subtle.exportKey("raw", ua.publicKey)) as ArrayBuffer);
    const uaJwk = (await crypto.subtle.exportKey("jwk", ua.privateKey)) as JsonWebKey;
    const auth = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const message = JSON.stringify({ type: "notification.created", id: "ntf_1", notification: null, note: "héllo 🔔" });
    const body = await encryptPayload(utf8(message), uaPublic, auth);
    expect(body.length).toBe(16 + 4 + 1 + 65 + utf8(message).length + 1 + 16);
    expect(new TextDecoder().decode(await decryptPayload(body, uaJwk, uaPublic, auth))).toBe(message);
  });
});

describe("VAPID", () => {
  it("produces a verifiable ES256 JWT", async () => {
    const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const publicKey = b64urlEncode((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
    const privateKey = ((await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey).d!;
    const header = await vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      { publicKey, privateKey, subject: "mailto:a@b.c" },
      1_700_000_000,
    );
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m).not.toBeNull();
    expect(m[4]).toBe(publicKey);
    expect(JSON.parse(b64urlDecodeString(m[1]!))).toEqual({ typ: "JWT", alg: "ES256" });
    expect(JSON.parse(b64urlDecodeString(m[2]!))).toEqual({ aud: "https://fcm.googleapis.com", exp: 1_700_000_000 + 43200, sub: "mailto:a@b.c" });
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      kp.publicKey,
      b64urlDecode(m[3]!),
      utf8(`${m[1]}.${m[2]}`),
    );
    expect(ok).toBe(true);
  });
});

describe("push payload rules", () => {
  const n = (over: Partial<Pick<Notification, "body" | "status">> = {}): Notification => ({
    id: "ntf_X",
    intent: "inform",
    source: "s",
    key: null,
    title: "t",
    body: null,
    severity: "info",
    status: "active",
    url: null,
    version: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    readAt: null,
    resolvedAt: null,
    inform: { links: [], fields: [], image: null, icon: null, cooldown: null },
    ...over,
  });

  it("FCM data map is all strings and omits large notifications", () => {
    const small = buildFcmData("notification.updated", "ntf_X", n(), false);
    expect(small).toMatchObject({ type: "notification.updated", id: "ntf_X", version: "3", alert: "false" });
    expect(JSON.parse(small.notification!).id).toBe("ntf_X");
    const big = buildFcmData("notification.created", "ntf_X", n({ body: "x".repeat(3900) }), true);
    expect(big.notification).toBeUndefined();
    expect(big.alert).toBe("true");
  });

  it("Web Push only for created, alerting updates and close-worthy changes", () => {
    expect(shouldWebPush({ type: "notification.created", notification: n() })).toBe(true);
    expect(shouldWebPush({ type: "notification.deleted", id: "x" })).toBe(true);
    expect(shouldWebPush({ type: "notification.updated", notification: n(), alert: false, reason: "update" })).toBe(false);
    expect(shouldWebPush({ type: "notification.updated", notification: n(), alert: true, reason: "update" })).toBe(true);
    expect(shouldWebPush({ type: "notification.updated", notification: n(), alert: false, reason: "read" })).toBe(true);
    expect(shouldWebPush({ type: "notification.updated", notification: n({ status: "resolved" }), alert: false, reason: "responded" })).toBe(true);
  });
});
