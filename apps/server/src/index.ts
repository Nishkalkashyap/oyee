/** Herald Worker entry: Hono router + the per-user InboxDO Durable Object. */
import { app } from "./app";
import type { Env } from "./env";

export { InboxDO } from "./inbox/do";

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
