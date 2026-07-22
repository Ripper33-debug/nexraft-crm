// Outscraper contact enrichment: given a company's website domain, pull the
// email addresses, extra phone numbers, and social profiles Outscraper has
// crawled for it (outscraper.com "Domain Emails & Contacts"). This is the
// upgrade path for the lead engine's own finds — Google Places gives us name,
// phone, and website but never an email; this fills that gap so a scanned
// lead becomes EMAILABLE without a rep digging by hand.
//
// Same config-gated pattern as Sunbiz/Stripe/Gmail/AI: no SDK, plain fetch,
// no key → feature quietly off, and any failure returns null instead of
// throwing ("enrichment is a bonus, never a blocker"). null (failure) vs []
// (the call worked, Outscraper just knows nothing) matters: callers only
// stamp a company "checked" on success, so a network blip never permanently
// buries a domain we paid nothing to ask about yet.
//
// API notes (verified against the live OpenAPI spec at docs.outscraper.com):
//   GET https://api.outscraper.cloud/emails-and-contacts
//     ?query=<domain>&query=<domain>...&async=false
//   header X-API-KEY: <key>
// async=false keeps the HTTP connection open and returns results directly —
// right call for the small nightly batches we send (a handful of domains,
// inside our own hard timeout). Response shape:
//   { data: [{ query, domain, emails: [{value, ...}], phones?: [...],
//              socials: { facebook: url, instagram: url, ... } }] }
// Pricing (as of 2026-07): first 500 domains free, then ~$3 per 1,000 —
// which is why callers only send domains we've never asked about before.

export function isOutscraperConfigured(): boolean {
  return Boolean(process.env.OUTSCRAPER_API_KEY);
}

export type OutscraperHit = {
  /** The domain as we asked for it (matches back to the company). */
  query: string;
  emails: string[];
  phones: string[];
  /** Social profile URLs (facebook, instagram, linkedin, ...). */
  socials: string[];
};

// "https://www.JoesPlumbing.com/about" -> "joesplumbing.com". Null for
// anything that isn't a usable public domain (empty, localhost, bare IPs are
// left alone — Outscraper can't do anything with them anyway).
export function websiteDomain(website: string | null | undefined): string | null {
  const raw = (website ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host.includes(".")) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    // Facebook/Instagram pages sometimes live in the website field — those
    // aren't the business's own domain, and enriching facebook.com would
    // burn a credit on garbage.
    if (/(^|\.)(facebook|instagram|linkedin|google|yelp)\.com$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

// Emails/phones arrive either as plain strings or as { value: "..." } objects
// depending on the endpoint version — accept both, keep only clean values.
function pickValues(list: unknown, validate?: (s: string) => boolean): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    const v =
      typeof item === "string"
        ? item
        : item && typeof item === "object" && typeof (item as { value?: unknown }).value === "string"
          ? ((item as { value: string }).value)
          : null;
    const clean = (v ?? "").trim();
    if (!clean || (validate && !validate(clean))) continue;
    if (!out.includes(clean)) out.push(clean);
  }
  return out;
}

// One batched call for up to ~10 domains. Returns one hit per domain that
// came back with anything useful; domains Outscraper knows nothing about are
// simply absent from a successful response. Returns null on any failure (no
// key, HTTP error, timeout, unparseable JSON) — callers treat null as "try
// again another day" and an absent domain as "Outscraper has nothing".
export async function fetchDomainContacts(
  domains: string[],
  timeoutMs = 30_000,
): Promise<OutscraperHit[] | null> {
  const key = process.env.OUTSCRAPER_API_KEY;
  if (!key || domains.length === 0) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const qs = domains.map((d) => `query=${encodeURIComponent(d)}`).join("&");
    const res = await fetch(`https://api.outscraper.cloud/emails-and-contacts?${qs}&async=false`, {
      headers: { "X-API-KEY": key, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: unknown };
    const rows = Array.isArray(json.data) ? json.data : [];
    const out: OutscraperHit[] = [];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const query =
        typeof r.query === "string" && r.query.trim() !== ""
          ? r.query.trim().toLowerCase()
          : typeof r.domain === "string"
            ? r.domain.trim().toLowerCase()
            : "";
      if (!query) continue;
      const emails = pickValues(r.emails, (s) => EMAIL_SHAPE.test(s)).map((e) => e.toLowerCase());
      const phones = pickValues(r.phones, (s) => /\d{7}/.test(s.replace(/\D/g, "")));
      const socials =
        r.socials && typeof r.socials === "object" && !Array.isArray(r.socials)
          ? Object.values(r.socials as Record<string, unknown>).filter(
              (v): v is string => typeof v === "string" && v.startsWith("http"),
            )
          : pickValues(r.socials, (s) => s.startsWith("http"));
      if (emails.length === 0 && phones.length === 0 && socials.length === 0) continue;
      out.push({ query, emails, phones, socials });
    }
    return out;
  } catch {
    return null; // network/timeout/abort — enrichment is a bonus, never a blocker
  } finally {
    clearTimeout(timer);
  }
}
