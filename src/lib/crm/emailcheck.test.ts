import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { emailDomain, mxVerdict } from "./emailcheck.server";

// The reps' complaint (2026-08-10): companies with wrong/dead emails keep
// landing in the book. The MX check is the free line of defense — these tests
// pin down its verdict logic (pure functions) and the places in data.ts that
// must consult it before an email is trusted.

describe("emailDomain", () => {
  it("extracts the domain, lowercased and trimmed", () => {
    expect(emailDomain("  Joe@Example.COM ")).toBe("example.com");
  });
  it("rejects things that aren't shaped like an email", () => {
    expect(emailDomain("not-an-email")).toBeNull();
    expect(emailDomain("a@b")).toBeNull(); // no TLD
    expect(emailDomain("")).toBeNull();
    expect(emailDomain(null)).toBeNull();
    expect(emailDomain(undefined)).toBeNull();
    expect(emailDomain("two@@ats.com")).toBeNull();
  });
});

describe("mxVerdict", () => {
  const mx = (Status: number, types: number[] = []) => ({
    Status,
    Answer: types.map((type) => ({ type })),
  });

  it("valid when the domain has MX records", () => {
    expect(mxVerdict(mx(0, [15]))).toBe("valid");
  });
  it("invalid on NXDOMAIN — the domain doesn't exist, everything bounces", () => {
    expect(mxVerdict(mx(3))).toBe("invalid");
  });
  it("unknown on SERVFAIL etc — never condemn a domain on a bad DNS day", () => {
    expect(mxVerdict(mx(2))).toBe("unknown");
    expect(mxVerdict(null)).toBe("unknown");
  });
  it("no MX but an A record → valid (RFC 5321 fallback for tiny hosts)", () => {
    expect(mxVerdict(mx(0), mx(0, [1]))).toBe("valid");
    expect(mxVerdict(mx(0), mx(0, [28]))).toBe("valid"); // AAAA counts too
  });
  it("no MX and no A/AAAA → invalid", () => {
    expect(mxVerdict(mx(0), mx(0))).toBe("invalid");
    expect(mxVerdict(mx(0), mx(3))).toBe("invalid");
  });
  it("no MX and the A lookup failed → unknown, not invalid", () => {
    expect(mxVerdict(mx(0))).toBe("unknown");
    expect(mxVerdict(mx(0), mx(2))).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Source assertions: the gates that keep bad emails out of the book. Server
// functions need a live DB, so (like data.moneypath.test.ts) we statically
// verify data.ts keeps calling the check where it matters.
// ---------------------------------------------------------------------------
const data = readFileSync(join(__dirname, "data.ts"), "utf8");
const checker = readFileSync(join(__dirname, "emailcheck.server.ts"), "utf8");

describe("MX gates in data.ts", () => {
  it("lead hunting skips companies whose email domain can't receive mail", () => {
    expect(data).toContain('if ((await checkEmailDeliverable(l.email)) === "invalid") continue;');
  });
  it("Outscraper enrichment MX-checks before recording an email fact", () => {
    expect(data).toContain('if ((await checkEmailDeliverable(email)) === "invalid") continue;');
  });
  it("the outreach workspace never offers a contact whose email bounced", () => {
    expect(data).toContain("COALESCE(email_status, '') <> 'invalid'");
  });
  it("the outreach workspace prefers verified-deliverable contacts", () => {
    expect(data).toContain("CASE WHEN email_status = 'valid' THEN 0 ELSE 1 END");
  });
  it("vetting stamps email_status on contacts so a check is never repeated", () => {
    expect(data).toContain("UPDATE contacts SET email_status = ?, email_checked_at = ?");
  });
});

describe("the checker itself stays cautious", () => {
  it("well-known mailbox hosts are never looked up (gmail is always valid at DNS level)", () => {
    expect(checker).toContain('"gmail.com"');
    expect(checker).toContain("KNOWN_MAIL_HOSTS.has(domain)");
  });
  it("uses two DoH resolvers so one outage can't poison the book", () => {
    expect(checker).toContain("cloudflare-dns.com/dns-query");
    expect(checker).toContain("dns.google/resolve");
  });
  it("unknown verdicts are not cached — they get retried next pass", () => {
    expect(checker).toContain('if (cached && cached !== "unknown") return cached;');
  });
});

describe("the vet sweep (rep complaint: fake companies, wrong emails, no need)", () => {
  it("protects signed/interested/maybe, referrals, worked deals, and future follow-ups", () => {
    expect(data).toContain("IN ('signed','interested','maybe')");
    expect(data).toContain("referred_by_company_id IS NOT NULL");
    expect(data).toContain("next_followup_at IS NOT NULL AND c.next_followup_at > ?");
  });
  it("archives, never deletes — and cascades to the company's deals", () => {
    const start = data.indexOf("async function vetBookCore");
    const body = data.slice(start, start + 4500);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("UPDATE companies SET archived_at = ? WHERE id = ? AND archived_at IS NULL");
    expect(body).toContain("UPDATE deals SET archived_at = ? WHERE company_id = ? AND archived_at IS NULL");
    expect(body).not.toContain("DELETE FROM companies");
  });
  it("uses one shared timestamp per pass so undoLastBulkArchive can reverse it", () => {
    const start = data.indexOf("async function vetBookCore");
    const body = data.slice(start, start + 4500);
    expect(body).toContain("const stamp = new Date().toISOString();");
  });
  it("writes a rep-readable vet_note explaining every verdict", () => {
    expect(data).toContain("No phone, no website, no deliverable email");
    expect(data).toContain("Every email on file bounces");
  });
});
