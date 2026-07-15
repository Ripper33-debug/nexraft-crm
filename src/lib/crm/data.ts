import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { db, uid } from "./db.server";
import { requireUser } from "./auth.server";
import { OPEN_STAGES, STAGES } from "./constants";

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
  created_at: string;
  company_name: string | null;
  owner_name: string | null;
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
  owner_id: z.string().optional().nullable(),
});

export const getCompanies = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const { results } = await db()
    .prepare(
      `SELECT c.*, u.name AS owner_name,
        (SELECT COUNT(*)::int FROM deals d WHERE d.company_id = c.id) AS deal_count
       FROM companies c LEFT JOIN users u ON u.id = c.owner_id
       ORDER BY c.name`,
    )
    .all<CompanyRow>();
  return results ?? [];
});

export const upsertCompany = createServerFn({ method: "POST" })
  .validator(companySchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    if (data.id) {
      await db()
        .prepare(
          `UPDATE companies SET name=?, industry=?, website=?, phone=?, city=?, source=?, notes=?, owner_id=? WHERE id=?`,
        )
        .bind(
          data.name,
          data.industry ?? null,
          data.website ?? null,
          data.phone ?? null,
          data.city ?? null,
          data.source ?? null,
          data.notes ?? null,
          data.owner_id ?? null,
          data.id,
        )
        .run();
      return { id: data.id };
    }
    const id = uid();
    await db()
      .prepare(
        `INSERT INTO companies (id, name, industry, website, phone, city, source, notes, owner_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        data.owner_id ?? user.id,
      )
      .run();
    return { id };
  });

export const deleteCompany = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireUser();
    await db().prepare("DELETE FROM companies WHERE id = ?").bind(data.id).run();
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
  const { results } = await db()
    .prepare(
      `SELECT ct.*, co.name AS company_name, u.name AS owner_name
       FROM contacts ct
       LEFT JOIN companies co ON co.id = ct.company_id
       LEFT JOIN users u ON u.id = ct.owner_id
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
    return { id };
  });

export const deleteContact = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireUser();
    await db().prepare("DELETE FROM contacts WHERE id = ?").bind(data.id).run();
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
});

export const getDeals = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const { results } = await db()
    .prepare(
      `SELECT d.*, co.name AS company_name, u.name AS owner_name,
        ct.first_name AS contact_first, ct.last_name AS contact_last
       FROM deals d
       LEFT JOIN companies co ON co.id = d.company_id
       LEFT JOIN users u ON u.id = d.owner_id
       LEFT JOIN contacts ct ON ct.id = d.contact_id
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
      await db()
        .prepare(
          `UPDATE deals SET name=?, company_id=?, contact_id=?, owner_id=?, stage=?, value=?,
            expected_close=?, next_step=?, notes=?, updated_at=?${stageChanged ? ", stage_changed_at=?" : ""}
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
            now,
            ...(stageChanged ? [now] : []),
            data.id,
          ],
        )
        .run();
      return { id: data.id };
    }
    const id = uid();
    await db()
      .prepare(
        `INSERT INTO deals (id, name, company_id, contact_id, owner_id, stage, value, expected_close, next_step, notes, created_at, updated_at, stage_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        now,
        now,
        now,
      )
      .run();
    return { id };
  });

export const setDealStage = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string(), stage: z.string() }))
  .handler(async ({ data }) => {
    await requireUser();
    const now = new Date().toISOString();
    await db()
      .prepare("UPDATE deals SET stage=?, updated_at=?, stage_changed_at=? WHERE id=?")
      .bind(data.stage, now, now, data.id)
      .run();
    return { ok: true };
  });

export const deleteDeal = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireUser();
    await db().prepare("DELETE FROM deals WHERE id = ?").bind(data.id).run();
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
    await requireUser();
    await db()
      .prepare("UPDATE activities SET status=?, completed_at=? WHERE id=?")
      .bind(data.done ? "done" : "open", data.done ? new Date().toISOString() : null, data.id)
      .run();
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
       FROM deals`,
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
    .prepare("SELECT stage, COUNT(*)::int AS n, COALESCE(SUM(value),0) AS v FROM deals GROUP BY stage")
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
       FROM users u LEFT JOIN deals d ON d.owner_id = u.id
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
       FROM deals WHERE stage='Launched'
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
       WHERE d.stage IN (${OPEN_LIST})
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
