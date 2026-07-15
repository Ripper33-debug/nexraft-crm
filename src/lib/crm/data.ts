import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { db, uid } from "./db.server";
import { requireUser, requireAdmin, hashPassword, signupCode } from "./auth.server";
import { OPEN_STAGES, STAGES } from "./constants";
import { ensureExtraSchema, logEvent } from "./schema.server";

const WON_STAGE = "Launched";
const LOST_STAGE = "Lost";

const OPEN_LIST = OPEN_STAGES.map((s) => `'${s}'`).join(",");

// ---------- Row types (concrete, serializable shapes for query results) ----------
export type CompanyRow = {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  city: string | null;
  source: string | null;
  notes: string | null;
  tags: string | null;
  archived_at: string | null;
  owner_id: string | null;
  created_at: string;
  owner_name: string | null;
  deal_count: number;
};

export type ContactRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  company_id: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  owner_id: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  company_name: string | null;
  owner_name: string | null;
  // Overlap signals so two teammates don't work the same client.
  company_owner_id: string | null;
  company_owner_name: string | null;
  email_dupes: number;
};

export type DealRow = {
  id: string;
  name: string;
  company_id: string | null;
  contact_id: string | null;
  owner_id: string | null;
  stage: string;
  value: number;
  expected_close: string | null;
  next_step: string | null;
  notes: string | null;
  lost_reason: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  stage_changed_at: string;
  company_name: string | null;
  owner_name: string | null;
  contact_first: string | null;
  contact_last: string | null;
};

export type ActivityRow = {
  id: string;
  type: string;
  subject: string;
  deal_id: string | null;
  contact_id: string | null;
  owner_id: string | null;
  status: string;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  deal_name: string | null;
  owner_name: string | null;
  contact_first: string | null;
  contact_last: string | null;
};

export type StaleDealRow = {
  id: string;
  name: string;
  stage: string;
  value: number;
  owner_name: string | null;
  days_in_stage: number;
};

export type FollowupRow = {
  id: string;
  subject: string;
  type: string;
  due_date: string | null;
  owner_name: string | null;
  deal_name: string | null;
  overdue: number;
};

// ---------- Users (for owner dropdowns) ----------
export const getUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const { results } = await db()
    .prepare("SELECT id, name, email, role FROM users ORDER BY name")
    .all<{ id: string; name: string; email: string; role: string }>();
  return results ?? [];
});

export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  return await requireUser();
});

// ---------- Companies ----------
const companySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  industry: z.string().optional().nullable(),
  website: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  tags: z.string().optional().nullable(),
  owner_id: z.string().optional().nullable(),
});

export const getCompanies = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  await ensureExtraSchema();
  const { results } = await db()
    .prepare(
      `SELECT c.*, u.name AS owner_name,
        (SELECT COUNT(*)::int FROM deals d WHERE d.company_id = c.id AND d.archived_at IS NULL) AS deal_count
       FROM companies c LEFT JOIN users u ON u.id = c.owner_id
       WHERE c.archived_at IS NULL
       ORDER BY c.name`,
    )
    .all<CompanyRow>();
  return results ?? [];
});

export const upsertCompany = createServerFn({ method: "POST" })
  .validator(companySchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    if (data.id) {
      await db()
        .prepare(
          `UPDATE companies SET name=?, industry=?, website=?, phone=?, city=?, source=?, notes=?, tags=?, owner_id=? WHERE id=?`,
        )
        .bind(
          data.name,
          data.industry ?? null,
          data.website ?? null,
          data.phone ?? null,
          data.city ?? null,
          data.source ?? null,
          data.notes ?? null,
          data.tags ?? null,
          data.owner_id ?? null,
          data.id,
        )
        .run();
      await logEvent({
        actorId: user.id,
        verb: "updated",
        entityType: "company",
        entityId: data.id,
        summary: `${user.name} updated company ${data.name}`,
      });
      return { id: data.id };
    }
    const id = uid();
    await db()
      .prepare(
        `INSERT INTO companies (id, name, industry, website, phone, city, source, notes, tags, owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        data.name,
        data.industry ?? null,
        data.website ?? null,
        data.phone ?? null,
        data.city ?? null,
        data.source ?? null,
        data.notes ?? null,
        data.tags ?? null,
        data.owner_id ?? user.id,
      )
      .run();
    await logEvent({
      actorId: user.id,
      verb: "created",
      entityType: "company",
      entityId: id,
      summary: `${user.name} added company ${data.name}`,
    });
    return { id };
  });

// Archive (soft-delete) rather than destroy, so a client's history is never lost
// and can be restored. Also archives the company's deals so they leave the board.
export const archiveCompany = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    const now = new Date().toISOString();
    const row = await db().prepare("SELECT name FROM companies WHERE id = ?").bind(data.id).first<{ name: string }>();
    await db().prepare("UPDATE companies SET archived_at=? WHERE id=?").bind(now, data.id).run();
    await db().prepare("UPDATE deals SET archived_at=? WHERE company_id=? AND archived_at IS NULL").bind(now, data.id).run();
    await logEvent({
      actorId: user.id,
      verb: "archived",
      entityType: "company",
      entityId: data.id,
      summary: `${user.name} archived company ${row?.name ?? ""}`.trim(),
    });
    return { ok: true };
  });

export const restoreCompany = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireUser();
    await ensureExtraSchema();
    // Read the archive timestamp first so we only un-archive the deals that
    // were cascade-archived *with* this company (same stamp) — deals archived
    // separately earlier keep their own timestamp and stay archived.
    const co = await db()
      .prepare("SELECT archived_at FROM companies WHERE id=?")
      .bind(data.id)
      .first<{ archived_at: string | null }>();
    await db().prepare("UPDATE companies SET archived_at=NULL WHERE id=?").bind(data.id).run();
    if (co?.archived_at) {
      await db()
        .prepare("UPDATE deals SET archived_at=NULL WHERE company_id=? AND archived_at=?")
        .bind(data.id, co.archived_at)
        .run();
    }
    return { ok: true };
  });

// ---------- Contacts ----------
const contactSchema = z.object({
  id: z.string().optional(),
  first_name: z.string().min(1),
  last_name: z.string().optional().nullable(),
  company_id: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  owner_id: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const getContacts = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  await ensureExtraSchema();
  const { results } = await db()
    .prepare(
      `SELECT ct.*, co.name AS company_name, u.name AS owner_name,
        co.owner_id AS company_owner_id, cu.name AS company_owner_name,
        (SELECT COUNT(*)::int FROM contacts c2
          WHERE ct.email IS NOT NULL AND ct.email <> ''
            AND lower(c2.email) = lower(ct.email) AND c2.id <> ct.id
            AND c2.archived_at IS NULL) AS email_dupes
       FROM contacts ct
       LEFT JOIN companies co ON co.id = ct.company_id
       LEFT JOIN users u ON u.id = ct.owner_id
       LEFT JOIN users cu ON cu.id = co.owner_id
       WHERE ct.archived_at IS NULL
       ORDER BY ct.first_name, ct.last_name`,
    )
    .all<ContactRow>();
  return results ?? [];
});

export const upsertContact = createServerFn({ method: "POST" })
  .validator(contactSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (data.id) {
      await db()
        .prepare(
          `UPDATE contacts SET first_name=?, last_name=?, company_id=?, title=?, email=?, phone=?, owner_id=?, notes=? WHERE id=?`,
        )
        .bind(
          data.first_name,
          data.last_name ?? null,
          data.company_id ?? null,
          data.title ?? null,
          data.email ?? null,
          data.phone ?? null,
          data.owner_id ?? null,
          data.notes ?? null,
          data.id,
        )
        .run();
      await logEvent({
        actorId: user.id,
        verb: "updated",
        entityType: "contact",
        entityId: data.id,
        summary: `${user.name} updated contact ${data.first_name} ${data.last_name ?? ""}`.trim(),
      });
      return { id: data.id };
    }
    const id = uid();
    await db()
      .prepare(
        `INSERT INTO contacts (id, first_name, last_name, company_id, title, email, phone, owner_id, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        data.first_name,
        data.last_name ?? null,
        data.company_id ?? null,
        data.title ?? null,
        data.email ?? null,
        data.phone ?? null,
        data.owner_id ?? user.id,
        data.notes ?? null,
      )
      .run();
    await logEvent({
      actorId: user.id,
      verb: "created",
      entityType: "contact",
      entityId: id,
      summary: `${user.name} added contact ${data.first_name} ${data.last_name ?? ""}`.trim(),
    });
    return { id };
  });

