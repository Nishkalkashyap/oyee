/* Herald service worker: Web Push (docs/protocol.md §8). Plain JS, no build step.
 * Presentation logic mirrors src/lib/webpush.ts + src/lib/format.ts (systemNotificationBody); keep them in sync. */

const DEFAULT_ICON = "/icon-192.png";
const BADGE_ICON = "/badge-72.png";
const REPLY_ACTION = "__reply";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// ─── Text helpers (markdown subset → plain text) ────────────────────────────

function stripMarkdown(s) {
  if (!s) return "";
  return String(s)
    .replace(/\r\n?/g, "\n")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*/g, "$1$2")
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1$2")
    .replace(/\\([\\`*_[\]()~])/g, "$1")
    .trim();
}

function progressText(p) {
  if (p.indeterminate) return p.label || "In progress…";
  const max = p.max || 100;
  const ratio = Math.max(0, Math.min(1, p.value / max));
  const filled = Math.round(ratio * 10);
  const bar = "▓".repeat(filled) + "░".repeat(10 - filled);
  return bar + " " + (p.label || (max === 100 ? Math.round(ratio * 100) + "%" : p.value + "/" + max));
}

function bodyText(n) {
  const parts = [];
  const body = stripMarkdown(n.body);
  if (body) parts.push(body);
  for (const f of n.fields || []) parts.push(f.label + ": " + f.value);
  if (n.progress) parts.push(progressText(n.progress));
  return parts.join("\n");
}

function actionsFor(n) {
  const out = (n.actions || [])
    .filter((a) => !a.url)
    .slice(0, 2)
    .map((a) => ({ action: a.id, title: a.label }));
  if (n.reply && out.length < 2) out.push({ action: REPLY_ACTION, title: n.reply.buttonLabel || "Reply…" });
  return out;
}

// ─── Show / close ───────────────────────────────────────────────────────────

async function closeTag(id) {
  const shown = await self.registration.getNotifications({ tag: id });
  shown.forEach((x) => x.close());
}

async function fetchNotification(id) {
  try {
    const res = await fetch("/api/notifications/" + encodeURIComponent(id), { credentials: "include" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function show(n, alert) {
  const isEmoji = n.icon && !/^https?:\/\//i.test(n.icon);
  const silent = !!n.silent || n.severity === "debug";
  const options = {
    tag: n.id,
    body: bodyText(n),
    icon: n.icon && /^https:\/\//i.test(n.icon) ? n.icon : DEFAULT_ICON,
    badge: BADGE_ICON,
    actions: actionsFor(n),
    requireInteraction: n.severity === "critical",
    silent,
    renotify: !!alert && !silent,
    timestamp: Date.parse(n.updatedAt) || Date.now(),
    data: { id: n.id, url: n.url || null, hasReply: !!n.reply, version: n.version },
  };
  if (n.image) options.image = n.image;
  await self.registration.showNotification((isEmoji ? n.icon + " " : "") + n.title, options);
}

async function handlePush(payload) {
  if (!payload || !payload.id) return;
  if (payload.type === "notification.deleted") return closeTag(payload.id);

  let n = payload.notification;
  if (!n) n = await fetchNotification(payload.id); // payload too large → fetch it
  if (!n) return;

  // Read or resolved elsewhere → remove the system notification.
  if (n.readAt || n.status === "resolved") return closeTag(n.id);

  // §8: `updated` pushes are only sent when they alert (or close, handled above).
  await show(n, true);
}

self.addEventListener("push", (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    payload = null;
  }
  event.waitUntil(handlePush(payload));
});

// ─── Clicks ─────────────────────────────────────────────────────────────────

async function openOrFocus(url) {
  const target = new URL(url, self.location.origin);
  const sameOrigin = target.origin === self.location.origin;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (sameOrigin) {
    const client = windows.find((c) => new URL(c.url).origin === self.location.origin);
    if (client) {
      // Route inside the SPA without a full reload; Layout listens for this message.
      client.postMessage({ type: "navigate", url: target.pathname + target.search });
      return client.focus();
    }
  }
  return self.clients.openWindow(target.href);
}

function post(path, body) {
  return fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const data = notification.data || {};
  const id = data.id;
  notification.close();
  if (!id) return;
  const base = "/api/notifications/" + encodeURIComponent(id);

  if (event.action === REPLY_ACTION) {
    // Web Push can't take text input: open the inbox with the reply box focused.
    event.waitUntil(openOrFocus("/inbox/" + encodeURIComponent(id) + "?reply=1"));
    return;
  }

  if (event.action) {
    event.waitUntil(
      post(base + "/respond", { actionId: event.action })
        .then((res) => {
          // Not signed in / failed → let the user finish in the inbox.
          if (!res.ok) return openOrFocus("/inbox/" + encodeURIComponent(id));
        })
        .catch(() => openOrFocus("/inbox/" + encodeURIComponent(id))),
    );
    return;
  }

  // Body click → mark read, then open the URL or the notification detail.
  event.waitUntil(
    Promise.all([
      post(base + "/read").catch(() => undefined),
      openOrFocus(data.url || "/inbox/" + encodeURIComponent(id)),
    ]),
  );
});
