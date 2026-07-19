import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";

import { db, uid } from "./db.server";
import { requireUser, requireAdmin, hashPassword, signupCode } from "./auth.server";
import {
  OPEN_STAGES,
  STAGES,
  RENEWAL_SOON_DAYS,
  canEditRecord,
  canAdministerRecord,
  dealCommission,
  salesBonus,
  opportunityScore,
  discoveryScore,
  estimateDealValue,
  PRICING_PACKAGES,
  ESTIMATE_LOW_MONTHLY,
  pickLeastLoaded,
  type AssigneeLoad,
  companyNameKey,
  phoneKey,
  emailKey,
  groupDuplicates,
  analyzeSiteHtml,
  parseSocials,
  industryMatchesAny,
} from "./constants";
import { ensureExtraSchema, logEvent, notify } from "./schema.server";
import { sendEmail, getConnection, isGmailConfigured } from "./gmail.server";
import { isStripeConfigured, stripeFetch } from "./stripe.server";
import { isPlacesConfigured, fetchPlaceRatings } from "./places.server";
import { isYelpConfigured, fetchYelpRatings } from "./yelp.server";

const WON_STAGE = "Launched";
const LOST_STAGE = "Lost";
// Entry stage: every new company gets a $0 deal here so it's ready to work.
const TO_CALL_STAGE = "To Call";

const OPEN_LIST = OPEN_STAGES.map((s) => `'${s}'`).join(",");

// Whitelisted entity tables that carry owner_id + shared_with access columns.
const ACCESS_TABLES = { company: "companies", contact: "contacts", deal: "deals", project: "projects" } as const;
type AccessEntity = keyof typeof ACCESS_TABLES;

// Load a record's current owner + share list and throw FORBIDDEN if `user` may
// not edit it. Missing records fall through so the normal path handles them.
async function assertCanEdit(
  user: { id: string; role: string },
  table: (typeof ACCESS_TABLES)[AccessEntity],
  id: string,
): Promise<void> {
  const row = await db()
    .prepare(`SELECT owner_id, shared_with FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<{ owner_id: string | null; shared_with: string | null }>();
  if (!row) return;
  if (!canEditRecord(user, row.owner_id, row.shared_with)) {
    throw new Error("FORBIDDEN");
  }
}

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
  shared_with: string | null;
  call_outcome: string | null;
  created_at: string;
  owner_name: string | null;
  deal_count: number;
  won_deals: number;
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
  shared_with: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  company_name: string | null;
  owner_name: string | null;
  // Overlap signals so two teammates don't work the same client.
  company_owner_id: string | null;
  company_owner_name: string | null;
  email_dupes: number;
  last_contacted: string | null;
};

export type DealRow = {
  id: string;
  name: string;
  company_id: string | null;
  contact_id: string | null;
  owner_id: string | null;
  shared_with: string | null;
  stage: string;
  value: number;
  expected_close: string | null;
  next_step: string | null;
  notes: string | null;
  lost_reason: string | null;
  win_reason: string | null;
  monthly_value: number | null;
  renewal_date: string | null;
  links: string | null;
  proposal_status: string | null;
  proposal_sent_at: string | null;
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

export type RenewalRow = {
  id: string;
  name: string;
  renewal_date: string | null;
  monthly_value: number | null;
  company_name: string | null;
  owner_name: string | null;
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

// Cheap count for the "Follow-ups" nav badge: companies that didn't pick up and
// are still waiting on a nudge. Mirrors the Follow-ups worklist (call_outcome =
// 'no_answer'), so the badge and that page always agree.
export const getFollowupCount = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  await ensureExtraSchema();
  // Counts only follow-ups actually DUE (never scheduled, or the scheduled date
  // has arrived) and not yet fully nudged — so the nav badge is a real "do this
  // now" number instead of the size of the whole waiting room.
  const row = await db()
    .prepare(
      `SELECT COUNT(*)::int AS n FROM companies
       WHERE archived_at IS NULL AND call_outcome = 'no_answer'
         AND COALESCE(email_touches, 0) < 3
         AND (next_followup_at IS NULL
              OR next_followup_at <= to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
    )
    .first<{ n: number }>();
  return { count: row?.n ?? 0 };
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
        (SELECT COUNT(*)::int FROM deals d WHERE d.company_id = c.id AND d.archived_at IS NULL) AS deal_count,
        (SELECT COUNT(*)::int FROM deals d WHERE d.company_id = c.id AND d.archived_at IS NULL AND d.stage = '${WON_STAGE}') AS won_deals
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
      await assertCanEdit(user, "companies", data.id);
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
    // Drop the new company straight into the pipeline as a $0 "To Call" deal so
    // it shows up ready to work in the call queue — no manual step for the rep.
    const dealOwner = data.owner_id ?? user.id;
    const now = new Date().toISOString();
    const dealId = uid();
    await db()
      .prepare(
        `INSERT INTO deals (id, name, company_id, contact_id, owner_id, stage, value, expected_close, next_step, notes, lost_reason, win_reason, monthly_value, renewal_date, links, proposal_status, proposal_sent_at, created_at, updated_at, stage_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        dealId,
        `${data.name} — Website`,
        id,
        null,
        dealOwner,
        TO_CALL_STAGE,
        0,
        null,
        "Reach out & qualify",
        null,
        null,
        null,
        0,
        null,
        null,
        "none",
        null,
        now,
        now,
        now,
      )
      .run();
    return { id };
  });

// Archive (soft-delete) rather than destroy, so a client's history is never lost
// and can be restored. Also archives the company's deals so they leave the board.
export const archiveCompany = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    await assertCanEdit(user, "companies", data.id);
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
    const user = await requireUser();
    await ensureExtraSchema();
    // Same permission rule as archiving: owner, co-editor, or admin only.
    await assertCanEdit(user, "companies", data.id);
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
            AND c2.archived_at IS NULL) AS email_dupes,
        (SELECT MAX(a.created_at) FROM activities a WHERE a.contact_id = ct.id) AS last_contacted
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
    await ensureExtraSchema();
    if (data.id) {
      await assertCanEdit(user, "contacts", data.id);
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
    await assertCanEdit(user, "contacts", data.id);
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
    const user = await requireUser();
    await ensureExtraSchema();
    // Same permission rule as archiving: owner, co-editor, or admin only.
    await assertCanEdit(user, "contacts", data.id);
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
  win_reason: z.string().optional().nullable(),
  monthly_value: z.number().nonnegative().default(0),
  renewal_date: z.string().optional().nullable(),
  links: z.string().optional().nullable(),
  proposal_status: z.enum(["none", "sent", "viewed", "signed"]).optional().nullable(),
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
    await ensureExtraSchema();
    const now = new Date().toISOString();
    if (data.id) {
      await assertCanEdit(user, "deals", data.id);
      const prev = await db()
        .prepare("SELECT stage, proposal_sent_at FROM deals WHERE id = ?")
        .bind(data.id)
        .first<{ stage: string; proposal_sent_at: string | null }>();
      const stageChanged = prev && prev.stage !== data.stage;
      // Only persist a lost/win reason while the deal is actually in that stage.
      const lostReason = data.stage === LOST_STAGE ? data.lost_reason ?? null : null;
      const winReason = data.stage === WON_STAGE ? data.win_reason ?? null : null;
      const proposalStatus = data.proposal_status ?? "none";
      // Stamp the sent date the first time a proposal leaves "none"; clear if reset.
      const proposalSentAt =
        proposalStatus === "none" ? null : prev?.proposal_sent_at || now;
      await db()
        .prepare(
          `UPDATE deals SET name=?, company_id=?, contact_id=?, owner_id=?, stage=?, value=?,
            expected_close=?, next_step=?, notes=?, lost_reason=?, win_reason=?, monthly_value=?,
            renewal_date=?, links=?, proposal_status=?, proposal_sent_at=?, updated_at=?${stageChanged ? ", stage_changed_at=?" : ""}
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
            winReason,
            data.monthly_value ?? 0,
            data.renewal_date ?? null,
            data.links ?? null,
            proposalStatus,
            proposalSentAt,
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
    const winReason = data.stage === WON_STAGE ? data.win_reason ?? null : null;
    const proposalStatus = data.proposal_status ?? "none";
    const proposalSentAt = proposalStatus === "none" ? null : now;
    await db()
      .prepare(
        `INSERT INTO deals (id, name, company_id, contact_id, owner_id, stage, value, expected_close, next_step, notes, lost_reason, win_reason, monthly_value, renewal_date, links, proposal_status, proposal_sent_at, created_at, updated_at, stage_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        winReason,
        data.monthly_value ?? 0,
        data.renewal_date ?? null,
        data.links ?? null,
        proposalStatus,
        proposalSentAt,
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
      ? `${user.name} won ${dealName}`
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
    await ensureExtraSchema();
    await assertCanEdit(user, "deals", data.id);
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
    await assertCanEdit(user, "deals", data.id);
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
    const user = await requireUser();
    await ensureExtraSchema();
    // Same permission rule as archiving: owner, co-editor, or admin only.
    await assertCanEdit(user, "deals", data.id);
    await db().prepare("UPDATE deals SET archived_at=NULL WHERE id=?").bind(data.id).run();
    return { ok: true };
  });

// ---------- Record access: hand off ownership / share edit rights ----------
const ENTITY_LABEL: Record<AccessEntity, string> = {
  company: "company",
  contact: "contact",
  deal: "deal",
  project: "project",
};

// A tiny label for feed lines — best effort, never blocks the mutation.
async function accessRecordName(table: (typeof ACCESS_TABLES)[AccessEntity], id: string): Promise<string> {
  try {
    if (table === "contacts") {
      const r = await db()
        .prepare("SELECT first_name, last_name FROM contacts WHERE id = ?")
        .bind(id)
        .first<{ first_name: string; last_name: string | null }>();
      return `${r?.first_name ?? ""} ${r?.last_name ?? ""}`.trim();
    }
    const r = await db().prepare(`SELECT name FROM ${table} WHERE id = ?`).bind(id).first<{ name: string }>();
    return r?.name ?? "";
  } catch {
    return "";
  }
}

// Hand a record off to another teammate — they become the new owner. Only the
// current owner (or an admin) may do this.
export const transferOwnership = createServerFn({ method: "POST" })
  .validator(z.object({ entity: z.enum(["company", "contact", "deal"]), id: z.string(), to_user_id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    const table = ACCESS_TABLES[data.entity as AccessEntity];
    const existing = await db()
      .prepare(`SELECT owner_id, shared_with FROM ${table} WHERE id = ?`)
      .bind(data.id)
      .first<{ owner_id: string | null; shared_with: string | null }>();
    if (!existing) throw new Error("NOT_FOUND");
    if (!canAdministerRecord(user, existing.owner_id)) throw new Error("FORBIDDEN");
    // New owner shouldn't linger in the shared list.
    const stillShared = (existing.shared_with ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== data.to_user_id);
    await db()
      .prepare(`UPDATE ${table} SET owner_id=?, shared_with=? WHERE id=?`)
      .bind(data.to_user_id, stillShared.length ? stillShared.join(",") : null, data.id)
      .run();
    const toUser = await db().prepare("SELECT name FROM users WHERE id = ?").bind(data.to_user_id).first<{ name: string }>();
    const label = await accessRecordName(table, data.id);
    await logEvent({
      actorId: user.id,
      verb: "reassigned",
      entityType: ENTITY_LABEL[data.entity as AccessEntity],
      entityId: data.id,
      summary: `${user.name} handed ${ENTITY_LABEL[data.entity as AccessEntity]} ${label} to ${toUser?.name ?? "a teammate"}`.trim(),
    });
    // Let the new owner know it's now theirs (don't notify yourself).
    if (data.to_user_id !== user.id) {
      await notify({
        userId: data.to_user_id,
        actorId: user.id,
        kind: "handoff",
        entityType: data.entity,
        entityId: data.id,
        summary: `${user.name} handed you ${ENTITY_LABEL[data.entity as AccessEntity]} ${label}`.trim(),
      });
    }
    return { ok: true };
  });

// Open-pool claim: a rep grabs an unowned opportunity off the Opportunities
// board and it (plus its deal) becomes theirs to work. Anyone can claim an
// unowned company; a company someone else already owns can't be snatched (only
// an admin can reassign that, via transferOwnership). Idempotent if you already
// own it.
export const claimCompany = createServerFn({ method: "POST" })
  .validator(z.object({ company_id: z.string() }))
  .handler(async ({ data }) => {
    const me = await requireUser();
    await ensureExtraSchema();
    const company = await db()
      .prepare("SELECT id, name, owner_id FROM companies WHERE id = ? AND archived_at IS NULL")
      .bind(data.company_id)
      .first<{ id: string; name: string; owner_id: string | null }>();
    if (!company) return { ok: false as const, error: "That company no longer exists." };

    if (company.owner_id && company.owner_id !== me.id) {
      // Owned by someone else — not up for grabs from the open pool.
      const owner = await db()
        .prepare("SELECT name FROM users WHERE id = ?")
        .bind(company.owner_id)
        .first<{ name: string }>();
      return {
        ok: false as const,
        error: `${owner?.name ?? "Someone else"} already owns this one. Ask an admin to reassign it.`,
      };
    }
    if (company.owner_id === me.id) {
      return { ok: true as const, alreadyMine: true };
    }

    // Take ownership of the company and its open deal(s) so it shows up in the
    // claimer's pipeline right away.
    await db().prepare("UPDATE companies SET owner_id = ? WHERE id = ?").bind(me.id, company.id).run();
    await db()
      .prepare(`UPDATE deals SET owner_id = ? WHERE company_id = ? AND archived_at IS NULL AND owner_id IS NULL`)
      .bind(me.id, company.id)
      .run();

    await logEvent({
      actorId: me.id,
      verb: "claimed",
      entityType: "company",
      entityId: company.id,
      summary: `${me.name} claimed ${company.name} from the opportunity pool`,
    });
    return { ok: true as const, alreadyMine: false };
  });

// Admin one-click pool cleanup: take every unclaimed lead sitting in the open
// pool and either hand it to a rep or junk it. Leads WITH a phone number get
// assigned round-robin to the least-loaded eligible rep (same balancer the radar
// uses — excludes Barry & Michael). Leads with NO phone number get junked to the
// trash (soft-delete, fully reversible) since there's no way to call them.
// Admin only. Returns how many were assigned vs. junked.
export const redistributePool = createServerFn({ method: "POST" }).handler(async () => {
  const me = await requireAdmin();
  await ensureExtraSchema();

  const pool =
    (
      await db()
        .prepare(
          `SELECT id, name, phone FROM companies
            WHERE owner_id IS NULL AND archived_at IS NULL`,
        )
        .all<{ id: string; name: string; phone: string | null }>()
    ).results ?? [];

  let assigned = 0;
  let junked = 0;
  const now = new Date().toISOString();

  // Load every eligible rep's live deal count ONCE, then balance the batch in
  // memory (incrementing the picked rep's count per assignment). Same even
  // spread as re-querying per lead, without the N+1 query storm that used to
  // hammer the pooler on big cleanups.
  const reps = await loadAutoAssignees();

  for (const c of pool) {
    if (normPhone(c.phone).length > 0) {
      const rep = pickLeastLoaded(reps);
      if (!rep) continue; // nobody eligible — leave it in the pool
      rep.open_deals++;
      await db().prepare("UPDATE companies SET owner_id = ? WHERE id = ?").bind(rep.id, c.id).run();
      await db()
        .prepare(
          `UPDATE deals SET owner_id = ? WHERE company_id = ? AND archived_at IS NULL AND owner_id IS NULL`,
        )
        .bind(rep.id, c.id)
        .run();
      assigned++;
      await logEvent({
        actorId: me.id,
        verb: "assigned",
        entityType: "company",
        entityId: c.id,
        summary: `${c.name} assigned to ${rep.name} (pool cleanup)`,
      });
    } else {
      // No phone → junk it to the trash. Soft-delete, so it's recoverable and
      // (per the de-dup rules) can't be re-discovered as a fresh lead.
      await db().prepare("UPDATE companies SET archived_at = ? WHERE id = ?").bind(now, c.id).run();
      await db()
        .prepare("UPDATE deals SET archived_at = ? WHERE company_id = ? AND archived_at IS NULL")
        .bind(now, c.id)
        .run();
      junked++;
      await logEvent({
        actorId: me.id,
        verb: "archived",
        entityType: "company",
        entityId: c.id,
        summary: `${c.name} junked from the pool — no phone number`,
      });
    }
  }

  return { ok: true as const, assigned, junked, total: pool.length };
});

// Admin bulk handoff: move an entire book of business from one teammate to
// another in one shot — every company, and optionally the deals and contacts
// they own. Used when a rep leaves or accounts get reshuffled. Admin only.
export const adminReassignBook = createServerFn({ method: "POST" })
  .validator(
    z.object({
      from_user_id: z.string(),
      to_user_id: z.string(),
      companies: z.boolean().default(true),
      deals: z.boolean().default(false),
      contacts: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    await ensureExtraSchema();
    if (data.from_user_id === data.to_user_id) {
      return { ok: false as const, error: "Pick a different teammate to hand records to." };
    }
    const [fromU, toU] = await Promise.all([
      db().prepare("SELECT name FROM users WHERE id = ?").bind(data.from_user_id).first<{ name: string }>(),
      db().prepare("SELECT name FROM users WHERE id = ?").bind(data.to_user_id).first<{ name: string }>(),
    ]);
    if (!fromU || !toU) return { ok: false as const, error: "Couldn't find one of those teammates." };

    // Count then update, so we can report exactly what moved. Only touch live
    // (non-archived) records; archived ones stay put.
    async function moveTable(table: "companies" | "deals" | "contacts"): Promise<number> {
      const row = await db()
        .prepare(`SELECT COUNT(*)::int AS c FROM ${table} WHERE owner_id = ? AND archived_at IS NULL`)
        .bind(data.from_user_id)
        .first<{ c: number }>();
      const n = row?.c ?? 0;
      if (n > 0) {
        await db()
          .prepare(`UPDATE ${table} SET owner_id = ? WHERE owner_id = ? AND archived_at IS NULL`)
          .bind(data.to_user_id, data.from_user_id)
          .run();
      }
      return n;
    }

    const moved = { companies: 0, deals: 0, contacts: 0 };
    if (data.companies) moved.companies = await moveTable("companies");
    if (data.deals) moved.deals = await moveTable("deals");
    if (data.contacts) moved.contacts = await moveTable("contacts");

    const parts = [
      data.companies ? `${moved.companies} companies` : null,
      data.deals ? `${moved.deals} deals` : null,
      data.contacts ? `${moved.contacts} contacts` : null,
    ].filter(Boolean);
    const summary = `${me.name} moved ${parts.join(", ")} from ${fromU.name} to ${toU.name}`;

    await logEvent({
      actorId: me.id,
      verb: "reassigned",
      entityType: "team",
      entityId: data.to_user_id,
      summary,
      meta: { from: data.from_user_id, to: data.to_user_id, moved },
    });
    if (data.to_user_id !== me.id) {
      await notify({
        userId: data.to_user_id,
        actorId: me.id,
        kind: "handoff",
        entityType: "team",
        entityId: data.to_user_id,
        summary: `${me.name} handed you ${parts.join(", ")} from ${fromU.name}`,
      });
    }
    return { ok: true as const, moved };
  });

// Set the exact list of teammates who can edit this record alongside the owner.
// Passing an empty list revokes all sharing. Only the owner (or admin) may share.
export const shareRecord = createServerFn({ method: "POST" })
  .validator(z.object({ entity: z.enum(["company", "contact", "deal"]), id: z.string(), user_ids: z.array(z.string()) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    const table = ACCESS_TABLES[data.entity as AccessEntity];
    const existing = await db()
      .prepare(`SELECT owner_id, shared_with FROM ${table} WHERE id = ?`)
      .bind(data.id)
      .first<{ owner_id: string | null; shared_with: string | null }>();
    if (!existing) throw new Error("NOT_FOUND");
    if (!canAdministerRecord(user, existing.owner_id)) throw new Error("FORBIDDEN");
    // Never keep the owner in their own share list; de-dupe the rest.
    const ids = Array.from(
      new Set(data.user_ids.map((s) => s.trim()).filter((s) => s && s !== existing.owner_id)),
    );
    const before = new Set(
      (existing.shared_with ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    );
    await db()
      .prepare(`UPDATE ${table} SET shared_with=? WHERE id=?`)
      .bind(ids.length ? ids.join(",") : null, data.id)
      .run();
    const label = await accessRecordName(table, data.id);
    // Notify teammates newly granted access (not already shared, not yourself).
    for (const uidTarget of ids) {
      if (uidTarget === user.id || before.has(uidTarget)) continue;
      await notify({
        userId: uidTarget,
        actorId: user.id,
        kind: "share",
        entityType: data.entity,
        entityId: data.id,
        summary: `${user.name} shared ${ENTITY_LABEL[data.entity as AccessEntity]} ${label} with you`.trim(),
      });
    }
    await logEvent({
      actorId: user.id,
      verb: "shared",
      entityType: ENTITY_LABEL[data.entity as AccessEntity],
      entityId: data.id,
      summary: ids.length
        ? `${user.name} shared ${ENTITY_LABEL[data.entity as AccessEntity]} ${label} with ${ids.length} teammate${ids.length > 1 ? "s" : ""}`.trim()
        : `${user.name} stopped sharing ${ENTITY_LABEL[data.entity as AccessEntity]} ${label}`.trim(),
    });
    return { ok: true };
  });

// ---------- Call queue triage & company board ----------
// Companies with no deal yet form a "need to call" queue. Triaging a company
// stamps an outcome so it leaves the queue and lands in a bucket on the board:
//   interested ("Yes") / maybe / not_interested ("No") / signed.
// Passing null puts it back in the "To Call" column.
// When a rep marks a company "signed" and picks a pricing package, we also spin
// up a won deal (unless one already exists) so revenue numbers stay accurate.
const OUTCOME_LABEL: Record<string, string> = {
  interested: "interested",
  maybe: "a maybe",
  not_interested: "not interested",
  no_answer: "no answer",
  signed: "signed",
};

export const setCompanyCallOutcome = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string(),
      outcome: z.enum(["interested", "not_interested", "maybe", "no_answer", "signed"]).nullable(),
      // Optional deal details supplied when marking a company "signed".
      package: z.string().optional().nullable(),
      value: z.number().nonnegative().optional().nullable(),
      monthly_value: z.number().nonnegative().optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    await assertCanEdit(user, "companies", data.id);

    const company = await db()
      .prepare(`SELECT id, name, owner_id FROM companies WHERE id = ?`)
      .bind(data.id)
      .first<{ id: string; name: string; owner_id: string | null }>();
    if (!company) throw new Error("NOT_FOUND");

    // Leaving the "no answer" queue (they replied / gave up / signed) also
    // clears any scheduled nudge so it never counts as due again.
    await db()
      .prepare(
        `UPDATE companies
            SET call_outcome = ?,
                next_followup_at = CASE WHEN ? = 'no_answer' THEN next_followup_at ELSE NULL END
          WHERE id = ?`,
      )
      .bind(data.outcome, data.outcome, data.id)
      .run();

    const name = company.name;
    const now = new Date().toISOString();

    // Keep the company's pipeline deal in step with the call outcome. Every
    // company has an auto-created "To Call" deal, so triaging should MOVE that
    // deal along the board rather than spawn duplicates. Prefer the To Call deal
    // if present, otherwise the most recently touched one.
    const deal = await db()
      .prepare(
        `SELECT id, stage FROM deals
           WHERE company_id = ? AND archived_at IS NULL
           ORDER BY (stage = ?) DESC, updated_at DESC LIMIT 1`,
      )
      .bind(data.id, TO_CALL_STAGE)
      .first<{ id: string; stage: string }>();
    const isOpen = (s: string) => OPEN_STAGES.includes(s);

    let createdDeal = false;
    if (data.outcome === "signed") {
      // Convert the company's open deal to a won deal — but only if one isn't
      // already won, so revenue never double-counts.
      const existingWon = await db()
        .prepare(
          `SELECT id FROM deals WHERE company_id = ? AND stage = ? AND archived_at IS NULL LIMIT 1`,
        )
        .bind(data.id, WON_STAGE)
        .first<{ id: string }>();
      if (!existingWon) {
        const pkg = (data.package || "").trim();
        if (deal) {
          // Promote the existing (To Call / open) deal to Launched.
          await db()
            .prepare(
              `UPDATE deals SET name = CASE WHEN ? <> '' THEN ? ELSE name END,
                 stage=?, proposal_status='signed',
                 value=COALESCE(?, value), monthly_value=COALESCE(?, monthly_value),
                 stage_changed_at=?, updated_at=? WHERE id=?`,
            )
            .bind(
              pkg,
              pkg ? `${name} — ${pkg}` : "",
              WON_STAGE,
              data.value ?? null,
              data.monthly_value ?? null,
              now,
              now,
              deal.id,
            )
            .run();
          await logEvent({
            actorId: user.id,
            verb: "won",
            entityType: "deal",
            entityId: deal.id,
            summary: `${user.name} signed ${name}${pkg ? ` on the ${pkg} package` : ""}`,
          });
        } else {
          // Fallback: no deal on file, so create the won deal outright.
          const dealId = uid();
          const dealName = pkg ? `${name} — ${pkg}` : `${name} — Website`;
          await db()
            .prepare(
              `INSERT INTO deals (id, name, company_id, contact_id, owner_id, stage, value, expected_close, next_step, notes, lost_reason, win_reason, monthly_value, renewal_date, links, proposal_status, proposal_sent_at, created_at, updated_at, stage_changed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              dealId,
              dealName,
              data.id,
              null,
              company.owner_id ?? user.id,
              WON_STAGE,
              data.value ?? 0,
              null,
              null,
              null,
              null,
              null,
              data.monthly_value ?? 0,
              null,
              null,
              "signed",
              now,
              now,
              now,
              now,
            )
            .run();
          createdDeal = true;
          await logEvent({
            actorId: user.id,
            verb: "won",
            entityType: "deal",
            entityId: dealId,
            summary: `${user.name} signed ${name}${pkg ? ` on the ${pkg} package` : ""}`,
          });
        }
      }
    } else if (data.outcome === "not_interested") {
      // A "no" drops the open deal to Lost (leave won deals untouched).
      if (deal && isOpen(deal.stage)) {
        await db()
          .prepare(`UPDATE deals SET stage=?, stage_changed_at=?, updated_at=? WHERE id=?`)
          .bind(LOST_STAGE, now, now, deal.id)
          .run();
      }
    } else if (data.outcome === "interested" || data.outcome === "maybe") {
      // A "yes"/"maybe" advances a fresh To Call deal to Lead (don't rewind a
      // deal a rep has already pushed further along).
      if (deal && deal.stage === TO_CALL_STAGE) {
        await db()
          .prepare(`UPDATE deals SET stage=?, stage_changed_at=?, updated_at=? WHERE id=?`)
          .bind("Lead", now, now, deal.id)
          .run();
      }
    } else if (data.outcome === null) {
      // Reset: send a triage-moved deal back to To Call (but never a won deal or
      // one a rep has advanced past Lead on their own).
      if (deal && (deal.stage === LOST_STAGE || deal.stage === "Lead")) {
        await db()
          .prepare(`UPDATE deals SET stage=?, stage_changed_at=?, updated_at=? WHERE id=?`)
          .bind(TO_CALL_STAGE, now, now, deal.id)
          .run();
      }
    }

    if (data.outcome && data.outcome !== "signed") {
      await logEvent({
        actorId: user.id,
        verb: "triaged",
        entityType: "company",
        entityId: data.id,
        summary: `${user.name} marked ${name || "a company"} ${OUTCOME_LABEL[data.outcome] ?? data.outcome}`,
      });
    }
    return { ok: true, createdDeal };
  });

