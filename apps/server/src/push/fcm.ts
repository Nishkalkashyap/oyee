/** Firebase Cloud Messaging HTTP v1 with a service-account JWT (RS256 via WebCrypto). */
import { LIMITS, type FcmData, type Notification, type PushEventType } from "@herald/schema";
import { b64urlEncode, byteLength, utf8 } from "../lib/encoding";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function parseServiceAccount(json: string | undefined): ServiceAccount | null {
  if (!json?.trim()) return null;
  try {
    const sa = JSON.parse(json) as Partial<ServiceAccount>;
    if (!sa.project_id || !sa.client_email || !sa.private_key) return null;
    return sa as ServiceAccount;
  } catch {
    return null;
  }
}

function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Module-level cache: survives across requests in the same isolate. */
let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.key === sa.client_email && tokenCache.expiresAt - 60 > now) return tokenCache.token;

  const tokenUri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
  const header = b64urlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64urlEncode(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${b64urlEncode(sig)}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { key: sa.client_email, token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

/** Builds the §7 data map, omitting `notification` if the message would exceed the inline limit. */
export function buildFcmData(
  type: PushEventType,
  id: string,
  notification: Notification | null,
  alert: boolean,
): FcmData {
  const data: FcmData = {
    type,
    id,
    version: String(notification?.version ?? 0),
    alert: alert ? "true" : "false",
  };
  if (notification) {
    const withNotification = { ...data, notification: JSON.stringify(notification) };
    if (byteLength(JSON.stringify(withNotification)) <= LIMITS.fcmInlineMaxBytes) return withNotification;
  }
  return data;
}

export interface FcmResult {
  ok: boolean;
  status: number;
  /** The registration token is no longer valid; drop it. */
  unregistered: boolean;
  error?: string;
}

export async function sendFcm(
  sa: ServiceAccount,
  fcmToken: string,
  data: FcmData,
  opts: { highPriority: boolean; collapseKey: string },
): Promise<FcmResult> {
  const accessToken = await getAccessToken(sa);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        data,
        android: {
          priority: opts.highPriority ? "HIGH" : "NORMAL",
          collapse_key: opts.collapseKey,
        },
      },
    }),
  });
  if (res.ok) {
    await res.arrayBuffer().catch(() => undefined);
    return { ok: true, status: res.status, unregistered: false };
  }
  const text = await res.text();
  let errorCode: string | undefined;
  try {
    const j = JSON.parse(text) as { error?: { status?: string; details?: { errorCode?: string }[] } };
    errorCode = j.error?.details?.find((d) => d.errorCode)?.errorCode ?? j.error?.status;
  } catch {
    // ignore
  }
  if (res.status === 401) tokenCache = null;
  const unregistered = errorCode === "UNREGISTERED" || (res.status === 404 && errorCode === "NOT_FOUND");
  return { ok: false, status: res.status, unregistered, error: `${errorCode ?? ""} ${text.slice(0, 200)}` };
}
