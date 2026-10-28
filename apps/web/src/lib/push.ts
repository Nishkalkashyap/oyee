/** Web Push helpers (service worker registration + VAPID subscription). */
import type { WebPushSubscription } from "@herald/schema";

const DEVICE_KEY = "herald:webDeviceId";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    window.isSecureContext
  );
}

/** VAPID public keys are base64url; PushManager wants bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return reg;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Requests permission and subscribes. Throws with a readable message on failure. */
export async function subscribeToPush(vapidPublicKey: string): Promise<WebPushSubscription> {
  if (!isPushSupported()) throw new Error("This browser doesn't support Web Push (or the page isn't served over HTTPS).");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site. Allow them in your browser's site settings and try again."
        : "Notification permission wasn't granted.",
    );
  }
  const reg = await registerServiceWorker();
  const key = urlBase64ToUint8Array(vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another VAPID key can't be reused.
  if (sub && sub.options.applicationServerKey) {
    const existing = new Uint8Array(sub.options.applicationServerKey);
    if (existing.length !== key.length || existing.some((b, i) => b !== key[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error("The browser returned an incomplete subscription.");
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getExistingSubscription();
  await sub?.unsubscribe();
}

export function rememberWebDeviceId(id: string | null): void {
  if (id) localStorage.setItem(DEVICE_KEY, id);
  else localStorage.removeItem(DEVICE_KEY);
}

export function getWebDeviceId(): string | null {
  return localStorage.getItem(DEVICE_KEY);
}

/** "Chrome on macOS" style default device name. */
export function browserDeviceName(ua: string = navigator.userAgent): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}