// ---------- Sales payroll ----------
// Reps earn 30% of every signed retainer for 12 months, plus a one-time $1,500
// bonus the first month they sign 5+. This computes each rep's earned/paid/owed
// ledger from their won deals + recorded payments. Money math lives in pure
// helpers (dealCommission / salesBonus) so it can be unit-tested.
export type PayrollDeal = {
  id: string;
  name: string;
  company_name: string | null;
  monthly: number;
  signed_at: string;
  earnedMonths: number;
  earned: number;
  lifetime: number;
};
export type PayrollPaymentRow = {
  id: string;
  amount: number;
  paid_at: string;
  note: string | null;
};
export type PayrollRep = {
  id: string;
  name: string;
  email: string;
  cadence: string;
  salesTotal: number;
  bestMonthCount: number;
  monthlyBook: number; // sum of monthly retainers they've signed
  commissionEarned: number;
  lifetimeCommission: number;
  bonusEarned: number;
  bonusMonth: string | null;
  earned: number;
  paid: number;
  owed: number;
  deals: PayrollDeal[];
  payments: PayrollPaymentRow[];
};

// Payroll is admin-only: every entry point below calls requireAdmin(), so a
// non-admin session gets FORBIDDEN even if it hits the server fn directly. The
// UI's code lock is a second layer, not the security boundary.
export const getPayroll = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  await ensureExtraSchema();

  const { results: users } = await db()
    .prepare(
      `SELECT id, name, email, COALESCE(pay_cadence, 'monthly') AS pay_cadence
       FROM users ORDER BY name`,
    )
    .all<{ id: string; name: string; email: string; pay_cadence: string }>();

  const { results: dealRows } = await db()
    .prepare(
      `SELECT d.id, d.name, d.owner_id,
        COALESCE(d.monthly_value, 0) AS monthly_value,
        COALESCE(d.stage_changed_at, d.created_at) AS signed_at,
        co.name AS company_name
       FROM deals d
       LEFT JOIN companies co ON co.id = d.company_id
       WHERE d.stage = ? AND d.archived_at IS NULL
       ORDER BY signed_at DESC`,
    )
    .bind(WON_STAGE)
    .all<{
      id: string;
      name: string;
      owner_id: string | null;
      monthly_value: number | string;
      signed_at: string;
      company_name: string | null;
    }>();

  const { results: paymentRows } = await db()
    .prepare(
      `SELECT id, user_id, amount, paid_at, note
       FROM payroll_payments ORDER BY paid_at DESC, created_at DESC`,
    )
    .all<{ id: string; user_id: string; amount: number | string; paid_at: string; note: string | null }>();

  const now = new Date();
  const reps: PayrollRep[] = (users ?? []).map((u) => {
    const mine = (dealRows ?? []).filter((d) => d.owner_id === u.id);
    const perMonth: Record<string, number> = {};
    let monthlyBook = 0;
    let commissionEarned = 0;
    let lifetimeCommission = 0;
    const deals: PayrollDeal[] = mine.map((d) => {
      const monthly = Number(d.monthly_value) || 0;
      monthlyBook += monthly;
      const c = dealCommission(monthly, d.signed_at, now);
      commissionEarned += c.earned;
      lifetimeCommission += c.lifetime;
      const mo = (d.signed_at || "").slice(0, 7); // YYYY-MM
      if (mo) perMonth[mo] = (perMonth[mo] ?? 0) + 1;
      return {
        id: d.id,
        name: d.name,
        company_name: d.company_name,
        monthly,
        signed_at: d.signed_at,
        earnedMonths: c.earnedMonths,
        earned: c.earned,
        lifetime: c.lifetime,
      };
    });
    const bonus = salesBonus(perMonth);
    const bestMonthCount = Object.values(perMonth).reduce((mx, n) => Math.max(mx, n), 0);
    const payments = (paymentRows ?? [])
      .filter((p) => p.user_id === u.id)
      .map((p) => ({ id: p.id, amount: Number(p.amount) || 0, paid_at: p.paid_at, note: p.note }));
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    const earned = commissionEarned + bonus.earned;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      cadence: u.pay_cadence,
      salesTotal: mine.length,
      bestMonthCount,
      monthlyBook,
      commissionEarned,
      lifetimeCommission,
      bonusEarned: bonus.earned,
      bonusMonth: bonus.month,
      earned,
      paid,
      owed: Math.max(0, earned - paid),
      deals,
      payments,
    };
  });

  return { reps };
});

