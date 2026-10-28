#!/usr/bin/env node
// Generates a VAPID key pair for Web Push (P-256), printed as base64url:
//   VAPID_PUBLIC_KEY  = 65-byte uncompressed public point (what browsers call applicationServerKey)
//   VAPID_PRIVATE_KEY = 32-byte private scalar
// Usage: node scripts/generate-vapid-keys.mjs
const { webcrypto } = await import("node:crypto");
const subtle = webcrypto.subtle;

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicRaw = await subtle.exportKey("raw", kp.publicKey);
const privateJwk = await subtle.exportKey("jwk", kp.privateKey);

console.log(`VAPID_PUBLIC_KEY=${b64url(publicRaw)}`);
console.log(`VAPID_PRIVATE_KEY=${privateJwk.d}`);
console.log("");
console.log("# Local: paste both lines into apps/server/.dev.vars");
console.log("# Production: put VAPID_PUBLIC_KEY in wrangler.jsonc vars, and run: wrangler secret put VAPID_PRIVATE_KEY");