export const archiveContact = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    const now = new Date().toISOString();
    const row = await db()
      .prepare("SELECT first_name, last_name FROM contacts WHERE id = ?")
      .bind(data.id)
      .first<{ first_name: string; last_name: string | null }>();
    await db().prepare("UPDATE contacts SET archived_at=? WHERE id=?").bind(now, data.id).run();
    await logEvent({
      actorId: user.id,
      verb: "archived",
      entityType: "contact",
      entityId: data.id,
      summary: `${user.name} archived contact ${row?.first_name ?? ""} ${row?.last_name ?? ""}`.trim(),
    });
    return { ok: true };
  });

export const restoreContact = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireUser();
    await ensureExtraSchema();
    await db().prepare("UPDATE contacts SET archived_at=NULL WHERE id=?").bind(data.id).run();
    return { ok: true };
  });

// ---------- Deals ----------
const dealSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  company_id: z.string().optional().nullable(),
  contact_id: z.string().optional().nullable(),
  owner_id: z.string().optional().nullable(),
  stage: z.string(),
  value: z.number().nonnegative().default(0),
  expected_close: z.string().optional().nullable(),
  next_step: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  lost_reason: z.string().optional().nullable(),
});

export const getDeals = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  await ensureExtraSchema();
  const { results } = await db()
    .prepare(
      `SELECT d.*, co.name AS company_name, u.name AS owner_name,
        ct.first_name AS contact_first, ct.last_name AS contact_last
       FROM deals d
       LEFT JOIN companies co ON co.id = d.company_id
       LEFT JOIN users u ON u.id = d.owner_id
       LEFT JOIN contacts ct ON ct.id = d.contact_id
       WHERE d.archived_at IS NULL
       ORDER BY d.updated_at DESC`,
    )
    .all<DealRow>();
  return results ?? [];
});

