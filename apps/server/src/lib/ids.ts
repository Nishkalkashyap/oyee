import { PAIRING_ALPHABET, TOKEN_PREFIX } from "@oyee/schema";
import { b64urlEncode, randomBytes } from "./encoding";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastTime = -1;
let lastRandom: number[] = [];

/** Monotonic ULID (26 chars, Crockford base32, time-sortable). */
export function ulid(now = Date.now()): string {
  let rand: number[];
  if (now <= lastTime && lastRandom.length === 16) {
    // Same (or earlier, Workers clocks freeze within a request) millisecond: increment the random part.
    now = lastTime;
    rand = lastRandom.slice();
    for (let i = 15; i >= 0; i--) {
      if (rand[i]! < 31) {
        rand[i]!++;
        break;
      }
      rand[i] = 0;
    }
  } else {
    const bytes = randomBytes(16);
    rand = Array.from(bytes, (b) => b & 31);
  }
  lastTime = now;
  lastRandom = rand;

  let t = now;
  let timePart = "";
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[t % 32] + timePart;
    t = Math.floor(t / 32);
  }
  return timePart + rand.map((r) => CROCKFORD[r]).join("");
}

export type IdPrefix = "usr" | "ntf" | "tok" | "dev" | "tpl";
export const newId = (prefix: IdPrefix) => `${prefix}_${ulid()}`;

/** A new secret token like `oyee_wh_<43 chars>` (32 random bytes, base64url). */
export function newSecret(kind: keyof typeof TOKEN_PREFIX): string {
  return TOKEN_PREFIX[kind] + b64urlEncode(randomBytes(32));
}

/** Display prefix for a token, e.g. `oyee_wh_ab12`. */
export function secretPrefix(secret: string): string {
  // `hrd_` is the prefix tokens had before the rename from Herald; they keep working.
  const m = /^((?:oyee|hrd)_(?:wh|mcp|dev)_)(.*)$/.exec(secret);
  return m ? m[1]! + m[2]!.slice(0, 4) : secret.slice(0, 8);
}

/** 8 chars from the pairing alphabet (no ambiguous characters). */
export function newPairingCode(): string {
  const bytes = randomBytes(8);
  let s = "";
  // 256 % 31 != 0 → tiny bias; acceptable for a 10-minute single-use code, but we reject-sample anyway.
  for (let i = 0; i < 8; i++) {
    let b = bytes[i]!;
    while (b >= 248) b = randomBytes(1)[0]!;
    s += PAIRING_ALPHABET[b % PAIRING_ALPHABET.length];
  }
  return s;
}

export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Normalizes user input: strips dashes/spaces, uppercases. */
export function normalizePairingCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}
