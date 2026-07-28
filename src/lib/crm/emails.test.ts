import { describe, it, expect } from "vitest";

import {
  aiDraftFromResearch,
  draftQualityIssue,
  EMAIL_TEMPLATES,
  followUpEmail,
  friendlyCompanyName,
  mailtoLink,
  mockupAsk,
  outreachFacts,
  specificityTokens,
  specificOpener,
  tradeWord,
} from "./emails";

// The outreach copy is tuned for replies: short enough to read on a phone,
// one question, an easy out, and a breakup email as the final touch. These
// tests pin the reply-rate properties without pinning every word.

const words = (s: string) => s.trim().split(/\s+/).length;

// The rows a real send actually uses. Testing only the bare-name case is how
// the length limit quietly broke on 2026-07-27: the tailored copy is the LONG
// copy, so every one of these branches has to fit on a phone too.
const ROWS: Record<string, Record<string, unknown>> = {
  "bare name only": { name: "Mills Plumbing LLC" },
  "full dossier": {
    name: "Mills Plumbing LLC",
    city: "Naples",
    industry: "Plumbing",
    research: JSON.stringify({
      rating: 4.9,
      reviews: 128,
      established: "1998",
      services: ["Water heaters"],
      people: ["Dale Mills"],
    }),
  },
  "dead site": {
    name: "Mills Plumbing LLC",
    city: "Naples",
    industry: "Plumbing",
    research: JSON.stringify({ siteStatus: "dead", rating: 4.9, reviews: 128 }),
  },
  "no site, probe ran": {
    name: "Mills Plumbing LLC",
    city: "Naples",
    industry: "Plumbing",
    research: JSON.stringify({ siteStatus: "none", siteProbe: { at: "2026-07-27" } }),
  },
};

describe("follow-up nudges are built to get replies", () => {
  it("every nudge fits on a phone screen (under 100 words) — for every dossier", () => {
    for (const [label, row] of Object.entries(ROWS)) {
      for (const touch of [1, 2, 3]) {
        const d = followUpEmail(row, "Michael Farina", touch);
        expect(words(d.body), `${label} / nudge ${touch} word count`).toBeLessThan(100);
      }
      for (const id of ["intro", "followup"]) {
        const tpl = EMAIL_TEMPLATES.find((t) => t.id === id)!;
        const d = tpl.build({ company: String(row.name), firstName: null, repName: "Michael Farina", row });
        expect(words(d.body), `${label} / ${id} word count`).toBeLessThan(100);
      }
    }
  });
  it("every nudge asks exactly one thing and gives an easy out", () => {
    for (const touch of [1, 2, 3]) {
      const d = followUpEmail("Joe's Plumbing", "Michael Farina", touch);
      // There's either a direct question or an explicit "reply with a word" ask.
      expect(d.body).toMatch(/\?|reply/i);
      // No corporate throat-clearing.
      expect(d.body.toLowerCase()).not.toContain("hope this finds you");
      expect(d.body.toLowerCase()).not.toContain("love to connect");
    }
  });
  it("the final touch is a breakup email — closing the file, not another pitch", () => {
    const d = followUpEmail("Joe's Plumbing", "Mike", 3);
    expect(d.subject.toLowerCase()).toContain("closing");
    expect(d.body.toLowerCase()).toContain("closing the file");
  });
  it("personalizes with the company and the rep's first name", () => {
    const d = followUpEmail("Joe's Plumbing", "Michael Farina", 1);
    // Subjects are lowercase on purpose — the way a person in town types one.
    expect(d.subject.toLowerCase()).toContain("joe's plumbing");
    expect(d.body).toContain("Joe's Plumbing");
    expect(d.body).toContain("Michael Farina");
  });
});

