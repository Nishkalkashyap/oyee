import { LIMITS } from "@herald/schema";
import type { Context } from "hono";
import type { z } from "zod";
import { ApiError, badRequest, parseOrThrow } from "./errors";

const tooLarge = () => new ApiError("payload_too_large", `Request body exceeds ${LIMITS.maxBodyBytes} bytes`);

/** Reads the body as text, enforcing LIMITS.maxBodyBytes. */
export async function readBodyText(c: Context): Promise<string> {
  const declared = Number(c.req.header("Content-Length") ?? "0");
  if (declared > LIMITS.maxBodyBytes) throw tooLarge();
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > LIMITS.maxBodyBytes) throw tooLarge();
  return new TextDecoder().decode(buf);
}

/** Reads + validates a JSON body. An empty body is treated as `{}`. */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const text = await readBodyText(c);
  let data: unknown = {};
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      throw badRequest("Body is not valid JSON");
    }
  }
  return parseOrThrow(schema, data);
}