export const recordPayrollPayment = createServerFn({ method: "POST" })
  .validator(
    z.object({
      user_id: z.string(),
      amount: z.number().positive(),
      paid_at: z.string().min(1),
      note: z.string().optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    await ensureExtraSchema();
    const id = uid();
    await db()
      .prepare(
        `INSERT INTO payroll_payments (id, user_id, amount, paid_at, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, data.user_id, data.amount, data.paid_at, data.note ?? null, user.id)
      .run();
    const rep = await db()
      .prepare(`SELECT name FROM users WHERE id = ?`)
      .bind(data.user_id)
      .first<{ name: string }>();
    await logEvent({
      actorId: user.id,
      verb: "paid",
      entityType: "payroll",
      entityId: id,
      summary: `${user.name} recorded a payroll payment to ${rep?.name ?? "a rep"}`,
    });
    return { id };
  });

export const deletePayrollPayment = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    await ensureExtraSchema();
    await db().prepare(`DELETE FROM payroll_payments WHERE id = ?`).bind(data.id).run();
    await logEvent({
      actorId: user.id,
      verb: "deleted",
      entityType: "payroll",
      entityId: data.id,
      summary: `${user.name} removed a payroll payment`,
    });
    return { ok: true };
  });

export const setPayCadence = createServerFn({ method: "POST" })
  .validator(z.object({ user_id: z.string(), cadence: z.enum(["monthly", "biweekly"]) }))
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureExtraSchema();
    await db()
      .prepare(`UPDATE users SET pay_cadence = ? WHERE id = ?`)
      .bind(data.cadence, data.user_id)
      .run();
    return { ok: true };
  });

// ---------- Notifications (record handed off / shared with you) ----------
export type NotificationRow = {
  id: string;
  actor_id: string | null;
  kind: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  seen: boolean;
  created_at: string;
  actor_name: string | null;
};

export const getNotifications = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  await ensureExtraSchema();
  const { results } = await db()
    .prepare(
      `SELECT n.id, n.actor_id, n.kind, n.entity_type, n.entity_id, n.summary, n.seen, n.created_at,
        u.name AS actor_name
       FROM notifications n LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = ?
       ORDER BY n.created_at DESC LIMIT 30`,
    )
    .bind(user.id)
    .all<NotificationRow>();
  return results ?? [];
});

export const markNotificationsSeen = createServerFn({ method: "POST" })
  .validator(z.object({ ids: z.array(z.string()).optional() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    if (data.ids && data.ids.length) {
      const placeholders = data.ids.map(() => "?").join(",");
      await db()
        .prepare(`UPDATE notifications SET seen=true WHERE user_id=? AND id IN (${placeholders})`)
        .bind(user.id, ...data.ids)
        .run();
    } else {
      await db().prepare(`UPDATE notifications SET seen=true WHERE user_id=?`).bind(user.id).run();
    }
    return { ok: true };
  });

// ---------- Bulk CSV import ----------
// Accepts rows already parsed on the client. Creates companies or contacts owned
// by the importer. Returns how many were added so the UI can report back.
const importCompanyRow = z.object({
  name: z.string().min(1),
  industry: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
});
const importContactRow = z.object({
  first_name: z.string().min(1),
  last_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
});

export const importCompanies = createServerFn({ method: "POST" })
  .validator(z.object({ rows: z.array(importCompanyRow) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    // Dedupe guard: skip rows matching an existing active company by
    // normalized name or phone (and dedupe within the batch itself).
    const { results: existing } = await db()
      .prepare(`SELECT name, phone FROM companies WHERE archived_at IS NULL`)
      .all<{ name: string; phone: string | null }>();
    const seenNames = new Set((existing ?? []).map((c) => companyNameKey(c.name)));
    const seenPhones = new Set((existing ?? []).map((c) => phoneKey(c.phone)).filter(Boolean));
    let added = 0;
    let skipped = 0;
    for (const r of data.rows) {
      const name = r.name.trim();
      if (!name) continue;
      const nameKey = companyNameKey(name);
      const phKey = phoneKey(r.phone);
      if (seenNames.has(nameKey) || (phKey && seenPhones.has(phKey))) {
        skipped++;
        continue;
      }
      seenNames.add(nameKey);
      if (phKey) seenPhones.add(phKey);
      await db()
        .prepare(
          `INSERT INTO companies (id, name, industry, website, phone, city, source, owner_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          uid(),
          name,
          r.industry?.trim() || null,
          r.website?.trim() || null,
          r.phone?.trim() || null,
          r.city?.trim() || null,
          r.source?.trim() || null,
          user.id,
        )
        .run();
      added++;
    }
    if (added) {
      await logEvent({
        actorId: user.id,
        verb: "imported",
        entityType: "company",
        summary: `${user.name} imported ${added} compan${added === 1 ? "y" : "ies"} from CSV`,
      });
    }
    return { added, skipped };
  });

export const importContacts = createServerFn({ method: "POST" })
  .validator(z.object({ rows: z.array(importContactRow) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    // Resolve company names to ids once, case-insensitively.
    const { results: cos } = await db()
      .prepare(`SELECT id, name FROM companies WHERE archived_at IS NULL`)
      .all<{ id: string; name: string }>();
    const byName = new Map<string, string>();
    for (const c of cos ?? []) byName.set(c.name.trim().toLowerCase(), c.id);
    // Dedupe guard: skip rows matching an existing active contact by email
    // or phone (and dedupe within the batch itself).
    const { results: existing } = await db()
      .prepare(`SELECT email, phone FROM contacts WHERE archived_at IS NULL`)
      .all<{ email: string | null; phone: string | null }>();
    const seenEmails = new Set((existing ?? []).map((c) => emailKey(c.email)).filter(Boolean));
    const seenPhones = new Set((existing ?? []).map((c) => phoneKey(c.phone)).filter(Boolean));
    let added = 0;
    let skipped = 0;
    for (const r of data.rows) {
      const first = r.first_name.trim();
      if (!first) continue;
      const emKey = emailKey(r.email);
      const phKey = phoneKey(r.phone);
      if ((emKey && seenEmails.has(emKey)) || (phKey && seenPhones.has(phKey))) {
        skipped++;
        continue;
      }
      if (emKey) seenEmails.add(emKey);
      if (phKey) seenPhones.add(phKey);
      const companyId = r.company_name ? byName.get(r.company_name.trim().toLowerCase()) ?? null : null;
      await db()
        .prepare(
          `INSERT INTO contacts (id, first_name, last_name, email, phone, title, company_id, owner_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          uid(),
          first,
          r.last_name?.trim() || null,
          r.email?.trim() || null,
          r.phone?.trim() || null,
          r.title?.trim() || null,
          companyId,
          user.id,
        )
        .run();
      added++;
    }
    if (added) {
      await logEvent({
        actorId: user.id,
        verb: "imported",
        entityType: "contact",
        summary: `${user.name} imported ${added} contact${added === 1 ? "" : "s"} from CSV`,
      });
    }
    return { added, skipped };
  });

// ---------- Duplicate cleanup & merge ----------
// The duplicates panel: group active companies by normalized name/phone and
// active contacts by email/phone, then let the user merge each group down to
// one record. Visible to everyone (matches the open-book visibility policy);
// merging itself is permission-checked per record.

export const getDuplicateGroups = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  await ensureExtraSchema();
  const { results: companies } = await db()
    .prepare(
      `SELECT id, name, phone, city, owner_id, created_at
         FROM companies WHERE archived_at IS NULL ORDER BY created_at ASC`,
    )
    .all<{
      id: string;
      name: string;
      phone: string | null;
      city: string | null;
      owner_id: string | null;
      created_at: string;
    }>();
  const { results: contacts } = await db()
    .prepare(
      `SELECT id, first_name, last_name, email, phone, company_id, owner_id, created_at
         FROM contacts WHERE archived_at IS NULL ORDER BY created_at ASC`,
    )
    .all<{
      id: string;
      first_name: string;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      company_id: string | null;
      owner_id: string | null;
      created_at: string;
    }>();
  // Companies match on normalized name, or on phone when both have one.
  const companyGroups = groupDuplicates(companies ?? [], (c) => [
    companyNameKey(c.name),
    phoneKey(c.phone),
  ]);
  // Contacts match on email first, then phone.
  const contactGroups = groupDuplicates(contacts ?? [], (c) => [
    emailKey(c.email),
    phoneKey(c.phone),
  ]);
  return { companyGroups, contactGroups };
});

// Merge `merge_id` into `keep_id`: repoint every reference, fill any blank
// fields on the keeper from the loser, then archive the loser. Soft-delete
// means a bad merge is recoverable from the archive.
export const mergeCompanies = createServerFn({ method: "POST" })
  .validator(z.object({ keep_id: z.string().min(1), merge_id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    if (data.keep_id === data.merge_id) throw new Error("Cannot merge a record into itself");
    // Must be allowed to edit BOTH records (owner, co-editor, or admin).
    await assertCanEdit(user, "companies", data.keep_id);
    await assertCanEdit(user, "companies", data.merge_id);
    const keep = await db()
      .prepare(`SELECT * FROM companies WHERE id = ? AND archived_at IS NULL`)
      .bind(data.keep_id)
      .first<CompanyRow & { email_touches: number | null; last_emailed_at: string | null }>();
    const lose = await db()
      .prepare(`SELECT * FROM companies WHERE id = ? AND archived_at IS NULL`)
      .bind(data.merge_id)
      .first<CompanyRow & { email_touches: number | null; last_emailed_at: string | null }>();
    if (!keep || !lose) throw new Error("Company not found (already merged or archived?)");
    // Repoint children.
    await db()
      .prepare(`UPDATE contacts SET company_id = ? WHERE company_id = ?`)
      .bind(keep.id, lose.id)
      .run();
    await db()
      .prepare(`UPDATE deals SET company_id = ? WHERE company_id = ?`)
      .bind(keep.id, lose.id)
      .run();
    await db()
      .prepare(`UPDATE sent_emails SET company_id = ? WHERE company_id = ?`)
      .bind(keep.id, lose.id)
      .run();
    await db()
      .prepare(`UPDATE notes SET entity_id = ? WHERE entity_type = 'company' AND entity_id = ?`)
      .bind(keep.id, lose.id)
      .run();
    // The loser's cached AI brief no longer matches anything; drop it.
    await db().prepare(`DELETE FROM ai_briefs WHERE company_id = ?`).bind(lose.id).run();
    // Fill blanks on the keeper from the loser; union tags; keep the higher
    // email-touch count and the more recent emailed-at.
    const tagUnion = [
      ...new Set(
        [...(keep.tags ?? "").split(","), ...(lose.tags ?? "").split(",")]
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ].join(",");
    const mergedNotes =
      keep.notes && lose.notes ? `${keep.notes}\n---\n${lose.notes}` : keep.notes || lose.notes;
    await db()
      .prepare(
        `UPDATE companies SET
           industry = COALESCE(industry, ?),
           website = COALESCE(website, ?),
           phone = COALESCE(phone, ?),
           city = COALESCE(city, ?),
           source = COALESCE(source, ?),
           call_outcome = COALESCE(call_outcome, ?),
           notes = ?,
           tags = ?,
           email_touches = GREATEST(COALESCE(email_touches, 0), ?),
           last_emailed_at = NULLIF(GREATEST(COALESCE(last_emailed_at, ''), COALESCE(?, '')), '')
         WHERE id = ?`,
      )
      .bind(
        lose.industry,
        lose.website,
        lose.phone,
        lose.city,
        lose.source,
        lose.call_outcome ?? null,
        mergedNotes ?? null,
        tagUnion || null,
        lose.email_touches ?? 0,
        lose.last_emailed_at ?? "",
        keep.id,
      )
      .run();
    // Archive the loser (blocks re-discovery and keeps it recoverable).
    await db()
      .prepare(
        `UPDATE companies SET archived_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE id = ?`,
      )
      .bind(lose.id)
      .run();
    await logEvent({
      actorId: user.id,
      verb: "merged",
      entityType: "company",
      entityId: keep.id,
      summary: `${user.name} merged duplicate company "${lose.name}" into "${keep.name}"`,
    });
    return { ok: true };
  });

export const mergeContacts = createServerFn({ method: "POST" })
  .validator(z.object({ keep_id: z.string().min(1), merge_id: z.string().min(1) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    if (data.keep_id === data.merge_id) throw new Error("Cannot merge a record into itself");
    await assertCanEdit(user, "contacts", data.keep_id);
    await assertCanEdit(user, "contacts", data.merge_id);
    const keep = await db()
      .prepare(`SELECT * FROM contacts WHERE id = ? AND archived_at IS NULL`)
      .bind(data.keep_id)
      .first<ContactRow>();
    const lose = await db()
      .prepare(`SELECT * FROM contacts WHERE id = ? AND archived_at IS NULL`)
      .bind(data.merge_id)
      .first<ContactRow>();
    if (!keep || !lose) throw new Error("Contact not found (already merged or archived?)");
    await db()
      .prepare(`UPDATE deals SET contact_id = ? WHERE contact_id = ?`)
      .bind(keep.id, lose.id)
      .run();
    await db()
      .prepare(`UPDATE activities SET contact_id = ? WHERE contact_id = ?`)
      .bind(keep.id, lose.id)
      .run();
    await db()
      .prepare(`UPDATE sent_emails SET contact_id = ? WHERE contact_id = ?`)
      .bind(keep.id, lose.id)
      .run();
    await db()
      .prepare(`UPDATE notes SET entity_id = ? WHERE entity_type = 'contact' AND entity_id = ?`)
      .bind(keep.id, lose.id)
      .run();
    const mergedNotes =
      keep.notes && lose.notes ? `${keep.notes}\n---\n${lose.notes}` : keep.notes || lose.notes;
    await db()
      .prepare(
        `UPDATE contacts SET
           last_name = COALESCE(last_name, ?),
           email = COALESCE(email, ?),
           phone = COALESCE(phone, ?),
           title = COALESCE(title, ?),
           company_id = COALESCE(company_id, ?),
           notes = ?
         WHERE id = ?`,
      )
      .bind(
        lose.last_name,
        lose.email,
        lose.phone,
        lose.title,
        lose.company_id,
        mergedNotes ?? null,
        keep.id,
      )
      .run();
    await db()
      .prepare(
        `UPDATE contacts SET archived_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE id = ?`,
      )
      .bind(lose.id)
      .run();
    await logEvent({
      actorId: user.id,
      verb: "merged",
      entityType: "contact",
      entityId: keep.id,
      summary: `${user.name} merged duplicate contact "${[lose.first_name, lose.last_name].filter(Boolean).join(" ")}" into "${[keep.first_name, keep.last_name].filter(Boolean).join(" ")}"`,
    });
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

// Log an outcome from Call Mode: records a completed Call activity (which also
// refreshes the contact's "last contacted"), optionally schedules a follow-up,
// and writes a line to the team feed.
export const logCall = createServerFn({ method: "POST" })
  .validator(
    z.object({
      contact_id: z.string().optional().nullable(),
      deal_id: z.string().optional().nullable(),
      subject_name: z.string().optional().nullable(),
      outcome: z.string().min(1),
      notes: z.string().optional().nullable(),
      followup_date: z.string().optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const now = new Date().toISOString();
    const who = data.subject_name ? ` with ${data.subject_name}` : "";
    await db()
      .prepare(
        `INSERT INTO activities (id, type, subject, deal_id, contact_id, owner_id, status, due_date, notes, completed_at)
         VALUES (?, 'Call', ?, ?, ?, ?, 'done', NULL, ?, ?)`,
      )
      .bind(
        uid(),
        `Call${who} — ${data.outcome}`,
        data.deal_id ?? null,
        data.contact_id ?? null,
        user.id,
        data.notes ?? null,
        now,
      )
      .run();
    if (data.followup_date) {
      await db()
        .prepare(
          `INSERT INTO activities (id, type, subject, deal_id, contact_id, owner_id, status, due_date, notes)
           VALUES (?, 'Task', ?, ?, ?, ?, 'open', ?, NULL)`,
        )
        .bind(
          uid(),
          `Follow up${who}`,
          data.deal_id ?? null,
          data.contact_id ?? null,
          user.id,
          data.followup_date,
        )
        .run();
    }
    await logEvent({
      actorId: user.id,
      verb: "completed",
      entityType: data.contact_id ? "contact" : "deal",
      entityId: data.contact_id ?? data.deal_id ?? null,
      summary: `${user.name} logged a call${who} — ${data.outcome}`,
    });

    // If the call ended in a flat "no", drop the linked deal straight into Lost
    // (the "No" column) so the rep never has to go hunt for it in the pipeline and
    // drag it across. Only fires on an explicit "Not interested" outcome, only when
    // there's an open deal to move, and never touches an already won/lost deal.
    let movedToLost = false;
    if (data.deal_id && /not interested/i.test(data.outcome)) {
      const deal = await db()
        .prepare("SELECT name, stage FROM deals WHERE id = ? AND archived_at IS NULL")
        .bind(data.deal_id)
        .first<{ name: string; stage: string }>();
      if (deal && deal.stage !== LOST_STAGE && deal.stage !== WON_STAGE) {
        await db()
          .prepare(
            `UPDATE deals SET stage = ?, updated_at = ?, stage_changed_at = ?,
               lost_reason = COALESCE(lost_reason, ?) WHERE id = ?`,
          )
          .bind(LOST_STAGE, now, now, "Not interested (logged from a call)", data.deal_id)
          .run();
        await logStageChange(user, data.deal_id, deal.name, deal.stage, LOST_STAGE);
        movedToLost = true;
      }
    }
    return { ok: true, movedToLost };
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
        COALESCE(SUM(CASE WHEN stage IN (${OPEN_LIST}) AND COALESCE(value,0) <= 0 THEN 1 END),0)::int AS open_unpriced,
        COALESCE(SUM(CASE WHEN stage IN (${OPEN_LIST}) THEN monthly_value END),0) AS open_monthly,
        COALESCE(SUM(CASE WHEN stage='Launched' THEN value END),0) AS won_value,
        COALESCE(SUM(CASE WHEN stage='Launched' THEN 1 END),0)::int AS won_count,
        COALESCE(SUM(CASE WHEN stage='Lost' THEN 1 END),0)::int AS lost_count
       FROM deals WHERE archived_at IS NULL`,
    )
    .first<{
      open_value: number;
      open_count: number;
      open_unpriced: number;
      open_monthly: number;
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

  // Weighted recurring-revenue forecast (conservative). For every open deal we
  // take its monthly retainer x its stage's win-odds and add them up: early-stage
  // deals barely count, near-close deals count almost fully — so a big raw
  // pipeline shrinks to a realistic "what we'll actually bank each month" number.
  // Deals with no price yet are valued at the LOW end of our range ($299/mo) so
  // the forecast stays a floor, never optimistic. MRR x 12 = ARR.
  const { results: fcRows } = await database
    .prepare(
      `SELECT stage,
        COALESCE(SUM(CASE WHEN monthly_value > 0 THEN monthly_value END),0) AS priced_monthly,
        COALESCE(SUM(CASE WHEN COALESCE(monthly_value,0) <= 0 THEN 1 END),0)::int AS unpriced_count
       FROM deals WHERE stage IN (${OPEN_LIST}) AND archived_at IS NULL
       GROUP BY stage`,
    )
    .all<{ stage: string; priced_monthly: number; unpriced_count: number }>();
  let forecastMrr = 0; // stage-weighted (conservative)
  let rawOpenMrr = 0; // unweighted total, for the "of $X pipeline" context
  for (const r of fcRows ?? []) {
    const prob = STAGES.find((x) => x.name === r.stage)?.prob ?? 0;
    const stageMrr = Number(r.priced_monthly) + r.unpriced_count * ESTIMATE_LOW_MONTHLY;
    forecastMrr += stageMrr * prob;
    rawOpenMrr += stageMrr;
  }
  const forecast = {
    mrr: Math.round(forecastMrr),
    arr: Math.round(forecastMrr * 12),
    rawMrr: Math.round(rawOpenMrr),
    rawArr: Math.round(rawOpenMrr * 12),
  };

  // Leaderboard per owner
  const { results: lbRows } = await database
    .prepare(
      `SELECT u.id, u.name,
        COALESCE(SUM(CASE WHEN d.stage IN (${OPEN_LIST}) THEN d.value END),0) AS open_value,
        COALESCE(SUM(CASE WHEN d.stage IN (${OPEN_LIST}) THEN 1 END),0)::int AS open_count,
        COALESCE(SUM(CASE WHEN d.stage IN (${OPEN_LIST}) AND COALESCE(d.value,0) <= 0 THEN 1 END),0)::int AS open_unpriced,
        COALESCE(SUM(CASE WHEN d.stage IN (${OPEN_LIST}) THEN d.monthly_value END),0) AS open_monthly,
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
      open_unpriced: number;
      open_monthly: number;
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

  // Recurring revenue: monthly value across won (active) clients.
  const mrrRow = await database
    .prepare(
      `SELECT COALESCE(SUM(monthly_value),0) AS mrr,
        COALESCE(SUM(CASE WHEN monthly_value > 0 THEN 1 END),0)::int AS retainer_count
       FROM deals WHERE stage='${WON_STAGE}' AND archived_at IS NULL`,
    )
    .first<{ mrr: number; retainer_count: number }>();

  // Renewals coming up in the next RENEWAL_SOON_DAYS days.
  const { results: renewalRows } = await database
    .prepare(
      `SELECT d.id, d.name, d.renewal_date, d.monthly_value, co.name AS company_name, u.name AS owner_name,
        CASE WHEN d.renewal_date::date < now()::date THEN 1 ELSE 0 END AS overdue
       FROM deals d
       LEFT JOIN companies co ON co.id = d.company_id
       LEFT JOIN users u ON u.id = d.owner_id
       WHERE d.archived_at IS NULL AND d.renewal_date IS NOT NULL AND d.renewal_date <> ''
         AND d.renewal_date::date <= (now()::date + ${RENEWAL_SOON_DAYS})
       ORDER BY d.renewal_date ASC LIMIT 8`,
    )
    .all<RenewalRow>();

  // 30-day daily sparklines: deals created per day and won value per day.
  const { results: createdRows } = await database
    .prepare(
      `SELECT to_char(created_at::timestamptz, 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
       FROM deals WHERE created_at::timestamptz >= now() - INTERVAL '30 days'
       GROUP BY d`,
    )
    .all<{ d: string; n: number }>();
  const { results: wonDailyRows } = await database
    .prepare(
      `SELECT to_char(stage_changed_at::timestamptz, 'YYYY-MM-DD') AS d, COALESCE(SUM(value),0) AS v
       FROM deals WHERE stage='${WON_STAGE}' AND archived_at IS NULL
         AND stage_changed_at::timestamptz >= now() - INTERVAL '30 days'
       GROUP BY d`,
    )
    .all<{ d: string; v: number }>();
  const createdMap = new Map((createdRows ?? []).map((r) => [r.d, r.n]));
  const wonMap = new Map((wonDailyRows ?? []).map((r) => [r.d, Number(r.v)]));
  const dailyCreated: number[] = [];
  const dailyWon: number[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    dailyCreated.push(createdMap.get(key) ?? 0);
    dailyWon.push(wonMap.get(key) ?? 0);
  }

  return {
    kpi: kpi ?? {
      open_value: 0,
      open_count: 0,
      open_unpriced: 0,
      open_monthly: 0,
      won_value: 0,
      won_count: 0,
      lost_count: 0,
    },
    weighted,
    forecast,
    mrr: mrrRow?.mrr ?? 0,
    retainer_count: mrrRow?.retainer_count ?? 0,
    byStage,
    leaderboard,
    months,
    stale: staleRows ?? [],
    followups: followRows ?? [],
    renewals: renewalRows ?? [],
    dailyCreated,
    dailyWon,
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
  open_unpriced: number;
  open_monthly: number;
  open_monthly_unpriced: number;
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
        COALESCE(SUM(CASE WHEN d.stage IN (${OPEN_LIST}) AND COALESCE(d.value,0) <= 0 THEN 1 END),0)::int AS open_unpriced,
        COALESCE(SUM(CASE WHEN d.stage IN (${OPEN_LIST}) THEN d.monthly_value END),0) AS open_monthly,
        COALESCE(SUM(CASE WHEN d.stage IN (${OPEN_LIST}) AND COALESCE(d.monthly_value,0) <= 0 THEN 1 END),0)::int AS open_monthly_unpriced,
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

// ---------- Rep activity report (admin) ----------
// "Who actually did the work" — pure effort metrics per rep over a time window,
// rolled up from the event log. Complements getTeamOverview (which measures the
// STATE of each rep's book) by measuring MOTION: calls triaged, emails sent,
// records created, deals moved, notes written. An idle rep with a big book and a
// grinder building one both show up honestly here.
export type RepActivityRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  calls: number;
  emails: number;
  created: number;
  stage_moves: number;
  won: number;
  lost: number;
  notes: number;
  claims: number;
  total: number;
  last_active: string | null;
};

export const getRepActivity = createServerFn({ method: "GET" })
  .validator(z.object({ range: z.enum(["week", "month", "quarter"]).default("week") }))
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureExtraSchema();
    const days = data.range === "week" ? 7 : data.range === "month" ? 30 : 90;
    const { results } = await db()
      .prepare(
        `SELECT u.id, u.name, u.email, u.role,
           COALESCE(SUM(CASE WHEN e.verb = 'triaged' THEN 1 END), 0)::int AS calls,
           COALESCE(SUM(CASE WHEN e.verb = 'emailed' THEN 1 END), 0)::int AS emails,
           COALESCE(SUM(CASE WHEN e.verb IN ('created', 'imported') THEN 1 END), 0)::int AS created,
           COALESCE(SUM(CASE WHEN e.verb = 'stage_changed' THEN 1 END), 0)::int AS stage_moves,
           COALESCE(SUM(CASE WHEN e.verb = 'won' THEN 1 END), 0)::int AS won,
           COALESCE(SUM(CASE WHEN e.verb = 'lost' THEN 1 END), 0)::int AS lost,
           COALESCE(SUM(CASE WHEN e.verb = 'note_added' THEN 1 END), 0)::int AS notes,
           COALESCE(SUM(CASE WHEN e.verb = 'claimed' THEN 1 END), 0)::int AS claims,
           COALESCE(COUNT(e.id), 0)::int AS total,
           MAX(e.created_at) AS last_active
         FROM users u
         LEFT JOIN events e ON e.actor_id = u.id
           AND e.created_at >= to_char(now() AT TIME ZONE 'UTC' - make_interval(days => ${days}), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         GROUP BY u.id, u.name, u.email, u.role
         ORDER BY total DESC, u.name`,
      )
      .all<RepActivityRow>();
    return { range: data.range, rows: results ?? [] };
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
    if (data.role === "member") {
      // Defense in depth on demotion: kill the user's sessions so they re-login
      // as a member. (Role is also re-read per request, so admin powers already
      // end immediately — this just clears any lingering signed-in tabs.)
      await db().prepare("DELETE FROM sessions WHERE user_id = ?").bind(data.id).run();
    }
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

// The full activity history for a single record — every logged event (created,
// stage moves, notes, emails, shares, wins…) newest-first. This is what the
// record detail pages render as a timeline. Unlike getActivityFeed (the global,
// capped, discovery-filtered feed) this is scoped to one entity and uncapped.
export const getEntityTimeline = createServerFn({ method: "GET" })
  .validator(z.object({ entity_type: entityTypeSchema, entity_id: z.string() }))
  .handler(async ({ data }) => {
    await requireUser();
    await ensureExtraSchema();
    const { results } = await db()
      .prepare(
        `SELECT e.id, e.actor_id, u.name AS actor_name, e.verb, e.entity_type, e.entity_id, e.summary, e.created_at
         FROM events e LEFT JOIN users u ON u.id = e.actor_id
         WHERE e.entity_type = ? AND e.entity_id = ?
         ORDER BY e.created_at DESC
         LIMIT 200`,
      )
      .bind(data.entity_type, data.entity_id)
      .all<FeedRow>();
    return (results ?? []) as FeedRow[];
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
      // The auto-scanner can assign dozens of discovered leads at a time; those
      // machine auto-assignments would drown out real team activity, so we hide
      // them from this feed. The events still exist (each company's own timeline
      // keeps its record) — they're just filtered out of the shared feed here.
      `SELECT e.id, e.actor_id, u.name AS actor_name, e.verb, e.entity_type, e.entity_id, e.summary, e.created_at
       FROM events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE NOT (e.verb = 'assigned' AND e.summary LIKE '%from lead discovery%')
       ORDER BY e.created_at DESC
       LIMIT 40`,
    )
    .all<FeedRow>();
  return (results ?? []) as FeedRow[];
});

// ================= WIN / LOSS ANALYTICS =================
export type LostReasonRow = { reason: string; n: number; value: number };
export type SourceConvRow = {
  source: string;
  total: number;
  won: number;
  lost: number;
  won_value: number;
  win_rate: number | null;
};
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

  // Source conversion: which lead sources actually turn into won work.
  const { results: sourceRows } = await database
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(co.source), ''), 'Unknown') AS source,
         COUNT(*)::int AS total,
         COALESCE(SUM(CASE WHEN d.stage='${WON_STAGE}' THEN 1 END),0)::int AS won,
         COALESCE(SUM(CASE WHEN d.stage='${LOST_STAGE}' THEN 1 END),0)::int AS lost,
         COALESCE(SUM(CASE WHEN d.stage='${WON_STAGE}' THEN d.value END),0) AS won_value
       FROM deals d LEFT JOIN companies co ON co.id = d.company_id
       WHERE ${dealScope(range, "d")}
       GROUP BY source ORDER BY won DESC, total DESC`,
    )
    .all<{ source: string; total: number; won: number; lost: number; won_value: number }>();
  const sources: SourceConvRow[] = (sourceRows ?? []).map((r) => {
    const decided = r.won + r.lost;
    return {
      source: r.source,
      total: r.total,
      won: r.won,
      lost: r.lost,
      won_value: r.won_value,
      win_rate: decided > 0 ? Math.round((r.won / decided) * 100) : null,
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
    sources,
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
// Admin only: this is the entire book of business in one download, so it must
// never be available to a rep account.
export const getExportBundle = createServerFn({ method: "GET" }).handler(async (): Promise<ExportBundle> => {
  await requireAdmin();
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

// ==================== AI opportunity briefs (Phase 2) ====================
// A plain-English write-up per company generated by Anthropic's Haiku model,
// covering fit, chance of closing, how to approach, and any watch-outs. Briefs
// are cached in ai_briefs and only regenerated when the company's signals change
// (via a stored fingerprint), so the API is called at most once per company per
// meaningful change — keeping cost tiny. If no API key is configured the feature
// degrades gracefully: nothing crashes, and the UI shows a "needs a key" note.

// Model is env-overridable so it can be swapped without a code change.
const AI_BRIEF_MODEL = process.env.AI_BRIEF_MODEL || "claude-haiku-4-5-20251001";

type BriefRow = {
  company_id: string;
  brief: string;
  model: string | null;
  signals_hash: string;
  score: number | null;
  updated_at: string;
};

// Fingerprint the inputs that would change the write-up. If this string matches
// what's stored, the cached brief is still valid and we skip the API call.
function briefSignalsHash(c: {
  name: string;
  industry: string | null;
  source: string | null;
  call_outcome: string | null;
  city: string | null;
  website: string | null;
  phone: string | null;
}, hasEmail: boolean): string {
  return JSON.stringify([
    (c.name ?? "").trim().toLowerCase(),
    (c.industry ?? "").trim().toLowerCase(),
    (c.source ?? "").trim().toLowerCase(),
    (c.call_outcome ?? "").trim().toLowerCase(),
    (c.city ?? "").trim().toLowerCase(),
    (c.website ?? "").trim() ? 1 : 0,
    (c.phone ?? "").trim() ? 1 : 0,
    hasEmail ? 1 : 0,
    AI_BRIEF_MODEL,
  ]);
}

const CALL_OUTCOME_LABEL: Record<string, string> = {
  interested: "Interested when called",
  maybe: "Maybe / lukewarm when called",
  no_answer: "Didn't answer the call yet",
  not_interested: "Said not interested when called",
};

// Ask the model for a short, structured read on a single company. Returns the
// write-up text, or throws on API/config error so the caller can handle it.
async function generateBriefText(input: {
  name: string;
  industry: string | null;
  city: string | null;
  website: string | null;
  source: string | null;
  call_outcome: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  score: number;
  band: string;
  reasons: string[];
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("NO_KEY");

  const starter = PRICING_PACKAGES.find((p) => p.id === "starter");
  const pro = PRICING_PACKAGES.find((p) => p.id === "pro");
  const priceLine = starter && pro
    ? `Nexraft sells a one-time website build (roughly $${starter.build}–$${pro.build}) plus a required monthly managed plan (roughly $${starter.monthly}–$${pro.monthly}/mo).`
    : "";

  const facts = [
    `Business name: ${input.name}`,
    `Industry: ${input.industry || "unknown"}`,
    input.city ? `Location: ${input.city}` : null,
    `Has a website already: ${input.website ? "yes" : "not on file"}`,
    `Lead source: ${input.source || "unknown"}`,
    `Call status: ${input.call_outcome ? CALL_OUTCOME_LABEL[input.call_outcome] ?? input.call_outcome : "not called yet"}`,
    `Contact info on file: ${[input.hasPhone ? "phone" : null, input.hasEmail ? "email" : null].filter(Boolean).join(" + ") || "none yet"}`,
    `Our internal fit score: ${input.score}/100 (${input.band})`,
    input.reasons.length ? `Scoring notes: ${input.reasons.join("; ")}` : null,
  ].filter(Boolean).join("\n");

  const system = `You are a sales strategist for Nexraft, a small studio that builds and hosts professional websites for local businesses. ${priceLine} You write short, practical briefs that help a non-technical salesperson decide whether and how to pursue a lead. Be concrete and honest — if a lead looks weak, say so. Never invent specific facts (people's names, revenue, exact details) you weren't given. Keep the whole thing under ~130 words.`;

  const user = `Write a quick opportunity brief for this company using ONLY the facts below. Use exactly these four short labeled sections, each 1–2 sentences:

Fit: why this business might (or might not) want a Nexraft website.
Chance: how likely this is to close and what's driving that.
Approach: a suggested angle or opening line for the outreach.
Watch-outs: any red flags or reasons it could be a harder/lower-value deal (write "None obvious" if there aren't any).

Facts:
${facts}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_BRIEF_MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`AI_ERROR_${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
  if (!text) throw new Error("AI_EMPTY");
  return text;
}

// Return the cached briefs so the board can show them. Cheap read — no API calls.
export const getCompanyBriefs = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  await ensureExtraSchema();
  const { results } = await db()
    .prepare(`SELECT company_id, brief, model, signals_hash, score, updated_at FROM ai_briefs`)
    .all<BriefRow>();
  return results ?? [];
});

// Generate briefs for companies that don't have a current one yet, up to `limit`
// per call. The client calls this in the background and loops until `remaining`
// hits 0, so the board fills in progressively without a slow blocking load. This
// is where the only paid API calls happen — and only for stale/missing briefs.
export const generateMissingBriefs = createServerFn({ method: "POST" })
  .validator(z.object({ limit: z.number().int().min(1).max(12).default(5) }))
  .handler(async ({ data }) => {
    await requireUser();
    await ensureExtraSchema();

    if (!process.env.ANTHROPIC_API_KEY) {
      return { ok: false as const, error: "NO_KEY", generated: 0, remaining: 0 };
    }

    // Live, not-yet-won companies are the ones worth analyzing.
    const companies = (
      await db()
        .prepare(
          `SELECT id, name, industry, city, website, source, phone, call_outcome
             FROM companies
            WHERE archived_at IS NULL AND (call_outcome IS NULL OR call_outcome <> 'signed')`,
        )
        .all<{
          id: string;
          name: string;
          industry: string | null;
          city: string | null;
          website: string | null;
          source: string | null;
          phone: string | null;
          call_outcome: string | null;
        }>()
    ).results ?? [];

    // Which companies have an email on file (via their contacts)?
    const emailRows = (
      await db()
        .prepare(
          `SELECT DISTINCT company_id FROM contacts
            WHERE company_id IS NOT NULL AND email IS NOT NULL AND email <> '' AND archived_at IS NULL`,
        )
        .all<{ company_id: string }>()
    ).results ?? [];
    const hasEmail = new Set(emailRows.map((r) => r.company_id));

    // Existing fingerprints so we skip anything already current.
    const existing = (
      await db().prepare(`SELECT company_id, signals_hash FROM ai_briefs`).all<{ company_id: string; signals_hash: string }>()
    ).results ?? [];
    const existingHash = new Map(existing.map((r) => [r.company_id, r.signals_hash]));

    const pending = companies.filter((c) => {
      const hash = briefSignalsHash(c, hasEmail.has(c.id));
      return existingHash.get(c.id) !== hash;
    });

    let generated = 0;
    let firstError: string | null = null;
    for (const c of pending.slice(0, data.limit)) {
      const emailed = hasEmail.has(c.id);
      const hash = briefSignalsHash(c, emailed);
      const scored = opportunityScore({
        source: c.source,
        callOutcome: c.call_outcome,
        industry: c.industry,
        hasPhone: Boolean(c.phone),
        hasEmail: emailed,
        createdAt: null,
      });
      try {
        const text = await generateBriefText({
          name: c.name,
          industry: c.industry,
          city: c.city,
          website: c.website,
          source: c.source,
          call_outcome: c.call_outcome,
          hasPhone: Boolean(c.phone),
          hasEmail: emailed,
          score: scored.score,
          band: scored.band,
          reasons: scored.reasons,
        });
        await db()
          .prepare(
            `INSERT INTO ai_briefs (company_id, brief, model, signals_hash, score, updated_at)
             VALUES (?, ?, ?, ?, ?, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
             ON CONFLICT (company_id) DO UPDATE
               SET brief = EXCLUDED.brief, model = EXCLUDED.model,
                   signals_hash = EXCLUDED.signals_hash, score = EXCLUDED.score,
                   updated_at = EXCLUDED.updated_at`,
          )
          .bind(c.id, text, AI_BRIEF_MODEL, hash, scored.score)
          .run();
        generated++;
      } catch (e) {
        firstError = e instanceof Error ? e.message : String(e);
        // Stop on the first hard failure (bad key, quota) — no point burning
        // through the rest; surface it so the user can fix the setup.
        break;
      }
    }

    const remaining = Math.max(0, pending.length - generated);
    return {
      ok: firstError ? (false as const) : (true as const),
      error: firstError ?? undefined,
      generated,
      remaining,
    };
  });

// Record that a follow-up email was drafted/sent to a company: bump the touch
// count and stamp the time, so the next nudge uses the right template. Called
// when the rep opens a pre-filled draft from the Follow-ups queue.
export const recordEmailTouch = createServerFn({ method: "POST" })
  .validator(z.object({ company_id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    const row = await db()
      .prepare("SELECT name, COALESCE(email_touches,0) AS email_touches FROM companies WHERE id = ?")
      .bind(data.company_id)
      .first<{ name: string; email_touches: number }>();
    if (!row) return { ok: false as const, touches: 0 };
    const next = (Number(row.email_touches) || 0) + 1;
    // Schedule the next nudge: 3 days after the 1st, 4 after the 2nd. After the
    // 3rd the cadence is done — no next date, and the due-count leaves it out.
    await db()
      .prepare(
        `UPDATE companies
            SET email_touches = ?,
                last_emailed_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                next_followup_at = CASE WHEN ? >= 3 THEN NULL
                  ELSE to_char(now() AT TIME ZONE 'UTC' + make_interval(days => CASE WHEN ? = 1 THEN 3 ELSE 4 END), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
          WHERE id = ?`,
      )
      .bind(next, next, next, data.company_id)
      .run();
    await logEvent({
      actorId: user.id,
      verb: "emailed",
      entityType: "company",
      entityId: data.company_id,
      summary: `${user.name} emailed ${row.name} (follow-up #${next})`,
    });
    return { ok: true as const, touches: next };
  });

// ==================== Gmail sending (Phase 4) ====================
// Each rep connects their own Google Workspace account once (Settings → Connect
// Gmail). After that, outreach goes out from their real address via the Gmail
// API — no separate mail server, and replies land in the rep's own inbox.

// Status for the Settings card and the "Send from CRM" buttons: is Gmail set up
// on the server at all, and has THIS rep connected their account (and which one).
export const getGmailStatus = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const configured = isGmailConfigured();
  if (!configured) return { configured: false as const, connected: false as const, email: null };
  const conn = await getConnection(user.id);
  return { configured: true as const, connected: conn.connected, email: conn.email };
});

// Send an outreach email from the signed-in rep's connected Gmail. Mirrors the
// tracking that recordEmailTouch does (bumps the company touch count + stamps
// last_emailed_at) and logs an activity so the contact's "last contacted" moves.
export const sendCrmEmail = createServerFn({ method: "POST" })
  .validator(
    z.object({
      to: z.string().email(),
      subject: z.string().min(1),
      body: z.string().min(1),
      company_id: z.string().optional(),
      contact_id: z.string().optional(),
      append_footer: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();

    const result = await sendEmail({
      userId: user.id,
      fromName: user.name,
      to: data.to,
      subject: data.subject,
      body: data.body,
      companyId: data.company_id ?? null,
      contactId: data.contact_id ?? null,
      appendFooter: data.append_footer,
    });
    if (!result.ok) return { ok: false as const, error: result.error };

    // Tracking: bump the company's email-touch count + stamp last_emailed_at,
    // exactly like recordEmailTouch, and log the send so it shows on the timeline.
    let touches = 0;
    if (data.company_id) {
      const row = await db()
        .prepare("SELECT name, COALESCE(email_touches,0) AS email_touches FROM companies WHERE id = ?")
        .bind(data.company_id)
        .first<{ name: string; email_touches: number }>();
      if (row) {
        touches = (Number(row.email_touches) || 0) + 1;
        // Same cadence as recordEmailTouch: next nudge lands 3 days after the
        // 1st, 4 after the 2nd, and after the 3rd the sequence is done.
        await db()
          .prepare(
            `UPDATE companies
                SET email_touches = ?,
                    last_emailed_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    next_followup_at = CASE WHEN ? >= 3 THEN NULL
                      ELSE to_char(now() AT TIME ZONE 'UTC' + make_interval(days => CASE WHEN ? = 1 THEN 3 ELSE 4 END), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
              WHERE id = ?`,
          )
          .bind(touches, touches, touches, data.company_id)
          .run();
        await logEvent({
          actorId: user.id,
          verb: "emailed",
          entityType: "company",
          entityId: data.company_id,
          summary: `${user.name} emailed ${row.name} — "${data.subject}"`,
        });
      }
    }

    // Log an activity against the contact so their "last contacted" advances
    // (that field is derived from MAX(activities.created_at)).
    if (data.contact_id) {
      await db()
        .prepare(
          `INSERT INTO activities (id, type, subject, deal_id, contact_id, owner_id, status, due_date, notes, completed_at)
           VALUES (?, 'Email', ?, NULL, ?, ?, 'done', NULL, ?, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
        )
        .bind(uid(), `Email — ${data.subject}`, data.contact_id, user.id, `Sent to ${data.to}`)
        .run();
    }

    return { ok: true as const, messageId: result.messageId, touches };
  });

// ==================== Lead discovery (Phase 3, OpenStreetMap) ====================
// On-demand prospecting: a rep searches a city + business type, and we pull real
// local businesses from OpenStreetMap — name, address, phone, and (crucially)
// whether they already have a website. Each candidate is scored (no website =
// prime target) and can be imported into the CRM in one click as an unowned
// "To Call" lead. Nothing is stored until it's imported.
//
// Why OpenStreetMap? It's a free, open database — no API key, no billing account,
// no cloud console setup. We resolve the area to a bounding box via Nominatim,
// then query businesses inside it via the Overpass API. Both are keyless. The
// trade-off vs. Google is no star ratings / review counts; for a web studio the
// decisive signal (does this business have a website?) comes through cleanly.

export type DiscoveredLead = {
  place_id: string;
  name: string;
  industry: string | null; // human-readable category label
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  rating: number | null; // null on OSM (kept for shape compatibility)
  reviews: number | null; // null on OSM
  score: number;
  band: string;
  reasons: string[];
  already_in_crm: boolean;
  // true = listed website was probed and is down; false = probed and alive;
  // null = has no website, or the probe didn't run (time budget).
  website_dead: boolean | null;
  // true = the dead site's domain no longer resolves in DNS at all (expired /
  // dropped). Only ever true when website_dead is true; null = not checked.
  domain_expired: boolean | null;
  // Pitchable defects the audit found on a live site (DIY builder, no mobile
  // support, stale copyright, ...). Empty when un-audited or clean.
  website_issues: string[];
  // Social platforms the business maintains per OSM ("Facebook", "Instagram") —
  // socials-but-no-site is the easiest pitch we have — plus a link to the first.
  socials: string[];
  social_url: string | null;
};

function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function normPhone(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

// Polite identifier required by the OpenStreetMap usage policies.
const OSM_UA = "NexraftCRM/1.0 (https://crm.nexraft.com)";

// The public Overpass servers get busy or slow on heavy whole-state queries
// (the primary regularly 504s on those). We hit ALL mirrors at once and take the
// first that answers, so one slow/dead/overloaded instance never holds up the
// request — critical on serverless, where trying them one-by-one blows the
// function's time budget before a good mirror is ever reached.
const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// fetch with a hard timeout. Without this, a dead/hanging mirror keeps the
// socket open until the serverless function itself is killed — which surfaces to
// the user as a permanent "can't reach the map service." The AbortController
// guarantees each attempt fails fast so we fall through to the next mirror.
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Website liveness probing (lead-gen quality) ----------
// "Has a website" is only half the signal — a listed site that no longer loads
// is a business paying for nothing, which makes them the warmest possible
// redesign prospect. probeWebsite() answers one question fast: does this URL
// respond at all?
//
// Judgement calls, tuned for prospecting rather than uptime monitoring:
//   - DNS failure / connection refused / timeout  → dead (site is gone)
//   - 404 / 410 / 5xx                             → dead (broken at the root)
//   - anything else that answers (200, redirects, 401/403 bot-blocks, etc.)
//                                                 → live (a server is there)
// Bot-blocking CDNs return 403 to unknown agents constantly; calling those
// "dead" would flood reps with false positives, so any HTTP answer outside the
// clearly-broken set counts as alive.
function normalizeProbeUrl(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (!u.hostname.includes(".")) return null; // "coming soon" junk like "n/a"
    return u.toString();
  } catch {
    return null;
  }
}

async function probeWebsite(raw: string, timeoutMs = 5000): Promise<"live" | "dead" | null> {
  const url = normalizeProbeUrl(raw);
  if (!url) return null; // not a checkable URL — leave status unknown
  try {
    const res = await fetchWithTimeout(
      url,
      { method: "GET", redirect: "follow", headers: { "User-Agent": OSM_UA, Accept: "text/html,*/*" } },
      timeoutMs,
    );
    if (res.status === 404 || res.status === 410 || res.status >= 500) return "dead";
    return "live";
  } catch {
    // On https failure, one retry over plain http — plenty of small-business
    // sites never got a certificate but are very much alive.
    if (url.startsWith("https://")) {
      try {
        const res = await fetchWithTimeout(
          url.replace(/^https:\/\//, "http://"),
          { method: "GET", redirect: "follow", headers: { "User-Agent": OSM_UA, Accept: "text/html,*/*" } },
          timeoutMs,
        );
        if (res.status === 404 || res.status === 410 || res.status >= 500) return "dead";
        return "live";
      } catch {
        return "dead";
      }
    }
    return "dead";
  }
}

// Probe a batch of URLs with a hard overall deadline. Prospecting runs inside a
// serverless request that also geocoded + queried Overpass, so this layer must
// never blow the time budget: whatever hasn't answered by `deadlineMs` is simply
// left unknown (null) rather than waited for.
async function probeWebsitesBatch(
  urls: string[],
  deadlineMs: number,
): Promise<Map<string, "live" | "dead">> {
  const out = new Map<string, "live" | "dead">();
  const perFetch = Math.max(1500, deadlineMs - 300);
  await Promise.race([
    Promise.allSettled(
      urls.map(async (u) => {
        const status = await probeWebsite(u, perFetch);
        if (status) out.set(u, status);
      }),
    ),
    new Promise((resolve) => setTimeout(resolve, deadlineMs)),
  ]);
  return out;
}

// ---------- Website quality audit (lead-gen quality, level 2) ----------
// Where probeWebsite() asks "does it respond?", auditWebsite() asks "is it any
// good?" — it fetches the homepage HTML and runs analyzeSiteHtml() over it to
// spot the defects a rep can pitch against (DIY builder, not mobile-friendly,
// ancient copyright, parked page, no HTTPS) and to harvest any email / phone
// sitting in the page. One GET per site, hard per-fetch timeout, body capped.
type SiteAudit = {
  status: "live" | "dead";
  // Only meaningful on dead sites: true = the hostname doesn't resolve in DNS
  // at all, i.e. the domain expired or was dropped — a stronger signal than a
  // server that's merely down, because whatever site existed is gone for good.
  domainExpired: boolean;
  issues: string[];
  email: string | null;
  phone: string | null;
};

// Free tie-breaker for dead sites: a fetch can fail because a server is down
// (recoverable — maybe they're mid-migration) or because the domain itself no
// longer exists in DNS (they stopped paying for it). Costs one DNS query, no
// API, no key. Dynamic import keeps node:dns out of the client bundle.
async function domainGone(raw: string): Promise<boolean> {
  const url = normalizeProbeUrl(raw);
  if (!url) return false;
  try {
    const { lookup } = await import("node:dns/promises");
    await lookup(new URL(url).hostname);
    return false; // resolves — server-side problem, not an expired domain
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code ?? "";
    // Only the "this name does not exist" family counts. Resolver hiccups
    // (SERVFAIL, timeouts) prove nothing and must not inflate the signal.
    return code === "ENOTFOUND" || code === "ENODATA";
  }
}

async function auditWebsite(raw: string, timeoutMs = 5000): Promise<SiteAudit | null> {
  const url = normalizeProbeUrl(raw);
  if (!url) return null; // not a checkable URL — leave unknown
  // Two flavors of dead: the server answered with a clearly-broken status
  // (domain still exists → not expired), or nothing answered at all (worth one
  // DNS query to learn whether the domain itself is gone).
  const deadResponding: SiteAudit = {
    status: "dead",
    domainExpired: false,
    issues: [],
    email: null,
    phone: null,
  };
  const deadUnreachable = async (): Promise<SiteAudit> => ({
    status: "dead",
    domainExpired: await domainGone(raw),
    issues: [],
    email: null,
    phone: null,
  });
  const attempt = (u: string) =>
    fetchWithTimeout(
      u,
      { method: "GET", redirect: "follow", headers: { "User-Agent": OSM_UA, Accept: "text/html,*/*" } },
      timeoutMs,
    );
  let res: Response;
  let https = true;
  try {
    res = await attempt(url);
  } catch {
    // https failed → one retry over plain http; a site alive only on http gets
    // "No HTTPS" recorded as its first strike.
    if (!url.startsWith("https://")) return deadUnreachable();
    try {
      res = await attempt(url.replace(/^https:\/\//, "http://"));
      https = false;
    } catch {
      return deadUnreachable();
    }
  }
  if (res.status === 404 || res.status === 410 || res.status >= 500) return deadResponding;
  let html = "";
  try {
    html = (await res.text()).slice(0, 200_000);
  } catch {
    // Alive but unreadable (encoding, stream cut) — still counts as live.
  }
  const analysis = analyzeSiteHtml(html, { https });
  return {
    status: "live",
    domainExpired: false,
    issues: analysis.issues,
    email: analysis.email,
    phone: analysis.phone,
  };
}

// Audit a batch with a hard overall deadline, same contract as
// probeWebsitesBatch: whatever hasn't finished when the clock runs out is
// simply left unknown rather than waited for.
async function auditWebsitesBatch(urls: string[], deadlineMs: number): Promise<Map<string, SiteAudit>> {
  const out = new Map<string, SiteAudit>();
  const perFetch = Math.max(1500, deadlineMs - 300);
  await Promise.race([
    Promise.allSettled(
      urls.map(async (u) => {
        const audit = await auditWebsite(u, perFetch);
        if (audit) out.set(u, audit);
      }),
    ),
    new Promise((resolve) => setTimeout(resolve, deadlineMs)),
  ]);
  return out;
}

// On-demand verification for companies already in the CRM. Sweeps up to 12 of
// the stalest unchecked websites (never checked, or checked > 7 days ago),
// probes them concurrently, and stamps website_status / website_checked_at.
// Runs in small batches so a click never risks the serverless time budget —
// clicking again simply continues where the last sweep left off.
export const verifyCompanyWebsites = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireUser();
  await ensureExtraSchema();
  const { results } = await db()
    .prepare(
      `SELECT id, name, website FROM companies
        WHERE archived_at IS NULL
          AND website IS NOT NULL AND btrim(website) <> ''
          AND (website_checked_at IS NULL
               OR website_checked_at < to_char(now() AT TIME ZONE 'UTC' - interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        ORDER BY website_checked_at NULLS FIRST
        LIMIT 12`,
    )
    .all<{ id: string; name: string; website: string }>();
  const targets = results ?? [];
  if (targets.length === 0) return { ok: true as const, checked: 0, down: 0, remaining: 0 };

  const statuses = await probeWebsitesBatch(targets.map((t) => t.website), 15000);
  let down = 0;
  for (const t of targets) {
    const status = statuses.get(t.website) ?? null;
    if (!status) continue; // deadline hit or junk URL — try again next sweep
    if (status === "dead") down++;
    await db()
      .prepare(
        `UPDATE companies
            SET website_status = ?,
                website_checked_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE id = ?`,
      )
      .bind(status, t.id)
      .run();
    if (status === "dead") {
      await logEvent({
        actorId: user.id,
        verb: "flagged",
        entityType: "company",
        entityId: t.id,
        summary: `Website check: ${t.name}'s site (${t.website}) is down — redesign opening`,
      });
    }
  }
  const remainingRow = await db()
    .prepare(
      `SELECT COUNT(*)::int AS n FROM companies
        WHERE archived_at IS NULL
          AND website IS NOT NULL AND btrim(website) <> ''
          AND (website_checked_at IS NULL
               OR website_checked_at < to_char(now() AT TIME ZONE 'UTC' - interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`,
    )
    .first<{ n: number }>();
  return {
    ok: true as const,
    checked: statuses.size,
    down,
    remaining: remainingRow?.n ?? 0,
  };
});

// Run an Overpass QL query against ALL mirrors in parallel and return the first
// one that answers successfully. Racing (instead of trying them in sequence) is
// what keeps this fast and reliable: a mirror that 504s or hangs simply loses the
// race instead of adding its full timeout to the total, so overall latency is
// just the fastest healthy mirror (~a few seconds). Throws only if every mirror
// fails.
async function overpassQuery(ql: string): Promise<any[]> {
  const attempts = OVERPASS_ENDPOINTS.map(async (endpoint) => {
    const res = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "User-Agent": OSM_UA,
        },
        body: "data=" + encodeURIComponent(ql),
      },
      12000, // 12s cap per mirror
    );
    if (!res.ok) throw new Error(`busy_${res.status}`); // reject so the race skips it
    const json = (await res.json()) as { elements?: any[] };
    return json.elements ?? [];
  });
  try {
    // Promise.any resolves with the first mirror that fulfils; it only rejects if
    // they ALL fail.
    return await Promise.any(attempts);
  } catch {
    throw new Error("unreachable");
  }
}

// Map a free-text business type to OpenStreetMap tag selectors. OSM classifies
// businesses across amenity / shop / craft / office / healthcare / leisure /
// tourism keys, so we translate common phrasings into the right ones. Anything
// unrecognised falls back to a best-effort slug match.
function osmFilters(businessType: string): string[] {
  const t = businessType.toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => t.includes(k));
  const f: string[] = [];
  if (has("restaurant", "diner", "eatery")) f.push(`"amenity"="restaurant"`);
  if (has("cafe", "coffee")) f.push(`"amenity"="cafe"`);
  if (has("bakery")) f.push(`"shop"="bakery"`);
  if (has("bar", "pub", "tavern")) f.push(`"amenity"="bar"`, `"amenity"="pub"`);
  if (has("dentist", "dental", "orthodont")) f.push(`"amenity"="dentist"`, `"healthcare"="dentist"`);
  if (has("doctor", "medical", "clinic", "physician", "urgent care"))
    f.push(`"amenity"="clinic"`, `"amenity"="doctors"`, `"healthcare"="doctor"`);
  if (has("chiro")) f.push(`"healthcare"="chiropractor"`);
  if (has("vet")) f.push(`"amenity"="veterinary"`);
  if (has("pharmac")) f.push(`"amenity"="pharmacy"`);
  if (has("optician", "optometr", "eyewear")) f.push(`"shop"="optician"`, `"healthcare"="optometrist"`);
  if (has("law", "legal", "attorney", "lawyer")) f.push(`"office"="lawyer"`);
  if (has("real estate", "realtor", "estate agent")) f.push(`"office"="estate_agent"`);
  if (has("account", "bookkeep", "cpa")) f.push(`"office"="accountant"`);
  if (has("insurance")) f.push(`"office"="insurance"`);
  if (has("roof")) f.push(`"craft"="roofer"`);
  if (has("plumb")) f.push(`"craft"="plumber"`);
  if (has("electric")) f.push(`"craft"="electrician"`);
  if (has("hvac", "heating", "air condition")) f.push(`"craft"="hvac"`);
  if (has("contractor", "construction", "builder", "remodel", "renovat"))
    f.push(`"craft"="contractor"`, `"office"="company"`);
  if (has("landscap", "lawn", "garden")) f.push(`"craft"="gardener"`, `"shop"="garden_centre"`);
  if (has("paint")) f.push(`"craft"="painter"`);
  if (has("salon", "hair", "barber")) f.push(`"shop"="hairdresser"`, `"shop"="beauty"`);
  if (has("spa")) f.push(`"leisure"="spa"`, `"shop"="beauty"`);
  if (has("nail")) f.push(`"shop"="beauty"`);
  if (has("gym", "fitness")) f.push(`"leisure"="fitness_centre"`);
  if (has("yoga", "pilates")) f.push(`"leisure"="fitness_centre"`);
  if (has("auto", "mechanic", "car repair", "tire", "tyre")) f.push(`"shop"="car_repair"`, `"shop"="tyres"`);
  if (has("dealership", "car dealer")) f.push(`"shop"="car"`);
  if (has("florist", "flower")) f.push(`"shop"="florist"`);
  if (has("pet")) f.push(`"shop"="pet"`);
  if (has("hotel", "motel", "inn", "lodg")) f.push(`"tourism"="hotel"`, `"tourism"="motel"`);
  if (has("photograph")) f.push(`"craft"="photographer"`, `"shop"="photo"`);
  if (has("clean", "janitor", "maid")) f.push(`"craft"="cleaning"`, `"shop"="dry_cleaning"`, `"office"="company"`);
  // Elective / cash-pay medical (med spas, weight-loss & IV-therapy clinics,
  // aesthetics) — high-budget prospects the auto-sweep tends to miss because
  // they hide under generic clinic/beauty tags. Manual presets mine them by hand.
  if (has("med spa", "medspa", "med-spa", "aesthetic", "botox", "weight loss", "weight-loss", "iv therapy", "iv drip", "wellness clinic"))
    f.push(`"leisure"="spa"`, `"shop"="beauty"`, `"amenity"="clinic"`, `"healthcare"="clinic"`);
  if (has("retail", "store", "boutique", "shop")) f.push(`"shop"`);
  // Fallback: match the raw term (singularised) against the common keys.
  if (f.length === 0) {
    const slug = t.trim().replace(/s$/, "").replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
    if (slug) f.push(`"shop"="${slug}"`, `"amenity"="${slug}"`, `"craft"="${slug}"`, `"office"="${slug}"`);
  }
  return Array.from(new Set(f));
}

// Resolve a free-text area ("Springfield, IL") to a bounding box + center point
// via Nominatim.
type GeoBox = { s: number; w: number; n: number; e: number; lat: number; lon: number };

// The auto-sweep geocodes the same ~50 US states over and over. Nominatim's
// usage policy forbids that kind of repeat automated hammering and will block
// the IP — so we cache each resolved area for the life of the process. State
// boxes never change, so this is safe and cuts geocoder calls to near zero.
const geocodeCache = new Map<string, GeoBox | null>();

async function geocodeArea(area: string): Promise<GeoBox | null> {
  const key = area.trim().toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;
  const result = await geocodeAreaUncached(area);
  // Only cache successful hits; a transient failure shouldn't be sticky.
  if (result) geocodeCache.set(key, result);
  return result;
}

async function geocodeAreaUncached(area: string): Promise<GeoBox | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(area)}`;
    const res = await fetchWithTimeout(
      url,
      { headers: { "User-Agent": OSM_UA, Accept: "application/json" } },
      8000, // 8s cap: geocode + overpass must together stay well under Vercel's 30s
    );
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ boundingbox?: string[]; lat?: string; lon?: string }>;
    const hit = arr?.[0];
    const bb = hit?.boundingbox; // [south, north, west, east]
    if (!bb || bb.length < 4) return null;
    const s = parseFloat(bb[0]);
    const n = parseFloat(bb[1]);
    const w = parseFloat(bb[2]);
    const e = parseFloat(bb[3]);
    if ([s, n, w, e].some((v) => Number.isNaN(v))) return null;
    // Prefer the reported centroid; fall back to the bbox midpoint.
    let lat = parseFloat(hit?.lat ?? "");
    let lon = parseFloat(hit?.lon ?? "");
    if (Number.isNaN(lat)) lat = (s + n) / 2;
    if (Number.isNaN(lon)) lon = (w + e) / 2;
    return { s, w, n, e, lat, lon };
  } catch {
    return null;
  }
}

// Build a bounding box of roughly `radiusKm` around a center point. Rough but
// plenty accurate for a local-business scan (1° lat ≈ 111 km).
function bboxAround(lat: number, lon: number, radiusKm: number) {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return { s: lat - dLat, n: lat + dLat, w: lon - dLon, e: lon + dLon };
}

// Best-effort human-readable category from OSM tags.
function osmLabel(tags: Record<string, string>): string | null {
  for (const k of ["amenity", "shop", "craft", "office", "healthcare", "leisure", "tourism"]) {
    const v = tags[k];
    if (v && v !== "yes") {
      return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return null;
}

function osmAddress(tags: Record<string, string>): string | null {
  const line1 = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const region = [tags["addr:state"], tags["addr:postcode"]].filter(Boolean).join(" ");
  const parts = [line1, tags["addr:city"], region].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export const discoverLeads = createServerFn({ method: "POST" })
  .validator(
    z.object({
      // Accepts a single type ("dentists") or a comma-separated combo
      // ("roofers, hvac, plumbers") — combos sweep every type in one query.
      businessType: z.string().min(1).max(160),
      area: z.string().max(120).optional().nullable(),
      // Auto-discovery asks for up to 40 candidates per sweep so it has enough to
      // filter down to the best-fit hot leads; the Overpass query itself returns up
      // to 60. This cap must stay >= the largest caller (the auto-scanner's 40) —
      // a lower cap makes Zod reject the request and the scan fails before it runs.
      limit: z.number().int().min(1).max(60).default(20),
      // When set, search a growing circle of ~radiusKm around the area's center
      // instead of the area's own bounding box (used by the expanding auto-scan).
      radiusKm: z.number().min(1).max(250).optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser();
    return discoverLeadsCore(data);
  });

// Industries that have actually converted for Nexraft — a won (Launched) deal,
// or at least an "interested" outcome on the phone. Discovery uses this to tilt
// scoring toward what historically closes for THIS team, not industry folklore.
// Cached per server process for a few minutes; staleness is harmless here.
let _provenCache: { at: number; industries: string[] } | null = null;
async function provenIndustries(): Promise<string[]> {
  if (_provenCache && Date.now() - _provenCache.at < 10 * 60_000) return _provenCache.industries;
  try {
    const rows =
      (
        await db()
          .prepare(
            `SELECT DISTINCT lower(trim(c.industry)) AS industry
               FROM companies c
              WHERE COALESCE(trim(c.industry), '') <> ''
                AND (
                  c.call_outcome = 'interested'
                  OR EXISTS (
                    SELECT 1 FROM deals d
                     WHERE d.company_id = c.id AND d.stage = 'Launched' AND d.archived_at IS NULL
                  )
                )`,
          )
          .all<{ industry: string }>()
      ).results ?? [];
    _provenCache = { at: Date.now(), industries: rows.map((r) => r.industry) };
  } catch {
    _provenCache = { at: Date.now(), industries: [] };
  }
  return _provenCache.industries;
}

type DiscoverParams = {
  businessType: string;
  area?: string | null;
  limit: number;
  radiusKm?: number | null;
};

// The discovery engine itself, callable without a request context so both the
// signed-in server fn above and the daily cron sweep share one implementation.
async function discoverLeadsCore(
  data: DiscoverParams,
): Promise<{ ok: true; leads: DiscoveredLead[] } | { ok: false; error: string; leads: DiscoveredLead[] }> {
    await ensureExtraSchema();

    const area = (data.area ?? "").trim();
    if (!area) {
      return {
        ok: false as const,
        error: "Add a city or area to search (e.g. Springfield, IL).",
        leads: [] as DiscoveredLead[],
      };
    }

    const geo = await geocodeArea(area);
    if (!geo) {
      return {
        ok: false as const,
        error: `Couldn't find "${area}". Try a "City, State" format like Springfield, IL.`,
        leads: [] as DiscoveredLead[],
      };
    }
    // Expanding scan uses a radius around the center; on-demand search uses the
    // area's natural bounding box.
    const box =
      data.radiusKm && data.radiusKm > 0 ? bboxAround(geo.lat, geo.lon, data.radiusKm) : geo;

    // Wider net: a comma-separated request ("roofers, hvac, plumbers") unions
    // the OSM selectors of every listed type into one Overpass query — one round
    // trip, one time budget, several niches swept at once. Capped at 4 types so
    // heavy combos can't push the query past the mirror timeout.
    const types = data.businessType
      .split(/,|\/| \+ | and /i)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);
    const filters = Array.from(new Set((types.length ? types : [data.businessType]).flatMap((t) => osmFilters(t))));
    // Overpass bbox order is (south,west,north,east).
    const bbox = `${box.s},${box.w},${box.n},${box.e}`;
    const clauses = filters
      .map((sel) => `  node[${sel}](${bbox});\n  way[${sel}](${bbox});`)
      .join("\n");
    // The Overpass server-side timeout MUST sit under our fetch cap (12s). It used
    // to be 25s, which meant the mirror was told it could spend 25s computing while
    // we hung up the socket at 12s — so on heavy whole-state combos every mirror
    // ran long and we got nothing, and the wasted seconds pushed the whole
    // serverless request toward Vercel's 30s kill limit (the "couldn't reach the
    // map service" the scanner reported). At 11s the mirror returns whatever it has
    // — or a clean timeout — inside our budget, so heavy combos fail fast instead of
    // hanging, and every combo that CAN finish returns its results.
    const ql = `[out:json][timeout:11];\n(\n${clauses}\n);\nout center tags 80;`;

    let elements: any[] = [];
    try {
      elements = await overpassQuery(ql);
    } catch {
      return {
        ok: false as const,
        error: "The map servers are busy right now — give it a moment and try again.",
        leads: [] as DiscoveredLead[],
      };
    }

    // Load existing companies so we can flag ones already in the CRM (by name or
    // phone match) and avoid encouraging duplicate imports. Includes trashed /
    // archived companies on purpose: a business someone already called and
    // dismissed should keep showing as "already in CRM" so it never re-surfaces
    // as a fresh lead for another rep.
    const existing = (
      await db()
        .prepare(`SELECT name, phone, website FROM companies`)
        .all<{ name: string; phone: string | null; website: string | null }>()
    ).results ?? [];
    const existingNames = new Set(existing.map((c) => normName(c.name)));
    const existingPhones = new Set(existing.map((c) => normPhone(c.phone)).filter(Boolean));
    // Third identity axis: website domain. Businesses often list slightly
    // different names ("Joe's Roofing" vs "Joes Roofing LLC") but the same site.
    const domainOf = (w: string | null | undefined): string => {
      const t = (w ?? "").trim();
      if (!t) return "";
      try {
        return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`).hostname
          .replace(/^www\./, "")
          .toLowerCase();
      } catch {
        return "";
      }
    };
    const existingDomains = new Set(existing.map((c) => domainOf(c.website)).filter(Boolean));

    // What's converted for Nexraft before — tilts scoring toward the team's
    // actual track record (cheap: cached per process).
    const proven = await provenIndustries();

    const seen = new Set<string>();
    const seenPhones = new Set<string>();
    const seenDomains = new Set<string>();
    const leads: DiscoveredLead[] = elements
      .map((el) => {
        const tags: Record<string, string> = el.tags ?? {};
        const name = tags.name ?? "";
        const website =
          tags.website || tags["contact:website"] || tags.url || tags["contact:url"] || null;
        const phone =
          tags.phone || tags["contact:phone"] || tags["contact:mobile"] || tags["phone:mobile"] || null;
        const email = tags.email || tags["contact:email"] || null;
        const industry = osmLabel(tags) ?? data.businessType;
        const social = parseSocials(tags);
        const provenHit = industryMatchesAny(industry, proven);
        const scored = discoveryScore({
          hasWebsite: Boolean(website),
          industry,
          rating: null,
          reviews: null, // OSM has no reviews — scoring skips that signal
          hasPhone: Boolean(phone),
          socials: social.platforms,
          provenIndustry: provenHit,
        });
        const already =
          existingNames.has(normName(name)) ||
          (normPhone(phone) ? existingPhones.has(normPhone(phone)) : false) ||
          (domainOf(website) ? existingDomains.has(domainOf(website)) : false);
        return {
          place_id: `${el.type}/${el.id}`,
          name,
          industry,
          address: osmAddress(tags),
          city: tags["addr:city"] ?? null,
          phone,
          email,
          website,
          rating: null,
          reviews: null,
          score: scored.score,
          band: scored.band,
          reasons: scored.reasons,
          already_in_crm: already,
          website_dead: null as boolean | null,
          domain_expired: null as boolean | null,
          website_issues: [] as string[],
          socials: social.platforms,
          social_url: social.url,
        };
      })
      .filter((l) => {
        if (!l.name) return false;
        const key = normName(l.name);
        if (seen.has(key)) return false; // OSM can return node+way for the same place
        seen.add(key);
        // Same phone or same website domain under a different name = same
        // business; keep only the first (highest-scoring after sort) copy.
        const ph = normPhone(l.phone);
        if (ph) {
          if (seenPhones.has(ph)) return false;
          seenPhones.add(ph);
        }
        const dom = domainOf(l.website);
        if (dom) {
          if (seenDomains.has(dom)) return false;
          seenDomains.add(dom);
        }
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, data.limit);

    // Liveness pass: probe the listed websites of the top prospects (best-effort,
    // hard 6s ceiling so the whole request stays inside the serverless budget).
    // A site that doesn't respond flips that lead from "redesign play" to
    // "website is down — prime redesign target" and re-scores it accordingly.
    const withSites = leads.filter((l) => l.website && !l.already_in_crm).slice(0, 10);
    if (withSites.length > 0) {
      const audits = await auditWebsitesBatch(
        withSites.map((l) => l.website as string),
        6000,
      );
      for (const l of withSites) {
        const audit = audits.get(l.website as string);
        if (!audit) continue;
        l.website_dead = audit.status === "dead";
        l.domain_expired = audit.status === "dead" ? audit.domainExpired : false;
        l.website_issues = audit.issues;
        // Contact info harvested from the page fills gaps OSM left — an email
        // turns an uncallable lead into a workable one.
        if (!l.email && audit.email) l.email = audit.email;
        if (!l.phone && audit.phone) l.phone = audit.phone;
        const rescored = discoveryScore({
          hasWebsite: true,
          websiteDead: l.website_dead,
          domainExpired: l.domain_expired,
          websiteIssues: audit.issues,
          industry: l.industry,
          rating: null,
          reviews: null,
          hasPhone: Boolean(l.phone),
          socials: l.socials,
          provenIndustry: industryMatchesAny(l.industry, proven),
        });
        l.score = rescored.score;
        l.band = rescored.band;
        l.reasons = rescored.reasons;
      }
      leads.sort((a, b) => b.score - a.score);
    }

    // Ratings pass (only when GOOGLE_PLACES_API_KEY is configured): pull Google
    // rating + review count for the top prospects. Reviews are the best "this
    // business is busy and making money" signal we can get — a 200-review roofer
    // with a bad site outranks a 3-review one every time. Best-effort under a
    // hard deadline, same as the audits; unmatched lookups just skip the signal.
    const targets = leads.filter((l) => !l.already_in_crm).slice(0, 12);
    const queryFor = (l: DiscoveredLead) => `${l.name}, ${l.city ?? area}`;
    const rescoreWithReviews = (l: DiscoveredLead) => {
      const rescored = discoveryScore({
        hasWebsite: Boolean(l.website),
        websiteDead: l.website_dead,
        domainExpired: l.domain_expired,
        websiteIssues: l.website_issues,
        industry: l.industry,
        rating: l.rating,
        reviews: l.reviews,
        hasPhone: Boolean(l.phone),
        socials: l.socials,
        provenIndustry: industryMatchesAny(l.industry, proven),
      });
      l.score = rescored.score;
      l.band = rescored.band;
      l.reasons = rescored.reasons;
    };
    let changed = false;
    if (isPlacesConfigured()) {
      const ratings = await fetchPlaceRatings(targets.map(queryFor), 5000);
      for (const l of targets) {
        const r = ratings.get(queryFor(l));
        if (!r) continue;
        l.rating = r.rating;
        l.reviews = r.reviews;
        rescoreWithReviews(l);
        changed = true;
      }
    }

    // Yelp fallback (free tier, gated on YELP_API_KEY): covers whatever Google
    // couldn't — key not set, daily quota burned, or individual lookups that
    // timed out / missed. Same signal (rating + review count), same deadline
    // contract, so the scoring path doesn't care which service answered.
    const uncovered = targets.filter((l) => l.reviews === null || l.reviews === undefined);
    if (isYelpConfigured() && uncovered.length > 0) {
      const yelp = await fetchYelpRatings(
        uncovered.map((l) => ({ key: l.place_id, term: l.name, location: l.city ?? area })),
        4000,
      );
      for (const l of uncovered) {
        const r = yelp.get(l.place_id);
        if (!r) continue;
        l.rating = r.rating;
        l.reviews = r.reviews;
        rescoreWithReviews(l);
        changed = true;
      }
    }
    if (changed) leads.sort((a, b) => b.score - a.score);

    return { ok: true as const, leads };
}

// Reps who stay OUT of the auto-assign rotation: Barry (the owner) and Michael.
// Everyone else on the team shares the auto-assigned half of discovered leads.
// Matched by a stable rule (email / name) so it works no matter who's running the
// radar in their browser.
const AUTO_ASSIGN_EXCLUDE_EMAIL = "barry@nexraft.com";
const AUTO_ASSIGN_EXCLUDE_NAME_LIKE = "%michael%";
const AUTO_ASSIGN_EXCLUDE_NAME_LIKE_2 = "barry castelli%";

// Share of radar-discovered leads that get auto-assigned to a rep; the rest stay
// in the claimable pool. 1.0 = every find is handed to a rep (nothing pooled).
const AUTO_ASSIGN_RATE = 1.0;

// Batch flavor of the balancer: load every eligible rep with their live open-deal
// count in ONE query, so callers assigning many leads can balance in memory
// (bump `open_deals` after each pick, via pickLeastLoaded from constants.ts)
// instead of re-querying per lead.
async function loadAutoAssignees(): Promise<AssigneeLoad[]> {
  const { results } = await db()
    .prepare(
      `SELECT u.id, u.name, COUNT(d.id)::int AS open_deals
         FROM users u
         LEFT JOIN deals d ON d.owner_id = u.id AND d.archived_at IS NULL
        WHERE lower(u.email) <> ?
          AND lower(u.name) NOT LIKE ?
          AND lower(u.name) NOT LIKE ?
        GROUP BY u.id, u.name`,
    )
    .bind(AUTO_ASSIGN_EXCLUDE_EMAIL, AUTO_ASSIGN_EXCLUDE_NAME_LIKE, AUTO_ASSIGN_EXCLUDE_NAME_LIKE_2)
    .all<AssigneeLoad>();
  return results ?? [];
}

// Pick the eligible rep with the lightest open pipeline (self-balancing round
// robin), breaking ties at random. Returns null if nobody's eligible.
async function pickAutoAssignee(): Promise<{ id: string; name: string } | null> {
  const row = await db()
    .prepare(
      `SELECT u.id, u.name, COUNT(d.id) AS open_deals
         FROM users u
         LEFT JOIN deals d ON d.owner_id = u.id AND d.archived_at IS NULL
        WHERE lower(u.email) <> ?
          AND lower(u.name) NOT LIKE ?
          AND lower(u.name) NOT LIKE ?
        GROUP BY u.id, u.name
        ORDER BY open_deals ASC, random()
        LIMIT 1`,
    )
    .bind(AUTO_ASSIGN_EXCLUDE_EMAIL, AUTO_ASSIGN_EXCLUDE_NAME_LIKE, AUTO_ASSIGN_EXCLUDE_NAME_LIKE_2)
    .first<{ id: string; name: string; open_deals: number }>();
  return row ? { id: row.id, name: row.name } : null;
}

// Import a discovered lead into the CRM with a $0 "To Call" deal, so it immediately
// shows in the call queue and Opportunities board. Manual imports land unowned in
// the open pool for anyone to claim. When called by the radar with autoAssign, it
// flips a coin: ~half get auto-assigned to a rep (least-loaded, excluding Barry &
// Michael) and half stay in the pool. Guards against duplicates by name/phone.
export const importDiscoveredLead = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().min(1),
      industry: z.string().optional().nullable(),
      website: z.string().optional().nullable(),
      phone: z.string().optional().nullable(),
      email: z.string().optional().nullable(),
      city: z.string().optional().nullable(),
      autoAssign: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    return importLeadCore(data, { id: user.id, name: user.name });
  });

type ImportLeadData = {
  name: string;
  industry?: string | null;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  autoAssign?: boolean;
};

// The import itself, callable without a request context (actor null = the daily
// server sweep) so the signed-in server fn and the cron share one code path.
async function importLeadCore(
  data: ImportLeadData,
  actor: { id: string; name: string } | null,
): Promise<{ ok: true; id: string; duplicate: boolean; assignedTo: string | null }> {
    await ensureExtraSchema();

    // Duplicate guard: skip if ANY company already matches by name or phone —
    // including trashed/archived ones. A lead a rep already called and marked
    // "not interested" (archived to the trash) must stay permanently blocked so
    // it can't be re-discovered and handed to a different rep as a fresh lead.
    const dupe = await db()
      .prepare(
        `SELECT id FROM companies
          WHERE (lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) = ?
                 OR (? <> '' AND regexp_replace(COALESCE(phone,''), '\\D', '', 'g') = ?))
          LIMIT 1`,
      )
      .bind(normName(data.name), normPhone(data.phone), normPhone(data.phone))
      .first<{ id: string }>();
    if (dupe) return { ok: true as const, id: dupe.id, duplicate: true, assignedTo: null };

    // Auto-assign roll: only when the radar asks for it. Most of the time (see
    // AUTO_ASSIGN_RATE) it lands and hands the lead to the least-loaded eligible
    // rep; otherwise the lead stays unowned in the claimable pool.
    let assignee: { id: string; name: string } | null = null;
    if (data.autoAssign && Math.random() < AUTO_ASSIGN_RATE) {
      assignee = await pickAutoAssignee();
    }
    const ownerId = assignee?.id ?? null;

    // Stamp a rough estimated value on the deal so pipeline totals aren't all $0.
    // Scored on the signals we have (no-website, industry, phone) and scaled by fit.
    const est = estimateDealValue(
      discoveryScore({
        hasWebsite: Boolean(data.website),
        industry: data.industry ?? null,
        rating: null,
        reviews: null,
        hasPhone: Boolean(data.phone),
      }).band,
    );

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
        "Discovered",
        data.email ? `Email: ${data.email}` : null, // stash any email so reps can reach them
        null,
        ownerId, // null → open pool; set → auto-assigned to a rep
      )
      .run();

    // Same "drop into the pipeline as a $0 To Call deal" treatment as a manually
    // added company — owner matches the company (unowned pool, or the assigned rep).
    const now = new Date().toISOString();
    await db()
      .prepare(
        `INSERT INTO deals (id, name, company_id, contact_id, owner_id, stage, value, expected_close, next_step, notes, lost_reason, win_reason, monthly_value, renewal_date, links, proposal_status, proposal_sent_at, created_at, updated_at, stage_changed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        uid(),
        `${data.name} — Website`,
        id,
        null,
        ownerId,
        TO_CALL_STAGE,
        est.value,
        null,
        "Reach out & qualify",
        null,
        null,
        null,
        est.monthly,
        null,
        null,
        "none",
        null,
        now,
        now,
        now,
      )
      .run();

    await logEvent({
      actorId: actor?.id ?? null,
      verb: assignee ? "assigned" : "created",
      entityType: "company",
      entityId: id,
      summary: assignee
        ? `${data.name} auto-assigned to ${assignee.name} from lead discovery`
        : actor
          ? `${actor.name} imported ${data.name} from lead discovery`
          : `Overnight sweep found ${data.name} and dropped it in the pool`,
    });
    return { ok: true as const, id, duplicate: false, assignedTo: assignee?.name ?? null };
}

// The claimable "Fresh leads" pool shown on the Discover tab: every discovered
// business that's still unowned (nobody has claimed it yet). Scored on the fly so
// the strongest no-website prospects sort to the top. Claiming one is the normal
// claimCompany action, which hands the company + its open deal to the rep.
export type PoolLead = {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  phone: string | null;
  city: string | null;
  created_at: string | null;
  score: number;
  band: string;
  reasons: string[];
};

export const getDiscoveredPool = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  await ensureExtraSchema();
  const rows =
    (
      await db()
        .prepare(
          `SELECT id, name, industry, website, phone, city, created_at
             FROM companies
            WHERE archived_at IS NULL AND owner_id IS NULL AND source = 'Discovered'
            ORDER BY created_at DESC
            LIMIT 300`,
        )
        .all<{
          id: string;
          name: string;
          industry: string | null;
          website: string | null;
          phone: string | null;
          city: string | null;
          created_at: string | null;
        }>()
    ).results ?? [];

  const leads: PoolLead[] = rows.map((r) => {
    const scored = discoveryScore({
      hasWebsite: Boolean(r.website),
      industry: r.industry,
      rating: null,
      reviews: null,
      hasPhone: Boolean(r.phone),
    });
    return { ...r, score: scored.score, band: scored.band, reasons: scored.reasons };
  });
  leads.sort((a, b) => b.score - a.score);
  return { leads };
});

// "Not a fit" — soft-archive an unclaimed discovered lead so it drops out of the
// pool. Only works on still-unowned discovered companies (never on someone's
// claimed account), and it's a reversible archive, not a delete.
export const dismissDiscoveredLead = createServerFn({ method: "POST" })
  .validator(z.object({ company_id: z.string() }))
  .handler(async ({ data }) => {
    const me = await requireUser();
    await ensureExtraSchema();
    const c = await db()
      .prepare("SELECT id, name, owner_id FROM companies WHERE id = ? AND archived_at IS NULL")
      .bind(data.company_id)
      .first<{ id: string; name: string; owner_id: string | null }>();
    if (!c) return { ok: false as const, error: "That lead is already gone." };
    if (c.owner_id) return { ok: false as const, error: "That lead's already been claimed." };

    const now = new Date().toISOString();
    await db().prepare("UPDATE companies SET archived_at = ? WHERE id = ?").bind(now, c.id).run();
    await db()
      .prepare("UPDATE deals SET archived_at = ? WHERE company_id = ? AND archived_at IS NULL")
      .bind(now, c.id)
      .run();
    await logEvent({
      actorId: me.id,
      verb: "archived",
      entityType: "company",
      entityId: c.id,
      summary: `${me.name} dismissed ${c.name} from the discovery pool`,
    });
    return { ok: true as const };
  });

// ==================== What converts for you (win-based learning) ====================
// Aggregate what actually happened to the leads the CRM has touched, industry by
// industry — imported, got an "interested" on the phone, won a deal. Discovery
// scoring already tilts toward these (see provenIndustries); this fn feeds the
// panel on the Discover page so the team can SEE where their wins come from.
export type ConversionInsight = {
  industry: string;
  companies: number;
  interested: number;
  won: number;
};

export const getConversionInsights = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  await ensureExtraSchema();
  const rows =
    (
      await db()
        .prepare(
          `SELECT initcap(lower(trim(c.industry))) AS industry,
                  COUNT(DISTINCT c.id) AS companies,
                  COUNT(DISTINCT CASE WHEN c.call_outcome = 'interested' THEN c.id END) AS interested,
                  COUNT(DISTINCT CASE WHEN d.stage = 'Launched' THEN c.id END) AS won
             FROM companies c
             LEFT JOIN deals d
               ON d.company_id = c.id AND d.archived_at IS NULL
            WHERE COALESCE(trim(c.industry), '') <> ''
            GROUP BY 1
           HAVING COUNT(DISTINCT CASE WHEN c.call_outcome = 'interested' THEN c.id END) > 0
               OR COUNT(DISTINCT CASE WHEN d.stage = 'Launched' THEN c.id END) > 0
            ORDER BY won DESC, interested DESC, companies DESC
            LIMIT 8`,
        )
        .all<{ industry: string; companies: number; interested: number; won: number }>()
    ).results ?? [];
  const insights: ConversionInsight[] = rows.map((r) => ({
    industry: r.industry,
    companies: Number(r.companies) || 0,
    interested: Number(r.interested) || 0,
    won: Number(r.won) || 0,
  }));
  return { insights };
});

// ==================== Daily auto sweeps (server-side radar) ====================
// The in-browser radar only mines while someone has the CRM open. These sweeps
// are its server-side sibling: admin-saved searches (area + business types) that
// a Vercel cron runs every morning, importing the strongest finds straight into
// the claimable pool — so the team wakes up to fresh leads.

export type SweepRow = {
  id: string;
  area: string;
  types: string[];
  enabled: boolean;
  next_type_idx: number;
  last_run_at: string | null;
  last_imported: number;
  total_imported: number;
};

function parseSweepTypes(raw: string): string[] {
  try {
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) return arr.filter((t): t is string => typeof t === "string");
  } catch {
    /* fall through */
  }
  return [];
}

