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
      // Website liveness (lead-gen quality): whether the company's site actually
      // responds. 'live' | 'dead' | NULL (never checked). A dead site is a prime
      // redesign target, so this feeds prospect scoring and the companies list.
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS website_status TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS website_checked_at TEXT`,
      // Hot-lead moment: stamped when a site FLIPS live→dead (the owner now
      // KNOWS they have a problem), cleared when it comes back. Recent stamps
      // surface as red alerts on the dashboard and jump the call queue.
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS site_down_at TEXT`,
      // Follow-up scheduling: when the next nudge for a 'no_answer' company is
      // due. NULL = due now (never emailed / legacy rows). Set automatically to
      // a few days out each time a nudge is sent, so the Follow-ups badge counts
      // what's actually actionable today instead of the whole queue.
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS next_followup_at TEXT`,
      // Callback ladder (separate from the EMAIL nudge above): how many times a
      // rep has dialled and got no answer, and when to ring again. A no-answer
      // used to end the lead's life — it left the call queue and never came
      // back. Now each one schedules the next dial 2/4/7 days out (then parks a
      // month out), and due callbacks re-enter the queue ahead of fresh names.
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS call_attempts INTEGER DEFAULT 0`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS next_call_at TEXT`,
      // Why they said no: one of the fixed NO_REASONS keys (see constants), set
      // when a rep marks a company "not interested". A pile of unexplained nos
      // looks like bad luck; the same pile with reasons on it usually names one
      // fixable thing — wrong list, wrong opener, or wrong time of day.
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS no_reason TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS no_reason_at TEXT`,
      // Company research dossier: JSON blob produced by the research engine
      // (brief, services, contacts found, pitch angles, ratings) + when it ran.
      // NULL = never researched; the nightly cron backfills newest-first.
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS research TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS research_at TEXT`,
      // Proposal tracking on deals: 'none' | 'sent' | 'viewed' | 'signed' (+ sent date).
      `ALTER TABLE deals ADD COLUMN IF NOT EXISTS proposal_status TEXT`,
      `ALTER TABLE deals ADD COLUMN IF NOT EXISTS proposal_sent_at TEXT`,
      // Shareable proposal pages: a public token per deal (lazy-created when the
      // rep clicks "Send proposal") + when the prospect first opened the page.
      // Opening it flips proposal_status to 'viewed' and notifies the deal owner.
      `ALTER TABLE deals ADD COLUMN IF NOT EXISTS proposal_token TEXT`,
      `ALTER TABLE deals ADD COLUMN IF NOT EXISTS proposal_viewed_at TEXT`,
      // Referral engine: which existing company (usually a signed client) sent
      // this lead our way. Referrals are the strongest close signal there is —
      // source flips to 'Referral' (+25 opportunity score) and the referrer
      // builds up a thank-them tally on their page.
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS referred_by_company_id TEXT`,
      // AI lead qualification (owner's ask, 2026-07-21): the model reads the
      // research dossier and rates 0-100 how likely this business is to buy a
      // Nexraft website (plans from $299/mo), with a one-line why. Feeds
      // call-list prioritization.
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_fit INTEGER`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_fit_reason TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_fit_at TEXT`,
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
      // Projects (first ERP piece): a signed deal becomes a build project — one
      // row per website being built, with a JSON checklist walking the delivery
      // from kickoff to launch. owner_id + shared_with so the standard record
      // ACL (assertCanEdit) applies. Soft-deleted via archived_at like the rest.
      `CREATE TABLE IF NOT EXISTS projects (
         id TEXT PRIMARY KEY,
         company_id TEXT NOT NULL,
         deal_id TEXT,
         name TEXT NOT NULL,
         owner_id TEXT,
         shared_with TEXT,
         status TEXT NOT NULL DEFAULT 'kickoff',
         checklist TEXT,
         launch_date TEXT,
         notes TEXT,
         archived_at TEXT,
         created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )`,
      `CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id)`,
      `CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id)`,
      `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`,
      // Unguessable token for the client-facing progress page (/share/<token>).
      // NULL until a builder generates the link, so nothing is public by default.
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS share_token TEXT`,
      // Stripe invoices raised from the CRM (billing phase). Mirrors what was
      // created in Stripe so the app can list/refresh without extra API calls.
      `CREATE TABLE IF NOT EXISTS invoices (
         id TEXT PRIMARY KEY,
         company_id TEXT NOT NULL,
         deal_id TEXT,
         stripe_invoice_id TEXT,
         description TEXT,
         amount NUMERIC NOT NULL DEFAULT 0,
         status TEXT NOT NULL DEFAULT 'open',
         hosted_url TEXT,
         created_by TEXT,
         created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id)`,
      // Stripe also renders a downloadable PDF of every finalized invoice — keep
      // its link alongside the hosted payment page.
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pdf_url TEXT`,
      // Daily auto sweeps (lead gen): admin-saved searches (area + business
      // types) that a Vercel cron runs every morning server-side — so fresh
      // leads land in the pool even when nobody has the CRM open in a browser.
      // next_type_idx rotates through the sweep's types run over run so a short
      // cron window still covers every niche across the week.
      `CREATE TABLE IF NOT EXISTS auto_sweeps (
         id TEXT PRIMARY KEY,
         area TEXT NOT NULL,
         types TEXT NOT NULL,
         enabled BOOLEAN NOT NULL DEFAULT true,
         next_type_idx INTEGER NOT NULL DEFAULT 0,
         last_run_at TEXT,
         last_imported INTEGER NOT NULL DEFAULT 0,
         total_imported INTEGER NOT NULL DEFAULT 0,
         created_by TEXT,
         created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )`,
      // Tiny key/value store for app-wide switches (e.g. lead_engine_paused),
      // so admins can flip things from the UI without a code change + redeploy.
      `CREATE TABLE IF NOT EXISTS app_settings (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )`,
      // Query-path indexes for the columns the app filters on constantly.
      // All IF NOT EXISTS, all safe on existing data (plain b-tree indexes
      // never conflict with live rows the way unique constraints could).
      `CREATE INDEX IF NOT EXISTS idx_companies_owner ON companies(owner_id)`,
      `CREATE INDEX IF NOT EXISTS idx_companies_archived ON companies(archived_at)`,
      `CREATE INDEX IF NOT EXISTS idx_companies_call_outcome ON companies(call_outcome)`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id)`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id)`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_email_lower ON contacts(lower(email))`,
      `CREATE INDEX IF NOT EXISTS idx_deals_company ON deals(company_id)`,
      `CREATE INDEX IF NOT EXISTS idx_deals_archived ON deals(archived_at)`,
      `CREATE INDEX IF NOT EXISTS idx_activities_deal ON activities(deal_id)`,
      `CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id)`,
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
      // One-time backfill: every company already sitting in "No answer" was
      // rung once and then forgotten, because until now nothing scheduled a
      // second dial. Treat each as one attempt and book the next one 1-7 days
      // out — randomised so a backlog of them trickles back into the call queue
      // over a week instead of landing on a rep all at once. Guarded by
      // next_call_at IS NULL, so it's a no-op on every run after the first.
      `UPDATE companies
          SET call_attempts = 1,
              next_call_at = to_char(
                (now() AT TIME ZONE 'UTC') + ((1 + floor(random() * 7)::int) * interval '1 day'),
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        WHERE call_outcome = 'no_answer'
          AND next_call_at IS NULL
          AND COALESCE(call_attempts, 0) = 0`,
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
