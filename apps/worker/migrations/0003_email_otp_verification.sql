-- Migration 0003: Mandatory Email OTP Verification & Dynamic Security Config
CREATE TABLE IF NOT EXISTS auth_pending_registrations (
  email           TEXT PRIMARY KEY,
  canonical_email TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  password_salt   TEXT NOT NULL,
  otp_hash        TEXT NOT NULL,
  otp_salt        TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  expires_at      TEXT NOT NULL,
  resend_after    TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_pending_canonical ON auth_pending_registrations(canonical_email);

CREATE TABLE IF NOT EXISTS auth_system_config (
  config_key   TEXT PRIMARY KEY,
  config_json  TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
