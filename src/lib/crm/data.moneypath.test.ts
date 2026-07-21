import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

// Guard-rail tests for the money path: Signed call outcome → won deal →
// project, plus the reverse sync when a deal is Lost, the lead-engine kill
// switch, and the per-rep scoping on the big list loaders. Like
// data.authz.test.ts, the server functions can't run in vitest (they need a
// live DB + request context), so we statically verify the source keeps the
// behaviours that money and privacy depend on.

const source = readFileSync(join(__dirname, "data.ts"), "utf8");

// Extract the body of `export const <name> = createServerFn(...)` up to the
// next `export const` (containment checks only).
function fnBody(name: string): string {
  const start = source.indexOf(`export const ${name} `);
  expect(start, `server function ${name} should exist in data.ts`).toBeGreaterThan(-1);
  const rest = source.slice(start + 10);
  const end = rest.indexOf("export const ");
  return end === -1 ? rest : rest.slice(0, end);
}

// Extract the body of a plain `function <name>(` helper up to the next
// top-level declaration.
function helperBody(name: string): string {
  const idx = source.search(new RegExp(`(async )?function ${name}\\(`));
  expect(idx, `helper ${name} should exist in data.ts`).toBeGreaterThan(-1);
  const rest = source.slice(idx);
  const end = rest.slice(10).search(/\n(export |async function |function )/);
  return end === -1 ? rest : rest.slice(0, end + 10);
}

describe("signing a company creates exactly one won deal", () => {
  const body = fnBody("setCompanyCallOutcome");
  it("checks for an existing won deal before promoting (no double-counted revenue)", () => {
    expect(body).toContain("existingWon");
    expect(body).toContain("WON_STAGE");
  });
  it("promotes the company's open deal rather than always inserting a new one", () => {
    expect(body).toContain("TO_CALL_STAGE");
    expect(body).toContain("UPDATE deals");
  });
  it("stamps proposal_status as signed on the won deal", () => {
    expect(body).toContain("proposal_status='signed'");
  });
  it("keeps record-level permissions on the company", () => {
    expect(body).toContain("assertCanEdit(");
  });
});

describe("won deals turn into build projects exactly once", () => {
  const body = helperBody("syncWonDealProjects");
  it("only creates projects for won, unarchived deals with a company", () => {
    expect(body).toContain("WON_STAGE");
    expect(body).toContain("archived_at IS NULL");
    expect(body).toContain("company_id IS NOT NULL");
  });
  it("is idempotent — skips deals that already have a project", () => {
    expect(body).toContain("NOT EXISTS");
    expect(body).toContain("p.deal_id = d.id");
  });
});

describe("losing a deal syncs the company outcome", () => {
  const sync = helperBody("syncCompanyOnDealLost");
  it("never downgrades a signed company", () => {
    expect(sync).toContain('call_outcome === "signed"');
  });
  it("leaves the company alone while it still has other open deals", () => {
    expect(sync).toContain("LOST_STAGE");
    expect(sync).toContain("COUNT(*)");
  });
  it("marks the company not_interested once the last deal is lost", () => {
    expect(sync).toContain("'not_interested'");
  });
  it("is wired into both stage-change paths (upsertDeal + setDealStage)", () => {
    expect(fnBody("upsertDeal")).toContain("syncCompanyOnDealLost(");
    expect(fnBody("setDealStage")).toContain("syncCompanyOnDealLost(");
  });
});

describe("lead-engine kill switch", () => {
  it("setLeadEnginePaused is admin-only and logged", () => {
    const body = fnBody("setLeadEnginePaused");
    expect(body).toContain("requireAdmin(");
    expect(body).toContain("logEvent(");
  });
  it("the nightly cron respects the database-backed pause", () => {
    expect(source).toContain("if (await readLeadEnginePaused()) return");
  });
  it("the pause falls back to the shipped default if the settings table is unreadable", () => {
    expect(helperBody("readLeadEnginePaused")).toContain("LEAD_ENGINE_PAUSED");
  });
});

describe("list loaders scope reps to their own book plus the unowned pool", () => {
  for (const name of ["getCompanies", "getContacts", "getDeals"]) {
    const body = fnBody(name);
    it(`${name} only skips scoping for admins`, () => {
      expect(body).toContain('me.role === "admin"');
    });
    it(`${name} keeps the unowned pool visible so claiming still works`, () => {
      expect(body).toMatch(/owner_id IS NULL/);
    });
  }
  it("getActivities scopes non-admins to their own activities", () => {
    const body = fnBody("getActivities");
    expect(body).toContain('me.role === "admin"');
    expect(body).toContain("a.owner_id = ?");
  });
});

describe("claiming from the pool stays safe", () => {
  const body = fnBody("claimCompany");
  it("refuses companies that already belong to someone else", () => {
    expect(body).toContain("owner_id");
    expect(body).toMatch(/TAKEN|already/i);
  });
  it("transfers the company's unowned open deals to the claimer", () => {
    expect(body).toContain("UPDATE deals");
  });
});

