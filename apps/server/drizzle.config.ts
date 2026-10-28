import { defineConfig } from "drizzle-kit";

/**
 * `pnpm db:generate` writes SQL migrations to ./migrations, which wrangler applies
 * (`wrangler d1 migrations apply oyee --local|--remote`, see wrangler.jsonc `migrations_dir`).
 * Optional: set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID and CLOUDFLARE_D1_TOKEN to use `pnpm db:studio` against the remote DB.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  ...(process.env.CLOUDFLARE_D1_TOKEN
    ? {
        driver: "d1-http" as const,
        dbCredentials: {
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
          databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
          token: process.env.CLOUDFLARE_D1_TOKEN!,
        },
      }
    : {}),
});