export const upsertDeal = createServerFn({ method: "POST" })
  .validator(dealSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const now = new Date().toISOString();
    if (data.id) {
      const prev = await db()
        .prepare("SELECT stage FROM deals WHERE id = ?")
        .bind(data.id)
        .first<{ stage: string }>();
      const stageChanged = prev && prev.stage !== data.stage;
      // Only persist a lost reason while the deal is actually Lost.
      const lostReason = data.stage === LOST_STAGE ? data.lost_reason ?? null : null;
      await db()
        .prepare(
          `UPDATE deals SET name=?, company_id=?, contact_id=?, owner_id=?, stage=?, value=?,
            expected_close=?, next_step=?, notes=?, lost_reason=?, updated_at=?${stageChanged ? ", stage_changed_at=?" : ""}
           WHERE id=?`,
        )
        .bind(
          ...[
            data.name,
            data.company_id ?? null,
            data.contact_id ?? null,
            data.owner_id ?? null,
            data.stage,
            data.value,
            data.expected_close ?? null,
            data.next_step ?? null,
            data.notes ?? null,
            lostReason,
            now,
            ...(stageChanged ? [now] : []),
            data.id,
          ],
        )
        .run();
      if (stageChanged) {
        await logStageChange(user, data.id, data.name, prev!.stage, data.stage);
      }
      return { id: data.id };
    }
    const id = uid();
    const lostReason = data.stage === LOST_STAGE ? data.lost_reason ?? null : null;
    await db()
      .prepare(
        `INSERT INTO deals (id, name, company_id, contact_id, owner_id, stage, value, expected_close, next_step, notes, lost_reason, created_at, updated_at, stage_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        data.name,
        data.company_id ?? null,
        data.contact_id ?? null,
        data.owner_id ?? user.id,
        data.stage,
        data.value,
        data.expected_close ?? null,
        data.next_step ?? null,
        data.notes ?? null,
        lostReason,
        now,
        now,
        now,
      )
      .run();
    await logEvent({
      actorId: user.id,
      verb: "created",
      entityType: "deal",
      entityId: id,
      summary: `${user.name} created deal ${data.name}`,
    });
    return { id };
  });

// Shared feed line for a deal moving between stages (won/lost get special verbs).
async function logStageChange(
  user: { id: string; name: string },
  dealId: string,
  dealName: string,
  from: string,
  to: string,
): Promise<void> {
  const verb = to === WON_STAGE ? "won" : to === LOST_STAGE ? "lost" : "stage_changed";
  const summary =
    to === WON_STAGE
      ? `${user.name} won ${dealName} 🎉`
      : to === LOST_STAGE
        ? `${user.name} marked ${dealName} lost`
        : `${user.name} moved ${dealName}: ${from} → ${to}`;
  await logEvent({
    actorId: user.id,
    verb,
    entityType: "deal",
    entityId: dealId,
    summary,
    meta: { from, to },
  });
}

export const setDealStage = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), stage: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const now = new Date().toISOString();
    const prev = await db()
      .prepare("SELECT name, stage FROM deals WHERE id = ?")
      .bind(data.id)
      .first<{ name: string; stage: string }>();
    // Clear any stale lost reason when moving out of Lost.
    await db()
      .prepare(
        `UPDATE deals SET stage=?, updated_at=?, stage_changed_at=?,
           lost_reason = CASE WHEN ? = '${LOST_STAGE}' THEN lost_reason ELSE NULL END
         WHERE id=?`,
      )
      .bind(data.stage, now, now, data.stage, data.id)
      .run();
    if (prev && prev.stage !== data.stage) {
      await logStageChange(user, data.id, prev.name, prev.stage, data.stage);
    }
    return { ok: true };
  });

export const archiveDeal = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    const now = new Date().toISOString();
    const row = await db().prepare("SELECT name FROM deals WHERE id = ?").bind(data.id).first<{ name: string }>();
    await db().prepare("UPDATE deals SET archived_at=? WHERE id=?").bind(now, data.id).run();
    await logEvent({
      actorId: user.id,
      verb: "archived",
      entityType: "deal",
      entityId: data.id,
      summary: `${user.name} archived deal ${row?.name ?? ""}`.trim(),
    });
    return { ok: true };
  });

export const restoreDeal = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireUser();
    await ensureExtraSchema();
    await db().prepare("UPDATE deals SET archived_at=NULL WHERE id=?").bind(data.id).run();
    return { ok: true };
  });

// ---------- Activities ----------
const activitySchema = z.object({
  id: z.string().optional(),
  type: z.string(),
  subject: z.string().min(1),
  deal_id: z.string().optional().nullable(),
  contact_id: z.string().optional().nullable(),
  owner_id: z.string().optional().nullable(),
  status: z.string().default("open"),
  due_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const getActivities = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const { results } = await db()
    .prepare(
      `SELECT a.*, d.name AS deal_name, u.name AS owner_name,
        ct.first_name AS contact_first, ct.last_name AS contact_last
       FROM activities a
       LEFT JOIN deals d ON d.id = a.deal_id
       LEFT JOIN users u ON u.id = a.owner_id
       LEFT JOIN contacts ct ON ct.id = a.contact_id
       ORDER BY (a.status='open') DESC, COALESCE(a.due_date, a.created_at) ASC`,
    )
    .all<ActivityRow>();
  return results ?? [];
});

export const upsertActivity = createServerFn({ method: "POST" })
  .validator(activitySchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (data.id) {
      await db()
        .prepare(
          `UPDATE activities SET type=?, subject=?, deal_id=?, contact_id=?, owner_id=?, status=?, due_date=?, notes=? WHERE id=?`,
        )
        .bind(
          data.type,
          data.subject,
          data.deal_id ?? null,
          data.contact_id ?? null,
          data.owner_id ?? null,
          data.status,
          data.due_date ?? null,
          data.notes ?? null,
          data.id,
        )
        .run();
      return { id: data.id };
    }
    const id = uid();
    await db()
      .prepare(
        `INSERT INTO activities (id, type, subject, deal_id, contact_id, owner_id, status, due_date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        data.type,
        data.subject,
        data.deal_id ?? null,
        data.contact_id ?? null,
        data.owner_id ?? user.id,
        data.status,
        data.due_date ?? null,
        data.notes ?? null,
      )
      .run();
    return { id };
  });

export const toggleActivity = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), done: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await db()
      .prepare("UPDATE activities SET status=?, completed_at=? WHERE id=?")
      .bind(data.done ? "done" : "open", data.done ? new Date().toISOString() : null, data.id)
      .run();
    if (data.done) {
      const act = await db()
        .prepare("SELECT subject FROM activities WHERE id = ?")
        .bind(data.id)
        .first<{ subject: string }>();
      await logEvent({
        actorId: user.id,
        verb: "completed",
        entityType: "activity",
        entityId: data.id,
        summary: `${user.name} completed “${act?.subject ?? "a task"}”`,
      });
    }
    return { ok: true };
  });

export const deleteActivity = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireUser();
    await db().prepare("DELETE FROM activities WHERE id = ?").bind(data.id).run();
    return { ok: true };
  });

