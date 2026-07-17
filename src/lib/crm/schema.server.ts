// Lazy, idempotent bootstrap for the tables/columns added after the initial
// schema (notes, events, deals.lost_reason). The base schema is applied by hand
// from migrations/postgres_schema.sql; rather than make the admin re-run SQL for
// these interim features, we ensure them once per server process. All statements
// are IF NOT EXISTS so this is safe to call repeatedly.
import { db, uid } from "./db.server";

let _ensured: Promise<void> | null = null;

export function ensureExtraSchema(): Promise<void> {
  if (_ensured) return _ensured;
  _ensured = (async () => {
    const stmts = [
      `CREATE TABLE IF NOT EXISTS notes (
         id TEXT PRIMARY KEY,
         entity_type TEXT NOT NULL,
         entity_id TEXT NOT NULL,
         author_id TEXT,
         body TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )`,
      `CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity_type, entity_id)`,
      `CREATE TABLE IF NOT EXISTS events (
         id TEXT PRIMARY KEY,
         actor_id TEXT,
         verb TEXT NOT NULL,
         entity_type TEXT NOT NULL,
         entity_id TEXT,
         summary TEXT NOT NULL,
         meta TEXT,
         created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )`,
      `CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)`,
      `ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_reason TEXT`,
      // Won-deal reason (mirror of lost_reason) for win/loss analytics.
      `ALTER TABLE deals ADD COLUMN IF NOT EXISTS win_reason TEXT`,
      // Recurring revenue: monthly retainer/hosting value + renewal date.
      `ALTER TABLE deals ADD COLUMN IF NOT EXISTS monthly_value NUMERIC DEFAULT 0`,
      `ALTER TABLE deals ADD COLUMN IF NOT EXISTS renewal_date TEXT`,
      // Labelled links (JSON array of {label,url}) — Figma, proposal, staging, etc.
      `ALTER TABLE deals ADD COLUMN IF NOT EXISTS links TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS tags TEXT`,
      // Soft-delete: records are archived (timestamped) rather than destroyed.
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS archived_at TEXT`,
      `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS archived_at TEXT`,
      `ALTER TABLE deals ADD COLUMN IF NOT EXISTS archived_at TEXT`,
      // Record-level access: comma-separated user ids who may edit alongside the
      // owner. NULL/empty means owner-only (plus admins). Powers "share edit access".
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS shared_with TEXT`,
      `ALTER TABLE contacts ADD COLUMN IF NOT EXISTS shared_with TEXT`,
      `ALTER TABLE deals ADD COLUMN IF NOT EXISTS shared_with TEXT`,
      // Call-queue triage outcome for companies with no deal yet:
      // NULL = still "need to call", 'interested' or 'not_interested' once triaged.
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS call_outcome TEXT`,
      // Email follow-up tracking (for the "no answer" nudge queue): how many
      // follow-up emails have been drafted/sent to this company, and when the
      // last one went out. Drives which nudge template comes next (1st/2nd/3rd).
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS email_touches INTEGER DEFAULT 0`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_emailed_at TEXT`,
      // Proposal tracking on deals: 'none' | 'sent' | 'viewed' | 'signed' (+ sent date).
      `ALTER TABLE deals ADD COLUMN IF NOT EXISTS proposal_status TEXT`,
      `ALTER TABLE deals ADD COLUMN IF NOT EXISTS proposal_sent_at TEXT`,
      // Per-user notifications (record handed off / shared with you).
      `CREATE TABLE IF NOT EXISTS notifications (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL,
         actor_id TEXT,
         kind TEXT NOT NULL,
         entity_type TEXT NOT NULL,
         entity_id TEXT,
         summary TEXT NOT NULL,
         seen BOOLEAN NOT NULL DEFAULT false,
         created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )`,
      `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, seen)`,
      // Sales payroll: per-rep pay cadence + a ledger of commission/bonus payments.
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS pay_cadence TEXT`,
      `CREATE TABLE IF NOT EXISTS payroll_payments (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL,
         amount NUMERIC NOT NULL DEFAULT 0,
         paid_at TEXT NOT NULL,
         note TEXT,
         created_by TEXT,
         created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )`,
      `CREATE INDEX IF NOT EXISTS idx_payroll_user ON payroll_payments(user_id)`,
      // Per-rep Gmail connection for sending outreach from the CRM. One row per
      // user. The refresh token is stored AES-GCM-encrypted (see crypto.server.ts);
      // the short-lived access token is cached with its expiry so we only hit
      // Google's token endpoint when it actually needs refreshing.
      `CREATE TABLE IF NOT EXISTS gmail_connections (
         user_id TEXT PRIMARY KEY,
         email TEXT NOT NULL,
         refresh_token TEXT NOT NULL,
         access_token TEXT,
         token_expires_at TEXT,
         scope TEXT,
         connected_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )`,
      // A record of every email actually sent through the CRM, for the timeline
      // and for proof-of-send. Keyed loosely to company/contact by id.
      `CREATE TABLE IF NOT EXISTS sent_emails (
         id TEXT PRIMARY KEY,
         sender_id TEXT NOT NULL,
         company_id TEXT,
         contact_id TEXT,
         to_email TEXT NOT NULL,
         subject TEXT,
         gmail_message_id TEXT,
         created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )`,
      `CREATE INDEX IF NOT EXISTS idx_sent_emails_company ON sent_emails(company_id)`,
      // AI opportunity briefs (Phase 2): a cached, plain-English write-up per
      // company generated by the AI model. One row per company. `signals_hash`
      // fingerprints the inputs (source, call outcome, industry, contact info)
      // so we only regenerate when something material changes — otherwise the
      // cached brief is reused, keeping API cost near zero.
      `CREATE TABLE IF NOT EXISTS ai_briefs (
         company_id TEXT PRIMARY KEY,
         brief TEXT NOT NULL,
         model TEXT,
         signals_hash TEXT NOT NULL,
         score INTEGER,
         created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )`,
      // One-time backfill: every active company should sit in the pipeline. Any
      // company that has no active deal yet gets a $0 "To Call" deal so nothing
      // slips through. Set-based + guarded by NOT EXISTS, so it's a no-op after
      // the first run (and safe to keep here permanently).
      `INSERT INTO deals (id, name, company_id, owner_id, stage, value, next_step, monthly_value, proposal_status)
       SELECT gen_random_uuid()::text, c.name || ' — Website', c.id, c.owner_id,
              'To Call', 0, 'Reach out & qualify', 0, 'none'
         FROM companies c
        WHERE c.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM deals d WHERE d.company_id = c.id AND d.archived_at IS NULL
          )`,
    ];
    for (const s of stmts) {
      await db().prepare(s).run();
    }
  })().catch((e) => {
    // Reset so a later call can retry if the first attempt failed transiently.
    _ensured = null;
    throw e;
  });
  return _ensured;
}

// Append one row to the team activity feed. Best-effort: a feed write must never
// break the underlying mutation, so failures are swallowed.
export async function logEvent(input: {
  actorId: string | null;
  verb: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await ensureExtraSchema();
    await db()
      .prepare(
        `INSERT INTO events (id, actor_id, verb, entity_type, entity_id, summary, meta)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        uid(),
        input.actorId,
        input.verb,
        input.entityType,
        input.entityId ?? null,
        input.summary,
        input.meta ? JSON.stringify(input.meta) : null,
      )
      .run();
  } catch {
    // ignore — feed logging is non-critical
  }
}

// Drop a notification in a teammate's tray. Best-effort, like logEvent.
export async function notify(input: {
  userId: string;
  actorId: string | null;
  kind: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
}): Promise<void> {
  try {
    await ensureExtraSchema();
    await db()
      .prepare(
        `INSERT INTO notifications (id, user_id, actor_id, kind, entity_type, entity_id, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        uid(),
        input.userId,
        input.actorId,
        input.kind,
        input.entityType,
        input.entityId ?? null,
        input.summary,
      )
      .run();
  } catch {
    // ignore — notifications are non-critical
  }
}
