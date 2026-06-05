-- NoteFlow D1 Schema Reference
-- NEVER auto-run this file. Run individual statements via wrangler d1 execute or the D1 MCP tool.
-- Timestamp conventions:
--   created_at, updated_at  → INTEGER (Unix seconds, e.g. 1716800000)
--   completed_at            → TEXT    (ISO 8601, e.g. "2026-05-27T14:00:00.000Z")
--   due_date                → TEXT    (ISO 8601 date only, e.g. "2026-05-30")

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  email        TEXT,
  display_name TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS notes (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  visibility   TEXT NOT NULL DEFAULT 'PRIVATE',
  pinned       INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Task fields (added May 2026)
  is_task           INTEGER NOT NULL DEFAULT 0,
  due_date          TEXT,           -- ISO 8601 date "YYYY-MM-DD", nullable
  priority          TEXT,           -- subject/category label (user-defined text), NULL=none; column type stays in schema for compatibility but stores TEXT
  completed_at      TEXT,           -- ISO 8601 datetime, NULL=incomplete
  notif_days_before INTEGER,        -- days before due_date to send notification (0=on day), NULL=no notification
  notif_time        TEXT            -- "HH:MM" UTC time to send notification, NULL=no notification
);
CREATE INDEX IF NOT EXISTS idx_notes_user_created ON notes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_tasks ON notes(user_id, is_task, completed_at, archived);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL,
  tag     TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_note_tags_user_tag ON note_tags(user_id, tag);

CREATE TABLE IF NOT EXISTS attachments (
  id         TEXT PRIMARY KEY,
  note_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  filename   TEXT NOT NULL,
  mime_type  TEXT,
  size_bytes INTEGER,
  r2_key     TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id);

CREATE TABLE IF NOT EXISTS document_index (
  attachment_id TEXT PRIMARY KEY,
  text_content  TEXT,
  indexed_at    INTEGER
);

CREATE TABLE IF NOT EXISTS tag_embeddings (
  user_id    TEXT NOT NULL,
  tag        TEXT NOT NULL,
  vector     TEXT NOT NULL,
  created_at INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, tag)
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  data    TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tracker_subjects (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  name                  TEXT NOT NULL,
  instructions          TEXT,
  ai_model              TEXT DEFAULT 'claude',
  color                 TEXT,
  archived              INTEGER DEFAULT 0,
  context_summary       TEXT,
  summary_updated_at    INTEGER,
  summary_covers_until  INTEGER,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracker_notes (
  id         TEXT PRIMARY KEY,
  tracker_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracker_conversations (
  id         TEXT PRIMARY KEY,
  tracker_id TEXT NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tracker_share_tokens (
  id                   TEXT PRIMARY KEY,
  tracker_id           TEXT NOT NULL,
  token                TEXT NOT NULL UNIQUE,
  partner_name         TEXT,
  partner_instructions TEXT,
  partner_language     TEXT DEFAULT 'da',
  password_hash        TEXT,
  created_at           INTEGER NOT NULL,
  last_used_at         INTEGER
);

CREATE TABLE IF NOT EXISTS tracker_partner_conversations (
  id         TEXT PRIMARY KEY,
  token_id   TEXT NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_ai_conversations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  project_tag TEXT NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Android widget tokens (added May 2026)
-- One token per user; generated via POST /api/widget/token (requires session auth)
CREATE TABLE IF NOT EXISTS widget_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Push notification subscriptions (added May 2026)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth_key   TEXT NOT NULL,  -- named auth_key not auth to avoid SQL reserved word collision
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscriptions(user_id);
