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
  isHighBudgetIndustry,
  analyzeSiteHtml,
  canEditRecord,
  canAdministerRecord,
  pickLeastLoaded,
  companyNameKey,
  phoneKey,
  emailKey,
  groupDuplicates,
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

  it("treats a dead website as nearly as strong a signal as no website", () => {
    const noSite = discoveryScore({ hasWebsite: false });
    const deadSite = discoveryScore({ hasWebsite: true, websiteDead: true });
    const liveSite = discoveryScore({ hasWebsite: true, websiteDead: false });
    expect(deadSite.score).toBeGreaterThan(liveSite.score);
    expect(deadSite.score).toBeLessThanOrEqual(noSite.score);
    expect(deadSite.reasons.join(" ")).toContain("down");
  });

  it("unprobed websites score exactly like the plain has-site case", () => {
    const unknown = discoveryScore({ hasWebsite: true, websiteDead: null });
    const plain = discoveryScore({ hasWebsite: true });
    expect(unknown.score).toBe(plain.score);
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

// Duplicate detection: the keys must collapse cosmetic differences without
// collapsing genuinely different records, and grouping must never suggest
// overlapping merges.
describe("duplicate detection", () => {
  it("companyNameKey ignores case, punctuation, and spacing", () => {
    expect(companyNameKey("Joe's Pizza")).toBe(companyNameKey("JOES PIZZA"));
    expect(companyNameKey("A-1 Plumbing ")).toBe(companyNameKey("a1 plumbing"));
    expect(companyNameKey("Joe's Pizza")).not.toBe(companyNameKey("Joe's Pizza Inc"));
    expect(companyNameKey(null)).toBe("");
  });

  it("phoneKey strips formatting and a leading US country code", () => {
    expect(phoneKey("+1 (555) 123-4567")).toBe("5551234567");
    expect(phoneKey("555.123.4567")).toBe("5551234567");
    expect(phoneKey("12345")).toBe("12345"); // short numbers untouched
    expect(phoneKey(null)).toBe("");
  });

  it("emailKey lowercases and trims", () => {
    expect(emailKey(" Bob@Example.COM ")).toBe("bob@example.com");
    expect(emailKey(null)).toBe("");
  });

  it("groups records sharing a key and ignores singles and blanks", () => {
    const rows = [
      { id: "a", name: "Joe's Pizza" },
      { id: "b", name: "Joes Pizza" },
      { id: "c", name: "Unique Co" },
      { id: "d", name: "" },
      { id: "e", name: "" },
    ];
    const groups = groupDuplicates(rows, (r) => [companyNameKey(r.name)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("a record never appears in two groups even when multiple keys match", () => {
    const rows = [
      { id: "a", email: "x@x.com", phone: "555-123-4567" },
      { id: "b", email: "x@x.com", phone: "999-999-9999" },
      { id: "c", email: "y@y.com", phone: "(555) 123-4567" },
    ];
    const groups = groupDuplicates(rows, (r) => [emailKey(r.email), phoneKey(r.phone)]);
    const all = groups.flat().map((r) => r.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it("largest group is listed first", () => {
    const rows = [
      { id: "a", name: "X" },
      { id: "b", name: "x" },
      { id: "c", name: "X!" },
      { id: "d", name: "Y" },
      { id: "e", name: "y" },
    ];
    const groups = groupDuplicates(rows, (r) => [companyNameKey(r.name)]);
    expect(groups[0]).toHaveLength(3);
    expect(groups[1]).toHaveLength(2);
  });
});

describe("analyzeSiteHtml — website quality grading", () => {
  it("flags DIY builders, missing viewport, and stale copyright", () => {
    const html = `<html><head><link href="https://static.wixstatic.com/x.css"></head>
      <body>&copy; 2019 Joe's Roofing</body></html>`;
    const a = analyzeSiteHtml(html, { https: true });
    expect(a.issues.join(" | ")).toContain("Wix");
    expect(a.issues.join(" | ")).toContain("mobile");
    expect(a.issues.join(" | ")).toContain("2019");
  });

  it("passes a clean modern site with no issues", () => {
    const year = new Date().getFullYear();
    const html = `<html><head><meta name="viewport" content="width=device-width"></head>
      <body>© ${year} Fresh Co</body></html>`;
    expect(analyzeSiteHtml(html, { https: true }).issues).toEqual([]);
  });

  it("uses the newest year of a copyright range", () => {
    const year = new Date().getFullYear();
    const html = `<meta name="viewport"> © 2008–${year} Old Timer LLC`;
    expect(analyzeSiteHtml(html, { https: true }).issues).toEqual([]);
  });

  it("flags parked/placeholder pages and missing HTTPS", () => {
    const a = analyzeSiteHtml(`<meta name="viewport"> This domain is parked`, { https: false });
    expect(a.issues.some((i) => i.includes("Placeholder"))).toBe(true);
    expect(a.issues.some((i) => i.includes("HTTPS"))).toBe(true);
  });

  it("extracts a mailto email and a tel phone, skipping junk addresses", () => {
    const html = `<meta name="viewport">
      <img src="hero@2x.png"> sentry@sentry.wixpress.com
      <a href="mailto:Owner@JoesRoofing.com">Email us</a>
      <a href="tel:(239) 555-0188">Call</a> © ${new Date().getFullYear()}`;
    const a = analyzeSiteHtml(html, { https: true });
    expect(a.email).toBe("owner@joesroofing.com");
    expect(a.phone).toBe("(239) 555-0188");
  });

  it("ignores image filenames and tooling noise when no mailto exists", () => {
    const html = `<meta name="viewport"> logo@2x.png trace@sentry.io info@realbusiness.com`;
    expect(analyzeSiteHtml(html, { https: true }).email).toBe("info@realbusiness.com");
  });
});

describe("discoveryScore — website quality + budget signals", () => {
  const base = { rating: null, reviews: null, hasPhone: true };

  it("a live-but-bad site scores above a clean site and below no site", () => {
    const clean = discoveryScore({ ...base, hasWebsite: true, websiteDead: false });
    const bad = discoveryScore({
      ...base,
      hasWebsite: true,
      websiteDead: false,
      websiteIssues: ["Built on Wix — DIY template site", "Not mobile-friendly — no viewport tag"],
    });
    const none = discoveryScore({ ...base, hasWebsite: false });
    expect(bad.score).toBeGreaterThan(clean.score);
    expect(none.score).toBeGreaterThan(bad.score);
  });

  it("surfaces the audited issues as callable reasons", () => {
    const bad = discoveryScore({
      ...base,
      hasWebsite: true,
      websiteDead: false,
      websiteIssues: ["Copyright stuck in 2018 — site looks abandoned"],
    });
    expect(bad.reasons.some((r) => r.includes("2018"))).toBe(true);
  });

  it("high-budget industries outscore ordinary ones", () => {
    const medspa = discoveryScore({ ...base, hasWebsite: false, industry: "Med Spa" });
    const generic = discoveryScore({ ...base, hasWebsite: false, industry: "Thrift store" });
    expect(medspa.score).toBeGreaterThan(generic.score);
  });

  it("isHighBudgetIndustry matches stems and multi-word phrases", () => {
    expect(isHighBudgetIndustry("Med spa")).toBe(true);
    expect(isHighBudgetIndustry("Roofing contractor")).toBe(true);
    expect(isHighBudgetIndustry("Personal injury attorney")).toBe(true);
    expect(isHighBudgetIndustry("Toy store")).toBe(false);
    expect(isHighBudgetIndustry(null)).toBe(false);
  });
});
