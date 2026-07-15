-- Nexraft CRM schema — Postgres (Supabase). Idempotent (IF NOT EXISTS).
-- Timestamp columns are TEXT holding ISO-8601 strings, matching the app which
-- writes new Date().toISOString() and reads them back as strings.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT,
  website TEXT,
  phone TEXT,
  city TEXT,
  source TEXT,
  notes TEXT,
  owner_id TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT,
  company_id TEXT,
  title TEXT,
  email TEXT,
  phone TEXT,
  owner_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company_id TEXT,
  contact_id TEXT,
  owner_id TEXT,
  stage TEXT NOT NULL DEFAULT 'Lead',
  value DOUBLE PRECISION NOT NULL DEFAULT 0,
  expected_close TEXT,
  next_step TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  stage_changed_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_deals_owner ON deals(owner_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'Note',
  subject TEXT NOT NULL,
  deal_id TEXT,
  contact_id TEXT,
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  due_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_activities_owner ON activities(owner_id);
CREATE INDEX IF NOT EXISTS idx_activities_status ON activities(status);

-- Threaded notes/comments on a company, contact, or deal. Distinct from the
-- single freeform `notes` TEXT column on those tables: this is a running log so
-- the whole team can see who last spoke to a client (stops double-work).
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,      -- 'company' | 'contact' | 'deal'
  entity_id TEXT NOT NULL,
  author_id TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity_type, entity_id);

-- Append-only team activity feed. Every meaningful mutation writes one row so
-- the dashboard can show a live "who did what" stream.
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  verb TEXT NOT NULL,            -- created | updated | stage_changed | won | lost | note_added | completed
  entity_type TEXT NOT NULL,     -- company | contact | deal | activity | note
  entity_id TEXT,
  summary TEXT NOT NULL,         -- human-readable line
  meta TEXT,                     -- optional JSON (e.g. {"from":"Lead","to":"Proposal"})
  created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

-- Why a deal was lost, for win/loss analytics.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_reason TEXT;