// ---------- Dashboard ----------
export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  await ensureExtraSchema();
  const database = db();

  // KPI totals
  const kpi = await database
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN stage IN (${OPEN_LIST}) THEN value END),0) AS open_value,
        COALESCE(SUM(CASE WHEN stage IN (${OPEN_LIST}) THEN 1 END),0)::int AS open_count,
        COALESCE(SUM(CASE WHEN stage='Launched' THEN value END),0) AS won_value,
        COALESCE(SUM(CASE WHEN stage='Launched' THEN 1 END),0)::int AS won_count,
        COALESCE(SUM(CASE WHEN stage='Lost' THEN 1 END),0)::int AS lost_count
       FROM deals WHERE archived_at IS NULL`,
    )
    .first<{
      open_value: number;
      open_count: number;
      won_value: number;
      won_count: number;
      lost_count: number;
    }>();

  // Stage breakdown
  const { results: stageRows } = await database
    .prepare("SELECT stage, COUNT(*)::int AS n, COALESCE(SUM(value),0) AS v FROM deals WHERE archived_at IS NULL GROUP BY stage")
    .all<{ stage: string; n: number; v: number }>();
  const byStage = STAGES.map((s) => {
    const r = (stageRows ?? []).find((x) => x.stage === s.name);
    return { stage: s.name, count: r?.n ?? 0, value: r?.v ?? 0, color: s.color };
  });

  // Weighted pipeline (open deals only) computed in JS from stage probabilities
  const weighted = byStage
    .filter((s) => OPEN_STAGES.includes(s.stage))
    .reduce((sum, s) => {
      const p = STAGES.find((x) => x.name === s.stage)?.prob ?? 0;
      return sum + s.value * p;
    }, 0);

  // Leaderboard per owner
  const { results: lbRows } = await database
    .prepare(
      `SELECT u.id, u.name,
        COALESCE(SUM(CASE WHEN d.stage IN (${OPEN_LIST}) THEN d.value END),0) AS open_value,
        COALESCE(SUM(CASE WHEN d.stage IN (${OPEN_LIST}) THEN 1 END),0)::int AS open_count,
        COALESCE(SUM(CASE WHEN d.stage='Launched' THEN d.value END),0) AS won_value,
        COALESCE(SUM(CASE WHEN d.stage='Launched' THEN 1 END),0)::int AS won_count,
        COALESCE(SUM(CASE WHEN d.stage='Lost' THEN 1 END),0)::int AS lost_count
       FROM users u LEFT JOIN deals d ON d.owner_id = u.id AND d.archived_at IS NULL
       GROUP BY u.id, u.name
       ORDER BY won_value DESC, open_value DESC`,
    )
    .all<{
      id: string;
      name: string;
      open_value: number;
      open_count: number;
      won_value: number;
      won_count: number;
      lost_count: number;
    }>();
  const leaderboard = (lbRows ?? []).map((r) => ({
    ...r,
    win_rate:
      r.won_count + r.lost_count > 0
        ? Math.round((r.won_count / (r.won_count + r.lost_count)) * 100)
        : null,
  }));

  // Monthly won trend (last 6 months)
  const { results: wonRows } = await database
    .prepare(
      `SELECT to_char(stage_changed_at::timestamptz, 'YYYY-MM') AS ym, COALESCE(SUM(value),0) AS v, COUNT(*)::int AS n
       FROM deals WHERE stage='Launched' AND archived_at IS NULL
       GROUP BY ym ORDER BY ym`,
    )
    .all<{ ym: string; v: number; n: number }>();
  const months: { label: string; ym: string; value: number; count: number }[] = [];
  const base = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const r = (wonRows ?? []).find((x) => x.ym === ym);
    months.push({
      label: d.toLocaleString("en-US", { month: "short" }),
      ym,
      value: r?.v ?? 0,
      count: r?.n ?? 0,
    });
  }

  // Stale open deals (untouched > STALE_DAYS)
  const { results: staleRows } = await database
    .prepare(
      `SELECT d.id, d.name, d.stage, d.value, u.name AS owner_name,
        CAST(EXTRACT(EPOCH FROM (now() - d.stage_changed_at::timestamptz)) / 86400 AS INTEGER) AS days_in_stage
       FROM deals d LEFT JOIN users u ON u.id = d.owner_id
       WHERE d.stage IN (${OPEN_LIST}) AND d.archived_at IS NULL
       ORDER BY days_in_stage DESC LIMIT 8`,
    )
    .all<StaleDealRow>();

  // Open follow-ups (activities) sorted by due date
  const { results: followRows } = await database
    .prepare(
      `SELECT a.id, a.subject, a.type, a.due_date, u.name AS owner_name, d.name AS deal_name,
        CASE WHEN a.due_date IS NOT NULL AND a.due_date::date < now()::date THEN 1 ELSE 0 END AS overdue
       FROM activities a
       LEFT JOIN users u ON u.id = a.owner_id
       LEFT JOIN deals d ON d.id = a.deal_id
       WHERE a.status='open'
       ORDER BY (a.due_date IS NULL), a.due_date ASC LIMIT 10`,
    )
    .all<FollowupRow>();

  return {
    kpi: kpi ?? {
      open_value: 0,
      open_count: 0,
      won_value: 0,
      won_count: 0,
      lost_count: 0,
    },
    weighted,
    byStage,
    leaderboard,
    months,
    stale: staleRows ?? [],
    followups: followRows ?? [],
  };
});

// ================= ADMIN (role = 'admin' only) =================
// Team-wide visibility + user management for the workspace owner.

export type TeamMemberRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
  open_value: number;
  open_count: number;
  won_value: number;
  won_count: number;
  lost_count: number;
  companies_count: number;
  contacts_count: number;
  open_activities: number;
  overdue_activities: number;
};

// Per-worker rollup: what every teammate has in their CRM.
export const getTeamOverview = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  await ensureExtraSchema();
  const { results } = await db()
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.created_at,
        COALESCE(SUM(CASE WHEN d.stage IN (${OPEN_LIST}) THEN d.value END),0) AS open_value,
        COALESCE(SUM(CASE WHEN d.stage IN (${OPEN_LIST}) THEN 1 END),0)::int AS open_count,
        COALESCE(SUM(CASE WHEN d.stage='Launched' THEN d.value END),0) AS won_value,
        COALESCE(SUM(CASE WHEN d.stage='Launched' THEN 1 END),0)::int AS won_count,
        COALESCE(SUM(CASE WHEN d.stage='Lost' THEN 1 END),0)::int AS lost_count,
        (SELECT COUNT(*)::int FROM companies c WHERE c.owner_id = u.id AND c.archived_at IS NULL) AS companies_count,
        (SELECT COUNT(*)::int FROM contacts ct WHERE ct.owner_id = u.id AND ct.archived_at IS NULL) AS contacts_count,
        (SELECT COUNT(*)::int FROM activities a WHERE a.owner_id = u.id AND a.status='open') AS open_activities,
        (SELECT COUNT(*)::int FROM activities a WHERE a.owner_id = u.id AND a.status='open'
           AND a.due_date IS NOT NULL AND a.due_date::date < now()::date) AS overdue_activities
       FROM users u LEFT JOIN deals d ON d.owner_id = u.id AND d.archived_at IS NULL
       GROUP BY u.id, u.name, u.email, u.role, u.created_at
       ORDER BY won_value DESC, open_value DESC, u.name`,
    )
    .all<TeamMemberRow>();
  return results ?? [];
});