async function loadSweeps(): Promise<SweepRow[]> {
  const rows =
    (
      await db()
        .prepare(
          `SELECT id, area, types, enabled, next_type_idx, last_run_at, last_imported, total_imported
             FROM auto_sweeps ORDER BY created_at ASC`,
        )
        .all<{
          id: string;
          area: string;
          types: string;
          enabled: boolean;
          next_type_idx: number;
          last_run_at: string | null;
          last_imported: number;
          total_imported: number;
        }>()
    ).results ?? [];
  return rows.map((r) => ({
    ...r,
    enabled: Boolean(r.enabled),
    types: parseSweepTypes(r.types),
    next_type_idx: Number(r.next_type_idx) || 0,
    last_imported: Number(r.last_imported) || 0,
    total_imported: Number(r.total_imported) || 0,
  }));
}

// How many business types one sweep run covers, and how many finds it may
// import per type. Sized so a run stays comfortably inside the serverless
// window (each discovery call is bounded at ~25s worst case).
const SWEEP_TYPES_PER_RUN = 2;
const SWEEP_IMPORTS_PER_TYPE = 5;

// Run one sweep once: search the next SWEEP_TYPES_PER_RUN types on its rotation,
// import the hottest workable finds (no website, contactable, not already ours)
// into the pool with the usual auto-assign coin flip, and advance the rotation.
async function runSweepOnce(sweep: SweepRow): Promise<{ imported: number; assigned: number }> {
  const types = sweep.types.length > 0 ? sweep.types : ["Contractors"];
  let imported = 0;
  let assigned = 0;
  const ran: string[] = [];
  for (let i = 0; i < Math.min(SWEEP_TYPES_PER_RUN, types.length); i++) {
    const type = types[(sweep.next_type_idx + i) % types.length];
    ran.push(type);
    const res = await discoverLeadsCore({ businessType: type, area: sweep.area, limit: 40 });
    if (!res.ok) continue;
    const targets = res.leads
      .filter(
        (l) =>
          l.band === "hot" &&
          !l.website &&
          !l.already_in_crm &&
          (Boolean(l.phone) || Boolean(l.email)),
      )
      .slice(0, SWEEP_IMPORTS_PER_TYPE);
    for (const l of targets) {
      try {
        const imp = await importLeadCore(
          {
            name: l.name,
            industry: l.industry,
            website: l.website,
            phone: l.phone,
            email: l.email,
            city: l.city,
            autoAssign: true,
          },
          null,
        );
        if (imp.ok && !imp.duplicate) {
          imported++;
          if (imp.assignedTo) assigned++;
        }
      } catch {
        /* skip this lead, keep sweeping */
      }
    }
  }
  const now = new Date().toISOString();
  await db()
    .prepare(
      `UPDATE auto_sweeps
          SET next_type_idx = ?, last_run_at = ?, last_imported = ?, total_imported = total_imported + ?
        WHERE id = ?`,
    )
    .bind((sweep.next_type_idx + SWEEP_TYPES_PER_RUN) % Math.max(1, types.length), now, imported, imported, sweep.id)
    .run();
  if (imported > 0) {
    await logEvent({
      actorId: null,
      verb: "radar",
      entityType: "company",
      summary: `Auto sweep: ${imported} new lead${imported === 1 ? "" : "s"} from ${sweep.area} (${ran.join(", ")})`,
    });
  }
  return { imported, assigned };
}

