import type { ErrorCode } from "@oyee/schema";
import { z } from "zod";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal: 500,
};

/** An error that maps to the protocol error envelope `{ error: { code, message } }`. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Seconds until the request may succeed (sent as `Retry-After` on 429s). */
  readonly retryAfter?: number;
  constructor(code: ErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.retryAfter = retryAfter;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message } };
  }

  static fromUnknown(err: unknown): ApiError | null {
    return err instanceof ApiError ? err : null;
  }
}

export const badRequest = (m: string) => new ApiError("bad_request", m);
export const unauthorized = (m = "Authentication required") => new ApiError("unauthorized", m);
export const forbidden = (m = "Not allowed with this credential") => new ApiError("forbidden", m);
export const notFound = (m = "Not found") => new ApiError("not_found", m);
export const conflict = (m: string) => new ApiError("conflict", m);
export const rateLimited = (m: string, retryAfter: number) => new ApiError("rate_limited", m, Math.max(1, Math.ceil(retryAfter)));

export function errorResponse(err: ApiError): Response {
  const headers = err.retryAfter ? { "Retry-After": String(err.retryAfter) } : undefined;
  return Response.json(err.toJSON(), { status: err.status, headers });
}

/** Parses `data` with `schema`, throwing a `bad_request` ApiError with a readable message on failure. */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const res = schema.safeParse(data);
  if (!res.success) throw badRequest(formatZodError(res.error));
  return res.data;
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

/** What InboxDO RPC methods return: expected errors travel as values (see `guard` in inbox/do.ts). */
export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ErrorCode; message: string; retryAfter?: number } };

/** Unwraps an InboxDO RPC result, rethrowing expected failures as ApiErrors. */
type OkValue<R> = R extends { ok: true; value: infer V } ? V : never;

export async function rpc<P extends PromiseLike<RpcResult<unknown>>>(p: P): Promise<OkValue<Awaited<P>>> {
  const r = (await p) as RpcResult<unknown>;
  if (r.ok) return r.value as OkValue<Awaited<P>>;
  throw new ApiError(r.error.code, r.error.message, r.error.retryAfter);
}
