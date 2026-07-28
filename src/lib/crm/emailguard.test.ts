import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { emailHistory, EMAIL_RECENT_DAYS, EMAIL_SEQUENCE_LENGTH } from "./constants";

// Barry, sitting in front of the CRM: "I was about to email a company and
// realized I already did and it didn't tell me."
//
// The count and the date were both in the database the whole time, bumped on
// every send. Exactly one screen read them. So the CRM knew the answer to
// "have I written to this lot before?" and kept it to itself on every screen
// where somebody decides to write.
//
// These tests pin the shared answer every screen now renders, and the rule
// that it warns without ever blocking — a fourth email can be the right call,
// and only the person writing it knows.

const NOW = new Date("2026-07-27T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600_000).toISOString();

describe("what we've already sent them", () => {
  it("says nothing at all about a company we've never emailed", () => {
    // Most rows. A badge on every one of them is wallpaper, and wallpaper is
    // what you stop seeing — which is how this got missed in the first place.
    expect(emailHistory({ email_touches: 0, last_emailed_at: null })).toBeNull();
    expect(emailHistory({})).toBeNull();
    expect(emailHistory(null)).toBeNull();
    expect(emailHistory(undefined)).toBeNull();
  });

  it("gives the count AND the date, because the count alone shrugs", () => {
    const h = emailHistory({ email_touches: 3, last_emailed_at: daysAgo(4) }, NOW);
    expect(h?.label).toContain("3×");
    expect(h?.label).toContain("4d ago");
  });

  it("goes loud while the last email is still warm", () => {
    expect(emailHistory({ email_touches: 1, last_emailed_at: daysAgo(2) }, NOW)?.recent).toBe(true);
    expect(emailHistory({ email_touches: 1, last_emailed_at: daysAgo(EMAIL_RECENT_DAYS - 1) }, NOW)?.recent).toBe(true);
    // Emailed them in the spring is context, not a warning. Treating it as one
    // trains the rep to click past the banner, which costs us the real ones.
    expect(emailHistory({ email_touches: 1, last_emailed_at: daysAgo(90) }, NOW)?.recent).toBe(false);
  });

  it("knows when the sequence is spent", () => {
    expect(emailHistory({ email_touches: EMAIL_SEQUENCE_LENGTH - 1, last_emailed_at: daysAgo(40) }, NOW)?.exhausted).toBe(false);
    const done = emailHistory({ email_touches: EMAIL_SEQUENCE_LENGTH, last_emailed_at: daysAgo(40) }, NOW);
    expect(done?.exhausted).toBe(true);
    expect(done?.advice).toMatch(/call them/i);
  });

  it("tells a fresh cold email apart from the next one in a sequence", () => {
    const warm = emailHistory({ email_touches: 1, last_emailed_at: daysAgo(3) }, NOW);
    expect(warm?.advice).toMatch(/sequence/i);
    // Nothing useful to say beats saying something useless.
    expect(emailHistory({ email_touches: 1, last_emailed_at: daysAgo(200) }, NOW)?.advice).toBe("");
  });

  it("survives a missing or junk date rather than rendering 'last NaN ago'", () => {
    for (const bad of [null, undefined, "", "not-a-date"]) {
      const h = emailHistory({ email_touches: 2, last_emailed_at: bad as string | null }, NOW);
      expect(h?.touches).toBe(2);
      expect(h?.label).not.toMatch(/NaN|Invalid/);
    }
  });

  it("never treats a junk count as history", () => {
    for (const bad of [null, undefined, -3, "" as unknown as number, "x" as unknown as number]) {
      expect(emailHistory({ email_touches: bad as number | null })).toBeNull();
    }
  });
});

// ---- Source guards: the history has to be visible where the decision happens ----

const src = (p: string) => readFileSync(join(__dirname, p), "utf8");

describe("the history shows up everywhere somebody might write", () => {
  it("is selected onto the shared company row, not just the Follow-ups query", () => {
    // The columns were always in `SELECT c.*`. They just weren't declared, so
    // every screen but one was typed blind to them.
    const data = src("data.ts");
    expect(data).toMatch(/email_touches: number \| null;/);
    expect(data).toMatch(/last_emailed_at: string \| null;/);
  });

  it("shows on the Companies list", () => {
    expect(src("../../routes/_app/companies.tsx")).toContain("<EmailedBadge company={c}");
  });

  it("shows on the company page, next to the Email button", () => {
    expect(src("../../routes/_app/companies_.$companyId.tsx")).toContain("<EmailedBadge company={c}");
  });

  it("shows on the call card, with something for the rep to say about it", () => {
    const calls = src("../../routes/_app/calls.tsx");
    expect(calls).toContain("<EmailedBadge company={current}");
    expect(calls).toContain("You've emailed them");
  });

  it("warns above the composer, before the draft is written", () => {
    const f = src("../../routes/_app/followups.tsx");
    expect(f).toContain("selectedHistory");
    expect(f).toContain("You've already emailed");
  });

  it("never blocks the send", () => {
    // The guard is information. A follow-up is a good email, and a CRM that
    // refuses to send one is a CRM people work around.
    const f = src("../../routes/_app/followups.tsx");
    expect(f).not.toMatch(/disabled=\{[^}]*selectedHistory/);
    expect(f).toContain("const canSend = to.trim().includes(\"@\")");
  });
});

describe("the book gets re-checked instead of staying a guess", () => {
  const data = src("data.ts");

  it("only picks up companies nobody has probed", () => {
    expect(data).toContain(`research NOT LIKE '%"siteProbe":%'`);
    expect(data).toContain("(website IS NULL OR btrim(website) = '')");
  });

  it("runs nightly off the cron with no button to remember", () => {
    expect(data).toContain("recheckUnverifiedSitesWithin(15_000, 10)");
  });

  it("stamps the probe either way, so a confirmed no-site lead gets promoted", () => {
    expect(data).toContain("dossier.siteProbe = {");
    expect(data).toContain('dossier.siteStatus = "none"');
  });

  it("saves a site it finds and says so in the thread", () => {
    expect(data).toContain("website = COALESCE(NULLIF(website, ''), ?)");
    expect(data).toContain("Do not open by saying they haven't got one.");
  });

  it("leaves a company alone when the probe fails, so tomorrow retries", () => {
    // Junk research JSON returns before anything is written.
    expect(data).toContain("return; // junk JSON — leave it alone");
  });
});

describe("the AI never writes a claim we haven't earned", () => {
  it("tells the model when the website status is unverified", () => {
    const ai = src("ai.server.ts");
    expect(ai).toContain("UNVERIFIED");
    expect(ai).toContain("do not state or imply they have no website");
  });

  it("bumps the prompt version so the bad drafts already stored get rewritten", () => {
    // Without this, every email written under the old prompt keeps its false
    // opening line and goes out anyway.
    // v4 (2026-07-27): no price at all, free-mockup offer, enforced
    // per-business specificity. Bumping this is the delivery mechanism — it's
    // what makes the nightly pass rewrite the drafts already sitting in the DB.
    expect(src("ai.server.ts")).toContain("export const AI_PROMPT_VERSION = 4;");
  });

  it("stops the fit scorer inferring 'no website' from a blank column", () => {
    const data = src("data.ts");
    expect(data).toContain("nobody has checked; do not assume they have none");
  });
});
