// Background work queue — the one pattern worth stealing from Comp AI's CRM
// (github.com/trycompai/crm). Their agent runs everything through a plain
// Postgres table claimed with FOR UPDATE SKIP LOCKED and a short lease. No
// Redis, no job framework, and a crashed run releases its work instead of
// losing it. Ours is the same idea sized for the Vercel cron:
//
//   * every overnight job (research, enrichment, AI drafts, site checks,
//     vetting) is a ROW, not a line in a hardcoded try/catch pile;
//   * the cron claims a few rows at a time inside its 60s budget — two
//     overlapping crons take disjoint work automatically;
//   * a run that dies mid-task leaves the lease to expire (10 min) and the
//     next cron picks it back up — before this, a crash silently starved
//     every job later in the sequence until the following night;
//   * `reason` is rep-readable, so the queue can always answer "why does
//     this job exist?" — same rule as leadNeed's spoken lines.
//
// Recurring kinds re-enqueue themselves on completion; that replaces the
// fixed nightly sequence with the same cadence but crash-proof and visible
// (SELECT * FROM crm_tasks WHERE done_at IS NULL tells you the whole plan).
import { db, uid } from "./db.server";
import { ensureExtraSchema } from "./schema.server";

export type TaskRow = {
  id: string;
  kind: string;
  company_id: string | null;
  reason: string | null;
  due_at: string;
  priority: number;
  attempts: number;
};

const LEASE_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function iso(d: Date): string {
  return d.toISOString();
}
function inMinutes(min: number): string {
  return iso(new Date(Date.now() + min * 60_000));
}
export function inHours(hours: number): string {
  return iso(new Date(Date.now() + hours * 3_600_000));
}

// The nightly recurring jobs and how often each comes due. ~20h (not 24)
// mirrors the old sweep cutoff: a job never skips a night because yesterday's
// cron ran a few minutes late.
export const RECURRING_TASKS: { kind: string; everyHours: number; reason: string }[] = [
  { kind: "enrich_new_leads", everyHours: 20, reason: "Give un-researched leads a dossier so reps can dial with a real fact." },
  { kind: "vet_book", everyHours: 20, reason: "Re-verify the book: MX-check emails, confirm the need is real, archive what no rep can act on." },
  { kind: "outscraper_enrich", everyHours: 20, reason: "Find inbox addresses for researched companies we can't email yet." },
  { kind: "ai_qualify", everyHours: 20, reason: "Rate fresh dossiers 0-100 on how likely they are to buy." },
  { kind: "redraft_emails", everyHours: 20, reason: "Rewrite stored drafts written under an older prompt version." },
  { kind: "verify_websites", everyHours: 20, reason: "Re-probe the stalest sites — a site that just died is the hottest lead there is." },
  { kind: "recheck_sites", everyHours: 20, reason: "Chip away at old dossiers that claim 'no website' without ever having looked." },
];

// Insert a task unless an identical open one already exists (unique partial
// index on (kind, company_id) WHERE done_at IS NULL makes this race-safe).
export async function enqueueTask(input: {
  kind: string;
  companyId?: string | null;
  reason?: string | null;
  dueAt?: string; // default: now
  priority?: number; // higher = sooner; default 0
}): Promise<boolean> {
  await ensureExtraSchema();
  const row = await db()
    .prepare(
      `INSERT INTO crm_tasks (id, kind, company_id, reason, due_at, priority)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (kind, (COALESCE(company_id, ''))) WHERE done_at IS NULL DO NOTHING
       RETURNING id`,
    )
    .bind(
      uid(),
      input.kind,
      input.companyId ?? null,
      input.reason ?? null,
      input.dueAt ?? iso(new Date()),
      input.priority ?? 0,
    )
    .first<{ id: string }>();
  return Boolean(row);
}

// Make sure every recurring job has an open row. Cheap (7 upserts) and run
// once per cron hit, so a wiped table heals itself on the next sweep.
export async function seedRecurringTasks(): Promise<void> {
  for (const t of RECURRING_TASKS) {
    await enqueueTask({ kind: t.kind, reason: t.reason });
  }
}

// Claim up to `limit` due tasks: lease them for 10 minutes and hand them
// back. One atomic statement — SKIP LOCKED means two dispatchers running at
// once take disjoint rows, exactly like Comp AI's claimDue().
export async function claimDueTasks(limit: number): Promise<TaskRow[]> {
  await ensureExtraSchema();
  const now = iso(new Date());
  const { results } = await db()
    .prepare(
      `UPDATE crm_tasks SET leased_until = ?, attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM crm_tasks
           WHERE done_at IS NULL
             AND due_at <= ?
             AND (leased_until IS NULL OR leased_until < ?)
             AND attempts < ${MAX_ATTEMPTS}
           ORDER BY priority DESC, due_at ASC
           LIMIT ?
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, kind, company_id, reason, due_at, priority::int AS priority, attempts::int AS attempts`,
    )
    .bind(inMinutes(LEASE_MINUTES), now, now, limit)
    .all<TaskRow>();
  return results ?? [];
}

export async function completeTask(id: string): Promise<void> {
  await db()
    .prepare(`UPDATE crm_tasks SET done_at = ?, leased_until = NULL, last_error = NULL WHERE id = ?`)
    .bind(iso(new Date()), id)
    .run();
}

// Failure keeps the row open with a growing backoff (30min × attempts) until
// MAX_ATTEMPTS, at which point claimDueTasks stops offering it — it stays in
// the table as evidence, with the last error written on it.
export async function failTask(id: string, attempts: number, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  await db()
    .prepare(`UPDATE crm_tasks SET leased_until = NULL, last_error = ?, due_at = ? WHERE id = ?`)
    .bind(msg.slice(0, 500), inMinutes(30 * Math.max(1, attempts)), id)
    .run();
}

// A finished recurring task books its own next run. Non-recurring kinds
// (one-shot per-company jobs) just complete.
export function recurringInterval(kind: string): number | null {
  const r = RECURRING_TASKS.find((t) => t.kind === kind);
  return r ? r.everyHours : null;
}
