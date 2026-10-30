/* Oyee service worker: Web Push (docs/protocol.md §8). Plain JS, no build step.
 * Presentation logic mirrors src/lib/webpush.ts (webPushPresentation, per intent); keep them in sync. */

const DEFAULT_ICON = "/icon-192.png";
const BADGE_ICON = "/badge-72.png";
const REPLY_ACTION = "__reply";
const ANSWER_ACTION = "answer:";
const LINK_ACTION = "link:";

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

function progressAmount(p) {
  const max = p.max || 100;
  const ratio = Math.max(0, Math.min(1, p.value / max));
  return p.label || (max === 100 ? Math.round(ratio * 100) + "%" : p.value + "/" + max);
}

function progressText(p) {
  if (p.indeterminate) return p.label || "In progress…";
  const max = p.max || 100;
  const ratio = Math.max(0, Math.min(1, p.value / max));
  const filled = Math.round(ratio * 10);
  return "▓".repeat(filled) + "░".repeat(10 - filled) + " " + progressAmount(p);
}

// ─── Per intent (≈ webPushBody / webPushActions) ────────────────────────────

const PROGRESS_ENDED = { done: "Done", failed: "Failed" };

function bodyText(n) {
  const parts = [];
  const body = stripMarkdown(n.body);
  if (body) parts.push(body);
  if (n.intent === "inform") for (const f of n.inform.fields || []) parts.push(f.label + ": " + f.value);
  if (n.intent === "progress") {
    const p = n.progress;
    if (p.state === "stopped") parts.push("Stopped reporting after " + progressAmount(p));
    else if (PROGRESS_ENDED[p.state]) parts.push(PROGRESS_ENDED[p.state] + " · " + progressAmount(p));
    else parts.push(progressText(p));
  }
  return parts.join("\n");
}

const askOpen = (n) => n.intent === "ask" && n.ask.state === "open";

function actionsFor(n) {
  if (n.intent === "inform") return (n.inform.links || []).slice(0, 2).map((l) => ({ action: LINK_ACTION + l.url, title: l.label }));
  if (!askOpen(n)) return [];
  const out = n.ask.options.slice(0, 2).map((o) => ({ action: ANSWER_ACTION + o, title: o }));
  if (n.ask.allowText && out.length < 2) out.push({ action: REPLY_ACTION, title: "Reply…" });
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
  const icon = n.intent === "inform" ? n.inform.icon : null;
  const image = n.intent === "inform" ? n.inform.image : null;
  const isEmoji = icon && !/^https?:\/\//i.test(icon);
  // Every severity alerts; only a running progress updates quietly.
  const silent = n.intent === "progress" && n.progress.state === "running";
  const options = {
    tag: n.id,
    body: bodyText(n),
    icon: icon && /^https:\/\//i.test(icon) ? icon : DEFAULT_ICON,
    badge: BADGE_ICON,
    actions: actionsFor(n),
    requireInteraction: n.severity === "critical",
    silent,
    renotify: !!alert && !silent,
    timestamp: Date.parse(n.updatedAt) || Date.now(),
    data: { id: n.id, url: n.url || null, hasReply: askOpen(n) && !!n.ask.allowText, version: n.version },
  };
  if (image) options.image = image;
  await self.registration.showNotification((isEmoji ? icon + " " : "") + n.title, options);
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
  const action = event.action || "";

  if (action === REPLY_ACTION) {
    // Web Push can't take text input: open the inbox with the reply box focused.
    event.waitUntil(openOrFocus("/inbox/" + encodeURIComponent(id) + "?reply=1"));
    return;
  }

  const openDetail = () => openOrFocus("/inbox/" + encodeURIComponent(id));

  if (action.startsWith(ANSWER_ACTION)) {
    event.waitUntil(
      post(base + "/respond", { option: action.slice(ANSWER_ACTION.length) })
        .then((res) => {
          // Not signed in, already answered or expired → let the user see why in the inbox.
          if (!res.ok) return openDetail();
        })
        .catch(openDetail),
    );
    return;
  }

  if (action.startsWith(LINK_ACTION)) {
    // A link button opens its URL; nothing is sent back.
    event.waitUntil(Promise.all([post(base + "/read").catch(() => undefined), openOrFocus(action.slice(LINK_ACTION.length))]));
    return;
  }

  if (action) {
    // A button from a popup shown by an older version of this worker: open the notification instead of guessing.
    event.waitUntil(openDetail());
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
