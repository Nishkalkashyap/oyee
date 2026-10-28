-- Herald D1 schema (global data). Per-user notifications/templates live in the InboxDO SQLite storage.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,               -- usr_<ulid>
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT,
  avatar_url  TEXT,
  google_sub  TEXT UNIQUE,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Browser sessions. The cookie holds a random id; only its SHA-256 hash is stored.
CREATE TABLE sessions (
  id_hash      TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent   TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Webhook / MCP tokens. `hash` = SHA-256(secret). `callback_secret` signs action callbacks (X-Herald-Signature).
CREATE TABLE tokens (
  id              TEXT PRIMARY KEY,           -- tok_<ulid>
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('webhook', 'mcp')),
  label           TEXT NOT NULL,
  prefix          TEXT NOT NULL,
  hash            TEXT NOT NULL UNIQUE,
  default_source  TEXT,
  callback_secret TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  last_used_at    TEXT
);
CREATE INDEX tokens_user ON tokens(user_id);

-- Paired native clients (token_hash set) and browser Web Push registrations (web_push_endpoint set).
CREATE TABLE devices (
  id                TEXT PRIMARY KEY,         -- dev_<ulid>
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  platform          TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'macos', 'web')),
  token_hash        TEXT UNIQUE,
  fcm_token         TEXT,
  web_push          TEXT,                     -- PushSubscriptionJSON
  web_push_endpoint TEXT UNIQUE,
  created_at        TEXT NOT NULL,
  last_seen_at      TEXT
);
CREATE INDEX devices_user ON devices(user_id);

CREATE TABLE pairing_codes (
  code        TEXT PRIMARY KEY,               -- normalized, 8 chars, no dash
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

-- Google OAuth authorization-code flow (state + PKCE verifier), 10 minute TTL.
CREATE TABLE oauth_states (
  state          TEXT PRIMARY KEY,
  code_verifier  TEXT NOT NULL,
  redirect       TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL
);
