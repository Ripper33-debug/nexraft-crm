import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  leadNeed,
  callOpener,
  opportunityScore,
  NEED_GROUPS,
  needGroupLabel,
  NEED_CALL_MIN,
  NEED_UNKNOWN_RANK,
  type NeedKey,
} from "./constants";

// The whole point of this layer: a rep should never dial a business without a
// true, specific, out-loud sentence about THAT business. Every no we got was an
// instant brush-off, which is what happens when the opener is about us. These
// tests pin the two things that fix it — who we call, and what we say first.

const NOW = new Date("2026-07-26T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 24 * 3600_000).toISOString();

function research(r: Record<string, unknown>): string {
  return JSON.stringify({ angles: [], ...r });
}

describe("leadNeed picks the one true reason to call", () => {
  it("a site that died this week beats everything else", () => {
    const need = leadNeed(
      { website: "https://joesplumbing.com", research: research({ siteStatus: "live" }), siteDownAt: days(2) },
      NOW,
    );
    expect(need.key).toBe("just_down");
    expect(need.rank).toBeGreaterThan(90);
    expect(need.worthCalling).toBe(true);
    expect(need.line).toMatch(/stopped loading/i);
  });

  it("a site that went down months ago is no longer news", () => {
    const need = leadNeed(
      { website: "https://joesplumbing.com", research: research({ siteStatus: "live" }), siteDownAt: days(90) },
      NOW,
    );
    expect(need.key).not.toBe("just_down");
  });

  it("no website at all is the strongest standing signal", () => {
    expect(leadNeed({ website: null }, NOW).key).toBe("no_site");
    expect(leadNeed({ website: "   " }, NOW).key).toBe("no_site");
    expect(leadNeed({ website: "https://x.com", research: research({ siteStatus: "none" }) }, NOW).key).toBe("no_site");
  });

  it("tells an expired domain apart from a site that just won't load", () => {
    const expired = leadNeed(
      { website: "https://gone.com", research: research({ siteStatus: "dead", angles: ["Domain expired — nothing resolves"] }) },
      NOW,
    );
    expect(expired.key).toBe("domain_expired");
    const down = leadNeed({ website: "https://gone.com", research: research({ siteStatus: "dead" }) }, NOW);
    expect(down.key).toBe("site_down");
  });

  it("facebook-only businesses get the social angle", () => {
    const need = leadNeed({ website: "https://facebook.com/joes", tags: "facebook-only", research: research({}) }, NOW);
    expect(need.key).toBe("facebook_only");
  });

  it("picks the strongest defect when a live site has several", () => {
    const need = leadNeed(
      {
        website: "https://joes.com",
        research: research({
          siteStatus: "live",
          angles: ["No contact form", "Not mobile-friendly — no viewport tag", "Built on Wix — free template"],
        }),
      },
      NOW,
    );
    expect(need.key).toBe("builder");
    expect(need.label).toContain("Wix");
    expect(need.line).toContain("Wix");
  });

  it("a brand-new business is worth calling on timing alone, but only while it's new", () => {
    const fresh = leadNeed({ website: "https://new.com", research: research({ siteStatus: "live" }), tags: "new-business", createdAt: days(10) }, NOW);
    expect(fresh.key).toBe("new_business");
    expect(fresh.worthCalling).toBe(true);
    const stale = leadNeed({ website: "https://new.com", research: research({ siteStatus: "live" }), tags: "new-business", createdAt: days(200) }, NOW);
    expect(stale.key).toBe("good_site");
  });

  it("a clean live site is NOT worth interrupting — that's the call we kept losing", () => {
    const need = leadNeed({ website: "https://great.com", research: research({ siteStatus: "live" }) }, NOW);
    expect(need.key).toBe("good_site");
    expect(need.worthCalling).toBe(false);
    expect(need.rank).toBeLessThan(NEED_CALL_MIN);
  });

  it("an un-researched company is held back rather than dialled blind", () => {
    const need = leadNeed({ website: "https://unknown.com" }, NOW);
    expect(need.key).toBe("unknown");
    expect(need.worthCalling).toBe(false);
    expect(need.rank).toBe(NEED_UNKNOWN_RANK);
  });

  // A rep reading these lines aloud is making a claim about the business. A
  // missing or corrupt timestamp must never turn into "your site went down a
  // couple of days ago" or "I saw you just registered".
  it("won't claim a site just went down off a missing or junk timestamp", () => {
    for (const bad of [null, undefined, "", "not-a-date", "0000-00-00"]) {
      const need = leadNeed(
        { website: "https://a.com", research: research({ siteStatus: "live", angles: ["No HTTPS"] }), siteDownAt: bad as string | undefined },
        NOW,
      );
      expect(need.key, String(bad)).not.toBe("just_down");
    }
  });

  it("won't claim a business just opened off a missing or junk created date", () => {
    for (const bad of [null, undefined, "", "not-a-date"]) {
      const need = leadNeed(
        { website: "https://a.com", research: research({ siteStatus: "live" }), tags: "new-business", createdAt: bad as string | undefined },
        NOW,
      );
      expect(need.key, String(bad)).not.toBe("new_business");
    }
  });

  it("survives junk research JSON instead of throwing mid-queue", () => {
    expect(() => leadNeed({ website: "https://x.com", research: "{not json" }, NOW)).not.toThrow();
    expect(leadNeed({ website: "https://x.com", research: "{not json" }, NOW).worthCalling).toBe(false);
  });

  it("every callable need carries a sentence the rep can actually say", () => {
    const cases: { website?: string | null; research?: string; tags?: string; siteDownAt?: string; createdAt?: string }[] = [
      { website: null },
      { website: "https://a.com", research: research({ siteStatus: "live" }), siteDownAt: days(1) },
      { website: "https://a.com", research: research({ siteStatus: "dead" }) },
      { website: "https://a.com", research: research({ siteStatus: "dead", angles: ["Domain expired"] }) },
      { website: "https://a.com", tags: "facebook-only", research: research({}) },
      { website: "https://a.com", research: research({ siteStatus: "live", angles: ["Parked placeholder page"] }) },
      { website: "https://a.com", research: research({ siteStatus: "live", angles: ["Built on Squarespace — free template"] }) },
      { website: "https://a.com", research: research({ siteStatus: "live", angles: ["Copyright stuck at 2015"] }) },
      { website: "https://a.com", research: research({ siteStatus: "live", angles: ["Not mobile-friendly"] }) },
      { website: "https://a.com", research: research({ siteStatus: "live", angles: ["No HTTPS — not secure"] }) },
      { website: "https://a.com", research: research({ siteStatus: "live", angles: ["No online booking"] }) },
      { website: "https://a.com", research: research({ siteStatus: "live" }), tags: "new-business", createdAt: days(3) },
    ];
    for (const c of cases) {
      const need = leadNeed(c, NOW);
      expect(need.worthCalling, JSON.stringify(c)).toBe(true);
      expect(need.rank).toBeGreaterThanOrEqual(NEED_CALL_MIN);
      expect(need.label.length).toBeGreaterThan(3);
      expect(need.line.length).toBeGreaterThan(30);
      // Said out loud to a stranger: it has to be about them, not about us.
      expect(need.line).not.toMatch(/\bNexraft\b/);
      expect(need.line).not.toMatch(/we (build|offer|provide|specialize)/i);
    }
  });

  it("never quotes a price — pricing is a later conversation, and never $100/mo", () => {
    for (const g of NEED_GROUPS) {
      const label = needGroupLabel(g.key);
      expect(label).not.toMatch(/\$/);
      expect(g.blurb).not.toMatch(/\$/);
    }
  });
});

describe("the need groups stay in step with the classifier", () => {
  it("covers every NeedKey the classifier can return, worst first", () => {
    const keys: NeedKey[] = [
      "just_down", "no_site", "domain_expired", "site_down", "facebook_only", "placeholder",
      "builder", "abandoned", "not_mobile", "no_https", "thin_site", "new_business", "unknown", "good_site",
    ];
    expect(NEED_GROUPS.map((g) => g.key).sort()).toEqual([...keys].sort());
    // No duplicates — the Companies page counts one bucket per key.
    expect(new Set(NEED_GROUPS.map((g) => g.key)).size).toBe(NEED_GROUPS.length);
  });

  it("orders the piles the way a rep should work them", () => {
    const rankOf = (k: NeedKey) => {
      const map: Record<string, number> = {
        just_down: 96, no_site: 92, domain_expired: 88, site_down: 86, facebook_only: 80,
        placeholder: 74, builder: 68, abandoned: 62, not_mobile: 58, no_https: 54,
        thin_site: 50, new_business: 46, unknown: 20, good_site: 0,
      };
      return map[k];
    };
    const ranks = NEED_GROUPS.map((g) => rankOf(g.key));
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });
});

describe("callOpener owns the first seven seconds", () => {
  const need = leadNeed({ website: null }, NOW);

  it("names the rep, the company and admits it's a cold call", () => {
    const o = callOpener({ company: "Joe's Plumbing", repFirst: "Barry", need, city: "Naples" });
    expect(o.hook).toContain("Joe's Plumbing");
    expect(o.hook).toContain("Barry");
    expect(o.hook).toMatch(/cold call/i);
    expect(o.hook).toMatch(/twenty seconds|20 seconds/i);
  });

  it("uses the need's own sentence as the one fact", () => {
    const o = callOpener({ company: "Joe's Plumbing", repFirst: "Barry", need });
    expect(o.fact).toBe(need.line);
  });

  it("ends on a question they can answer without committing to anything", () => {
    const o = callOpener({ company: "Joe's Plumbing", repFirst: "Barry", need });
    expect(o.ask.trim().endsWith("?")).toBe(true);
    expect(o.ask).not.toMatch(/\$|price|cost|sign|contract/i);
  });

  it("still produces a usable opener with no rep name and no need", () => {
    const o = callOpener({ company: "Joe's Plumbing" });
    expect(o.hook).toContain("Joe's Plumbing");
    expect(o.hook.length).toBeGreaterThan(20);
    expect(o.fact.length).toBeGreaterThan(10);
    expect(o.ask.trim().endsWith("?")).toBe(true);
  });

  it("never opens with a pitch about us", () => {
    for (const n of [need, leadNeed({ website: "https://a.com", research: research({ siteStatus: "dead" }) }, NOW), null]) {
      const o = callOpener({ company: "Acme", repFirst: "Barry", need: n, industry: "Plumber", city: "Naples" });
      expect(o.fact).not.toMatch(/we (build|design|make) websites/i);
    }
  });
});

describe("the need signal moves the score, so the queue order follows it", () => {
  const base = { createdAt: NOW.toISOString(), industry: "Plumber", city: "Naples" };

  it("a clean site is pushed down hard even when everything else looks good", () => {
    const good = opportunityScore({ ...base, need: leadNeed({ website: "https://great.com", research: research({ siteStatus: "live" }) }, NOW) });
    const plain = opportunityScore({ ...base });
    expect(good.score).toBeLessThan(plain.score);
    expect(good.reasons.join(" ")).toMatch(/already fine|nothing to open/i);
  });

  it("no website beats a clean site by a wide margin", () => {
    const none = opportunityScore({ ...base, need: leadNeed({ website: null }, NOW) });
    const good = opportunityScore({ ...base, need: leadNeed({ website: "https://great.com", research: research({ siteStatus: "live" }) }, NOW) });
    expect(none.score - good.score).toBeGreaterThan(30);
  });

  it("the reason to call is the FIRST thing the rep reads on the card", () => {
    const none = opportunityScore({ ...base, need: leadNeed({ website: null }, NOW) });
    expect(none.reasons[0]).toBe("No website");
  });

  it("an un-researched lead is nudged down, not buried — it just needs a look", () => {
    const unknown = opportunityScore({ ...base, need: leadNeed({ website: "https://x.com" }, NOW) });
    const plain = opportunityScore({ ...base });
    expect(unknown.score).toBeLessThan(plain.score);
    expect(unknown.score).toBeGreaterThan(0);
  });

  it("scores stay inside 0-100 with the need block applied", () => {
    for (const sig of [
      { website: null },
      { website: "https://great.com", research: research({ siteStatus: "live" }) },
      { website: "https://a.com", research: research({ siteStatus: "live" }), siteDownAt: days(1) },
    ]) {
      const s = opportunityScore({ ...base, need: leadNeed(sig, NOW), callOutcome: "interested", source: "Referral", hasPhone: true, hasEmail: true });
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
  });
});

// ---- Source guards: the UI has to keep obeying the classifier ----

describe("the call queue only hands out leads with a reason", () => {
  const calls = readFileSync(join(__dirname, "../../routes/_app/calls.tsx"), "utf8");

  it("uses the shared classifier rather than its own site test", () => {
    expect(calls).toContain("leadNeed({");
    expect(calls).toContain("export function needOf(");
  });

  it("sorts worst-website-first and filters out leads with nothing to say", () => {
    expect(calls).toContain("need.rank");
    expect(calls).toContain("x.need.worthCalling");
  });

  it("shows the rep the exact opening line on the card", () => {
    expect(calls).toContain("need.line");
  });

  it("still lets the rep see the held-back leads on purpose", () => {
    expect(calls).toContain("showAll");
    expect(calls).toContain("held");
  });
});

describe("the Companies page shows what the book is really made of", () => {
  const companies = readFileSync(join(__dirname, "../../routes/_app/companies.tsx"), "utf8");

  it("counts every account into a need bucket from the shared classifier", () => {
    expect(companies).toContain("NEED_GROUPS");
    expect(companies).toContain("export function needOf(");
    expect(companies).toContain("counts.set(n.key");
  });

  it("the old good/weak site dropdown is gone in favour of the signal pills", () => {
    expect(companies).not.toContain("siteFilter");
    expect(companies).not.toContain("Weak, dead, or none");
  });

  it("filtering by a signal narrows the table to that pile", () => {
    expect(companies).toContain("needs.byId.get(c.id as string)?.key === needFilter");
  });

  it("the bulk archive still only offers itself on the nothing-wrong pile", () => {
    expect(companies).toContain('needFilter === "good_site"');
  });
});

describe("pruning can't eat the leads the whole pitch depends on", () => {
  const source = readFileSync(join(__dirname, "data.ts"), "utf8");
  const body = (() => {
    const start = source.indexOf("export const pruneWeakLeads ");
    expect(start, "pruneWeakLeads should exist").toBeGreaterThan(-1);
    const rest = source.slice(start + 10);
    const end = rest.indexOf("export const ");
    return end === -1 ? rest : rest.slice(0, end);
  })();

  it("scores candidates with the same need the rep sees", () => {
    expect(body).toContain("leadNeed({");
    expect(body).toContain("site_down_at");
  });

  it("keeps any lead with a real reason to call, whatever it scores", () => {
    expect(body).toContain("if (need.worthCalling && c.call_outcome !== \"not_interested\") return false;");
  });

  it("still only ever archives — nothing here deletes a row", () => {
    expect(body).toContain("SET archived_at=?");
    expect(body).not.toMatch(/DELETE FROM companies/i);
  });
});

describe("the call script leads with the need, not with us", () => {
  const script = readFileSync(join(__dirname, "../../components/crm/call-mode.tsx"), "utf8");

  it("opens on the first seven seconds and uses callOpener", () => {
    expect(script).toContain("First seven seconds");
    expect(script).toContain("callOpener(");
  });

  it("keeps the warm opener for accounts we already know", () => {
    expect(script).toContain("isWarmAccount");
  });

  it("arms the rep for the instant brush-off, the gatekeeper and 'we already have a site'", () => {
    expect(script).toContain("brushoff");
    expect(script).toContain("gatekeeper");
    expect(script).toContain("howgot");
    expect(script).toContain("We already have a website");
  });
});
