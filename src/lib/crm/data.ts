import { createServerFn } from "@tanstack/react-start";
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
} from "./constants";
import { ensureExtraSchema, logEvent, notify } from "./schema.server";

const WON_STAGE = "Launched";
const LOST_STAGE = "Lost";
// Entry stage: every new company gets a $0 deal here so it's ready to work.
const TO_CALL_STAGE = "To Call";

const OPEN_LIST = OPEN_STAGES.map((s) => `'${s}'`).join(",");

// Whitelisted entity tables that carry owner_id + shared_with access columns.
const ACCESS_TABLES = { company: "companies", contact: "contacts", deal: "deals" } as const;
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
    await requireUser();
    await ensureExtraSchema();
    await db().prepare("UPDATE deals SET archived_at=NULL WHERE id=?").bind(data.id).run();
    return { ok: true };
  });

// ---------- Record access: hand off ownership / share edit rights ----------
const ENTITY_LABEL: Record<AccessEntity, string> = { company: "company", contact: "contact", deal: "deal" };

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

  for (const c of pool) {
    if (normPhone(c.phone).length > 0) {
      // Has a phone → hand to the least-loaded eligible rep. pickAutoAssignee
      // re-reads live load each call, so looping self-balances the batch evenly.
      const rep = await pickAutoAssignee();
      if (!rep) continue; // nobody eligible — leave it in the pool
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

    await db()
      .prepare(`UPDATE companies SET call_outcome=? WHERE id=?`)
      .bind(data.outcome, data.id)
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
    let added = 0;
    for (const r of data.rows) {
      const name = r.name.trim();
      if (!name) continue;
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
    return { added };
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
    let added = 0;
    for (const r of data.rows) {
      const first = r.first_name.trim();
      if (!first) continue;
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
    return { added };
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
    return { ok: true };
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
    await db()
      .prepare(
        `UPDATE companies
            SET email_touches = ?,
                last_emailed_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          WHERE id = ?`,
      )
      .bind(next, data.company_id)
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
  if (has("clean", "janitor")) f.push(`"shop"="dry_cleaning"`, `"office"="company"`);
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
      12000,
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
      businessType: z.string().min(1).max(80),
      area: z.string().max(120).optional().nullable(),
      limit: z.number().int().min(1).max(20).default(20),
      // When set, search a growing circle of ~radiusKm around the area's center
      // instead of the area's own bounding box (used by the expanding auto-scan).
      radiusKm: z.number().min(1).max(250).optional().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    await requireUser();
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

    const filters = osmFilters(data.businessType);
    // Overpass bbox order is (south,west,north,east).
    const bbox = `${box.s},${box.w},${box.n},${box.e}`;
    const clauses = filters
      .map((sel) => `  node[${sel}](${bbox});\n  way[${sel}](${bbox});`)
      .join("\n");
    const ql = `[out:json][timeout:25];\n(\n${clauses}\n);\nout center tags 60;`;

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

    const seen = new Set<string>();
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
        const scored = discoveryScore({
          hasWebsite: Boolean(website),
          industry,
          rating: null,
          reviews: null, // OSM has no reviews — scoring skips that signal
          hasPhone: Boolean(phone),
        });
        const already =
          existingNames.has(normName(name)) ||
          (normPhone(phone) ? existingPhones.has(normPhone(phone)) : false);
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
        };
      })
      .filter((l) => {
        if (!l.name) return false;
        const key = normName(l.name);
        if (seen.has(key)) return false; // OSM can return node+way for the same place
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, data.limit);

    return { ok: true as const, leads };
  });

// Reps who stay OUT of the auto-assign rotation: Barry (the owner) and Michael.
// Everyone else on the team shares the auto-assigned half of discovered leads.
// Matched by a stable rule (email / name) so it works no matter who's running the
// radar in their browser.
const AUTO_ASSIGN_EXCLUDE_EMAIL = "barry@nexraft.com";
const AUTO_ASSIGN_EXCLUDE_NAME_LIKE = "%michael%";

// Share of radar-discovered leads that get auto-assigned to a rep; the rest stay
// in the claimable pool. 1.0 = every find is handed to a rep (nothing pooled).
const AUTO_ASSIGN_RATE = 1.0;

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
        GROUP BY u.id, u.name
        ORDER BY open_deals ASC, random()
        LIMIT 1`,
    )
    .bind(AUTO_ASSIGN_EXCLUDE_EMAIL, AUTO_ASSIGN_EXCLUDE_NAME_LIKE)
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
      actorId: user.id,
      verb: assignee ? "assigned" : "created",
      entityType: "company",
      entityId: id,
      summary: assignee
        ? `${data.name} auto-assigned to ${assignee.name} from lead discovery`
        : `${user.name} imported ${data.name} from lead discovery`,
    });
    return { ok: true as const, id, duplicate: false, assignedTo: assignee?.name ?? null };
  });

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
