/**
 * Web Push via WebCrypto only:
 * - VAPID (RFC 8292): ES256 JWT, `Authorization: vapid t=<jwt>, k=<public key>`.
 * - Message encryption (RFC 8291) with the `aes128gcm` content coding (RFC 8188), single record.
 */
import type { WebPushSubscription } from "@oyee/schema";
import { b64urlDecode, b64urlEncode, concatBytes, hmacSha256, randomBytes, utf8 } from "../lib/encoding";

const RECORD_SIZE = 4096;

// ─── RFC 8291 encryption ────────────────────────────────────────────────────

export interface EncryptOptions {
  /** Test hook: fixed application-server ECDH key pair (raw public key + JWK private key). */
  asKeyPair?: { publicKey: Uint8Array; privateJwk: JsonWebKey };
  /** Test hook: fixed 16-byte salt. */
  salt?: Uint8Array;
}

/** WebCrypto's ECDH params use `public` (workers-types mislabels it `$public`). */
const ecdhParams = (pub: CryptoKey) => ({ name: "ECDH", public: pub }) as unknown as SubtleCryptoDeriveKeyAlgorithm;

async function hkdfExpand1(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array<ArrayBuffer>> {
  // One HKDF-Expand block (T(1)) is enough for every length we need (≤ 32).
  const t = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return t.slice(0, length);
}

/**
 * Encrypts `plaintext` for a push subscription. Returns the full aes128gcm body
 * (header: salt ‖ rs ‖ idlen ‖ keyid, followed by the single encrypted record).
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  uaPublicB64: string,
  authSecretB64: string,
  opts: EncryptOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(uaPublicB64);
  const authSecret = b64urlDecode(authSecretB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("invalid p256dh key");

  // Application-server ephemeral key pair.
  let asPublic: Uint8Array;
  let asPrivate: CryptoKey;
  if (opts.asKeyPair) {
    asPublic = opts.asKeyPair.publicKey;
    asPrivate = await crypto.subtle.importKey("jwk", opts.asKeyPair.privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, [
      "deriveBits",
    ]);
  } else {
    const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer);
    asPrivate = kp.privateKey;
  }

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams(uaKey), asPrivate, 256));

  // PRK_key = HMAC(auth_secret, ecdh_secret); IKM = HKDF-Expand(PRK_key, "WebPush: info" ‖ 0 ‖ ua_public ‖ as_public, 32)
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const keyInfo = concatBytes(utf8("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdfExpand1(prkKey, keyInfo, 32);

  const salt = opts.salt ?? randomBytes(16);
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand1(prk, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand1(prk, utf8("Content-Encoding: nonce\0"), 12);

  // Single (last) record: plaintext ‖ 0x02 delimiter, no extra padding.
  const padded = concatBytes(plaintext, new Uint8Array([2]));
  if (padded.length + 16 > RECORD_SIZE) throw new Error("payload too large for a single record");
  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, padded));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concatBytes(header, ciphertext);
}

/** Decrypts an aes128gcm body with the user agent's private key (used by tests; mirrors what browsers do). */
export async function decryptPayload(
  body: Uint8Array,
  uaPrivateJwk: JsonWebKey,
  uaPublicB64: string,
  authSecretB64: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const uaPublic = b64urlDecode(uaPublicB64);
  const authSecret = b64urlDecode(authSecretB64);

  const uaPrivate = await crypto.subtle.importKey("jwk", uaPrivateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams(asKey), uaPrivate, 256));
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const ikm = await hkdfExpand1(prkKey, concatBytes(utf8("WebPush: info\0"), uaPublic, asPublic), 32);
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand1(prk, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand1(prk, utf8("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, ciphertext));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (padded[end] !== 2) throw new Error("invalid padding delimiter");
  return padded.slice(0, end);
}

// ─── VAPID ──────────────────────────────────────────────────────────────────

export interface VapidKeys {
  publicKey: string; // base64url, 65-byte uncompressed P-256 point
  privateKey: string; // base64url, 32-byte scalar d
  subject: string; // mailto: or https: URL
}

/** Builds a JWK for the VAPID private key from its raw (base64url) public and private parts. */
export function vapidPrivateJwk(keys: { publicKey: string; privateKey: string }): JsonWebKey {
  const pub = b64urlDecode(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY must be a base64url uncompressed P-256 point");
  return {
    kty: "EC",
    crv: "P-256",
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d: keys.privateKey.replace(/=+$/, ""),
    ext: true,
  };
}

const vapidKeyCache = new Map<string, Promise<CryptoKey>>();

/** `Authorization` header value for a push endpoint. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const aud = new URL(endpoint).origin;
  let keyP = vapidKeyCache.get(keys.privateKey);
  if (!keyP) {
    keyP = crypto.subtle.importKey("jwk", vapidPrivateJwk(keys), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    vapidKeyCache.set(keys.privateKey, keyP);
  }
  const header = b64urlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64urlEncode(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: keys.subject }));
  const input = `${header}.${claims}`;
  // WebCrypto ECDSA returns the IEEE P1363 r‖s form, which is exactly what JWS ES256 expects.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await keyP, utf8(input));
  return `vapid t=${input}.${b64urlEncode(sig)}, k=${keys.publicKey.replace(/=+$/, "")}`;
}

// ─── Send ───────────────────────────────────────────────────────────────────

export interface WebPushResult {
  ok: boolean;
  status: number;
  /** True if the subscription is gone (404/410) and should be removed. */
  gone: boolean;
}

export async function sendWebPush(
  sub: WebPushSubscription,
  payload: string,
  keys: VapidKeys,
  opts: { ttl?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string } = {},
): Promise<WebPushResult> {
  const body = await encryptPayload(utf8(payload), sub.keys.p256dh, sub.keys.auth);
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(sub.endpoint, keys),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(opts.ttl ?? 86400),
    Urgency: opts.urgency ?? "normal",
  };
  // Topic (≤32 base64url chars) lets the push service collapse undelivered messages for the same notification.
  if (opts.topic && /^[A-Za-z0-9_-]{1,32}$/.test(opts.topic)) headers.Topic = opts.topic;
  const res = await fetch(sub.endpoint, { method: "POST", headers, body });
  // Drain the body so the connection can be reused.
  await res.arrayBuffer().catch(() => undefined);
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