export type UserDealRow = {
  id: string;
  name: string;
  stage: string;
  value: number;
  next_step: string | null;
  expected_close: string | null;
  company_name: string | null;
};
export type UserCompanyRow = { id: string; name: string; industry: string | null; city: string | null };
export type UserContactRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
};
export type UserActivityRow = {
  id: string;
  type: string;
  subject: string;
  status: string;
  due_date: string | null;
  deal_name: string | null;
};

// Drill into one teammate: everything they own.
export const getUserDetail = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureExtraSchema();
    const database = db();
    const user = await database
      .prepare("SELECT id, name, email, role, created_at FROM users WHERE id = ?")
      .bind(data.id)
      .first<{ id: string; name: string; email: string; role: string; created_at: string }>();
    if (!user) throw new Error("User not found");

    const [deals, companies, contacts, activities] = await Promise.all([
      database
        .prepare(
          `SELECT d.id, d.name, d.stage, d.value, d.next_step, d.expected_close, co.name AS company_name
           FROM deals d LEFT JOIN companies co ON co.id = d.company_id
           WHERE d.owner_id = ? AND d.archived_at IS NULL ORDER BY d.updated_at DESC`,
        )
        .bind(data.id)
        .all<UserDealRow>(),
      database
        .prepare("SELECT id, name, industry, city FROM companies WHERE owner_id = ? AND archived_at IS NULL ORDER BY name")
        .bind(data.id)
        .all<UserCompanyRow>(),
      database
        .prepare(
          `SELECT id, first_name, last_name, title, email, phone FROM contacts
           WHERE owner_id = ? AND archived_at IS NULL ORDER BY first_name, last_name`,
        )
        .bind(data.id)
        .all<UserContactRow>(),
      database
        .prepare(
          `SELECT a.id, a.type, a.subject, a.status, a.due_date, d.name AS deal_name
           FROM activities a LEFT JOIN deals d ON d.id = a.deal_id
           WHERE a.owner_id = ? ORDER BY (a.status='open') DESC, COALESCE(a.due_date, a.created_at) ASC`,
        )
        .bind(data.id)
        .all<UserActivityRow>(),
    ]);

    return {
      user,
      deals: (deals.results ?? []) as UserDealRow[],
      companies: (companies.results ?? []) as UserCompanyRow[],
      contacts: (contacts.results ?? []) as UserContactRow[],
      activities: (activities.results ?? []) as UserActivityRow[],
    };
  });

// Admin adds a teammate directly (they can sign in immediately).
export const adminCreateUser = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(8),
      role: z.enum(["admin", "member"]).default("member"),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    const email = data.email.trim().toLowerCase();
    const existing = await db()
      .prepare("SELECT id FROM users WHERE email = ?")
      .bind(email)
      .first<{ id: string }>();
    if (existing) return { ok: false as const, error: "An account with that email already exists." };
    const id = uid();
    const password_hash = await hashPassword(data.password);
    await db()
      .prepare("INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)")
      .bind(id, email, data.name.trim(), password_hash, data.role)
      .run();
    return { ok: true as const, id };
  });