describe("research-email backfill is safe to rerun", () => {
  const body = fnBody("backfillResearchEmails");
  it("is admin-only and logged", () => {
    expect(body).toContain("requireAdmin(");
    expect(body).toContain("logEvent(");
  });
  it("only targets companies that have NO emailable contact yet", () => {
    expect(body).toContain("NOT EXISTS");
    expect(body).toContain("research IS NOT NULL");
  });
  it("never duplicates an address already in the book", () => {
    expect(body).toContain("lower(email) = ?");
  });
  it("validates the address shape before creating a contact", () => {
    expect(body).toContain("emailShape");
  });
});

describe("COO briefing is boss-only and read-only", () => {
  const body = fnBody("getCooBriefing");
  it("returns nothing for non-admins", () => {
    expect(body).toContain('me.role !== "admin"');
    expect(body).toContain("return null");
  });
  it("never writes — it only flags", () => {
    expect(body).not.toMatch(/INSERT INTO|UPDATE |DELETE FROM/);
  });
  it("watches all five operational areas", () => {
    for (const probe of ["quiet_rep", "hot_lead", "stalled_project", "unpaid_invoice", "pace"]) {
      expect(body).toContain(probe);
    }
  });
});

describe("AI research layer is a bonus, never a blocker", () => {
  const aiSource = readFileSync(join(__dirname, "ai.server.ts"), "utf8");
  it("is config-gated on ANTHROPIC_API_KEY and returns null when unset", () => {
    expect(aiSource).toContain("ANTHROPIC_API_KEY");
    expect(aiSource).toContain("if (!isAiConfigured()) return null");
  });
  it("has a hard timeout so a slow AI call can't stall a research batch", () => {
    expect(aiSource).toContain("AbortController");
    expect(aiSource).toContain("timeoutMs");
  });
  it("swallows every failure into null instead of throwing", () => {
    expect(aiSource).toMatch(/catch\s*\{\s*\n?\s*return null/);
  });
  it("sends distilled dossier facts, never raw crawled HTML", () => {
    expect(aiSource).toContain("dossierFacts(");
    expect(aiSource).not.toContain("html");
  });
  it("is wired into the research pipeline and the note digest", () => {
    expect(helperBody("researchCompanyCore")).toContain("aiResearchBrief(");
    expect(helperBody("dossierNoteBody")).toContain("d.ai");
  });
  it("re-research refresh is admin-only and refuses to run without the key", () => {
    const body = fnBody("runReResearchBatch");
    expect(body).toContain("requireAdmin()");
    expect(body).toContain("if (!isAiConfigured())");
  });
  it("re-research only targets dossiers missing an AI brief, never archived companies", () => {
    expect(source).toContain(
      `NEEDS_AI_REFRESH_SQL = \`research IS NOT NULL AND research NOT LIKE '%"ai":%' AND archived_at IS NULL\``,
    );
    expect(fnBody("runReResearchBatch")).toContain("NEEDS_AI_REFRESH_SQL");
  });
  it("full re-research is admin-only and cutoff-bounded so it can't loop forever", () => {
    const body = fnBody("runFullReResearchBatch");
    expect(body).toContain("requireAdmin()");
    expect(body).toContain("STALE_RESEARCH_SQL");
    expect(body).toContain(".bind(data.before)");
    expect(source).toContain(
      "STALE_RESEARCH_SQL = `archived_at IS NULL AND (research_at IS NULL OR research_at < ?)`",
    );
  });
});

describe("dead-site alerts catch the live→dead flip", () => {
  const core = helperBody("verifyWebsitesCore");
  it("only treats a LIVE site going dead as the hot moment, not always-dead ones", () => {
    expect(core).toContain(`status === "dead" && t.website_status === "live"`);
  });
  it("stamps site_down_at on the flip and clears it when the site recovers", () => {
    expect(core).toContain("site_down_at = CASE");
    expect(core).toContain("WHEN ? = 'live' THEN NULL");
  });
  it("jumps the follow-up queue and leaves a call-now note for the rep", () => {
    expect(core).toContain("next_followup_at = CASE");
    expect(core).toContain("INSERT INTO notes");
  });
  it("runs from the daily cron as best-effort housekeeping", () => {
    expect(fnBody("runDueSweeps")).toContain("verifyWebsitesCore(null)");
  });
  it("surfaces on the boss briefing but never for signed/interested companies", () => {
    const body = fnBody("getCooBriefing");
    expect(body).toContain("site_down_at IS NOT NULL");
    expect(body).toContain(`NOT IN ('signed', 'interested')`);
  });
});

describe("new-business feed is a bonus, never a blocker", () => {
  const sunbizSource = readFileSync(join(__dirname, "sunbiz.server.ts"), "utf8");
  it("is config-gated on SUNBIZ_DAILY_API_KEY and returns [] when unset", () => {
    expect(sunbizSource).toContain("SUNBIZ_DAILY_API_KEY");
    expect(sunbizSource).toContain("if (!key) return []");
  });
  it("swallows every failure into [] instead of throwing", () => {
    expect(sunbizSource).toMatch(/catch\s*\{\s*\n?\s*return \[\]/);
  });
  it("has a hard timeout so a slow feed can't stall the cron", () => {
    expect(sunbizSource).toContain("AbortController");
    expect(sunbizSource).toContain("timeoutMs");
  });
  const core = helperBody("importNewBusinessesCore");
  it("goes through the shared import path (dedupe + auto-assign)", () => {
    expect(core).toContain("importLeadCore(");
  });
  it("respects the config gate and the daily cap", () => {
    expect(core).toContain("isSunbizConfigured()");
    expect(core).toContain("cap");
  });
  it("the on-demand pull is admin-only", () => {
    expect(fnBody("runNewBusinessImport")).toContain("requireAdmin(");
  });
  it("runs from the daily cron and respects the pause gate", () => {
    const sweeps = fnBody("runDueSweeps");
    expect(sweeps).toContain("importNewBusinessesCore(15)");
    const pauseIdx = sweeps.indexOf("readLeadEnginePaused()");
    const importIdx = sweeps.indexOf("importNewBusinessesCore(15)");
    expect(pauseIdx).toBeGreaterThan(-1);
    expect(importIdx).toBeGreaterThan(pauseIdx);
  });
});

describe("site report card stays fenced and capped", () => {
  const body = fnBody("runPublicSiteReport");
  it("is login-gated while Barry keeps it internal", () => {
    expect(body).toContain("requireUser()");
  });
  it("refuses non-public hosts before fetching anything", () => {
    expect(body).toContain("isPublicHttpHost(");
    const fence = helperBody("isPublicHttpHost");
    expect(fence).toContain("localhost");
    expect(fence).toContain("192");
  });
  it("lead capture goes through the shared import path (dedupe + auto-assign)", () => {
    expect(body).toContain("importLeadCore(");
  });
  it("caps report-card lead creation per day so bots can't flood the book", () => {
    expect(body).toContain("'Report card'");
    expect(body).toContain("< 25");
  });
  it("lead-capture failures never break the visitor's report", () => {
    expect(body).toMatch(/catch\s*\{/);
  });
  it("inbound leads jump the follow-up queue", () => {
    expect(body).toContain("next_followup_at");
  });
});

describe("facebook-only leads are tagged and durable", () => {
  it("importLeadCore tags siteless leads that have a social profile", () => {
    const core = helperBody("importLeadCore");
    expect(core).toContain("data.socialUrl");
    expect(core).toContain('"facebook-only"');
    expect(core).toContain("!data.website");
  });
  it("the backfill is admin-only and only touches siteless untagged companies", () => {
    const body = fnBody("tagFacebookOnlyCompanies");
    expect(body).toContain("requireAdmin()");
    expect(body).toContain("website IS NULL OR website = ''");
    expect(body).toContain("NOT LIKE '%facebook-only%'");
  });
  it("the backfill appends to existing tags instead of overwriting them", () => {
    const body = fnBody("tagFacebookOnlyCompanies");
    expect(body).toContain("`${c.tags},facebook-only`");
  });
  it("a bad dossier never aborts the batch", () => {
    const body = fnBody("tagFacebookOnlyCompanies");
    expect(body).toMatch(/catch\s*\{/);
  });
});

describe("referral engine keeps its guards", () => {
  const body = fnBody("setCompanyReferredBy");
  it("keeps record-level permissions on the lead", () => {
    expect(body).toContain("assertCanEdit(");
  });
  it("refuses self-referrals", () => {
    expect(body).toContain("SELF_REFERRAL");
  });
  it("flips source to Referral so the +25 opportunity boost kicks in", () => {
    expect(body).toContain("source = 'Referral'");
  });
  it("only accepts live (unarchived) companies as referrers", () => {
    expect(body).toContain("archived_at IS NULL");
  });
  it("is event-logged so the timeline shows who linked it", () => {
    expect(body).toContain("logEvent(");
  });
});

describe("good-site archive protects the money", () => {
  const body = fnBody("archiveGoodSiteCompanies");
  it("is admin-only and logged", () => {
    expect(body).toContain("requireAdmin(");
    expect(body).toContain("logEvent(");
  });
  it("never touches signed clients, interested leads, or won-deal companies", () => {
    expect(body).toContain("'signed', 'interested'");
    expect(body).toContain("WON_STAGE");
  });
  it("soft-archives with the cascade stamp instead of deleting", () => {
    expect(body).toContain("SET archived_at");
    expect(body).not.toMatch(/DELETE FROM/);
  });
  it("only archives sites the audit graded live with zero angles", () => {
    expect(body).toContain('siteStatus !== "live"');
    expect(body).toContain("angles");
  });
});
