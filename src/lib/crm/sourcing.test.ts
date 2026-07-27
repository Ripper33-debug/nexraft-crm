import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { looksLikeChain, nameKey, candidateDomains, pageProvesBusiness } from "./constants";
import { STATE_TOUR } from "./autodiscover";

// Where the leads come from.
//
// Every "no" this team got traces back to the same place: the radar decided a
// business had no website because OpenStreetMap had no website tag, and nobody
// ever checked. A live Overpass sample of Cape Coral had 184 named businesses,
// 118 of them (64%) with no website tag — and the 22 the radar would have
// imported included Ross, 7-Eleven, and an electrician who has been trading at
// aaaeinc.com for years. Reps opened those calls with a confident false claim.
//
// These tests pin the four things that fix it: don't claim what nobody checked,
// don't call chains, ask the map for need instead of filtering it out
// afterwards, and stay in the state we can actually sell in.

describe("chains never reach a rep's queue", () => {
  it("knows the national brands by name", () => {
    for (const name of [
      "Ross",
      "7-Eleven",
      "Walmart",
      "McDonald's",
      "Subway",
      "Dollar General",
      "AutoZone",
      "Starbucks",
    ]) {
      expect(looksLikeChain({ name }), `${name} should be caught`).toBe(true);
    }
  });

  it("catches numbered branches of the same brand", () => {
    // OSM names outlets "Walgreens 4821", "Publix 122" and so on.
    expect(looksLikeChain({ name: "Walgreens 4821" })).toBe(true);
    expect(looksLikeChain({ name: "Publix 122" })).toBe(true);
  });

  it("catches an outlet whose name IS its brand tag", () => {
    expect(looksLikeChain({ name: "Firehouse Subs", brand: "Firehouse Subs" })).toBe(true);
    expect(looksLikeChain({ name: "Wendy's", operator: "Wendy's" })).toBe(true);
  });

  // All four of these were real Cape Coral listings the first version let past,
  // because it only allowed a numeric suffix after the brand.
  it("catches an outlet with a descriptor bolted on", () => {
    expect(looksLikeChain({ name: "Pizza Hut Express", brand: "Pizza Hut" })).toBe(true);
    expect(looksLikeChain({ name: "AT&T Express Outlet", brand: "AT&T" })).toBe(true);
    expect(looksLikeChain({ name: "Bank of America Financial Center", operator: "Bank of America" })).toBe(true);
    expect(looksLikeChain({ name: "Applebee's", brand: "Applebee's Neighborhood Grill & Bar" })).toBe(true);
  });

  // The other half of that fix. An operator tag is NOT the chain tell a brand
  // tag is — plenty of independents list themselves as their own operator, and
  // treating the two the same threw away a real local arcade.
  it("keeps an independent that lists itself as its own operator", () => {
    expect(looksLikeChain({ name: "Coral Palace Arcade 777", operator: "Coral Palace Arcade" })).toBe(false);
    expect(looksLikeChain({ name: "Real Deal Realty", operator: "Michelle Deal" })).toBe(false);
  });

  // The descriptor list has to stay narrow for the same reason. "Ross Market"
  // is a corner shop; "Ross Outlet" is a Ross.
  it("won't turn a local name into a chain via the descriptor list", () => {
    expect(looksLikeChain({ name: "Ross Market" })).toBe(false);
    expect(looksLikeChain({ name: "Rossiter Roofing" })).toBe(false);
    expect(looksLikeChain({ name: "Subway Tile & Stone" })).toBe(false);
    expect(looksLikeChain({ name: "Shell Point Landscaping" })).toBe(false);
  });

  // The rule that matters. 22 of those 118 Cape Coral businesses carried a
  // brand or operator tag, and a blunt "has a brand tag, drop it" rule would
  // have thrown away real independents — the exact leads we want. A local shop
  // that sells Goodyear tyres is a family business with its own name over the
  // door; a Goodyear outlet is called Goodyear.
  it("keeps independents who merely carry a brand", () => {
    expect(looksLikeChain({ name: "Karry's Automotive", brand: "Goodyear" })).toBe(false);
    expect(looksLikeChain({ name: "De Bono's Stop and Go", brand: "Sunoco" })).toBe(false);
    expect(looksLikeChain({ name: "Abacus Hair Design" })).toBe(false);
    expect(looksLikeChain({ name: "All American Air & Elec Inc" })).toBe(false);
  });

  it("says no to a business with no name rather than guessing", () => {
    expect(looksLikeChain({ name: "" })).toBe(false);
    expect(looksLikeChain({ name: null })).toBe(false);
    expect(looksLikeChain({})).toBe(false);
  });

  it("ignores punctuation and case the way OSM data varies", () => {
    expect(nameKey("McDonald's")).toBe(nameKey("mcdonalds"));
    expect(looksLikeChain({ name: "7 Eleven" })).toBe(true);
    expect(looksLikeChain({ name: "SUBWAY" })).toBe(true);
  });
});

