-- NOVA AI Cloud — Multi-Tenant User Accounts, Hashed Sessions, Resource Isolation & Quotas
CREATE TABLE IF NOT EXISTS auth_users (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE,
  display_name       TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  password_salt      TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'user',
  quota_limit        INTEGER NOT NULL DEFAULT 20,
  quota_used         INTEGER NOT NULL DEFAULT 0,
  quota_day          TEXT NOT NULL DEFAULT '',
  quota_locked_until TEXT,
  created_at         TEXT NOT NULL,
  last_login_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS resource_owners (
  resource_type TEXT NOT NULL,
  resource_id   TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_resource_owners_user ON resource_owners(user_id, resource_type);

CREATE TABLE IF NOT EXISTS user_settings_kv (
  user_id       TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket_key   TEXT PRIMARY KEY,
  hits         INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
