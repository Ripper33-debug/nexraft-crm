import { describe, it, expect } from "vitest";

import {
  pipelineValueRange,
  pipelineMrrRange,
  formatRange,
  formatMoney,
  dealCommission,
  salesBonus,
  monthsElapsed,
  opportunityScore,
  opportunityBand,
  discoveryScore,
  isBestFitIndustry,
  canEditRecord,
  canAdministerRecord,
  pickLeastLoaded,
  parseSharedIds,
  parseTags,
  serializeTags,
  normalizeUrl,
  daysBetween,
  ESTIMATE_LOW_BUILD,
  ESTIMATE_HIGH_BUILD,
  ESTIMATE_LOW_MONTHLY,
  ESTIMATE_HIGH_MONTHLY,
  COMMISSION_RATE,
  COMMISSION_MONTHS,
  SALES_BONUS_AMOUNT,
  SALES_BONUS_THRESHOLD,
  OPPORTUNITY_HOT_MIN,
  OPPORTUNITY_WARM_MIN,
} from "./constants";

// These are the numbers that turn into money on someone's paycheck and into the
// forecast the team plans around, so they get real coverage — happy paths,
// boundaries, and the messy inputs (nulls, negatives, bad dates) that reach them
// from the database.

describe("pipelineValueRange", () => {
  it("returns the known value when nothing is unpriced", () => {
    expect(pipelineValueRange(10000, 0)).toEqual({ low: 10000, high: 10000 });
  });

  it("adds the Starter–Pro band for each unpriced deal", () => {
    expect(pipelineValueRange(0, 2)).toEqual({
      low: 2 * ESTIMATE_LOW_BUILD,
      high: 2 * ESTIMATE_HIGH_BUILD,
    });
  });

  it("low never exceeds high", () => {
    const r = pipelineValueRange(5000, 7);
    expect(r.low).toBeLessThanOrEqual(r.high);
  });

  it("clamps negative unpriced counts to zero", () => {
    expect(pipelineValueRange(1000, -3)).toEqual({ low: 1000, high: 1000 });
  });

  it("coerces NaN/undefined inputs to zero instead of producing NaN", () => {
    const r = pipelineValueRange(NaN as unknown as number, undefined as unknown as number);
    expect(Number.isNaN(r.low)).toBe(false);
    expect(Number.isNaN(r.high)).toBe(false);
    expect(r).toEqual({ low: 0, high: 0 });
  });
});

describe("pipelineMrrRange", () => {
  it("adds the monthly band for each unpriced deal", () => {
    expect(pipelineMrrRange(500, 3)).toEqual({
      low: 500 + 3 * ESTIMATE_LOW_MONTHLY,
      high: 500 + 3 * ESTIMATE_HIGH_MONTHLY,
    });
  });
});

describe("formatRange / formatMoney", () => {
  it("collapses to a single value when low === high", () => {
    expect(formatRange(1500, 1500)).toBe(formatMoney(1500));
    expect(formatRange(1500, 1500)).not.toContain("–");
  });

  it("shows a dash-joined range when the ends differ", () => {
    expect(formatRange(1000, 4000)).toContain("–");
  });

  it("formats money with no cents and a $ sign", () => {
    expect(formatMoney(1500)).toBe("$1,500");
  });

  it("treats NaN as $0 rather than '$NaN'", () => {
    expect(formatMoney(NaN as unknown as number)).toBe("$0");
  });
});

describe("dealCommission", () => {
  const SIGNED = "2026-01-15T00:00:00Z";

  it("earns nothing for a one-off build with no monthly retainer", () => {
    expect(dealCommission(0, SIGNED)).toEqual({ earnedMonths: 0, earned: 0, lifetime: 0 });
  });

  it("earns nothing for a negative monthly value", () => {
    expect(dealCommission(-399, SIGNED)).toEqual({ earnedMonths: 0, earned: 0, lifetime: 0 });
  });

  it("earns the first month the day it is signed (month 1)", () => {
    const to = new Date("2026-01-15T00:00:00Z");
    const c = dealCommission(399, SIGNED, to);
    expect(c.earnedMonths).toBe(1);
    expect(c.earned).toBe(Math.round(399 * COMMISSION_RATE * 1)); // 120
  });

  it("accrues one more month per elapsed calendar month", () => {
    const to = new Date("2026-04-15T00:00:00Z"); // 3 months later => month 4
    const c = dealCommission(399, SIGNED, to);
    expect(c.earnedMonths).toBe(4);
    expect(c.earned).toBe(Math.round(399 * COMMISSION_RATE * 4));
  });

  it("caps earned months at the commission window", () => {
    const to = new Date("2030-01-15T00:00:00Z"); // years later
    const c = dealCommission(399, SIGNED, to);
    expect(c.earnedMonths).toBe(COMMISSION_MONTHS);
  });

  it("returns whole-dollar amounts (no fractional cents)", () => {
    // 399 * 0.3 = 119.7 — the exact case that used to leak cents into payroll.
    const c = dealCommission(399, SIGNED, new Date("2026-01-15T00:00:00Z"));
    expect(Number.isInteger(c.earned)).toBe(true);
    expect(Number.isInteger(c.lifetime)).toBe(true);
  });

  it("projects lifetime as the full-window ceiling", () => {
    const c = dealCommission(399, SIGNED, new Date("2026-01-15T00:00:00Z"));
    expect(c.lifetime).toBe(Math.round(399 * COMMISSION_RATE * COMMISSION_MONTHS));
    expect(c.lifetime).toBeGreaterThanOrEqual(c.earned);
  });

  it("treats a missing signed date as month 1 (never crashes)", () => {
    const c = dealCommission(399, null);
    expect(c.earnedMonths).toBe(1);
  });
});

