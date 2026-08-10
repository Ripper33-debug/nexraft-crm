// Free email deliverability check — no API key, no credits.
//
// The reps' complaint (2026-08-10) was that outreach addresses are often
// wrong. We can't prove a mailbox exists without sending, but we CAN prove a
// domain can't receive mail at all: if DNS has no MX records (and no A/AAAA
// fallback), every message to it bounces. That one lookup kills the worst
// class of bad address — dead domains, typo'd domains, free-builder leftovers.
//
// Uses DNS-over-HTTPS (Cloudflare, then Google as fallback) so it works from
// Vercel's runtime, where raw DNS sockets aren't available.

export type MxVerdict = "valid" | "invalid" | "unknown";

// Well-known mailbox hosts we never need to look up. If someone@gmail.com is
// wrong, it's wrong at the mailbox level — DNS can't tell us, so don't spend
// a lookup. Their domains always have MX.
const KNOWN_MAIL_HOSTS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "msn.com",
  "live.com",
  "comcast.net",
  "att.net",
  "verizon.net",
  "bellsouth.net",
  "proton.me",
  "protonmail.com",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailDomain(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return null;
  return e.slice(e.lastIndexOf("@") + 1);
}

type DohAnswer = { type: number; data?: string };
type DohResponse = { Status: number; Answer?: DohAnswer[] };

// Pure verdict from a DoH JSON response for an MX query, plus (optionally)
// one for an A query when there were no MX records. Exported for tests.
export function mxVerdict(mx: DohResponse | null, a?: DohResponse | null): MxVerdict {
  if (!mx) return "unknown";
  // NXDOMAIN (3): the domain doesn't exist at all. Nothing can be delivered.
  if (mx.Status === 3) return "invalid";
  if (mx.Status !== 0) return "unknown"; // SERVFAIL etc — don't condemn on a bad day
  const hasMx = (mx.Answer ?? []).some((r) => r.type === 15);
  if (hasMx) return "valid";
  // No MX but the name resolves? RFC 5321 falls back to the A record. Rare
  // but real for tiny hosts, so only call it invalid when neither exists.
  if (a && a.Status === 0 && (a.Answer ?? []).some((r) => r.type === 1 || r.type === 28)) {
    return "valid";
  }
  if (a && (a.Status === 0 || a.Status === 3)) return "invalid";
  return "unknown";
}

const DOH_ENDPOINTS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
] as const;

async function dohQuery(name: string, type: "MX" | "A"): Promise<DohResponse | null> {
  for (const base of DOH_ENDPOINTS) {
    try {
      const res = await fetch(`${base}?name=${encodeURIComponent(name)}&type=${type}`, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as DohResponse;
      if (typeof json?.Status === "number") return json;
    } catch {
      // try the next resolver
    }
  }
  return null;
}

// One process-lifetime cache per domain — a vet sweep over a big book hits
// the same domains (and the same NXDOMAINs) repeatedly.
const domainCache = new Map<string, MxVerdict>();

export async function checkEmailDeliverable(email: string | null | undefined): Promise<MxVerdict> {
  const domain = emailDomain(email);
  if (!domain) return "invalid"; // not even shaped like an email
  if (KNOWN_MAIL_HOSTS.has(domain)) return "valid";
  const cached = domainCache.get(domain);
  if (cached && cached !== "unknown") return cached;
  const mx = await dohQuery(domain, "MX");
  let verdict = mxVerdict(mx);
  if (verdict === "invalid" || (mx && mx.Status === 0 && !(mx.Answer ?? []).length)) {
    // Double-check the A-record fallback before condemning the domain.
    const a = await dohQuery(domain, "A");
    verdict = mxVerdict(mx, a);
  }
  domainCache.set(domain, verdict);
  return verdict;
}