export const adminUpdateRole = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), role: z.enum(["admin", "member"]) }))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    if (data.role === "member") {
      // Never leave the workspace without an admin.
      const admins = await db()
        .prepare("SELECT COUNT(*)::int AS c FROM users WHERE role='admin'")
        .first<{ c: number }>();
      const target = await db()
        .prepare("SELECT role FROM users WHERE id = ?")
        .bind(data.id)
        .first<{ role: string }>();
      if (target?.role === "admin" && (admins?.c ?? 0) <= 1) {
        return { ok: false as const, error: "You can't remove the last admin." };
      }
      if (data.id === me.id && (admins?.c ?? 0) <= 1) {
        return { ok: false as const, error: "You can't demote yourself as the last admin." };
      }
    }
    await db().prepare("UPDATE users SET role = ? WHERE id = ?").bind(data.role, data.id).run();
    return { ok: true as const };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), password: z.string().min(8) }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const password_hash = await hashPassword(data.password);
    await db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(password_hash, data.id).run();
    // Invalidate existing sessions so the new password takes effect everywhere.
    await db().prepare("DELETE FROM sessions WHERE user_id = ?").bind(data.id).run();
    return { ok: true as const };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    if (data.id === me.id) return { ok: false as const, error: "You can't remove your own account." };
    const admins = await db()
      .prepare("SELECT COUNT(*)::int AS c FROM users WHERE role='admin'")
      .first<{ c: number }>();
    const target = await db()
      .prepare("SELECT role FROM users WHERE id = ?")
      .bind(data.id)
      .first<{ role: string }>();
    if (target?.role === "admin" && (admins?.c ?? 0) <= 1) {
      return { ok: false as const, error: "You can't remove the last admin." };
    }
    // Unassign their records (kept for the team) then remove the user + sessions.
    await db().prepare("UPDATE companies SET owner_id = NULL WHERE owner_id = ?").bind(data.id).run();
    await db().prepare("UPDATE contacts SET owner_id = NULL WHERE owner_id = ?").bind(data.id).run();
    await db().prepare("UPDATE deals SET owner_id = NULL WHERE owner_id = ?").bind(data.id).run();
    await db().prepare("UPDATE activities SET owner_id = NULL WHERE owner_id = ?").bind(data.id).run();
    await db().prepare("DELETE FROM sessions WHERE user_id = ?").bind(data.id).run();
    await db().prepare("DELETE FROM users WHERE id = ?").bind(data.id).run();
    return { ok: true as const };
  });

// Surfaced on the admin page so the admin can share it when adding teammates.
export const getSignupCode = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  return { code: signupCode() };
});

// ================= NOTES (threaded comments) =================
export type NoteRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
};

const entityTypeSchema = z.enum(["company", "contact", "deal"]);

export const getNotes = createServerFn({ method: "GET" })
  .validator(z.object({ entity_type: entityTypeSchema, entity_id: z.string() }))
  .handler(async ({ data }) => {
    await requireUser();
    await ensureExtraSchema();
    const { results } = await db()
      .prepare(
        `SELECT n.id, n.entity_type, n.entity_id, n.author_id, u.name AS author_name, n.body, n.created_at
         FROM notes n LEFT JOIN users u ON u.id = n.author_id
         WHERE n.entity_type = ? AND n.entity_id = ?
         ORDER BY n.created_at DESC`,
      )
      .bind(data.entity_type, data.entity_id)
      .all<NoteRow>();
    return (results ?? []) as NoteRow[];
  });

export const addNote = createServerFn({ method: "POST" })
  .validator(
    z.object({
      entity_type: entityTypeSchema,
      entity_id: z.string(),
      body: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    const id = uid();
    await db()
      .prepare("INSERT INTO notes (id, entity_type, entity_id, author_id, body) VALUES (?, ?, ?, ?, ?)")
      .bind(id, data.entity_type, data.entity_id, user.id, data.body.trim())
      .run();
    // Resolve a friendly label for the feed line.
    let label: string = data.entity_type;
    if (data.entity_type === "company") {
      const r = await db().prepare("SELECT name FROM companies WHERE id = ?").bind(data.entity_id).first<{ name: string }>();
      label = r?.name ?? "a company";
    } else if (data.entity_type === "deal") {
      const r = await db().prepare("SELECT name FROM deals WHERE id = ?").bind(data.entity_id).first<{ name: string }>();
      label = r?.name ?? "a deal";
    } else {
      const r = await db()
        .prepare("SELECT first_name, last_name FROM contacts WHERE id = ?")
        .bind(data.entity_id)
        .first<{ first_name: string; last_name: string | null }>();
      label = r ? `${r.first_name} ${r.last_name ?? ""}`.trim() : "a contact";
    }
    await logEvent({
      actorId: user.id,
      verb: "note_added",
      entityType: data.entity_type,
      entityId: data.entity_id,
      summary: `${user.name} noted on ${label}: “${data.body.trim().slice(0, 80)}”`,
    });
    return { id };
  });

// ================= ACTIVITY FEED =================
export type FeedRow = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  verb: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: string;
};

export const getActivityFeed = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  await ensureExtraSchema();
  const { results } = await db()
    .prepare(
      `SELECT e.id, e.actor_id, u.name AS actor_name, e.verb, e.entity_type, e.entity_id, e.summary, e.created_at
       FROM events e LEFT JOIN users u ON u.id = e.actor_id
       ORDER BY e.created_at DESC
       LIMIT 40`,
    )
    .all<FeedRow>();
  return (results ?? []) as FeedRow[];
});

// ================= WIN / LOSS ANALYTICS =================
export type LostReasonRow = { reason: string; n: number; value: number };
export type RepPerfRow = {
  id: string;
  name: string;
  won_count: number;
  won_value: number;
  lost_count: number;
  win_rate: number | null;
  avg_deal: number;
  avg_cycle_days: number | null;
};

const RANGE_DAYS: Record<string, number> = { month: 30, quarter: 90, year: 365 };

// Build the deal-scope condition for a given column prefix. Always excludes
// archived deals; for a bounded range it limits to deals decided in the window.
function dealScope(range: string, prefix = ""): string {
  const p = prefix ? `${prefix}.` : "";
  const base = `${p}archived_at IS NULL`;
  const days = RANGE_DAYS[range];
  if (!days) return base;
  return `${base} AND ${p}stage_changed_at::timestamptz >= now() - interval '${days} days'`;
}