// Owner's rule, 2026-07-27: "dont discuss price." A number in a first email
// gets argued with before anything has been shown — the offer is a free
// mockup, and the price conversation happens after they've seen it. These are
// the tests that stop a future edit from quietly putting a number back.
describe("first-touch outreach never discusses money", () => {
  const MONEY = /\$\s?\d/;
  const PRICE_TALK = [
    "plans start",
    "plans from",
    "starting at",
    "per month",
    "a month",
    "/month",
    "/mo",
    "monthly fee",
    "our pricing",
    "affordable",
  ];
  const isColdOutreach = (id: string) => id === "intro" || id === "followup";

  it("no nudge quotes a price of any kind", () => {
    for (const touch of [1, 2, 3]) {
      const body = followUpEmail("Joe's Plumbing", "Mike", touch).body;
      expect(body, `nudge ${touch}`).not.toMatch(MONEY);
      for (const phrase of PRICE_TALK) {
        expect(body.toLowerCase(), `nudge ${touch} / "${phrase}"`).not.toContain(phrase);
      }
    }
  });
  it("no cold template quotes a price of any kind", () => {
    for (const tpl of EMAIL_TEMPLATES.filter((t) => isColdOutreach(t.id))) {
      const d = tpl.build({ company: "Ana's Bakery", firstName: "Ana", repName: "Brady" });
      expect(`${d.subject}\n${d.body}`, tpl.id).not.toMatch(MONEY);
      for (const phrase of PRICE_TALK) {
        expect(d.body.toLowerCase(), `${tpl.id} / "${phrase}"`).not.toContain(phrase);
      }
    }
  });
  it("every cold email offers the free mockup instead", () => {
    for (const touch of [1, 2, 3]) {
      expect(followUpEmail("Joe's Plumbing", "Mike", touch).body.toLowerCase(), `nudge ${touch}`).toContain(
        "mockup",
      );
    }
    for (const tpl of EMAIL_TEMPLATES.filter((t) => isColdOutreach(t.id))) {
      const d = tpl.build({ company: "Ana's Bakery", firstName: "Ana", repName: "Brady" });
      expect(d.body.toLowerCase(), tpl.id).toContain("mockup");
      expect(d.body.toLowerCase(), `${tpl.id} says it's free`).toContain("free");
    }
  });
  it("the post-conversation templates may still talk money — that's the point of them", () => {
    // quote/proposal_chase happen AFTER a real conversation, so pricing is
    // expected there. This test exists so the rule above is never widened into
    // them by accident.
    const quote = EMAIL_TEMPLATES.find((t) => t.id === "quote")!;
    expect(quote.build({ company: "Ana's Bakery", firstName: "Ana", repName: "Brady" }).body).toContain("pricing");
  });
});

