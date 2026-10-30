-- NOVA AI Cloud — initial schema (D1 / SQLite)
-- Applied with: npm run db:migrate:local   |   npm run db:migrate:remote

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL DEFAULT 'New chat',
  project_id      TEXT,
  model_id        TEXT,
  model_class     TEXT NOT NULL DEFAULT 'chat',
  memory_enabled  INTEGER NOT NULL DEFAULT 1,
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  reasoning       TEXT,
  tool_calls      TEXT,
  tool_call_id    TEXT,
  tool_name       TEXT,
  attachments     TEXT,
  model_id        TEXT,
  provider_id     TEXT,
  status          TEXT NOT NULL DEFAULT 'complete',
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  error           TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  language        TEXT NOT NULL DEFAULT 'typescript',
  default_branch  TEXT NOT NULL DEFAULT 'main',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_files (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  path         TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  sha          TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  language     TEXT NOT NULL DEFAULT 'plaintext',
  status       TEXT NOT NULL DEFAULT 'active',
  updated_at   TEXT NOT NULL,
  UNIQUE (project_id, path)
);
CREATE INDEX IF NOT EXISTS idx_files_project ON project_files(project_id, status);

-- Content-addressed blob store: file content is kept per sha so history is real.
-- A commit stores path -> sha; restoring or diffing any old commit reads from here.
CREATE TABLE IF NOT EXISTS project_blobs (
  sha          TEXT PRIMARY KEY,
  content      TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS changes (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  run_id       TEXT,
  path         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  before_text  TEXT,
  after_text   TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  reason       TEXT,
  created_at   TEXT NOT NULL,
  applied_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_changes_project ON changes(project_id, status);

CREATE TABLE IF NOT EXISTS commits (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  parent_id    TEXT,
  branch       TEXT NOT NULL DEFAULT 'main',
  message      TEXT NOT NULL,
  author       TEXT NOT NULL DEFAULT 'nova',
  tree         TEXT NOT NULL DEFAULT '{}',
  files        INTEGER NOT NULL DEFAULT 0,
  additions    INTEGER NOT NULL DEFAULT 0,
  deletions    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commits_project ON commits(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT,
  run_id       TEXT,
  title        TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, sort_order);

CREATE TABLE IF NOT EXISTS agent_runs (
  id              TEXT PRIMARY KEY,
  project_id      TEXT,
  conversation_id TEXT,
  model_id        TEXT NOT NULL,
  provider_id     TEXT,
  status          TEXT NOT NULL DEFAULT 'running',
  steps           INTEGER NOT NULL DEFAULT 0,
  prompt          TEXT NOT NULL DEFAULT '',
  summary         TEXT,
  error           TEXT,
  started_at      TEXT NOT NULL,
  finished_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_project ON agent_runs(project_id, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_events (
  run_id      TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE IF NOT EXISTS memory (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL DEFAULT 'global',
  scope_id    TEXT,
  key         TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_unique ON memory(scope, scope_id, key);

CREATE TABLE IF NOT EXISTS usage (
  id          TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'chat',
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage(created_at DESC);

CREATE TABLE IF NOT EXISTS attachments (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT,
  project_id      TEXT,
  name            TEXT NOT NULL,
  mime            TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes      INTEGER NOT NULL DEFAULT 0,
  blob_key        TEXT NOT NULL,
  text_excerpt    TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_cache (
  model_id     TEXT PRIMARY KEY,
  provider     TEXT NOT NULL,
  data         TEXT NOT NULL,
  verified_at  TEXT NOT NULL
);
