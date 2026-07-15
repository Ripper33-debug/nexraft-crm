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
