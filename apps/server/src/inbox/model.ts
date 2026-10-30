/** Pure notification helpers shared by the InboxDO and the intent modules: who is acting, device targeting, search. */
import type { Notification, Platform } from "@oyee/schema";
import { badRequest } from "../lib/errors";

/** Who is acting. Passed with every InboxDO call. */
export interface Actor {
  userId: string;
  /** Device that performed the action (device token), if any. */
  deviceId: string | null;
  deviceName: string | null;
  /** Webhook/MCP token used to send, if any (per-token rate limit). */
  tokenId: string | null;
  /** Default `source` for sends: token label/defaultSource, "web" or the device name. */
  defaultSource: string;
}

// ─── Device targeting ───────────────────────────────────────────────────────

export interface TargetableDevice {
  id: string;
  name: string;
  platform: Platform;
}

/** Case-insensitive, with typographic quotes folded (macOS names devices "Nishkal’s MacBook Pro"). */
const normName = (s: string) => s.trim().toLowerCase().replace(/[‘’ʼ`]/g, "'");

const describe = (devices: TargetableDevice[]) =>
  devices.length ? devices.map((d) => `${d.name} (${d.platform}, ${d.id})`).join("; ") : "none";

/**
 * Resolves `devices` (ids or names) and `platforms` to device ids. Returns null when no targeting was requested
 * (= deliver everywhere). Throws a 400 that lists the paired devices when something doesn't match, so an agent can retry.
 */
export function resolveTargets(
  devices: TargetableDevice[],
  wanted: { devices?: string[]; platforms?: Platform[] },
): string[] | null {
  const names = wanted.devices ?? [];
  const platforms = wanted.platforms ?? [];
  if (names.length === 0 && platforms.length === 0) return null;
  const ids = new Set<string>();
  for (const raw of names) {
    const q = normName(raw);
    const match =
      devices.find((d) => d.id === raw.trim()) ??
      devices.find((d) => normName(d.name) === q) ??
      (() => {
        const partial = devices.filter((d) => normName(d.name).includes(q));
        if (partial.length > 1) throw badRequest(`devices: "${raw}" matches several devices: ${describe(partial)}`);
        return partial[0];
      })();
    if (!match) throw badRequest(`devices: no paired device matches "${raw}". Paired devices: ${describe(devices)}`);
    ids.add(match.id);
  }
  for (const p of platforms) {
    const onPlatform = devices.filter((d) => d.platform === p);
    if (!onPlatform.length) throw badRequest(`platforms: no ${p} device is paired. Paired devices: ${describe(devices)}`);
    for (const d of onPlatform) ids.add(d.id);
  }
  return [...ids];
}

/** Lowercased text used for `q` search: title, body, source, an inform's rows, an ask's answer buttons. */
export function searchText(n: Notification): string {
  const extra =
    n.intent === "inform"
      ? n.inform.fields.map((f) => `${f.label} ${f.value}`).join(" ")
      : n.intent === "ask"
        ? n.ask.options.join(" ")
        : (n.progress.label ?? "");
  return [n.title, n.body ?? "", n.source, extra].join("\n").toLowerCase();
}
