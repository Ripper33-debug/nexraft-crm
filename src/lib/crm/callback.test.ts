import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  CALLBACK_DAYS,
  CALLBACK_MAX_ATTEMPTS,
  CALLBACK_PARK_DAYS,
  callbackDelayDays,
  callbackDue,
  callbackLabel,
  callbackWhen,
  nextCallbackAt,
  NO_REASONS,
  isNoReason,
  noReasonCoach,
  noReasonLabel,
  tallyNoReasons,
} from "./constants";

// The three things this file protects, all of which are about a lead never
// falling silently out of the funnel:
//   1. a no-answer always books another dial, and never schedules "never";
//   2. a company that's been rung four times is parked, not deleted;
//   3. every "no" is asked for a reason, from every screen that can file one.

const NOW = new Date("2026-07-26T12:00:00.000Z");
const day = 86400000;

describe("the callback ladder widens instead of pestering", () => {
  it("waits 2, then 4, then 7 days", () => {
    expect(callbackDelayDays(1)).toBe(2);
    expect(callbackDelayDays(2)).toBe(4);
    expect(callbackDelayDays(3)).toBe(7);
    expect([...CALLBACK_DAYS]).toEqual([2, 4, 7]);
  });

  it("gets further apart every time — never closer together", () => {
    for (let i = 2; i <= CALLBACK_DAYS.length; i++) {
      expect(callbackDelayDays(i)).toBeGreaterThan(callbackDelayDays(i - 1));
    }
  });

  it("spreads four dials across roughly a fortnight, not a week", () => {
    const span = CALLBACK_DAYS.reduce((n, d) => n + d, 0);
    expect(span).toBeGreaterThanOrEqual(10);
    expect(span).toBeLessThanOrEqual(21);
  });

  it("parks a spent lead a month out rather than dropping it", () => {
    expect(callbackDelayDays(CALLBACK_MAX_ATTEMPTS)).toBe(CALLBACK_PARK_DAYS);
    expect(callbackDelayDays(99)).toBe(CALLBACK_PARK_DAYS);
  });

  it("treats junk attempt counts as the first try instead of throwing", () => {
    expect(callbackDelayDays(0)).toBe(2);
    expect(callbackDelayDays(-3)).toBe(2);
    expect(callbackDelayDays(NaN)).toBe(2);
  });
});