describe("monthsElapsed", () => {
  it("is 0 on the signing day", () => {
    expect(monthsElapsed("2026-01-15", new Date("2026-01-15T12:00:00Z"))).toBe(0);
  });

  it("does not count a month until the day-of-month is reached", () => {
    expect(monthsElapsed("2026-01-15", new Date("2026-02-14T00:00:00Z"))).toBe(0);
    expect(monthsElapsed("2026-01-15", new Date("2026-02-15T00:00:00Z"))).toBe(1);
  });

  it("never returns a negative number for future dates", () => {
    expect(monthsElapsed("2027-01-15", new Date("2026-01-15T00:00:00Z"))).toBe(0);
  });

  it("returns 0 for null or malformed input", () => {
    expect(monthsElapsed(null)).toBe(0);
    expect(monthsElapsed("not-a-date")).toBe(0);
  });
});

describe("salesBonus", () => {
  it("pays nothing below the monthly signing threshold", () => {
    expect(salesBonus({ "2026-07": SALES_BONUS_THRESHOLD - 1 })).toEqual({
      earned: 0,
      month: null,
    });
  });

  it("pays the flat bonus the first month the threshold is met", () => {
    expect(salesBonus({ "2026-07": SALES_BONUS_THRESHOLD })).toEqual({
      earned: SALES_BONUS_AMOUNT,
      month: "2026-07",
    });
  });

  it("is one-time: awards the earliest qualifying month only", () => {
    const r = salesBonus({ "2026-09": 9, "2026-07": 6, "2026-08": 5 });
    expect(r.earned).toBe(SALES_BONUS_AMOUNT);
    expect(r.month).toBe("2026-07"); // chronologically first, not the biggest
  });

  it("handles an empty history", () => {
    expect(salesBonus({})).toEqual({ earned: 0, month: null });
  });
});

describe("opportunityScore", () => {
  it("stays within 0–100", () => {
    const hot = opportunityScore({
      source: "referral",
      callOutcome: "interested",
      industry: "Dental clinic",
      hasPhone: true,
      hasEmail: true,
      createdAt: new Date().toISOString(),
    });
    expect(hot.score).toBeGreaterThanOrEqual(0);
    expect(hot.score).toBeLessThanOrEqual(100);
    expect(hot.band).toBe("hot");
  });

  it("never drops below 0 even with all negative signals", () => {
    const cold = opportunityScore({ callOutcome: "not_interested" });
    expect(cold.score).toBeGreaterThanOrEqual(0);
  });

  it("bands line up with their thresholds", () => {
    expect(opportunityBand(OPPORTUNITY_HOT_MIN)).toBe("hot");
    expect(opportunityBand(OPPORTUNITY_WARM_MIN)).toBe("warm");
    expect(opportunityBand(OPPORTUNITY_WARM_MIN - 1)).toBe("cool");
  });

  it("gives a plain-English reason for every scored lead", () => {
    const s = opportunityScore({ hasEmail: true });
    expect(s.reasons.length).toBeGreaterThan(0);
  });
});

describe("discoveryScore", () => {
  it("rewards a business with no website most heavily", () => {
    const noSite = discoveryScore({ hasWebsite: false });
    const hasSite = discoveryScore({ hasWebsite: true });
    expect(noSite.score).toBeGreaterThan(hasSite.score);
  });

  it("does not penalise sources that report no review data", () => {
    const withReviews = discoveryScore({ hasWebsite: false, reviews: 0 });
    const noReviewData = discoveryScore({ hasWebsite: false, reviews: null });
    expect(noReviewData.score).toBeGreaterThan(withReviews.score);
  });
});

describe("isBestFitIndustry", () => {
  it("matches on a loose case-insensitive substring", () => {
    expect(isBestFitIndustry("Family Dental Care")).toBe(true);
    expect(isBestFitIndustry("JOE'S DENTISTRY")).toBe(true);
  });

  it("is false for empty or unrelated industries", () => {
    expect(isBestFitIndustry("")).toBe(false);
    expect(isBestFitIndustry(null)).toBe(false);
    expect(isBestFitIndustry("Aerospace Manufacturing")).toBe(false);
  });
});

