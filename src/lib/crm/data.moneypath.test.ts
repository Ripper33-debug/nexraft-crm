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
    it(`${name} only skips scoping for admins & managers (team scope)`, () => {
      expect(body).toContain("hasTeamScope(me.role)");
    });
    it(`${name} keeps the unowned pool visible so claiming still works`, () => {
      expect(body).toMatch(/owner_id IS NULL/);
    });
  }
  it("getActivities scopes plain members to their own activities", () => {
    const body = fnBody("getActivities");
    expect(body).toContain("hasTeamScope(me.role)");
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
  it("is config-gated on an AI key and returns null when unset", () => {
    expect(aiSource).toContain("ANTHROPIC_API_KEY");
    expect(aiSource).toContain("if (!isAiConfigured()) return null");
  });
  it("supports OpenRouter as an alternate provider (Barry's card won't clear on Anthropic)", () => {
    expect(aiSource).toContain("OPENROUTER_API_KEY");
    expect(aiSource).toContain("https://openrouter.ai/api/v1/chat/completions");
    expect(aiSource).toContain("https://api.anthropic.com/v1/messages");
  });
  it("routes an OpenRouter key pasted into ANTHROPIC_API_KEY correctly (sk-or- prefix)", () => {
    expect(aiSource).toContain(`startsWith("sk-or-")`);
  });
  it("runs Grok 4.5 on OpenRouter (owner's pick), swappable via AI_MODEL env", () => {
    expect(aiSource).toContain("x-ai/grok-4.5-20260708");
    expect(aiSource).toContain("process.env.AI_MODEL");
    // A bare model name without a vendor prefix would 404 on OpenRouter, so
    // the override is only honored when it looks like a real slug.
    expect(aiSource).toContain(`AI_MODEL_OVERRIDE.includes("/")`);
  });
  it("board briefs share the same provider layer instead of a second inline fetch", () => {
    expect(helperBody("generateBriefText")).toContain("aiComplete(");
    expect(source).not.toContain(`fetch("https://api.anthropic.com`);
    expect(source).toContain("AI_BRIEF_MODEL = process.env.AI_BRIEF_MODEL || aiDefaultModel()");
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

describe("prune weak leads archives, never deletes, and can't touch a real prospect", () => {
  const body = fnBody("pruneWeakLeads");
  it("is admin-only", () => {
    expect(body).toContain("requireAdmin()");
  });
  it("archives with the restorable cascade — no DELETE anywhere", () => {
    expect(body).toContain("UPDATE companies SET archived_at=?");
    expect(body).toContain("UPDATE deals SET archived_at=?");
    expect(body).not.toContain("DELETE FROM");
  });
  it("protects signed, interested, and maybe outcomes at the SQL level", () => {
    expect(body).toContain(`NOT IN ('signed', 'interested', 'maybe')`);
  });
  it("protects referrals both directions and active deals", () => {
    expect(body).toContain(`LOWER(COALESCE(c.source, '')) <> 'referral'`);
    expect(body).toContain("c.referred_by_company_id IS NULL");
    expect(body).toContain("r.referred_by_company_id = c.id");
    expect(body).toContain(`d.stage <> 'To Call' OR COALESCE(d.value, 0) > 0`);
  });
  it("protects scheduled follow-ups and fresh uncalled leads (30-day grace)", () => {
    expect(body).toContain("c.next_followup_at IS NULL OR c.next_followup_at <=");
    expect(body).toContain("isoDaysAgo(30)");
    expect(body).toContain(`'not_interested'`);
  });
  it("scores with the shared opportunityScore and honors the threshold", () => {
    expect(body).toContain("opportunityScore({");
    expect(body).toContain(".score < data.threshold");
  });
  it("supports a dry run so the UI can preview before archiving", () => {
    expect(body).toContain("if (data.dryRun)");
  });
});

describe("undo last bulk archive is the safety hatch for the bulk archivers", () => {
  const body = fnBody("undoLastBulkArchive");
  it("is admin-only", () => {
    expect(body).toContain("requireAdmin()");
  });
  it("targets only a shared bulk stamp — a solo archive is never a 'bulk pass'", () => {
    expect(body).toContain("HAVING COUNT(*) >= 2");
    expect(body).toContain("ORDER BY archived_at DESC LIMIT 1");
  });
  it("restores companies AND their cascade-archived deals, no DELETE anywhere", () => {
    expect(body).toContain("UPDATE companies SET archived_at=NULL WHERE archived_at=?");
    expect(body).toContain("UPDATE deals SET archived_at=NULL WHERE archived_at=?");
    expect(body).not.toContain("DELETE FROM");
  });
  it("supports a dry run so the UI can preview before restoring, and logs the real run", () => {
    expect(body).toContain("if (data.dryRun)");
    expect(body).toContain("logEvent(");
  });
});

describe("auto-assign rotation includes every rep except Barry", () => {
  it("Michael is no longer excluded from the rotation (owner's call, 2026-07-21)", () => {
    expect(helperBody("loadAutoAssignees")).not.toContain("michael");
    expect(helperBody("pickAutoAssignee")).not.toContain("michael");
  });
  it("Barry (owner) stays out of the rotation by email and name", () => {
    expect(source).toContain(`AUTO_ASSIGN_EXCLUDE_EMAIL = "barry@nexraft.com"`);
    expect(source).toContain(`AUTO_ASSIGN_EXCLUDE_NAME_LIKE_2 = "barry castelli%"`);
  });
});

describe("AI lead qualification rates real research, never invents leads", () => {
  const body = helperBody("aiQualifyCore");
  it("the admin button is admin-only; the shared core is config-gated like every AI feature", () => {
    expect(fnBody("aiQualifyLeadsBatch")).toContain("requireAdmin()");
    expect(fnBody("aiQualifyLeadsBatch")).toContain("aiQualifyCore(data.limit)");
    expect(body).toContain("if (!isAiConfigured())");
    expect(body).toContain("configured: false");
  });
  it("only rates companies that HAVE a research dossier — no dossier, no verdict", () => {
    expect(source).toContain("NEEDS_AI_FIT_SQL = `research IS NOT NULL AND archived_at IS NULL");
  });
  it("re-rates after fresh research so verdicts track reality", () => {
    expect(source).toContain("ai_fit_at < research_at");
  });
  it("clamps the model's number to 0-100 and requires a why before saving", () => {
    expect(body).toContain("Math.max(0, Math.min(100, Math.round(Number(parsed.fit))))");
    expect(body).toContain("!parsed.why");
  });
  it("one bad row never stops the batch", () => {
    expect(body).toMatch(/catch\s*\{/);
  });
  it("tells the model to judge only from given facts (anti-hallucination contract)", () => {
    expect(source).toContain("Judge ONLY from the facts given");
    expect(source).toContain(`{"fit": <integer 0-100>, "why": "<one sentence>"}`);
  });
  it("runs from the nightly cron so the engine's own finds arrive pre-rated, best-effort", () => {
    const cron = source.slice(source.indexOf("export const runDueSweeps"));
    const idx = cron.indexOf("await aiQualifyCore(");
    expect(idx).toBeGreaterThan(-1);
    // …after research, before the pause gate (rating existing leads is
    // housekeeping, not importing), and wrapped so a failure can't stall it.
    expect(idx).toBeGreaterThan(cron.indexOf("enrichNewLeads("));
    expect(idx).toBeLessThan(cron.indexOf("readLeadEnginePaused()"));
  });
});

describe("bulk pool handoff deals an even spread, never someone else's book", () => {
  const body = fnBody("assignPoolLeadsToRep");
  it("is admin-only and must match exactly one teammate", () => {
    expect(body).toContain("requireAdmin()");
    expect(body).toContain("matches.length === 0");
    expect(body).toContain("matches.length > 1");
  });
  it("only touches unowned, unarchived, unsigned companies", () => {
    expect(body).toContain("c.owner_id IS NULL AND c.archived_at IS NULL");
    expect(body).toContain(`COALESCE(c.call_outcome, '') <> 'signed'`);
  });
  it("assigns with an ownership guard so a race can't steal a claimed lead", () => {
    expect(body).toContain("SET owner_id = ? WHERE id = ? AND owner_id IS NULL");
    expect(body).toContain("AND archived_at IS NULL AND owner_id IS NULL");
  });
  it("stripes picks evenly across the score-sorted callable pool", () => {
    expect(body).toContain("opportunityScore({");
    expect(body).toContain("Math.floor((i * callable.length) / take)");
  });
  it("supports a dry run and logs the real handoff", () => {
    expect(body).toContain("if (data.dryRun)");
    expect(body).toContain("logEvent(");
  });
});

describe("team rebalance takes evenly from teammates but never their real work", () => {
  const body = fnBody("pullTeamLeadsToRep");
  it("is admin-only and must match exactly one target rep", () => {
    expect(body).toContain("requireAdmin()");
    expect(body).toContain("matches.length === 0");
    expect(body).toContain("matches.length > 1");
  });
  it("never moves signed, interested, or maybe leads", () => {
    expect(body).toContain(`NOT IN ('signed', 'interested', 'maybe')`);
  });
  it("never moves worked deals (stage progress) or leads with a scheduled follow-up", () => {
    expect(body).toContain(`d.stage <> 'To Call'`);
    // Deal VALUE must NOT protect: radar imports carry MRR estimates, so a
    // value guard would make every uncalled lead untouchable (the v1 bug).
    expect(body).not.toContain("COALESCE(d.value");
    expect(body).toContain("c.next_followup_at IS NULL OR c.next_followup_at <=");
  });
  it("splits the take evenly across donors, least-worked leads first", () => {
    expect(body).toContain("entry.queue[lap]"); // round-robin, one per donor per lap
    expect(body).toContain("workRank");
    expect(body).toContain(`"no_answer"`);
  });
  it("moves with an ownership guard so a race can't yank a lead sideways", () => {
    expect(body).toContain("SET owner_id = ? WHERE id = ? AND owner_id = ?");
  });
  it("supports a dry run with a per-donor breakdown, and logs the real move", () => {
    expect(body).toContain("if (data.dryRun)");
    expect(body).toContain("breakdown");
    expect(body).toContain("logEvent(");
  });
});

describe("the one-time Michael rebalance runs itself exactly once", () => {
  const body = helperBody("runMichaelRebalance");
  it("claims a run-once lock in app_settings before touching anything", () => {
    expect(body).toContain("ON CONFLICT (key) DO NOTHING RETURNING key");
    expect(body).toContain("if (!row) return");
  });
  it("takes at most 40 per donor and never a rep's real work", () => {
    expect(source).toContain("REBALANCE_PER_DONOR = 40");
    expect(body).toContain(`NOT IN ('signed', 'interested', 'maybe')`);
    expect(body).toContain(`d.stage <> 'To Call'`);
    expect(body).toContain("c.next_followup_at IS NULL OR c.next_followup_at <=");
  });
  it("uses a versioned run-once key and skips if Michael's book is already stocked", () => {
    expect(source).toContain(`REBALANCE_TASK_KEY = "task_rebalance_michael_2026_07_21_v2"`);
    expect(body).toContain(">= REBALANCE_PER_DONOR");
  });
  it("never donates from Michael himself or from Barry the owner", () => {
    expect(body).toContain("c.owner_id <> ?");
    expect(body).toContain("AUTO_ASSIGN_EXCLUDE_EMAIL");
  });
  it("skips safely unless exactly one Michael exists", () => {
    expect(body).toContain("michaels.length !== 1");
  });
  it("moves with the ownership guard, least-worked leads first, and logs what it did", () => {
    expect(body).toContain("SET owner_id = ? WHERE id = ? AND owner_id = ?");
    expect(body).toContain("workRank");
    expect(body).toContain("logEvent(");
  });
  it("fires from both the Companies loader and the cron, and releases the lock on failure", () => {
    expect(fnBody("getCompanies")).toContain("runPendingOneTimeTasks()");
    const cron = source.slice(source.indexOf("export const runDueSweeps"));
    expect(cron).toContain("runPendingOneTimeTasks()");
    expect(body).toContain(`value='running'`);
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

describe("outreach uses the AI-tailored email for each business", () => {
  const emails = readFileSync(join(__dirname, "emails.ts"), "utf8");
  const followups = readFileSync(join(__dirname, "..", "..", "routes", "_app", "followups.tsx"), "utf8");
  it("aiDraftFromResearch reads the research .ai draft and fills the rep's name", () => {
    expect(emails).toContain("export function aiDraftFromResearch");
    expect(emails).toContain("email_subject");
    expect(emails).toContain("email_body");
    expect(emails).toContain('replaceAll("{{REP_NAME}}"');
  });
  it("returns null (so canned templates take over) when there is no AI draft", () => {
    const start = emails.indexOf("export function aiDraftFromResearch");
    const body = emails.slice(start, emails.indexOf("export function", start + 10));
    expect(body).toContain("return null");
    expect(body).toContain("catch");
  });
  it("nudge cards and the bulk approve prefer the tailored draft for the first touch", () => {
    expect(followups).toContain("aiDraftFromResearch(company.research");
    expect(followups).toContain("aiDraftFromResearch(t.c.research");
    expect(followups).toContain("?? followUpEmail(");
  });
  it("the composer leads with the tailored draft when a client has one", () => {
    expect(followups).toContain("aiDraftFromResearch(c.research");
    expect(followups).toContain("TAILORED_ID");
  });
  it("the email workspace ships the research column the composer needs", () => {
    expect(fnBody("getEmailWorkspace")).toContain("c.research");
    expect(source).toMatch(/EmailTargetRow = \{[\s\S]*?research: string \| null;[\s\S]*?\};/);
  });
  it("the one-time Arctic Air move is locked, strict about matches, and logs Michael's email", () => {
    const body = helperBody("runMoveArcticAirToMichael");
    expect(source).toContain('"task_move_arctic_air_to_michael_2026_07_21"');
    expect(body).toContain("ON CONFLICT (key) DO NOTHING"); // run-once lock
    expect(body).toContain("matches.length !== 1"); // never guess between companies
    expect(body).toContain("michaels.length !== 1"); // never guess who Michael is
    expect(body).toContain("GREATEST(COALESCE(email_touches, 0), 1)"); // his email counts, once
    expect(helperBody("runPendingOneTimeTasks")).toContain("runMoveArcticAirToMichael()");
  });
  it("the one-time web-hunt seed is locked, dedupes like the CSV import, and lands emailable leads on Barry's book", () => {
    const body = helperBody("runSeedWebHuntLeads");
    expect(source).toContain('"task_seed_web_hunt_2026_07_21"');
    expect(body).toContain("ON CONFLICT (key) DO NOTHING"); // run-once lock
    expect(body).toContain("companyNameKey"); // same dedupe as CSV import
    expect(body).toContain("phoneKey");
    expect(body).toContain("INSERT INTO contacts"); // email lands as a contact → Outreach-ready
    expect(source).toContain("WEB_HUNT_LEADS");
    expect(source).toContain("web hunt 2026-07"); // source tag reps can filter on
    expect(helperBody("runPendingOneTimeTasks")).toContain("runSeedWebHuntLeads()");
  });
  it("every AI prompt quotes the real pricing ($299/month, per nexraft.com) — never the old $100", () => {
    const aiServer = readFileSync(join(__dirname, "ai.server.ts"), "utf8");
    expect(aiServer).toContain("$299/month");
    expect(aiServer).not.toContain("$100");
    expect(source).toContain("$299/month"); // AI_FIT_SYSTEM lead-qualification prompt
    expect(source).not.toContain("$100/mo");
    expect(source).not.toContain("$100/month");
  });
  it("generated drafts must clear the quality bar — one rewrite, then no draft beats a bad draft", () => {
    const aiServer = readFileSync(join(__dirname, "ai.server.ts"), "utf8");
    expect(aiServer).toContain("draftQualityIssue"); // same bar the composer enforces
    expect(aiServer).toContain("rejected by our quality check"); // failure fed back for the rewrite
    expect(aiServer).toContain("attempt < 2"); // exactly one retry
  });
  it("nightly auto-research puts emailable leads first so tailored drafts land where they can be sent", () => {
    const body = helperBody("enrichNewLeads");
    expect(body).toContain("EXISTS");
    expect(body).toContain("ct.email IS NOT NULL");
    expect(fnBody("runDueSweeps")).toContain("enrichNewLeads(10)");
  });
});

describe("the company edit form's email box syncs to the primary contact", () => {
  it("upsertCompany syncs the email on both create and update", () => {
    const body = fnBody("upsertCompany");
    const calls = body.match(/syncCompanyEmail\(/g) ?? [];
    expect(calls.length).toBe(2);
  });
  it("edits the same contact Outreach would send to (email-having contacts first)", () => {
    const body = helperBody("syncCompanyEmail");
    expect(body).toContain("WHEN email IS NOT NULL AND email <> '' THEN 0");
    expect(body).toContain("UPDATE contacts SET email = ?");
  });
  it("creates a bare office contact when the company has none, skips when field untouched", () => {
    const body = helperBody("syncCompanyEmail");
    expect(body).toContain("INSERT INTO contacts");
    expect(body).toContain("if (raw === undefined) return;");
  });
  it("getCompanies ships contact_email so the form can prefill it", () => {
    expect(fnBody("getCompanies")).toContain("AS contact_email");
  });
});

describe("Outscraper enrichment spends credits carefully and never blocks", () => {
  const body = helperBody("outscraperEnrichCore");
  it("is config-gated — no key means a clean no-op, no credits spent", () => {
    expect(body).toContain("isOutscraperConfigured()");
    expect(body).toContain("configured: false");
  });
  it("only asks about researched, email-less companies it has never asked about", () => {
    expect(body).toContain(`NOT LIKE '%"outscraper":%'`);
    expect(body).toContain("ct.email IS NOT NULL");
    expect(body).toContain("c.website IS NOT NULL");
  });
  it("a failed call stamps nothing (retry later); a successful one stamps every queried company", () => {
    // null = the call failed; bail before any UPDATE so the batch re-enters
    // the pool another night instead of being buried by a network blip.
    expect(body).toContain("if (hits === null) return");
    expect(body).toContain("dossier.outscraper =");
    expect(body).toContain("UPDATE companies SET research = ?");
  });
  it("turns the best email into a contact, deduped against the whole book", () => {
    expect(body).toContain("INSERT INTO contacts");
    expect(body).toContain("lower(email) = ?");
    // Prefer an address on the company's own domain over generic forwarders.
    expect(body).toContain("endsWith(`@${domain}`)");
  });
  it("one company per domain — shared sites never double-spend a credit", () => {
    expect(body).toContain("byDomain.has(domain)");
  });
  it("runs nightly from the cron, capped and best-effort, and the admin trigger is admin-only", () => {
    expect(fnBody("runDueSweeps")).toContain("outscraperEnrichCore(6)");
    expect(fnBody("runOutscraperEnrich")).toContain("requireAdmin()");
  });
});

describe("prompt upgrades reach every stored email draft (redraft pass)", () => {
  const body = helperBody("redraftAiEmailsCore");
  it("is gated on an AI key — no key, no token spend, clean no-op", () => {
    expect(body).toContain("isAiConfigured()");
    expect(body).toContain("configured: false");
  });
  it("targets only drafts written under an older prompt version, emailable companies first", () => {
    expect(body).toContain(`LIKE '%"ai":{%'`);
    expect(body).toContain(`NOT LIKE '%"v":`);
    expect(body).toContain("ct.email IS NOT NULL");
  });
  it("a failed rewrite keeps a still-good old draft (and retries later), only blanks below-bar ones", () => {
    expect(body).toContain("draftQualityIssue(old.email_subject");
    expect(body).toContain(`email_subject: ""`);
  });
  it("every fresh draft is stamped with the prompt version so the pool drains", () => {
    const aiSource = readFileSync(join(__dirname, "ai.server.ts"), "utf8");
    expect(aiSource).toContain("export const AI_PROMPT_VERSION");
    expect(aiSource).toContain("{ ...brief, v: AI_PROMPT_VERSION }");
  });
  it("runs nightly from the cron and the on-demand batch is admin-only", () => {
    expect(fnBody("runDueSweeps")).toContain("redraftAiEmailsCore(6)");
    expect(fnBody("runRedraftEmailsBatch")).toContain("requireAdmin()");
  });
  it("the prompt itself forbids the mass-mail voice Barry flagged", () => {
    const aiSource = readFileSync(join(__dirname, "ai.server.ts"), "utf8");
    expect(aiSource).toContain("if this email could be sent to a different business by swapping the name, it is WRONG");
    expect(aiSource).toContain(`"I noticed"`);
    expect(aiSource).toContain("plans from $299/month");
  });
});

describe("a manually added company gets researched immediately, not tomorrow", () => {
  const companiesPage = readFileSync(join(__dirname, "../../routes/_app/companies.tsx"), "utf8");
  it("the New-company form fires researchCompany in the background after create", () => {
    expect(companiesPage).toContain("const saved = await upsertCompany(");
    expect(companiesPage).toContain("void researchCompany({ data: { id: saved.id as string } }).catch(");
  });
  it("only new companies trigger it — edits don't re-burn research", () => {
    // The fire-and-forget lives in the else-branch of `if (company?.id)`.
    const idx = companiesPage.indexOf("void researchCompany(");
    const before = companiesPage.slice(idx - 700, idx);
    expect(before).toContain("if (company?.id)");
    expect(before).toContain("researching it in the background");
  });
  it("upsertCompany returns the new id the form relies on", () => {
    expect(fnBody("upsertCompany")).toContain("return { id }");
  });
});

describe("the bulk lead hunt only imports fully contactable businesses", () => {
  const body = fnBody("huntLeadsBatch");
  it("is admin-only", () => {
    expect(body).toContain("requireAdmin()");
  });
  it("enforces Barry's rule: no email + phone, no import", () => {
    expect(body).toContain("l.phone && l.email && EMAIL_OK.test(l.email.trim())");
    expect(body).toContain("!l.already_in_crm");
  });
  it("makes each hunted lead emailable immediately via a real contact row", () => {
    expect(body).toContain("INSERT INTO contacts");
    expect(body).toContain("found during the bulk lead hunt");
  });
  it("one bad lead can't stall a step, and finished steps report done", () => {
    expect(body).toContain("one bad lead must not stall the hunt");
    expect(body).toContain("data.step + 1 >= HUNT_STOPS.length");
  });
  it("the Team page button loops steps and is stoppable", () => {
    const teamPage = readFileSync(join(__dirname, "../../routes/_app/team.tsx"), "utf8");
    expect(teamPage).toContain("huntLeadsBatch({ data: { step } })");
    expect(teamPage).toContain("total >= HUNT_TARGET || res.done");
    expect(teamPage).toContain("<HuntLeadsButton />");
  });
});

describe("the 2026-07-21 statewide hunt seeds itself into the CRM exactly once", () => {
  const body = helperBody("runSeedFlHuntLeads");
  const seed = readFileSync(join(__dirname, "fl-hunt-seed.server.ts"), "utf8");
  it("run-once lock with a resumable progress cursor (never a 30s timeout gamble)", () => {
    expect(source).toContain(`const FL_HUNT_TASK_KEY = "task_seed_fl_hunt_2026_07_21"`);
    expect(body).toContain("ON CONFLICT (key) DO NOTHING RETURNING key");
    expect(body).toContain('startsWith("progress:")');
    expect(body).toContain("FL_HUNT_LEADS.slice(offset, offset + FL_HUNT_CHUNK)");
  });
  it("dedupes against every company including trashed ones", () => {
    expect(body).toContain("SELECT name, phone FROM companies");
    expect(body).not.toContain("SELECT name, phone FROM companies WHERE archived_at IS NULL");
    expect(body).toContain("companyNameKey(lead.name)");
  });
  it("each lead lands pool-owned with a To Call deal AND an email contact", () => {
    expect(body).toContain("TO_CALL_STAGE");
    expect(body).toContain("INSERT INTO contacts");
    expect(body).toContain("lead.email.toLowerCase()");
    expect(body).toContain("open pool: reps claim them like radar finds");
  });
  it("is wired into the one-time task runner", () => {
    expect(helperBody("runPendingOneTimeTasks")).toContain("runSeedFlHuntLeads()");
  });
  it("every seeded lead honors Barry's rules: phone, email, and a reason they need us", () => {
    const leads = JSON.parse(seed.slice(seed.indexOf("= [") + 2, seed.lastIndexOf("]") + 1)) as {
      name: string; phone: string; email: string; why: string;
    }[];
    expect(leads.length).toBeGreaterThanOrEqual(200);
    for (const l of leads) {
      expect(l.name.length).toBeGreaterThan(2);
      expect(l.phone.replace(/\D/g, "").length).toBeGreaterThanOrEqual(7);
      expect(l.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/);
      expect(l.why.length).toBeGreaterThan(5);
    }
    // No duplicates within the seed itself.
    const names = leads.map((l) => l.name.toLowerCase().replace(/[^a-z0-9]/g, ""));
    expect(new Set(names).size).toBe(leads.length);
    const emails = leads.map((l) => l.email.toLowerCase());
    expect(new Set(emails).size).toBe(leads.length);
  });
});

describe("moneypath: reps can run & read AI research without leaving the pipeline", () => {
  const panel = readFileSync(join(__dirname, "../../components/crm/research-panel.tsx"), "utf8");
  const pipeline = readFileSync(join(__dirname, "../../routes/_app/pipeline.tsx"), "utf8");
  const companyPage = readFileSync(join(__dirname, "../../routes/_app/companies_.$companyId.tsx"), "utf8");

  it("the research panel is a shared component that runs research on the real company", () => {
    expect(panel).toContain("export function ResearchPanel");
    expect(panel).toContain("researchCompany({ data: { id: company.id as string } })");
    expect(panel).toContain("Copy email draft");
  });
  it("the company page uses the shared panel instead of its own copy", () => {
    expect(companyPage).toContain('import { ResearchPanel } from "../../components/crm/research-panel"');
    expect(companyPage).not.toContain("function ResearchPanel(");
  });
  it("opening a deal shows the company's intel panel, keyed so switching deals resets it", () => {
    expect(pipeline).toContain('import { ResearchPanel } from "../../components/crm/research-panel"');
    expect(pipeline).toContain("<ResearchPanel key={dealCompany.id as string} company={dealCompany} />");
    expect(pipeline).toContain("companies.find((c) => c.id === (deal.company_id as string))");
  });
  it("kanban cards flag deals that already have a dossier", () => {
    expect(pipeline).toContain("Boolean(c.research)");
    expect(pipeline).toContain("researched.has((d.company_id as string)");
    expect(pipeline).toContain("Research done — intel & drafted email inside");
  });
});

describe("moneypath: the simplified pipeline reads To Call → Lost → Proposal → Negotiation", () => {
  const constants = readFileSync(join(__dirname, "constants.ts"), "utf8");

  it("Lost sits right next to To Call and Lead/Discovery are gone", () => {
    const names = [...constants.matchAll(/\{ name: "([^"]+)", prob:/g)].map((m) => m[1]);
    expect(names).toEqual(["To Call", "Lost", "Proposal", "Negotiation", "In Build", "Launched"]);
  });
  it("a one-time task sweeps deals parked in the retired stages back to To Call", () => {
    const body = helperBody("runRetireLeadDiscoveryStages");
    expect(body).toContain("ON CONFLICT (key) DO NOTHING RETURNING key");
    expect(body).toContain("WHERE stage IN ('Lead','Discovery')");
    expect(body).toContain("TO_CALL_STAGE");
    expect(helperBody("runPendingOneTimeTasks")).toContain("runRetireLeadDiscoveryStages()");
  });
  it("an interested call now advances a To Call deal straight to Proposal", () => {
    expect(source).toContain('.bind("Proposal", now, now, deal.id)');
    expect(source).not.toContain('.bind("Lead", now, now, deal.id)');
  });
  it("new deals default to the To Call entry stage, not a retired one", () => {
    const pipeline = readFileSync(join(__dirname, "../../routes/_app/pipeline.tsx"), "utf8");
    expect(pipeline).toContain('String(fd.get("stage") || "To Call")');
    expect(pipeline).not.toContain('|| "Lead"');
  });
});

describe("moneypath: every phone and email on screen is one tap away", () => {
  const panel = readFileSync(join(__dirname, "../../components/crm/research-panel.tsx"), "utf8");
  const contacts = readFileSync(join(__dirname, "../../routes/_app/contacts.tsx"), "utf8");
  const today = readFileSync(join(__dirname, "../../routes/_app/today.tsx"), "utf8");
  const companyPage = readFileSync(join(__dirname, "../../routes/_app/companies_.$companyId.tsx"), "utf8");

  it("research dossier emails/phones are live mailto:/tel: links", () => {
    expect(panel).toContain("href={`mailto:${em}`}");
    expect(panel).toContain('href={`tel:${ph.replace(/[^\\d+]/g, "")}`}');
  });
  it("the contacts table links email and phone without triggering the row click", () => {
    expect(contacts).toContain("href={`mailto:${c.email as string}`}");
    expect(contacts).toContain('href={`tel:${(c.phone as string).replace(/[^\\d+]/g, "")}`}');
    expect(contacts).toContain("e.stopPropagation()");
  });
  it("My Day's big call number is tappable", () => {
    expect(today).toContain('href={`tel:${(current.row.phone as string).replace(/[^\\d+]/g, "")}`}');
  });
  it("the company page phone is tappable too", () => {
    expect(companyPage).toContain("tel:");
  });
});

describe("moneypath: proposals go out straight from the kanban board", () => {
  const pipeline = readFileSync(join(__dirname, "../../routes/_app/pipeline.tsx"), "utf8");

  it("Proposal/Negotiation cards carry a send-proposal button", () => {
    expect(pipeline).toContain("function CardProposalButton(");
    expect(pipeline).toContain('d.stage === "Proposal" || d.stage === "Negotiation"');
    expect(pipeline).toContain("<CardProposalButton dealId={d.id as string} status={String(d.proposal_status ?? \"none\")} />");
  });
  it("clicking it copies the real tokenized link and doesn't open the card", () => {
    const start = pipeline.indexOf("function CardProposalButton(");
    const body = pipeline.slice(start, pipeline.indexOf("\nfunction ", start + 10));
    expect(body).toContain("getProposalLink({ data: { dealId } })");
    expect(body).toContain("stopPropagation()");
    expect(body).toContain("clipboard.writeText");
  });
});

describe("moneypath: the company page is a one-stop calling cockpit", () => {
  const companyPage = readFileSync(join(__dirname, "../../routes/_app/companies_.$companyId.tsx"), "utf8");

  it("a Call button opens the same Call Mode reps use in the queue", () => {
    expect(companyPage).toContain('import { CallMode } from "../../components/crm/call-mode"');
    expect(companyPage).toContain("setCalling(true)");
    expect(companyPage).toContain('kind="company"');
  });
  it("logging a call from here refreshes the page data", () => {
    expect(companyPage).toContain("onLogged={() => router.invalidate()}");
  });
  it("the quick Email button prefers the AI-drafted email and personalizes the rep name", () => {
    expect(companyPage).toContain("REP_NAME");
    expect(companyPage).toContain("quickEmail");
    expect(companyPage).toContain("mailto:${to}?subject=");
  });
});

describe("moneypath: a missed call turns into an email without leaving Call Mode", () => {
  const callMode = readFileSync(join(__dirname, "../../components/crm/call-mode.tsx"), "utf8");

  it("the nudge only appears for voicemail / no answer / call-back outcomes", () => {
    expect(callMode).toContain("/voicemail|no answer|call back/i.test(outcome) && missEmail");
  });
  it("it targets a real address: the contact's email or the dossier's first find", () => {
    expect(callMode).toContain("(subject?.email as string)");
    expect(callMode).toContain("intel?.emails[0]");
  });
  it("it uses the AI-drafted subject/body when available, with the rep's real name", () => {
    expect(callMode).toContain("REP_NAME");
    expect(callMode).toContain("Email them now");
  });
});

describe("moneypath: quick edits on the deal page hit the server safely", () => {
  const body = fnBody("setDealQuickFields");
  const dealPage = readFileSync(join(__dirname, "../../routes/_app/deals.$dealId.tsx"), "utf8");

  it("only next_step and renewal_date are editable, and only by someone allowed to", () => {
    expect(body).toContain('assertCanEdit(user, "deals", data.id)');
    expect(body).toContain("next_step = CASE WHEN ? THEN ? ELSE next_step END");
    expect(body).toContain("renewal_date = CASE WHEN ? THEN ? ELSE renewal_date END");
  });
  it("omitting a field leaves it untouched (undefined ≠ clear)", () => {
    expect(body).toContain("data.next_step !== undefined");
    expect(body).toContain("data.renewal_date !== undefined");
  });
  it("the deal page wires both fields through click-to-edit rows", () => {
    expect(dealPage).toContain("function QuickEditRow(");
    expect(dealPage).toContain('field="next_step"');
    expect(dealPage).toContain('field="renewal_date"');
    expect(dealPage).toContain("setDealQuickFields({ data: { id: dealId, [field]: draft.trim() || null } })");
  });
});

describe("moneypath: reps land on My Day and the tour teaches the real routine", () => {
  const login = readFileSync(join(__dirname, "../../routes/api/auth/login.ts"), "utf8");
  const signup = readFileSync(join(__dirname, "../../routes/api/auth/signup.ts"), "utf8");
  const index = readFileSync(join(__dirname, "../../routes/_app/index.tsx"), "utf8");
  const tour = readFileSync(join(__dirname, "../../components/crm/tour.tsx"), "utf8");

  it("login and signup both drop reps on /today", () => {
    expect(login).toContain('redirect("/today", sessionCookie(result.token))');
    expect(signup).toContain('redirect("/today", sessionCookie(result.token))');
  });
  it("the dashboard hands off to My Day instead of duplicating the daily plan", () => {
    expect(index).toContain("function MyDayBanner(");
    expect(index).not.toContain("function TodayBoard(");
    expect(index).toContain('to="/today"');
    expect(index).toContain("Open My Day →");
  });
  it("the tour was bumped to v2 so existing reps see the refreshed steps once", () => {
    expect(tour).toContain('const SEEN_KEY = "nexraft_tour_seen_v2"');
  });
  it("the v2 tour walks the actual day: My Day → call → log → email → outreach → pipeline", () => {
    const names = [...tour.matchAll(/title: "([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([
      "Welcome to your CRM",
      "Start every day on My Day",
      "The Calls queue tees up who to call",
      "Log the call with one tap",
      "Missed them? Email them right away",
      "Outreach keeps follow-ups moving",
      "The pipeline reads left to right",
      "Everything has one owner",
      "You can't break anything",
    ]);
    expect(tour).toContain("To Call → Lost → Proposal → Negotiation → In Build → Launched");
  });
});

describe("moneypath: the Manager role sees the whole team's book without admin powers", () => {
  const constants = readFileSync(join(__dirname, "constants.ts"), "utf8");
  const team = readFileSync(join(__dirname, "../../routes/_app/team.tsx"), "utf8");
  const calls = readFileSync(join(__dirname, "../../routes/_app/calls.tsx"), "utf8");

  it("hasTeamScope covers exactly admin and manager", () => {
    expect(constants).toContain('return role === "admin" || role === "manager";');
  });
  it("record edits and every big list loader use team scope, not a bare admin check", () => {
    const canEdit = constants.slice(constants.indexOf("export function canEditRecord"));
    expect(canEdit.slice(0, 500)).toContain("hasTeamScope(user.role)");
    // companies, contacts, deals, activities loaders
    const scopes = [...source.matchAll(/hasTeamScope\(me\.role\)/g)];
    expect(scopes.length).toBeGreaterThanOrEqual(4);
  });
  it("admins can grant the manager role from the Team page", () => {
    expect(fnBody("adminUpdateRole")).toContain('z.enum(["admin", "manager", "member"])');
    expect(team).toContain('<option value="manager">');
  });
  it("the last-admin guard still holds when demoting to manager", () => {
    const body = fnBody("adminUpdateRole");
    expect(body).toContain('data.role !== "admin"');
    expect(body).toContain("You can't remove the last admin.");
  });
  it("Nick Besser gets promoted once, automatically, by surname match", () => {
    const body = helperBody("runPromoteNickBesserToManager");
    expect(source).toContain('const NICK_MANAGER_TASK_KEY = "task_make_besser_manager_2026_07_22"');
    expect(body).toContain("ON CONFLICT (key) DO NOTHING RETURNING key");
    expect(body).toContain("LOWER(name) LIKE '%besser%' OR LOWER(email) LIKE '%besser%'");
    expect(body).toContain("role='member'"); // never touches admins
    expect(helperBody("runPendingOneTimeTasks")).toContain("runPromoteNickBesserToManager()");
  });
  it("the Calls page gives managers the full-team queue", () => {
    expect(calls).toContain("hasTeamScope(me?.role)");
  });
  it("admin pages stay admin-only (team & payroll gates untouched)", () => {
    const payroll = readFileSync(join(__dirname, "../../routes/_app/payroll.tsx"), "utf8");
    expect(team).toContain('user.role !== "admin"');
    expect(payroll).toContain('user.role !== "admin"');
  });
});