export const getAnalytics = createServerFn({ method: "GET" })
  .validator(z.object({ range: z.enum(["all", "month", "quarter", "year"]).default("all") }))
  .handler(async ({ data }) => {
  await requireUser();
  await ensureExtraSchema();
  const database = db();
  const range = data.range;

  const totals = await database
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN stage='${WON_STAGE}' THEN 1 END),0)::int AS won_count,
         COALESCE(SUM(CASE WHEN stage='${WON_STAGE}' THEN value END),0) AS won_value,
         COALESCE(SUM(CASE WHEN stage='${LOST_STAGE}' THEN 1 END),0)::int AS lost_count,
         COALESCE(SUM(CASE WHEN stage='${LOST_STAGE}' THEN value END),0) AS lost_value,
         COALESCE(AVG(CASE WHEN stage='${WON_STAGE}' THEN value END),0) AS avg_won_value,
         COALESCE(AVG(CASE WHEN stage='${WON_STAGE}'
           THEN EXTRACT(EPOCH FROM (stage_changed_at::timestamptz - created_at::timestamptz))/86400 END),0) AS avg_cycle_days
       FROM deals WHERE ${dealScope(range)}`,
    )
    .first<{
      won_count: number;
      won_value: number;
      lost_count: number;
      lost_value: number;
      avg_won_value: number;
      avg_cycle_days: number;
    }>();

  const won = totals?.won_count ?? 0;
  const lost = totals?.lost_count ?? 0;
  const decided = won + lost;
  const winRate = decided > 0 ? Math.round((won / decided) * 100) : null;

  // Lost reasons breakdown.
  const { results: lostRows } = await database
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(lost_reason), ''), 'Unspecified') AS reason,
         COUNT(*)::int AS n, COALESCE(SUM(value),0) AS value
       FROM deals WHERE stage='${LOST_STAGE}' AND ${dealScope(range)}
       GROUP BY reason ORDER BY n DESC`,
    )
    .all<LostReasonRow>();

  // Per-rep performance.
  const { results: repRows } = await database
    .prepare(
      `SELECT u.id, u.name,
         COALESCE(SUM(CASE WHEN d.stage='${WON_STAGE}' THEN 1 END),0)::int AS won_count,
         COALESCE(SUM(CASE WHEN d.stage='${WON_STAGE}' THEN d.value END),0) AS won_value,
         COALESCE(SUM(CASE WHEN d.stage='${LOST_STAGE}' THEN 1 END),0)::int AS lost_count,
         COALESCE(AVG(CASE WHEN d.stage='${WON_STAGE}' THEN d.value END),0) AS avg_deal,
         COALESCE(AVG(CASE WHEN d.stage='${WON_STAGE}'
           THEN EXTRACT(EPOCH FROM (d.stage_changed_at::timestamptz - d.created_at::timestamptz))/86400 END),0) AS avg_cycle_days
       FROM users u LEFT JOIN deals d ON d.owner_id = u.id AND ${dealScope(range, "d")}
       GROUP BY u.id, u.name
       ORDER BY won_value DESC, u.name`,
    )
    .all<{
      id: string;
      name: string;
      won_count: number;
      won_value: number;
      lost_count: number;
      avg_deal: number;
      avg_cycle_days: number;
    }>();
  const reps: RepPerfRow[] = (repRows ?? []).map((r) => {
    const d = r.won_count + r.lost_count;
    return {
      id: r.id,
      name: r.name,
      won_count: r.won_count,
      won_value: r.won_value,
      lost_count: r.lost_count,
      win_rate: d > 0 ? Math.round((r.won_count / d) * 100) : null,
      avg_deal: Math.round(r.avg_deal),
      avg_cycle_days: r.won_count > 0 ? Math.round(r.avg_cycle_days) : null,
    };
  });

  return {
    won_count: won,
    won_value: totals?.won_value ?? 0,
    lost_count: lost,
    lost_value: totals?.lost_value ?? 0,
    win_rate: winRate,
    avg_won_value: Math.round(totals?.avg_won_value ?? 0),
    avg_cycle_days: won > 0 ? Math.round(totals?.avg_cycle_days ?? 0) : null,
    lost_reasons: (lostRows ?? []) as LostReasonRow[],
    reps,
  };
});

// ================= EXPORT (for the eventual Monday migration) =================
export type ExportBundle = {
  companies: Record<string, string>[];
  contacts: Record<string, string>[];
  deals: Record<string, string>[];
  activities: Record<string, string>[];
};

// Flat, fully-denormalized rows (names resolved, no internal ids) so the export
// opens cleanly in Excel / imports into Monday without any lookups.
export const getExportBundle = createServerFn({ method: "GET" }).handler(async (): Promise<ExportBundle> => {
  await requireUser();
  await ensureExtraSchema();
  const database = db();

  const [companies, contacts, deals, activities] = await Promise.all([
    database
      .prepare(
        `SELECT c.name, c.industry, c.website, c.phone, c.city, c.source, u.name AS owner, c.tags, c.notes, c.created_at
         FROM companies c LEFT JOIN users u ON u.id = c.owner_id
         WHERE c.archived_at IS NULL ORDER BY c.name`,
      )
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT ct.first_name, ct.last_name, ct.title, ct.email, ct.phone, co.name AS company,
           u.name AS owner, ct.notes, ct.created_at
         FROM contacts ct LEFT JOIN companies co ON co.id = ct.company_id
         LEFT JOIN users u ON u.id = ct.owner_id
         WHERE ct.archived_at IS NULL ORDER BY ct.first_name, ct.last_name`,
      )
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT d.name, d.stage, d.value, co.name AS company,
           (ct.first_name || ' ' || COALESCE(ct.last_name,'')) AS contact,
           u.name AS owner, d.expected_close, d.next_step, d.lost_reason, d.notes,
           d.created_at, d.updated_at, d.stage_changed_at
         FROM deals d LEFT JOIN companies co ON co.id = d.company_id
         LEFT JOIN contacts ct ON ct.id = d.contact_id
         LEFT JOIN users u ON u.id = d.owner_id
         WHERE d.archived_at IS NULL ORDER BY d.updated_at DESC`,
      )
      .all<Record<string, unknown>>(),
    database
      .prepare(
        `SELECT a.type, a.subject, a.status, a.due_date, d.name AS deal,
           (ct.first_name || ' ' || COALESCE(ct.last_name,'')) AS contact,
           u.name AS owner, a.notes, a.created_at, a.completed_at
         FROM activities a LEFT JOIN deals d ON d.id = a.deal_id
         LEFT JOIN contacts ct ON ct.id = a.contact_id
         LEFT JOIN users u ON u.id = a.owner_id ORDER BY a.created_at DESC`,
      )
      .all<Record<string, unknown>>(),
  ]);

  const clean = (rows: Record<string, unknown>[] | undefined): Record<string, string>[] =>
    (rows ?? []).map((row) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(row)) out[k] = v == null ? "" : String(v);
      return out;
    });

  return {
    companies: clean(companies.results),
    contacts: clean(contacts.results),
    deals: clean(deals.results),
    activities: clean(activities.results),
  };
});