describe("a no-answer is always given a date", () => {
  it("schedules the next dial the right number of days out", () => {
    expect(nextCallbackAt(1, NOW)).toBe(new Date(NOW.getTime() + 2 * day).toISOString());
    expect(nextCallbackAt(3, NOW)).toBe(new Date(NOW.getTime() + 7 * day).toISOString());
  });

  it("never returns an empty value — a missing date reads as 'due now' everywhere", () => {
    for (let i = 1; i <= 10; i++) {
      const at = nextCallbackAt(i, NOW);
      expect(at).toBeTruthy();
      expect(isNaN(new Date(at).getTime())).toBe(false);
      expect(new Date(at).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });
});

describe("knowing when a callback is ready", () => {
  it("is due once the date has passed", () => {
    expect(callbackDue(new Date(NOW.getTime() - day).toISOString(), NOW)).toBe(true);
    expect(callbackDue(NOW.toISOString(), NOW)).toBe(true);
  });

  it("is not due while the date is still ahead", () => {
    expect(callbackDue(new Date(NOW.getTime() + day).toISOString(), NOW)).toBe(false);
  });

  it("treats a never-scheduled or unreadable date as ready, so nothing gets stranded", () => {
    expect(callbackDue(null, NOW)).toBe(true);
    expect(callbackDue(undefined, NOW)).toBe(true);
    expect(callbackDue("", NOW)).toBe(true);
    expect(callbackDue("not a date", NOW)).toBe(true);
  });

  it("reads Postgres' space-separated timestamps, not just ISO", () => {
    expect(callbackDue("2026-07-25 09:00:00", NOW)).toBe(true);
    expect(callbackDue("2026-07-27 09:00:00", NOW)).toBe(false);
  });
});

describe("what the rep is told about a callback", () => {
  it("counts the dial they're about to make, not the one they made", () => {
    expect(callbackLabel(1)).toBe("2nd try");
    expect(callbackLabel(2)).toBe("3rd try");
  });

  it("says it's the last one when the ladder is nearly spent", () => {
    expect(callbackLabel(CALLBACK_MAX_ATTEMPTS - 1)).toBe("Last try");
    expect(callbackLabel(CALLBACK_MAX_ATTEMPTS + 5)).toBe("Last try");
  });

  it("looks forwards, never backwards — a future date is never 'just now'", () => {
    expect(callbackWhen(new Date(NOW.getTime() + 2 * day).toISOString(), NOW)).toBe("in 2 days");
    expect(callbackWhen(new Date(NOW.getTime() + 12 * 3600000).toISOString(), NOW)).toBe("tomorrow");
    expect(callbackWhen(new Date(NOW.getTime() - day).toISOString(), NOW)).toBe("due now");
    expect(callbackWhen(null, NOW)).toBe("due now");
  });

  it("falls back to a plain date once it's weeks away", () => {
    expect(callbackWhen(new Date(NOW.getTime() + 30 * day).toISOString(), NOW)).toMatch(
      /^[A-Z][a-z]{2} \d+$/,
    );
  });
});

describe("why they said no", () => {
  it("offers few enough options to tap between calls", () => {
    expect(NO_REASONS.length).toBeGreaterThanOrEqual(5);
    expect(NO_REASONS.length).toBeLessThanOrEqual(8);
  });

  it("has unique keys and a plain-English label on each", () => {
    const keys = new Set(NO_REASONS.map((r) => r.key));
    expect(keys.size).toBe(NO_REASONS.length);
    for (const r of NO_REASONS) {
      expect(r.label.length).toBeGreaterThan(3);
      expect(r.label.length).toBeLessThan(30);
    }
  });

  it("tells us what to do differently for every reason we can actually fix", () => {
    for (const r of NO_REASONS) {
      if (r.key === "other") continue;
      expect(r.coach.length, `${r.key} needs a fix, not just a count`).toBeGreaterThan(30);
    }
  });

  it("only accepts reasons it knows, so the tally can't be polluted", () => {
    expect(isNoReason("no_budget")).toBe(true);
    expect(isNoReason("whatever")).toBe(false);
    expect(isNoReason(null)).toBe(false);
    expect(noReasonLabel("no_budget")).toBe("Can't afford it");
    expect(noReasonLabel(null)).toBe("Not recorded");
    expect(noReasonCoach("no_budget")).toContain("$299");
  });
});

describe("the tally that turns a pile of nos into a decision", () => {
  const rows = [
    { call_outcome: "not_interested", no_reason: "happy_with_site" },
    { call_outcome: "not_interested", no_reason: "happy_with_site" },
    { call_outcome: "not_interested", no_reason: "no_budget" },
    { call_outcome: "not_interested", no_reason: null },
    { call_outcome: "not_interested", no_reason: "made up" },
    { call_outcome: "interested", no_reason: "no_budget" },
    { call_outcome: null, no_reason: "no_budget" },
  ];

  it("counts only nos, and only recognised reasons", () => {
    const t = tallyNoReasons(rows);
    expect(t.reduce((n, x) => n + x.count, 0)).toBe(3);
  });

  it("puts the commonest reason first — that's the one worth fixing", () => {
    const t = tallyNoReasons(rows);
    expect(t[0].key).toBe("happy_with_site");
    expect(t[0].count).toBe(2);
    expect(t[0].coach.length).toBeGreaterThan(0);
  });

  it("never invents a row for a reason nobody gave", () => {
    expect(tallyNoReasons([])).toEqual([]);
    expect(tallyNoReasons(rows).every((x) => x.count > 0)).toBe(true);
  });
});

// ---------- Source guards ----------
// These behaviours live in server functions and route components that can't run
// under vitest (no DB, no request context, no browser), so we verify the source
// still does the thing rather than deleting the coverage.

const src = (p: string) => readFileSync(join(__dirname, p), "utf8");
const data = src("data.ts");
const schema = src("schema.server.ts");
const calls = src("../../routes/_app/calls.tsx");
const today = src("../../routes/_app/today.tsx");
const companies = src("../../routes/_app/companies.tsx");
const followups = src("../../routes/_app/followups.tsx");
const modal = src("../../components/crm/no-reason-modal.tsx");

function outcomeFn(): string {
  const start = data.indexOf("export const setCompanyCallOutcome ");
  expect(start).toBeGreaterThan(-1);
  const rest = data.slice(start + 10);
  const end = rest.indexOf("export const ");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("setCompanyCallOutcome keeps the ladder honest", () => {
  const body = outcomeFn();

  it("counts the dial and books the next one", () => {
    expect(body).toContain("call_attempts = ?");
    expect(body).toContain("next_call_at = ?");
    expect(body).toContain("nextCallbackAt(attempts");
  });

  it("only ever schedules a callback for a no-answer", () => {
    expect(body).toContain('const isNoAnswer = data.outcome === "no_answer"');
    expect(body).toContain("isNoAnswer ? nextCallbackAt(attempts, new Date()) : null");
  });

  it("resets the count the moment we actually reach them", () => {
    expect(body).toContain("isNoAnswer ? (company.call_attempts ?? 0) + 1 : 0");
  });

  it("stores a reason only for a no, and only a recognised one", () => {
    expect(body).toContain("no_reason = ?");
    expect(body).toContain('data.outcome === "not_interested" && isNoReason(data.no_reason)');
  });

  it("carries the reason onto the lost deal without overwriting a typed one", () => {
    expect(body).toContain("lost_reason = COALESCE(NULLIF(lost_reason, ''), ?)");
  });

  it("still checks the caller may edit this company", () => {
    expect(body).toContain('assertCanEdit(user, "companies", data.id)');
  });
});

describe("the schema carries the new columns and rescues the old no-answers", () => {
  it("adds the callback and reason columns", () => {
    expect(schema).toContain("ADD COLUMN IF NOT EXISTS call_attempts");
    expect(schema).toContain("ADD COLUMN IF NOT EXISTS next_call_at");
    expect(schema).toContain("ADD COLUMN IF NOT EXISTS no_reason");
  });

  it("backfills existing no-answers so they come back one at a time", () => {
    expect(schema).toContain("SET call_attempts = 1");
    expect(schema).toContain("random()");
    // Guarded, so re-running it can never re-schedule a live callback.
    expect(schema).toContain("AND next_call_at IS NULL");
  });
});

describe("the Calls page works the ladder", () => {
  it("lets due callbacks back into the queue", () => {
    expect(calls).toContain("callbackDue(c.next_call_at as string | null, now)");
    expect(calls).toContain("CALLBACK_MAX_ATTEMPTS");
  });

  it("puts callbacks ahead of names nobody has ever rung", () => {
    expect(calls).toContain("(b.attempts > 0 ? 1 : 0) - (a.attempts > 0 ? 1 : 0)");
  });

  it("never holds a booked callback back for lack of research", () => {
    expect(calls).toContain("x.need.worthCalling || x.attempts > 0");
  });

  it("asks why on every no instead of filing it silently", () => {
    expect(calls).toContain("onNo(current)");
    expect(calls).toContain("<NoReasonModal");
    expect(calls).not.toContain('decide("not_interested")');
  });

  it("shows the tally where the nos are being filed", () => {
    expect(calls).toContain("tallyNoReasons");
    expect(calls).toContain("<NoTally");
  });
});

describe("every screen that can file a no asks the same question", () => {
  it("uses one shared modal rather than a copy per page", () => {
    expect(modal).toContain('outcome: "not_interested"');
    for (const [name, file] of [
      ["calls", calls],
      ["companies", companies],
      ["followups", followups],
    ] as const) {
      expect(file, `${name} should import the shared reason modal`).toContain(
        "components/crm/no-reason-modal",
      );
    }
  });

  it("leaves a way to skip — a forced reason would just be a guess", () => {
    expect(modal).toContain("save(null)");
    expect(modal).toContain("Skip");
  });

  it("no longer files a bare not_interested from the row triage or the chase list", () => {
    expect(companies).not.toContain('decide("not_interested")');
    expect(followups).not.toContain('resolve("not_interested")');
  });
});

describe("My Day leads with the sites that broke this week", () => {
  it("finds them through the one shared need classifier", () => {
    expect(today).toContain('needOfRow(c).key === "just_down"');
  });

  it("shows unclaimed ones too — a dead site is worth less by Monday", () => {
    expect(today).toContain("brokeThisWeek");
    expect(today).toContain("Unclaimed");
  });

  it("skips anyone already signed or already said no", () => {
    expect(today).toContain('if (o === "signed" || o === "not_interested") return false;');
  });

  it("puts them in the game plan without listing them twice", () => {
    expect(today).toContain("placed.add(b.row.id as string)");
    expect(today).toContain("!placed.has(x.row.id as string)");
  });
});
