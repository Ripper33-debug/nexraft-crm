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
} from "./constants";
import { ensureExtraSchema, logEvent, notify } from "./schema.server";

const WON_STAGE = "Launched";
const LOST_STAGE = "Lost";

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
  signed: "signed",
};

export const setCompanyCallOutcome = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string(),
      outcome: z.enum(["interested", "not_interested", "maybe", "signed"]).nullable(),
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

    // When they sign, create a won deal so the pipeline / revenue reflect it —
    // but only if this company doesn't already have a won deal on the books.
    let createdDeal = false;
    if (data.outcome === "signed") {
      const existingWon = await db()
        .prepare(
          `SELECT id FROM deals WHERE company_id = ? AND stage = ? AND archived_at IS NULL LIMIT 1`,
        )
        .bind(data.id, WON_STAGE)
        .first<{ id: string }>();
      if (!existingWon) {
        const now = new Date().toISOString();
        const dealId = uid();
        const pkg = (data.package || "").trim();
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