// ---------- Stale-lead recycling ----------
// Radar-assigned leads shouldn't rot on someone's list. Nightly (piggybacking
// on the sweep cron):
//   1. NUDGE — an auto-assigned discovered lead that's had ZERO activity for
//      2+ days gets an open follow-up Task on its rep's plate ("going cold").
//   2. RECYCLE — if it's STILL never been called after 7+ days, the lead goes
//      back to the open pool (owner cleared on company + deals) so someone
//      else can grab it, and the nudge task is closed out.
const NUDGE_AFTER_MS = 2 * 24 * 3600_000;
const RECYCLE_AFTER_MS = 7 * 24 * 3600_000;
const RECYCLE_BATCH = 25;
const AUTO_NUDGE_MARK = "auto-nudge";

async function recycleStaleLeads(): Promise<{ nudged: number; recycled: number }> {
  const now = Date.now();
  const nudgeCutoff = new Date(now - NUDGE_AFTER_MS).toISOString();
  const recycleCutoff = new Date(now - RECYCLE_AFTER_MS).toISOString();

  // 1) Nudge: assigned, discovered, never touched (no activity on its deal at
  // all — which also means we haven't nudged it yet), 2+ days old.
  const { results: toNudge } = await db()
    .prepare(
      `SELECT c.id, c.name, c.owner_id, d.id AS deal_id
         FROM companies c
         JOIN deals d ON d.company_id = c.id AND d.archived_at IS NULL
        WHERE c.archived_at IS NULL
          AND c.source = 'Discovered'
          AND c.owner_id IS NOT NULL
          AND c.call_outcome IS NULL
          AND c.created_at < ?
          AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.deal_id = d.id)
        ORDER BY c.created_at ASC
        LIMIT ${RECYCLE_BATCH}`,
    )
    .bind(nudgeCutoff)
    .all<{ id: string; name: string; owner_id: string; deal_id: string }>();
  let nudged = 0;
  for (const c of toNudge ?? []) {
    await db()
      .prepare(
        `INSERT INTO activities (id, type, subject, deal_id, contact_id, owner_id, status, due_date, notes)
         VALUES (?, 'Task', ?, ?, NULL, ?, 'open', ?, ?)`,
      )
      .bind(
        uid(),
        `Call ${c.name} — radar lead going cold`,
        c.deal_id,
        c.owner_id,
        new Date(now).toISOString().slice(0, 10),
        AUTO_NUDGE_MARK,
      )
      .run();
    nudged++;
  }

  // 2) Recycle: assigned, discovered, STILL never called after 7+ days (the
  // nudge task doesn't count as being worked — only a Call does).
  const { results: toRecycle } = await db()
    .prepare(
      `SELECT c.id, c.name
         FROM companies c
        WHERE c.archived_at IS NULL
          AND c.source = 'Discovered'
          AND c.owner_id IS NOT NULL
          AND c.call_outcome IS NULL
          AND c.created_at < ?
          AND NOT EXISTS (
                SELECT 1 FROM activities a
                  JOIN deals d ON a.deal_id = d.id
                 WHERE d.company_id = c.id AND a.type = 'Call'
              )
        ORDER BY c.created_at ASC
        LIMIT ${RECYCLE_BATCH}`,
    )
    .bind(recycleCutoff)
    .all<{ id: string; name: string }>();
  let recycled = 0;
  for (const c of toRecycle ?? []) {
    await db().prepare(`UPDATE companies SET owner_id = NULL WHERE id = ?`).bind(c.id).run();
    await db()
      .prepare(
        `UPDATE deals SET owner_id = NULL WHERE company_id = ? AND archived_at IS NULL`,
      )
      .bind(c.id)
      .run();
    await db()
      .prepare(
        `UPDATE activities SET status = 'done', completed_at = ?
          WHERE notes = ? AND status = 'open'
            AND deal_id IN (SELECT id FROM deals WHERE company_id = ?)`,
      )
      .bind(new Date(now).toISOString(), AUTO_NUDGE_MARK, c.id)
      .run();
    recycled++;
  }
  if (recycled > 0) {
    await logEvent({
      actorId: null,
      verb: "radar",
      entityType: "company",
      summary: `Recycled ${recycled} untouched radar lead${recycled === 1 ? "" : "s"} back to the pool`,
    });
  }
  return { nudged, recycled };
}

