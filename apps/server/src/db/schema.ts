/**
 * Oyee D1 schema (global data) — source of truth for migrations.
 * Per-user notifications/templates live in the InboxDO SQLite storage, not here.
 *
 * Change this file, then `pnpm --filter @oyee/server db:generate` to create a migration in `migrations/`.
 */
import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Platform, TokenKind } from "@oyee/schema";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // usr_<ulid>
  email: text("email").notNull().unique(), // stored lower-cased
  name: text("name"),
  avatarUrl: text("avatar_url"),
  googleSub: text("google_sub").unique(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Browser sessions. The cookie holds a random id; only its SHA-256 hash is stored. */
export const sessions = sqliteTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user").on(t.userId)],
);

/** Webhook / MCP tokens. `hash` = SHA-256(secret). `callbackSecret` signs action callbacks (X-Oyee-Signature). */
export const tokens = sqliteTable(
  "tokens",
  {
    id: text("id").primaryKey(), // tok_<ulid>
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<TokenKind>().notNull(),
    label: text("label").notNull(),
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull().unique(),
    defaultSource: text("default_source"),
    callbackSecret: text("callback_secret").notNull(),
    createdAt: text("created_at").notNull(),
    lastUsedAt: text("last_used_at"),
  },
  (t) => [index("tokens_user").on(t.userId), check("tokens_kind", sql`${t.kind} IN ('webhook', 'mcp')`)],
);

/** Paired native clients (`tokenHash` set) and browser Web Push registrations (`webPushEndpoint` set). */
export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(), // dev_<ulid>
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").$type<Platform>().notNull(),
    tokenHash: text("token_hash").unique(),
    fcmToken: text("fcm_token"),
    webPush: text("web_push"), // PushSubscriptionJSON
    webPushEndpoint: text("web_push_endpoint").unique(),
    createdAt: text("created_at").notNull(),
    lastSeenAt: text("last_seen_at"),
  },
  (t) => [
    index("devices_user").on(t.userId),
    check("devices_platform", sql`${t.platform} IN ('android', 'ios', 'macos', 'web')`),
  ],
);

export const pairingCodes = sqliteTable("pairing_codes", {
  code: text("code").primaryKey(), // normalized, 8 chars, no dash
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

/** Google OAuth authorization-code flow (state + PKCE verifier), 10 minute TTL. */
export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  codeVerifier: text("code_verifier").notNull(),
  redirect: text("redirect").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export type UserRow = typeof users.$inferSelect;
export type TokenRow = typeof tokens.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