describe("outreach reads like a person wrote it (the 2026-07-21 screenshot fixes)", () => {
  it("friendlyCompanyName strips legal suffixes, even stacked ones", () => {
    expect(friendlyCompanyName("Mills Plumbing & Drain Cleaning LLC")).toBe("Mills Plumbing & Drain Cleaning");
    expect(friendlyCompanyName("Z Plumber, Inc.")).toBe("Z Plumber");
    expect(friendlyCompanyName("Plumbing Solutions of Southwest Florida, LLC")).toBe(
      "Plumbing Solutions of Southwest Florida",
    );
    expect(friendlyCompanyName("Sunshine Pools Co., Inc.")).toBe("Sunshine Pools");
    // Names that just end in suffix-looking words are left alone.
    expect(friendlyCompanyName("Joe's Plumbing")).toBe("Joe's Plumbing");
    expect(friendlyCompanyName("Pasco")).toBe("Pasco");
  });
  it("templates never show the legal suffix in subject or body", () => {
    for (const tpl of EMAIL_TEMPLATES) {
      const d = tpl.build({ company: "Mills Plumbing & Drain Cleaning LLC", firstName: null, repName: "Barry" });
      expect(d.subject, tpl.id).not.toContain("LLC");
      expect(d.body, tpl.id).not.toContain("LLC");
    }
    expect(followUpEmail("Z Plumber, Inc.", "Barry", 1).body).not.toContain("Inc");
  });
  it('never greets a placeholder contact by "name" — no more "Hi Office /,"', () => {
    const intro = EMAIL_TEMPLATES.find((t) => t.id === "intro")!;
    for (const bad of ["Office /", "Office", "Main", "info", null, ""]) {
      const d = intro.build({ company: "Mills Plumbing LLC", firstName: bad, repName: "Barry" });
      expect(d.body, `first name: ${JSON.stringify(bad)}`).toContain("Hi there,");
      expect(d.body).not.toContain("Hi Office");
    }
    // A real first name still gets used.
    expect(intro.build({ company: "Ana's Bakery", firstName: "Ana", repName: "Barry" }).body).toContain("Hi Ana,");
  });
  it("never claims the rep lives in the prospect's exact town", () => {
    // The reps are spread across southwest Florida; "I'm in Cape Coral too" is
    // a coin-flip lie the moment the prospect is a town over.
    const body = followUpEmail({ name: "X", city: "Cape Coral" }, "Barry", 2).body;
    expect(body).toContain("up the road from Cape Coral");
    expect(body).not.toMatch(/I'm in Cape Coral/);
    expect(followUpEmail({ name: "X" }, "Barry", 2).body).toContain("in southwest Florida");
  });
  it("greets the owner by name when the dossier turned one up", () => {
    const row = { name: "Mills Plumbing LLC", research: JSON.stringify({ people: ["Dale Mills"] }) };
    expect(followUpEmail(row, "Barry", 1).body.startsWith("Dale —")).toBe(true);
  });
  it("no template or nudge uses the cold-email cliché subjects", () => {
    const nudge2 = followUpEmail("Joe's Plumbing", "Mike", 2);
    expect(nudge2.subject.toLowerCase()).not.toContain("quick question");
    for (const tpl of EMAIL_TEMPLATES) {
      const d = tpl.build({ company: "Ana's Bakery", firstName: "Ana", repName: "Barry" });
      expect(d.subject.toLowerCase(), tpl.id).not.toContain("quick question");
    }
  });
});

describe("cold composer templates stay short and reply-first", () => {
  it("intro and follow-up are under 100 words with a question", () => {
    for (const id of ["intro", "followup"]) {
      const tpl = EMAIL_TEMPLATES.find((t) => t.id === id)!;
      const d = tpl.build({ company: "Ana's Bakery", firstName: "Ana", repName: "Brady Boak" });
      expect(words(d.body), `${id} word count`).toBeLessThan(100);
      expect(d.body).toMatch(/\?|reply/i);
      expect(d.body).toContain("Ana");
    }
  });
});

// ---- The tailoring layer ----------------------------------------------------
// Owner's ask, 2026-07-27: "i want every email tailored to each business."
// These pin the facts the copy is built from, and — just as importantly —
// what we refuse to claim when nobody actually checked.

describe("outreachFacts pulls the tailoring material out of a company row", () => {
  it("reads name, city, trade and the dossier facts", () => {
    const f = outreachFacts({
      name: "Mills Plumbing & Drain Cleaning LLC",
      city: "Cape Coral",
      industry: "Plumbing",
      research: JSON.stringify({
        rating: 4.9,
        reviews: 128.4,
        established: "1998",
        services: ["Drain cleaning", "Water heaters"],
        people: ["Dale Mills", "Rita Mills"],
        siteStatus: "dead",
      }),
    });
    expect(f.company).toBe("Mills Plumbing & Drain Cleaning");
    expect(f.city).toBe("Cape Coral");
    expect(f.trade).toBe("plumber");
    expect(f.rating).toBe(4.9);
    expect(f.reviews).toBe(128); // review counts are whole numbers
    expect(f.established).toBe("1998");
    expect(f.service).toBe("Drain cleaning");
    expect(f.ownerFirst).toBe("Dale");
    expect(f.siteStatus).toBe("dead");
  });
  it("takes an already-parsed dossier too (getCompanies rows)", () => {
    expect(outreachFacts({ name: "Ana's Bakery", research: { rating: 4.7 } }).rating).toBe(4.7);
  });
  it("never throws on junk, missing or half-written dossiers", () => {
    for (const research of [null, undefined, "", "not json{", "[]", 7, JSON.stringify({ rating: "abc" })]) {
      const f = outreachFacts({ name: "Ana's Bakery LLC", research });
      expect(f.company).toBe("Ana's Bakery");
      expect(f.rating).toBeNull();
    }
    expect(outreachFacts(null).company).toBe("your business");
    expect(outreachFacts({}).company).toBe("your business");
  });
  it("ignores non-string row fields instead of stringifying them", () => {
    const f = outreachFacts({ name: 42, city: null, industry: { x: 1 } });
    expect(f.company).toBe("your business");
    expect(f.city).toBeNull();
    expect(f.trade).toBeNull();
  });
  it('only believes "no website" when the probe actually ran', () => {
    // The whole point of the site-probe work: an unchecked blank is not proof.
    expect(outreachFacts({ name: "X", research: JSON.stringify({ siteStatus: "none" }) }).siteStatus).toBeNull();
    expect(
      outreachFacts({ name: "X", research: JSON.stringify({ siteStatus: "none", siteProbe: { at: "now" } }) })
        .siteStatus,
    ).toBe("none");
  });
});

describe("tradeWord says the trade the way a neighbour would", () => {
  it("maps directory categories to person-nouns", () => {
    expect(tradeWord("Plumbing")).toBe("plumber");
    expect(tradeWord("roofing")).toBe("roofer");
    expect(tradeWord("Lawn Care")).toBe("lawn guy");
  });
  it("keeps acronyms uppercase and makes them hireable — 'an HVAC company', not 'a hvac'", () => {
    expect(tradeWord("HVAC")).toBe("HVAC company");
  });
  it("falls through lowercased, and returns null for nothing", () => {
    expect(tradeWord("Mobile Detailing")).toBe("mobile detailing");
    expect(tradeWord("")).toBeNull();
    expect(tradeWord(null)).toBeNull();
  });
});

describe("specificOpener leads with the most specific TRUE thing we know", () => {
  const base = { name: "Mills Plumbing", city: "Naples", industry: "Plumbing" };
  it("a dead site outranks everything — it's the most urgent fact", () => {
    const f = outreachFacts({ ...base, research: JSON.stringify({ siteStatus: "dead", rating: 4.9, reviews: 90 }) });
    expect(specificOpener(f).toLowerCase()).toContain("isn't loading");
  });
  it("uses their rating and review count when there's no site problem", () => {
    const f = outreachFacts({ ...base, research: JSON.stringify({ rating: 4.9, reviews: 128 }) });
    const o = specificOpener(f);
    expect(o).toContain("4.9");
    expect(o).toContain("128");
    expect(o).toContain("Naples");
  });
  it("falls back through founding year, then a named service, then the trade", () => {
    expect(specificOpener(outreachFacts({ ...base, research: JSON.stringify({ established: "1998" }) }))).toContain(
      "1998",
    );
    expect(
      specificOpener(outreachFacts({ ...base, research: JSON.stringify({ services: ["Water heaters"] }) })),
    ).toContain("water heaters");
    expect(specificOpener(outreachFacts(base))).toContain("plumber");
  });
  it("never claims a business has no website unless the probe proved it", () => {
    const unchecked = specificOpener(outreachFacts({ ...base, research: JSON.stringify({ siteStatus: "none" }) }));
    expect(unchecked.toLowerCase()).not.toContain("couldn't find");
    const checked = specificOpener(
      outreachFacts({ ...base, research: JSON.stringify({ siteStatus: "none", siteProbe: { at: "now" } }) }),
    );
    expect(checked.toLowerCase()).toContain("couldn't find");
  });
  it("gets a/an right — the small thing that gives software away", () => {
    const trade = (industry: string) => specificOpener(outreachFacts({ name: "X", industry }));
    expect(trade("HVAC")).toContain("an HVAC company");
    expect(trade("Electrical")).toContain("an electrician");
    expect(trade("Plumbing")).toContain("a plumber");
    // Nothing anywhere should read "a HVAC" / "a electrician".
    for (const industry of ["HVAC", "Electrical", "Plumbing", "Roofing", "Auto Repair"]) {
      for (const touch of [1, 2, 3]) {
        expect(followUpEmail({ name: "X", industry }, "Barry", touch).body, industry).not.toMatch(
          /\ba ([AEIOU]|[FHLMNRSX][A-Z])/,
        );
      }
    }
  });
  it("never claims the business beats its competitors — we never looked at them", () => {
    const f = outreachFacts({ name: "X", city: "Naples", research: JSON.stringify({ rating: 4.9, reviews: 128 }) });
    const o = specificOpener(f).toLowerCase();
    expect(o).not.toContain("better than");
    expect(o).not.toContain("beats");
    expect(o).not.toContain("anyone else");
  });
  it("still writes something honest when we know nothing at all", () => {
    const o = specificOpener(outreachFacts({ name: "Ana's Bakery" }));
    expect(o).toContain("Ana's Bakery");
    expect(words(o)).toBeLessThan(30);
  });
});

describe("specificityTokens are the proof an email is about this business", () => {
  it("collects every fact worth naming", () => {
    const f = outreachFacts({
      name: "Mills Plumbing",
      city: "Naples",
      industry: "Plumbing",
      research: JSON.stringify({ rating: 4.9, reviews: 128, established: "1998", services: ["Water heaters"] }),
    });
    expect(specificityTokens(f)).toEqual(["Naples", "plumber", "4.9", "128", "1998", "Water heaters"]);
  });
  it("is empty when we know nothing — nothing to require, so nothing is enforced", () => {
    expect(specificityTokens(outreachFacts({ name: "Ana's Bakery" }))).toEqual([]);
  });
  it("the built copy always contains at least one of them", () => {
    const row = {
      name: "Mills Plumbing LLC",
      city: "Naples",
      industry: "Plumbing",
      research: JSON.stringify({ rating: 4.9, reviews: 128 }),
    };
    const tokens = specificityTokens(outreachFacts(row));
    for (const touch of [1, 2, 3]) {
      const body = followUpEmail(row, "Barry", touch).body.toLowerCase();
      expect(
        tokens.some((t) => body.includes(t.toLowerCase())),
        `nudge ${touch} names none of: ${tokens.join(", ")}`,
      ).toBe(true);
    }
    const intro = EMAIL_TEMPLATES.find((t) => t.id === "intro")!;
    const introBody = intro.build({ company: "Mills Plumbing LLC", firstName: null, repName: "Barry", row }).body;
    expect(tokens.some((t) => introBody.toLowerCase().includes(t.toLowerCase()))).toBe(true);
  });
});

describe("mockupAsk is the offer — free, theirs, no obligation", () => {
  it("names the business, says free, and asks one question", () => {
    const ask = mockupAsk(outreachFacts({ name: "Ana's Bakery LLC" }));
    expect(ask).toContain("Ana's Bakery");
    expect(ask.toLowerCase()).toContain("free");
    expect(ask).toContain("?");
    expect(ask).not.toMatch(/\$\s?\d/);
  });
});

// A draft that clears the quality bar — used by several tests below. Note what
// it does NOT have: a price. That's the 2026-07-27 rule, and this fixture is
// the thing that would catch a regression first.
const GOOD_BODY =
  "Hi Joe,\n\nSaw the 4.9 stars across 128 reviews on Google — better than anyone else in Naples, and none of it shows up when someone goes looking. joesplumbing.com hasn't loaded in days.\n\nRather than talk about it, I'll build you a homepage mockup with your own reviews on it. Free, and yours to keep either way.\n\nWant me to put one together? If it's not for you, say so and I'll leave you be.\n\n{{REP_NAME}}";

describe("the draft quality bar (draftQualityIssue)", () => {
  it("passes a good draft", () => {
    expect(draftQualityIssue("your google reviews", GOOD_BODY)).toBeNull();
  });
  it("rejects any dollar figure at all — ours, theirs, or invented", () => {
    expect(draftQualityIssue("your site", GOOD_BODY.replace("Free,", "$299/month,"))).toMatch(/price/);
    expect(draftQualityIssue("your site", GOOD_BODY.replace("Free,", "$100 a month,"))).toMatch(/price/);
    // Even a fact about THEIR business. Quoting a stranger's pricing back at
    // them was never a good opening either.
    expect(draftQualityIssue("your site", GOOD_BODY.replace("4.9 stars", "$150 service calls"))).toMatch(/price/);
  });
  it("rejects price talk even without a number", () => {
    expect(draftQualityIssue("your site", GOOD_BODY.replace("Free,", "Plans start low,"))).toMatch(/pricing/);
    expect(draftQualityIssue("your site", GOOD_BODY.replace("Free,", "Affordable,"))).toMatch(/pricing/);
  });
  it("rejects a mail merge — copy that names nothing about this business", () => {
    const generic =
      "Hi there,\n\nYour website is the first thing people see, and a good one makes all the difference for a local business like yours. I'll build you a homepage mockup, free, yours to keep.\n\nWant me to put one together? If not, say so and I'll leave you be.\n\n{{REP_NAME}}";
    expect(draftQualityIssue("your website", generic, ["Naples", "plumber", "4.9"])).toMatch(/nothing specific/);
    // One fact is enough to clear it.
    expect(draftQualityIssue("your website", generic.replace("Hi there,", "Hi there, from one Naples guy"), [
      "Naples",
      "plumber",
    ])).toBeNull();
    // Nothing required when we know nothing.
    expect(draftQualityIssue("your website", generic, [])).toBeNull();
  });
  it("rejects drafts that are too short, too long, or missing the sign-off placeholder", () => {
    expect(draftQualityIssue("hi", "Too short.\n\n{{REP_NAME}}")).toMatch(/too short/);
    expect(draftQualityIssue("hi", `${"word ".repeat(140)}? {{REP_NAME}}`)).toMatch(/too long/);
    expect(draftQualityIssue("hi", GOOD_BODY.replace("{{REP_NAME}}", "Barry"))).toMatch(/REP_NAME/);
  });
  it("rejects the cold-email clichés — the mass-sent voice Barry flagged", () => {
    expect(draftQualityIssue("hi", GOOD_BODY.replace("Saw the", "I noticed the"))).toMatch(/cliché/);
    expect(draftQualityIssue("hi", GOOD_BODY.replace("Saw the", "My name is Sam — saw the"))).toMatch(/cliché/);
    expect(draftQualityIssue("quick question", GOOD_BODY)).toMatch(/cliché/);
    expect(draftQualityIssue("hi", GOOD_BODY.replace("Want me to", "Just following up — want me to"))).toMatch(
      /cliché/,
    );
    expect(draftQualityIssue("hi", GOOD_BODY.replace("Rather than", "We specialize in websites. Rather than"))).toMatch(
      /cliché/,
    );
  });
  it("rejects drafts with no question or with corporate speak", () => {
    expect(draftQualityIssue("hi", GOOD_BODY.replaceAll("?", "."))).toMatch(/question/);
    expect(draftQualityIssue("hi", GOOD_BODY.replace("Saw the", "Hope this finds you well — saw the"))).toMatch(
      /corporate/,
    );
  });
  it("rejects marathon subjects", () => {
    expect(draftQualityIssue("a".repeat(61), GOOD_BODY)).toMatch(/subject/);
  });
});

describe("aiDraftFromResearch surfaces the per-business AI email", () => {
  const research = JSON.stringify({
    ai: { email_subject: "your google reviews", email_body: GOOD_BODY },
  });
  it("parses the research JSON and fills in the rep's name", () => {
    const d = aiDraftFromResearch(research, "Ayden Sackrider");
    expect(d).not.toBeNull();
    expect(d!.subject).toBe("your google reviews");
    expect(d!.body).toContain("Ayden Sackrider");
    expect(d!.body).not.toContain("{{REP_NAME}}");
  });
  it("accepts an already-parsed object too (getCompanies rows)", () => {
    const d = aiDraftFromResearch(JSON.parse(research), "Ayden");
    expect(d?.subject).toBe("your google reviews");
  });
  it("returns null for missing/blank/garbage research so templates take over", () => {
    expect(aiDraftFromResearch(null, "Ayden")).toBeNull();
    expect(aiDraftFromResearch("not json{", "Ayden")).toBeNull();
    expect(aiDraftFromResearch(JSON.stringify({ ai: { email_subject: "x" } }), "Ayden")).toBeNull();
    expect(aiDraftFromResearch(JSON.stringify({ siteStatus: "live" }), "Ayden")).toBeNull();
  });
  it("rejects stale drafts quoting a price so the tailored templates take over", () => {
    const stale = JSON.stringify({
      ai: { email_subject: "your site", email_body: GOOD_BODY.replace("Free,", "$299/month,") },
    });
    expect(aiDraftFromResearch(stale, "Ayden")).toBeNull();
  });
  it("rejects a stored draft that says nothing about the business it was written for", () => {
    const row = { name: "Mills Plumbing", city: "Naples", industry: "Plumbing" };
    const dossier = {
      rating: 4.9,
      reviews: 128,
      ai: {
        email_subject: "your website",
        email_body:
          "Hi there,\n\nYour website is the first thing people see, and a good one makes all the difference for a local business like yours. I'll build you a homepage mockup, free, yours to keep.\n\nWant me to put one together? If not, say so and I'll leave you be.\n\n{{REP_NAME}}",
      },
    };
    // With the row in hand we know six things it should have mentioned.
    expect(aiDraftFromResearch(JSON.stringify(dossier), "Ayden", row)).toBeNull();
  });
});

describe("mailto links encode safely", () => {
  it("escapes subject and body", () => {
    const link = mailtoLink("a@b.com", "hi & bye", "line1\nline2");
    expect(link).toContain("a%40b.com");
    expect(link).toContain("hi%20%26%20bye");
    expect(link).toContain("line1%0Aline2");
  });
});
