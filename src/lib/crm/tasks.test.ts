import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { RECURRING_TASKS, recurringInterval, inHours } from "./tasks.server";
import { FACT_WEIGHTS, FACT_APPLY_MIN, FACT_PROPOSE_MIN, factDisposition } from "./constants";

// The crm_tasks work queue (ported from Comp AI's CRM) replaced the nightly
// hardcoded try/catch pile. These tests pin the pure parts and statically
// verify the SQL keeps the properties the port exists for: SKIP LOCKED
// claiming, lease expiry, bounded retries, and recurring re-enqueue.

const tasksSrc = readFileSync(join(__dirname, "tasks.server.ts"), "utf8");
const dataSrc = readFileSync(join(__dirname, "data.ts"), "utf8");
const schemaSrc = readFileSync(join(__dirname, "schema.server.ts"), "utf8");

describe("recurring task definitions", () => {
  it("covers every overnight job the old sweep ran", () => {
    const kinds = RECURRING_TASKS.map((t) => t.kind);
    for (const k of [
      "enrich_new_leads",
      "vet_book",
      "outscraper_enrich",
      "ai_qualify",
      "redraft_emails",
      "verify_websites",
      "recheck_sites",
    ]) {
      expect(kinds, `recurring kind ${k} should exist`).toContain(k);
    }
  });
  it("every recurring job has a rep-readable reason (why does this job exist?)", () => {
    for (const t of RECURRING_TASKS) {
      expect(t.reason.length, `${t.kind} needs a real reason`).toBeGreaterThan(20);
    }
  });
  it("runs on a ~20h cadence so a late cron never skips a night", () => {
    for (const t of RECURRING_TASKS) {
      expect(t.everyHours).toBeLessThan(24);
      expect(t.everyHours).toBeGreaterThanOrEqual(12);
    }
  });
  it("recurringInterval maps kinds to their cadence, null for one-shots", () => {
    expect(recurringInterval("vet_book")).toBe(20);
    expect(recurringInterval("research_company")).toBeNull();
    expect(recurringInterval("nonsense")).toBeNull();
  });
  it("inHours produces a future ISO timestamp", () => {
    const t = inHours(20);
    expect(new Date(t).getTime()).toBeGreaterThan(Date.now() + 19 * 3_600_000);
  });
});

describe("claiming is crash-safe and concurrent-safe", () => {
  it("claims with FOR UPDATE SKIP LOCKED in a single atomic UPDATE", () => {
    expect(tasksSrc).toContain("FOR UPDATE SKIP LOCKED");
    expect(tasksSrc).toContain("UPDATE crm_tasks SET leased_until = ?, attempts = attempts + 1");
  });
  it("only claims due, unleased (or lease-expired), under-attempted open rows", () => {
    expect(tasksSrc).toContain("done_at IS NULL");
    expect(tasksSrc).toContain("due_at <= ?");
    expect(tasksSrc).toContain("leased_until IS NULL OR leased_until < ?");
    expect(tasksSrc).toMatch(/attempts < \$\{MAX_ATTEMPTS\}|attempts < 5/);
  });
  it("highest priority first, then oldest due", () => {
    expect(tasksSrc).toContain("ORDER BY priority DESC, due_at ASC");
  });
  it("failure backs off (30min × attempts) and keeps the error as evidence", () => {
    expect(tasksSrc).toContain("inMinutes(30 * Math.max(1, attempts))");
    expect(tasksSrc).toContain("last_error = ?");
  });
  it("enqueue dedupes: at most one open row per (kind, company)", () => {
    expect(tasksSrc).toContain("ON CONFLICT (kind, (COALESCE(company_id, ''))) WHERE done_at IS NULL DO NOTHING");
    expect(schemaSrc).toContain("idx_crm_tasks_one_open");
  });
});

describe("the dispatcher in data.ts", () => {
  it("the cron routes overnight work through the queue with a bounded budget", () => {
    expect(dataSrc).toContain("await runTaskQueue(40_000);");
  });
  it("a finished recurring task books its own next run", () => {
    const start = dataSrc.indexOf("async function runTaskQueue");
    const body = dataSrc.slice(start, dataSrc.indexOf("export const runDueSweeps"));
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("recurringInterval(t.kind)");
    expect(body).toContain("dueAt: inHours(every)");
  });
  it("failures go through failTask (backoff), never silently swallowed per-row", () => {
    const start = dataSrc.indexOf("async function runTaskQueue");
    const body = dataSrc.slice(start, dataSrc.indexOf("export const runDueSweeps"));
    expect(body).toContain("await failTask(t.id, t.attempts, e);");
    expect(body).toContain("await completeTask(t.id);");
  });
  it("seeds the recurring plan every run, so a wiped table heals itself", () => {
    const start = dataSrc.indexOf("async function runTaskQueue");
    const body = dataSrc.slice(start, dataSrc.indexOf("export const runDueSweeps"));
    expect(body).toContain("await seedRecurringTasks();");
  });
  it("every recurring kind has a dispatch arm", () => {
    const start = dataSrc.indexOf("async function runTaskDispatch");
    const body = dataSrc.slice(start, dataSrc.indexOf("async function runTaskQueue"));
    for (const t of RECURRING_TASKS) {
      expect(body, `dispatch arm for ${t.kind}`).toContain(`case "${t.kind}":`);
    }
  });
});

// ---------------------------------------------------------------------------
// Fact ledger: evidence-weighted suggestions with a single write path.
// ---------------------------------------------------------------------------
describe("fact ledger weights and thresholds", () => {
  it("human evidence always wins; own-domain evidence auto-applies; generic only proposes", () => {
    expect(FACT_WEIGHTS.human).toBe(1);
    expect(factDisposition("outscraper.own-domain")).toBe("apply");
    expect(factDisposition("site.own-domain-email")).toBe("apply");
    expect(factDisposition("outscraper.generic")).toBe("propose");
  });
  it("thresholds are ordered: apply bar above propose bar", () => {
    expect(FACT_APPLY_MIN).toBeGreaterThan(FACT_PROPOSE_MIN);
    for (const w of Object.values(FACT_WEIGHTS)) {
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });
});

describe("recordCompanyFact is the single write path and never re-offers", () => {
  const start = dataSrc.indexOf("async function recordCompanyFact");
  const body = dataSrc.slice(start, start + 2600);
  it("exists", () => {
    expect(start).toBeGreaterThan(-1);
  });
  it("dedupes case-insensitively across ALL statuses — a dismissed fact stays dismissed", () => {
    expect(body).toContain("lower(value) = lower(?)");
    expect(body).toContain('if (existing && existing.status !== "superseded") return "skipped";');
  });
  it("weight comes from the fixed evidence table, never ad hoc", () => {
    expect(body).toContain("FACT_WEIGHTS[input.evidenceKind]");
  });
  it("Outscraper enrichment records facts instead of inserting contacts directly", () => {
    const os = dataSrc.indexOf("async function outscraperEnrichCore");
    const osBody = dataSrc.slice(os, os + 6000);
    expect(os).toBeGreaterThan(-1);
    expect(osBody).toContain("recordCompanyFact");
    expect(osBody).toContain("outscraper.own-domain");
    expect(osBody).toContain("outscraper.generic");
  });
  it("accepting a suggestion applies with guarded writes (never overwrite human data)", () => {
    const d = dataSrc.indexOf("export const decideCompanyFact");
    const dBody = dataSrc.slice(d, d + 4000);
    expect(d).toBeGreaterThan(-1);
    expect(dBody).toContain("COALESCE(NULLIF(");
    expect(dBody).toContain("'dismissed'");
  });
});
