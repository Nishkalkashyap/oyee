import { applyD1Migrations, env } from "cloudflare:test";

// Setup files run outside per-test-file isolation, so this applies once per test runner; applyD1Migrations is idempotent.
await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS);
