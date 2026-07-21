import { describe, it, expect } from "vitest";

import { aiDraftFromResearch, EMAIL_TEMPLATES, followUpEmail, mailtoLink } from "./emails";

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
  it("mentions the price so the ask is concrete, in touches 1 and 2", () => {
    expect(followUpEmail("Joe's Plumbing", "Mike", 1).body).toContain("$100/month");
    expect(followUpEmail("Joe's Plumbing", "Mike", 2).body).toContain("$100/month");
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

describe("aiDraftFromResearch surfaces the per-business AI email", () => {
  const research = JSON.stringify({
    ai: { email_subject: "your google reviews", email_body: "Hi Joe,\n\nSaw the 4.9 stars.\n\n{{REP_NAME}}" },
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
});

describe("mailto links encode safely", () => {
  it("escapes subject and body", () => {
    const link = mailtoLink("a@b.com", "hi & bye", "line1\nline2");
    expect(link).toContain("a%40b.com");
    expect(link).toContain("hi%20%26%20bye");
    expect(link).toContain("line1%0Aline2");
  });
});