// Entry point for the Vercel cron (/api/cron/sweep): run the enabled sweep
// that's waited longest, skipping any that already ran in the last 20 hours —
// which doubles as abuse protection if the endpoint is hit repeatedly.
// createServerOnlyFn keeps this export out of the client bundle (it throws if a
// client ever calls it; only the cron route does).
export const runDueSweeps = createServerOnlyFn(
  async (): Promise<{ ran: number; imported: number; nudged: number; recycled: number }> => {
    await ensureExtraSchema();
    // Housekeeping first, every cron hit: nudge cold radar leads, recycle
    // abandoned ones back to the pool. Never let it block the sweep itself.
    let nudged = 0;
    let recycled = 0;
    try {
      const r = await recycleStaleLeads();
      nudged = r.nudged;
      recycled = r.recycled;
    } catch {
      /* housekeeping is best-effort */
    }
    const sweeps = (await loadSweeps()).filter((s) => s.enabled);
    const cutoff = Date.now() - 20 * 3600_000;
    const due = sweeps
      .filter((s) => !s.last_run_at || new Date(s.last_run_at).getTime() < cutoff)
      .sort((a, b) => (a.last_run_at ?? "").localeCompare(b.last_run_at ?? ""));
    if (due.length === 0) return { ran: 0, imported: 0, nudged, recycled };
    const res = await runSweepOnce(due[0]);
    return { ran: 1, imported: res.imported, nudged, recycled };
  },
);