describe("guessing a business's domain before we call them", () => {
  it("tries the obvious joined-up name first", () => {
    expect(candidateDomains("Abacus Hair Design")).toContain("abacushairdesign.com");
  });

  // The one that caught us out: All American Air & Elec Inc trades at
  // aaaeinc.com, which is the initials plus the legal suffix. Without this
  // form we'd have called them to say they had no website.
  it("tries the initials form that real trade businesses use", () => {
    expect(candidateDomains("All American Air & Elec Inc")).toContain("aaaeinc.com");
  });

  it("gives up quietly on a name with nothing to work with", () => {
    expect(candidateDomains("")).toEqual([]);
    expect(candidateDomains(null)).toEqual([]);
  });

  it("stays inside its budget so a probe can't run away", () => {
    const many = candidateDomains("First Second Third Fourth Fifth Sixth Seventh Eighth", 4);
    expect(many.length).toBeLessThanOrEqual(4);
  });
});

describe("a page only counts as theirs if it proves it", () => {
  const biz = { name: "Abacus Hair Design", phone: "(239) 555-0142" };

  it("accepts a page carrying their phone number", () => {
    expect(pageProvesBusiness("<html>Call us on 239-555-0142</html>", biz)).toBe(true);
  });

  it("accepts a page carrying every distinctive word of their name", () => {
    expect(pageProvesBusiness("<title>Abacus Hair Design — Cape Coral</title>", biz)).toBe(true);
  });

  // Both of these would have been recorded as "they have a website", which is
  // just a different wrong answer. Unproven has to stay unproven.
  it("rejects a parked domain and a same-named business elsewhere", () => {
    expect(pageProvesBusiness("<html>This domain is for sale</html>", biz)).toBe(false);
    expect(pageProvesBusiness("<h1>Abacus Consulting, Denver</h1>", biz)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

const dataSrc = readFileSync(join(__dirname, "data.ts"), "utf8");

describe("the map is asked for need, not filtered afterwards", () => {
  it("excludes every spelling of the website tag when asked for siteless only", () => {
    // Overpass only returns the first 80 matches. Missing one spelling lets a
    // business with an obvious website through and burns a slot.
    for (const tag of ["website", "contact:website", "url", "contact:url"]) {
      expect(dataSrc).toContain(`["${tag}"!~".*"]`);
    }
  });

  it("applies the exclusion to both nodes and ways", () => {
    expect(dataSrc).toContain("node[${sel}]${needSel}");
    expect(dataSrc).toContain("way[${sel}]${needSel}");
  });

  it("only narrows for the automated paths, never a person's search", () => {
    // The radar and the nightly sweep discard everything with a website, so
    // narrowing costs them nothing. Someone searching Discover by hand is
    // entitled to the whole street, including live-but-broken sites.
    expect(dataSrc).toContain("sitelessOnly: true");
    expect(dataSrc).toMatch(/const needSel = data\.sitelessOnly/);
  });

  it("drops chains before scoring, deduping or importing", () => {
    const idx = dataSrc.indexOf("looksLikeChain({");
    const mapIdx = dataSrc.indexOf("const tags: Record<string, string> = el.tags ?? {};");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(mapIdx);
  });
});

describe("nobody claims 'no website' until somebody has looked", () => {
  it("goes looking before it writes the claim down", () => {
    const probe = dataSrc.indexOf("await probeForWebsite(");
    const claim = dataSrc.indexOf('siteStatus = "none"');
    expect(probe).toBeGreaterThan(-1);
    // The claim is only reachable from the else-branch of the probe.
    expect(probe).toBeLessThan(claim);
  });

  it("keeps the probe's working out on the dossier", () => {
    // Which domains were tried, and what was found — so a wrong call can be
    // traced back to what we actually did rather than argued about.
    expect(dataSrc).toMatch(/siteProbe\?: \{ checked: string\[\]; found: string \| null; at: string \}/);
  });

  it("writes a website it discovers back onto the company", () => {
    // Finding a site and then not saving it means the next researcher repeats
    // the work and the next rep repeats the mistake.
    expect(dataSrc).toContain("website = COALESCE(NULLIF(website, ''), ?)");
    expect(dataSrc).toContain("d.siteProbe?.found ?? null");
  });

  it("warns the rep off the opener when it finds a site we didn't know about", () => {
    expect(dataSrc).toContain("Never open by saying they haven't got one");
  });

  it("passes the phone through so the probe can prove a match", () => {
    // A page carrying their phone number is the only proof that survives a
    // same-named business in another state.
    expect(dataSrc).toContain("phone: company.phone ?? null");
  });
});

describe("the radar stays where we can actually sell", () => {
  it("only ever tours Florida", () => {
    expect(STATE_TOUR.length).toBeGreaterThan(20);
    for (const stop of STATE_TOUR) {
      expect(stop.query, `${stop.label} should be a Florida stop`).toMatch(/, FL$/);
    }
  });

  it("starts on the home turf in the southwest", () => {
    expect(STATE_TOUR[0].label).toBe("Cape Coral");
    const firstTen = STATE_TOUR.slice(0, 10).map((s) => s.label);
    expect(firstTen).toContain("Fort Myers");
    expect(firstTen).toContain("Naples");
  });

  it("works one metro at a time, not one state at a time", () => {
    // A whole-state bounding box is heavy enough that the public Overpass
    // mirrors routinely time it out, so those sweeps returned nothing at all.
    for (const stop of STATE_TOUR) {
      expect(stop.label).not.toBe("Florida");
    }
    expect(new Set(STATE_TOUR.map((s) => s.label)).size).toBe(STATE_TOUR.length);
  });
});