describe("canEditRecord / canAdministerRecord", () => {
  const admin = { id: "u-admin", role: "admin" };
  const owner = { id: "u-owner", role: "rep" };
  const other = { id: "u-other", role: "rep" };

  it("locks out a logged-out user", () => {
    expect(canEditRecord(null, "u-owner", null)).toBe(false);
  });

  it("lets an admin edit anything", () => {
    expect(canEditRecord(admin, "u-owner", null)).toBe(true);
  });

  it("lets the owner edit their own record", () => {
    expect(canEditRecord(owner, "u-owner", null)).toBe(true);
  });

  it("blocks a non-owner who is not shared with", () => {
    expect(canEditRecord(other, "u-owner", null)).toBe(false);
  });

  it("lets a shared collaborator edit", () => {
    expect(canEditRecord(other, "u-owner", "u-other, u-someone")).toBe(true);
  });

  it("treats an unowned record as open to all signed-in users", () => {
    expect(canEditRecord(other, null, null)).toBe(true);
  });

  it("only lets owner or admin administer (hand off / reshare)", () => {
    expect(canAdministerRecord(admin, "u-owner")).toBe(true);
    expect(canAdministerRecord(owner, "u-owner")).toBe(true);
    expect(canAdministerRecord(other, "u-owner")).toBe(false);
  });
});

describe("pickLeastLoaded", () => {
  it("returns null when nobody is eligible", () => {
    expect(pickLeastLoaded([])).toBe(null);
  });

  it("always picks the lightest-loaded rep", () => {
    const reps = [
      { id: "a", name: "A", open_deals: 5 },
      { id: "b", name: "B", open_deals: 2 },
      { id: "c", name: "C", open_deals: 9 },
    ];
    expect(pickLeastLoaded(reps)?.id).toBe("b");
  });

  it("breaks ties among the lightest only", () => {
    const reps = [
      { id: "a", name: "A", open_deals: 1 },
      { id: "b", name: "B", open_deals: 1 },
      { id: "c", name: "C", open_deals: 7 },
    ];
    for (let i = 0; i < 25; i++) {
      const picked = pickLeastLoaded(reps);
      expect(["a", "b"]).toContain(picked?.id);
    }
  });

  it("spreads a batch evenly when callers bump the winner's load", () => {
    const reps = [
      { id: "a", name: "A", open_deals: 0 },
      { id: "b", name: "B", open_deals: 0 },
      { id: "c", name: "C", open_deals: 0 },
    ];
    // Simulate redistributePool assigning 30 leads.
    for (let i = 0; i < 30; i++) {
      const rep = pickLeastLoaded(reps);
      expect(rep).not.toBe(null);
      rep!.open_deals++;
    }
    // Perfectly even split: 10 each.
    expect(reps.map((r) => r.open_deals)).toEqual([10, 10, 10]);
  });
});

describe("small parsing/formatting helpers", () => {
  it("parseSharedIds trims and drops empties", () => {
    expect(parseSharedIds(" a , b ,, c ")).toEqual(["a", "b", "c"]);
    expect(parseSharedIds(null)).toEqual([]);
  });

  it("tags round-trip through serialize/parse", () => {
    const tags = ["Retainer", "VIP"];
    expect(parseTags(serializeTags(tags))).toEqual(tags);
    expect(parseTags(null)).toEqual([]);
  });

  it("normalizeUrl adds https:// only when missing a scheme", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
    expect(normalizeUrl("http://example.com")).toBe("http://example.com");
    expect(normalizeUrl("https://example.com")).toBe("https://example.com");
  });

  it("daysBetween returns 0 for null/malformed dates", () => {
    expect(daysBetween(null)).toBe(0);
    expect(daysBetween("nonsense")).toBe(0);
  });
});

// Guard rails on the business constants themselves, so a careless edit that,
// say, sets the commission rate to 3 (300%) trips a test instead of a payroll.
describe("business constants stay sane", () => {
  it("commission rate is a fraction between 0 and 1", () => {
    expect(COMMISSION_RATE).toBeGreaterThan(0);
    expect(COMMISSION_RATE).toBeLessThan(1);
  });

  it("the estimate band is ordered low <= high", () => {
    expect(ESTIMATE_LOW_BUILD).toBeLessThanOrEqual(ESTIMATE_HIGH_BUILD);
    expect(ESTIMATE_LOW_MONTHLY).toBeLessThanOrEqual(ESTIMATE_HIGH_MONTHLY);
  });

  it("hot threshold is above warm threshold", () => {
    expect(OPPORTUNITY_HOT_MIN).toBeGreaterThan(OPPORTUNITY_WARM_MIN);
  });
});