export const getSweeps = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  await ensureExtraSchema();
  return { sweeps: await loadSweeps() };
});

export const saveSweep = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().optional().nullable(),
      area: z.string().min(2).max(120),
      types: z.array(z.string().min(1).max(60)).min(1).max(12),
      enabled: z.boolean().default(true),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    await ensureExtraSchema();
    if (data.id) {
      await db()
        .prepare(`UPDATE auto_sweeps SET area = ?, types = ?, enabled = ? WHERE id = ?`)
        .bind(data.area.trim(), JSON.stringify(data.types), data.enabled, data.id)
        .run();
      return { ok: true as const, id: data.id };
    }
    const id = uid();
    await db()
      .prepare(
        `INSERT INTO auto_sweeps (id, area, types, enabled, created_by) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(id, data.area.trim(), JSON.stringify(data.types), data.enabled, admin.id)
      .run();
    return { ok: true as const, id };
  });

export const deleteSweep = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureExtraSchema();
    await db().prepare(`DELETE FROM auto_sweeps WHERE id = ?`).bind(data.id).run();
    return { ok: true as const };
  });

// Admin "Run now" — same engine the cron uses, on demand.
export const runSweepNow = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureExtraSchema();
    const sweep = (await loadSweeps()).find((s) => s.id === data.id);
    if (!sweep) return { ok: false as const, error: "That sweep is gone.", imported: 0 };
    const res = await runSweepOnce(sweep);
    return { ok: true as const, imported: res.imported, assigned: res.assigned };
  });

// ==================== Projects (ERP phase 1) ====================
// When a deal is won, the sale becomes a BUILD — and the projects board is where
// that build lives: a delivery checklist from kickoff to launch, a status lane,
// and a launch date. Projects are auto-created from won deals (set-based, same
// pattern as the To Call backfill) so nothing signed can slip through uncreated.

export const PROJECT_STATUSES = ["kickoff", "design", "build", "review", "launched"] as const;

export const DEFAULT_PROJECT_CHECKLIST = [
  "Kickoff call",
  "Collect content & branding",
  "Design draft",
  "Client design approval",
  "Build site",
  "Internal QA",
  "Client review",
  "Connect domain & launch",
] as const;

export type ProjectChecklistItem = { label: string; done: boolean };

export type ProjectRow = {
  id: string;
  company_id: string;
  deal_id: string | null;
  name: string;
  owner_id: string | null;
  shared_with: string | null;
  owner_name: string | null;
  company_name: string | null;
  status: string;
  checklist: string | null;
  launch_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export const getProjects = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  await ensureExtraSchema();
  // Self-healing sync: every won (Launched-stage) deal gets a project the first
  // time anyone opens the board. Set-based + NOT EXISTS, so it's a no-op once
  // created — and it catches every path a deal can be won through (call triage,
  // pipeline drag, manual edit) without hooks in each one.
  const defaultChecklist = JSON.stringify(
    DEFAULT_PROJECT_CHECKLIST.map((label) => ({ label, done: false })),
  );
  await db()
    .prepare(
      `INSERT INTO projects (id, company_id, deal_id, name, owner_id, status, checklist)
       SELECT gen_random_uuid()::text, d.company_id, d.id,
              COALESCE(c.name, d.name) || ' — Website build', d.owner_id, 'kickoff', ?
         FROM deals d
         LEFT JOIN companies c ON c.id = d.company_id
        WHERE d.stage = '${WON_STAGE}' AND d.archived_at IS NULL
          AND d.company_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM projects p WHERE p.deal_id = d.id
          )`,
    )
    .bind(defaultChecklist)
    .run();

  const { results } = await db()
    .prepare(
      `SELECT p.*, u.name AS owner_name, c.name AS company_name
         FROM projects p
         LEFT JOIN users u ON u.id = p.owner_id
         LEFT JOIN companies c ON c.id = p.company_id
        WHERE p.archived_at IS NULL
        ORDER BY (p.status = 'launched'), p.updated_at DESC`,
    )
    .all<ProjectRow>();
  return results ?? [];
});

export const updateProject = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string(),
      status: z.enum(PROJECT_STATUSES).optional(),
      checklist: z.string().optional(), // JSON [{label, done}]
      launch_date: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
      name: z.string().min(1).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    await assertCanEdit(user, "projects", data.id);

    // Validate the checklist actually parses to the expected shape before it's
    // stored — a malformed blob would break every later render of the board.
    let checklist: string | undefined;
    if (data.checklist !== undefined) {
      try {
        const parsed = JSON.parse(data.checklist) as ProjectChecklistItem[];
        if (!Array.isArray(parsed)) throw new Error("bad");
        checklist = JSON.stringify(
          parsed
            .filter((i) => i && typeof i.label === "string")
            .map((i) => ({ label: i.label.slice(0, 200), done: Boolean(i.done) }))
            .slice(0, 40),
        );
      } catch {
        return { ok: false as const, error: "Bad checklist payload." };
      }
    }

    const existing = await db()
      .prepare(`SELECT name, status FROM projects WHERE id = ? AND archived_at IS NULL`)
      .bind(data.id)
      .first<{ name: string; status: string }>();
    if (!existing) return { ok: false as const, error: "Project not found." };

    await db()
      .prepare(
        `UPDATE projects SET
           status = COALESCE(?, status),
           checklist = COALESCE(?, checklist),
           launch_date = COALESCE(?, launch_date),
           notes = COALESCE(?, notes),
           name = COALESCE(?, name),
           updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         WHERE id = ?`,
      )
      .bind(
        data.status ?? null,
        checklist ?? null,
        data.launch_date ?? null,
        data.notes ?? null,
        data.name ?? null,
        data.id,
      )
      .run();

    if (data.status && data.status !== existing.status) {
      await logEvent({
        actorId: user.id,
        verb: data.status === "launched" ? "completed" : "stage_changed",
        entityType: "project",
        entityId: data.id,
        summary:
          data.status === "launched"
            ? `${user.name} launched ${existing.name} 🎉`
            : `${user.name} moved ${existing.name} to ${data.status}`,
        meta: { from: existing.status, to: data.status },
      });
    }
    return { ok: true as const };
  });

export const archiveProject = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await ensureExtraSchema();
    await assertCanEdit(user, "projects", data.id);
    const row = await db()
      .prepare(`SELECT name FROM projects WHERE id = ?`)
      .bind(data.id)
      .first<{ name: string }>();
    await db()
      .prepare(
        `UPDATE projects SET archived_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE id = ?`,
      )
      .bind(data.id)
      .run();
    await logEvent({
      actorId: user.id,
      verb: "archived",
      entityType: "project",
      entityId: data.id,
      summary: `${user.name} archived project ${row?.name ?? ""}`.trim(),
    });
    return { ok: true as const };
  });

// ==================== Billing (Stripe) ====================
// Admin-only invoicing straight from the CRM. Config-gated on STRIPE_SECRET_KEY
// (set it in Vercel env) — until then the billing page shows setup steps and
// these functions return clean "not configured" results. Flow per invoice:
// find-or-create the Stripe customer by email → invoice item → invoice
// (send_invoice, 14 days) → finalize → store the hosted payment URL locally.

export type InvoiceRow = {
  id: string;
  company_id: string;
  deal_id: string | null;
  stripe_invoice_id: string | null;
  description: string | null;
  amount: number;
  status: string;
  hosted_url: string | null;
  pdf_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  company_name: string | null;
  creator_name: string | null;
};

export const getBillingOverview = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  await ensureExtraSchema();
  const { results } = await db()
    .prepare(
      `SELECT i.*, c.name AS company_name, u.name AS creator_name
         FROM invoices i
         LEFT JOIN companies c ON c.id = i.company_id
         LEFT JOIN users u ON u.id = i.created_by
        ORDER BY i.created_at DESC
        LIMIT 200`,
    )
    .all<InvoiceRow>();
  return { configured: isStripeConfigured(), invoices: results ?? [] };
});

export const createStripeInvoice = createServerFn({ method: "POST" })
  .validator(
    z.object({
      company_id: z.string(),
      deal_id: z.string().optional().nullable(),
      email: z.string().email(),
      amount: z.number().positive().max(1000000),
      description: z.string().min(1).max(500),
      days_until_due: z.number().int().min(1).max(90).default(14),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAdmin();
    await ensureExtraSchema();
    if (!isStripeConfigured()) {
      return { ok: false as const, error: "Stripe isn't configured yet — add STRIPE_SECRET_KEY in Vercel." };
    }
    const company = await db()
      .prepare(`SELECT name FROM companies WHERE id = ?`)
      .bind(data.company_id)
      .first<{ name: string }>();
    if (!company) return { ok: false as const, error: "Company not found." };

    // 1) Find or create the customer by email.
    type CustomerList = { data: Array<{ id: string }> };
    const found = await stripeFetch<CustomerList>("/customers", { email: data.email, limit: 1 }, "GET");
    if (!found.ok) return { ok: false as const, error: found.error };
    let customerId = found.data.data?.[0]?.id;
    if (!customerId) {
      const created = await stripeFetch<{ id: string }>("/customers", {
        email: data.email,
        name: company.name,
      });
      if (!created.ok) return { ok: false as const, error: created.error };
      customerId = created.data.id;
    }

    // 2) Draft the invoice, 3) attach the line item, 4) finalize to get the
    // hosted payment page. (Item is attached via the invoice id so it can never
    // land on some other draft.)
    const inv = await stripeFetch<{ id: string }>("/invoices", {
      customer: customerId,
      collection_method: "send_invoice",
      days_until_due: data.days_until_due,
      description: data.description,
    });
    if (!inv.ok) return { ok: false as const, error: inv.error };
    const item = await stripeFetch<{ id: string }>("/invoiceitems", {
      customer: customerId,
      invoice: inv.data.id,
      amount: Math.round(data.amount * 100),
      currency: "usd",
      description: data.description,
    });
    if (!item.ok) return { ok: false as const, error: item.error };
    const fin = await stripeFetch<{
      id: string;
      status: string;
      hosted_invoice_url: string | null;
      invoice_pdf: string | null;
    }>(`/invoices/${inv.data.id}/finalize`, { auto_advance: true });
    if (!fin.ok) return { ok: false as const, error: fin.error };

    const localId = uid();
    await db()
      .prepare(
        `INSERT INTO invoices (id, company_id, deal_id, stripe_invoice_id, description, amount, status, hosted_url, pdf_url, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        localId,
        data.company_id,
        data.deal_id ?? null,
        fin.data.id,
        data.description,
        data.amount,
        fin.data.status || "open",
        fin.data.hosted_invoice_url ?? null,
        fin.data.invoice_pdf ?? null,
        user.id,
      )
      .run();
    await logEvent({
      actorId: user.id,
      verb: "invoiced",
      entityType: "company",
      entityId: data.company_id,
      summary: `${user.name} invoiced ${company.name} $${data.amount.toLocaleString()} — ${data.description}`,
    });
    return { ok: true as const, id: localId, url: fin.data.hosted_invoice_url ?? null };
  });

export const refreshInvoiceStatus = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureExtraSchema();
    const row = await db()
      .prepare(`SELECT stripe_invoice_id FROM invoices WHERE id = ?`)
      .bind(data.id)
      .first<{ stripe_invoice_id: string | null }>();
    if (!row?.stripe_invoice_id) return { ok: false as const, error: "No Stripe invoice attached." };
    const res = await stripeFetch<{
      status: string;
      hosted_invoice_url: string | null;
      invoice_pdf: string | null;
    }>(`/invoices/${row.stripe_invoice_id}`);
    if (!res.ok) return { ok: false as const, error: res.error };
    await db()
      .prepare(
        `UPDATE invoices SET status = ?, hosted_url = COALESCE(?, hosted_url),
           pdf_url = COALESCE(?, pdf_url),
           updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         WHERE id = ?`,
      )
      .bind(res.data.status || "open", res.data.hosted_invoice_url ?? null, res.data.invoice_pdf ?? null, data.id)
      .run();
    return { ok: true as const, status: res.data.status };
  });
