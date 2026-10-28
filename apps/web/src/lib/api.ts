/**
 * Typed REST client for the Herald API (docs/protocol.md §3). Same-origin, cookie session.
 * The transport is swappable so mock mode can serve fixtures without a backend.
 */
import type {
  CreateTokenInput,
  CreateTokenResult,
  Device,
  ErrorCode,
  ListNotificationsQuery,
  Notification,
  Page,
  PairingCode,
  RegisterWebDeviceInput,
  RespondInput,
  SendNotificationInput,
  ServerConfig,
  SourceSummary,
  Template,
  TokenInfo,
  UpdateNotificationInput,
  UpsertTemplateInput,
  User,
} from "@herald/schema";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface TransportResponse {
  status: number;
  data: unknown;
}

export type Transport = (method: HttpMethod, path: string, body?: unknown) => Promise<TransportResponse>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "network";
  constructor(status: number, code: ErrorCode | "network", message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

const fetchTransport: Transport = async (method, path, body) => {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, "network", e instanceof Error ? `Network error: ${e.message}` : "Network error");
  }
  if (res.status === 204) return { status: 204, data: null };
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data };
};

let transport: Transport = fetchTransport;

/** Replace the transport (mock mode / tests). */
export function setTransport(t: Transport): void {
  transport = t;
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  429: "rate_limited",
};

/** Turns a non-2xx response into an ApiError, reading the `{ error: { code, message } }` envelope when present. */
export function toApiError(status: number, data: unknown): ApiError {
  const env = data as { error?: { code?: unknown; message?: unknown } } | null;
  const code =
    env && typeof env === "object" && env.error && typeof env.error.code === "string"
      ? (env.error.code as ErrorCode)
      : (STATUS_CODES[status] ?? "internal");
  const message =
    env && typeof env === "object" && env.error && typeof env.error.message === "string"
      ? env.error.message
      : typeof data === "string" && data && data.length < 300 && !data.trimStart().startsWith("<")
        ? data
        : `Request failed (${status})`;
  return new ApiError(status, code, message);
}

export async function request<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  const res = await transport(method, path, body);
  if (res.status >= 200 && res.status < 300) return res.data as T;
  throw toApiError(res.status, res.data);
}

/** Builds `?a=1&b=2`, dropping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const enc = encodeURIComponent;

export type ListParams = Partial<Omit<ListNotificationsQuery, "limit">> & { limit?: number };

export const api = {
  config: () => request<ServerConfig>("GET", "/api/config"),
  me: () => request<User>("GET", "/api/me"),
  logout: () => request<unknown>("POST", "/auth/logout"),

  tokens: {
    list: () => request<{ items: TokenInfo[] }>("GET", "/api/tokens"),
    create: (input: CreateTokenInput) => request<CreateTokenResult>("POST", "/api/tokens", input),
    revoke: (id: string) => request<null>("DELETE", `/api/tokens/${enc(id)}`),
  },

  devices: {
    list: () => request<{ items: Device[] }>("GET", "/api/devices"),
    createPairingCode: () => request<PairingCode>("POST", "/api/devices/pairing-codes"),
    remove: (id: string) => request<null>("DELETE", `/api/devices/${enc(id)}`),
    registerWeb: (input: RegisterWebDeviceInput) => request<Device>("POST", "/api/devices/web", input),
  },

  notifications: {
    list: (p: ListParams) =>
      request<Page<Notification>>(
        "GET",
        `/api/notifications${qs({
          limit: p.limit,
          cursor: p.cursor,
          source: p.source,
          severity: p.severity,
          status: p.status,
          threadId: p.threadId,
          q: p.q,
          updatedSince: p.updatedSince,
        })}`,
      ),
    get: (id: string) => request<Notification>("GET", `/api/notifications/${enc(id)}`),
    send: (input: SendNotificationInput) => request<Notification>("POST", "/api/notifications", input),
    update: (id: string, input: UpdateNotificationInput) =>
      request<Notification>("PATCH", `/api/notifications/${enc(id)}`, input),
    respond: (id: string, input: RespondInput) =>
      request<Notification>("POST", `/api/notifications/${enc(id)}/respond`, input),
    read: (id: string) => request<Notification>("POST", `/api/notifications/${enc(id)}/read`),
    readAll: (source?: string) =>
      request<{ updated: number }>("POST", "/api/notifications/read-all", source ? { source } : {}),
    resolve: (id: string) => request<Notification>("POST", `/api/notifications/${enc(id)}/resolve`),
    remove: (id: string) => request<null>("DELETE", `/api/notifications/${enc(id)}`),
  },

  sources: () => request<{ items: SourceSummary[] }>("GET", "/api/sources"),

  templates: {
    list: () => request<{ items: Template[] }>("GET", "/api/templates"),
    get: (name: string) => request<Template>("GET", `/api/templates/${enc(name)}`),
    put: (name: string, input: UpsertTemplateInput) => request<Template>("PUT", `/api/templates/${enc(name)}`, input),
    remove: (name: string) => request<null>("DELETE", `/api/templates/${enc(name)}`),
    preview: (name: string, vars: Record<string, string | number | boolean>) =>
      request<SendNotificationInput>("POST", `/api/templates/${enc(name)}/preview`, { vars }),
  },
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