// ---------- Global search ----------
export type SearchHit = {
  kind: "company" | "contact" | "deal";
  id: string;
  title: string;
  subtitle: string | null;
};

// Single fast lookup across companies, contacts and deals for the header search
// bar. Each result carries enough to route the user to the right list page and
// auto-open the matching record (via the ?focus= param).
export const globalSearch = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string() }))
  .handler(async ({ data }): Promise<SearchHit[]> => {
    await requireUser();
    await ensureExtraSchema();
    const q = data.q.trim();
    if (q.length < 1) return [];
    const like = `%${q.toLowerCase()}%`;
    const database = db();

    const [companies, contacts, deals] = await Promise.all([
      database
        .prepare(
          `SELECT id, name, industry, city FROM companies
           WHERE archived_at IS NULL
             AND (lower(name) LIKE ? OR lower(COALESCE(industry,'')) LIKE ? OR lower(COALESCE(city,'')) LIKE ?)
           ORDER BY name LIMIT 6`,
        )
        .bind(like, like, like)
        .all<{ id: string; name: string; industry: string | null; city: string | null }>(),
      database
        .prepare(
          `SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.title, co.name AS company_name
           FROM contacts ct LEFT JOIN companies co ON co.id = ct.company_id
           WHERE ct.archived_at IS NULL
             AND (lower(ct.first_name) LIKE ? OR lower(COALESCE(ct.last_name,'')) LIKE ?
               OR lower(COALESCE(ct.email,'')) LIKE ? OR lower(COALESCE(co.name,'')) LIKE ?)
           ORDER BY ct.first_name, ct.last_name LIMIT 6`,
        )
        .bind(like, like, like, like)
        .all<{
          id: string;
          first_name: string;
          last_name: string | null;
          email: string | null;
          title: string | null;
          company_name: string | null;
        }>(),
      database
        .prepare(
          `SELECT d.id, d.name, d.stage, co.name AS company_name
           FROM deals d LEFT JOIN companies co ON co.id = d.company_id
           WHERE d.archived_at IS NULL
             AND (lower(d.name) LIKE ? OR lower(COALESCE(co.name,'')) LIKE ?)
           ORDER BY d.updated_at DESC LIMIT 6`,
        )
        .bind(like, like)
        .all<{ id: string; name: string; stage: string; company_name: string | null }>(),
    ]);

    const hits: SearchHit[] = [];
    for (const c of companies.results ?? []) {
      hits.push({
        kind: "company",
        id: c.id,
        title: c.name,
        subtitle: [c.industry, c.city].filter(Boolean).join(" · ") || null,
      });
    }
    for (const ct of contacts.results ?? []) {
      const name = `${ct.first_name} ${ct.last_name ?? ""}`.trim();
      hits.push({
        kind: "contact",
        id: ct.id,
        title: name,
        subtitle: [ct.title, ct.company_name, ct.email].filter(Boolean).join(" · ") || null,
      });
    }
    for (const d of deals.results ?? []) {
      hits.push({
        kind: "deal",
        id: d.id,
        title: d.name,
        subtitle: [d.company_name, d.stage].filter(Boolean).join(" · ") || null,
      });
    }
    return hits;
  });

// ---------- Archived records (for the "Show archived" view + restore) ----------
export type ArchivedRow = { id: string; label: string; sub: string | null; archived_at: string };

export const getArchived = createServerFn({ method: "GET" })
  .validator(z.object({ entity: z.enum(["company", "contact", "deal"]) }))
  .handler(async ({ data }): Promise<ArchivedRow[]> => {
    await requireUser();
    await ensureExtraSchema();
    const database = db();
    if (data.entity === "company") {
      const { results } = await database
        .prepare(
          `SELECT id, name AS label,
             NULLIF(TRIM(COALESCE(industry,'') || CASE WHEN city IS NOT NULL AND city <> '' THEN ' · ' || city ELSE '' END), '') AS sub,
             archived_at
           FROM companies WHERE archived_at IS NOT NULL ORDER BY archived_at DESC`,
        )
        .all<ArchivedRow>();
      return (results ?? []) as ArchivedRow[];
    }
    if (data.entity === "contact") {
      const { results } = await database
        .prepare(
          `SELECT ct.id, TRIM(ct.first_name || ' ' || COALESCE(ct.last_name,'')) AS label,
             NULLIF(TRIM(COALESCE(ct.title,'') || CASE WHEN co.name IS NOT NULL THEN ' · ' || co.name ELSE '' END), '') AS sub,
             ct.archived_at
           FROM contacts ct LEFT JOIN companies co ON co.id = ct.company_id
           WHERE ct.archived_at IS NOT NULL ORDER BY ct.archived_at DESC`,
        )
        .all<ArchivedRow>();
      return (results ?? []) as ArchivedRow[];
    }
    const { results } = await database
      .prepare(
        `SELECT d.id, d.name AS label,
           NULLIF(TRIM(COALESCE(co.name,'') || ' · ' || d.stage), '') AS sub,
           d.archived_at
         FROM deals d LEFT JOIN companies co ON co.id = d.company_id
         WHERE d.archived_at IS NOT NULL ORDER BY d.archived_at DESC`,
      )
      .all<ArchivedRow>();
    return (results ?? []) as ArchivedRow[];
  });
