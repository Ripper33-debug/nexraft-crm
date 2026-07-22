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
