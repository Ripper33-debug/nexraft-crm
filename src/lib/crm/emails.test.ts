import { describe, it, expect } from "vitest";

import {
  aiDraftFromResearch,
  draftQualityIssue,
  EMAIL_TEMPLATES,
  followUpEmail,
  friendlyCompanyName,
  mailtoLink,
} from "./emails";

// The outreach copy is tuned for replies: short enough to read on a phone,
// one question, an easy out, and a breakup email as the final touch. These
// tests pin the reply-rate properties without pinning every word.

const words = (s: string) => s.trim().split(/\s+/).length;

describe("follow-up nudges are built to get replies", () => {
  it("every nudge fits on a phone screen (under 100 words)", () => {
    for (const touch of [1, 2, 3]) {
      const d = followUpEmail("Joe's Plumbing", "Michael Farina", touch);
      expect(words(d.body), `nudge ${touch} word count`).toBeLessThan(100);
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
  it("states the real pricing (plans from $299/month, per nexraft.com) — never the old $100", () => {
    expect(followUpEmail("Joe's Plumbing", "Mike", 1).body).toContain("$299/month");
    expect(followUpEmail("Joe's Plumbing", "Mike", 2).body).toContain("$299/month");
    for (const touch of [1, 2, 3]) {
      expect(followUpEmail("Joe's Plumbing", "Mike", touch).body).not.toContain("$100");
    }
    for (const tpl of EMAIL_TEMPLATES) {
      const d = tpl.build({ company: "Ana's Bakery", firstName: "Ana", repName: "Brady" });
      expect(d.body, tpl.id).not.toContain("$100");
    }
  });
  it("the final touch is a breakup email — closing the file, not another pitch", () => {
    const d = followUpEmail("Joe's Plumbing", "Mike", 3);
    expect(d.subject.toLowerCase()).toContain("closing");
    expect(d.body.toLowerCase()).toContain("close your file");
  });
  it("personalizes with the company and the rep's first name", () => {
    const d = followUpEmail("Joe's Plumbing", "Michael Farina", 1);
    expect(d.subject).toContain("Joe's Plumbing");
    expect(d.body).toContain("Michael ");
    expect(d.body).toContain("Michael Farina");
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

// A draft that clears the quality bar — used by several tests below.
const GOOD_BODY =
  "Hi Joe,\n\nSaw the 4.9 stars on Google — with reviews like that, it's a shame joesplumbing.com doesn't load anymore. We build and run websites for local trades, everything handled, plans from $299/month. Worth a look? If not, just say so and I'll leave you be.\n\n{{REP_NAME}}";

describe("the draft quality bar (draftQualityIssue)", () => {
  it("passes a good draft", () => {
    expect(draftQualityIssue("your google reviews", GOOD_BODY)).toBeNull();
  });
  it("catches the old wrong pricing but allows the prospect's own prices as facts", () => {
    expect(draftQualityIssue("your site", GOOD_BODY.replace("$299/month", "$100/month"))).toMatch(/isn't ours/);
    expect(draftQualityIssue("your site", GOOD_BODY.replace("$299/month", "$450 per month"))).toMatch(/isn't ours/);
    // "$150 service calls" is a fact about THEIR business, not a plan price.
    expect(draftQualityIssue("your site", GOOD_BODY.replace("4.9 stars", "$150 service calls"))).toBeNull();
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
    expect(
      draftQualityIssue("hi", GOOD_BODY.replace("Worth a look?", "Just following up — worth a look?")),
    ).toMatch(/cliché/);
    expect(
      draftQualityIssue("hi", GOOD_BODY.replace("We build and run", "We specialize in building")),
    ).toMatch(/cliché/);
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
  it("rejects stale drafts quoting the old $100 price so the fixed templates take over", () => {
    const stale = JSON.stringify({
      ai: { email_subject: "your site", email_body: "We handle it all for $100/month.\n\n{{REP_NAME}}" },
    });
    expect(aiDraftFromResearch(stale, "Ayden")).toBeNull();
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
