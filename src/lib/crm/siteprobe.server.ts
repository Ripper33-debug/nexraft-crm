// Checking whether a business really has no website.
//
// The lead engine's best pitch is "you don't have a website." Until now that
// claim rested on nothing but the absence of a `website` tag in OpenStreetMap,
// which is absence of evidence and not evidence of absence: in a live sample of
// Cape Coral, 64% of named businesses had no website tag, and the ones the
// radar would have imported included Ross, 7-Eleven and a local electrician
// trading at aaaeinc.com since long before we called them.
//
// This module does the looking. It is deliberately conservative in both
// directions: it will only report "they have a site" when the page it fetched
// visibly belongs to that business, and it will only report "no site found"
// after it has actually tried. Anything it can't answer stays unanswered, and
// leadNeed() phrases the opener as a question in that case.
//
// No API key required — it guesses the obvious domains and looks. That misses
// businesses whose domain resembles nothing in their name, which is why a
// clean run is still reported as a check rather than a proof.

import { candidateDomains, pageProvesBusiness } from "./constants";

const UA = "NexraftCRM/1.0 (+https://crm.nexraft.com) lead-research";

export type SiteProbeResult =
  | { found: true; url: string; provedBy: "phone" | "name" }
  | { found: false; checked: string[] };

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    });
    if (!res.ok) return null;
    const body = await res.text();
    return body.slice(0, 120_000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look for a website belonging to this business.
 *
 * Returns `found: true` only when a fetched page proves it belongs to them
 * (their phone number on the page, or every distinctive word of their name).
 * A parked domain or a same-named business elsewhere fails that test, which is
 * the point — recording the wrong site would just swap one false claim for
 * another.
 *
 * `budgetMs` caps the whole search, because this runs inside a serverless
 * request that has other work to do.
 */
export async function probeForWebsite(
  business: { name: string; phone?: string | null },
  budgetMs = 6000,
): Promise<SiteProbeResult> {
  const candidates = candidateDomains(business.name);
  const checked: string[] = [];
  if (candidates.length === 0) return { found: false, checked };

  const deadline = Date.now() + budgetMs;
  for (const domain of candidates) {
    const remaining = deadline - Date.now();
    // Under a second left is not enough for an honest attempt; stop rather than
    // record a timeout as "nothing there".
    if (remaining < 1200) break;
    const url = `https://${domain}`;
    checked.push(domain);
    const html = await fetchText(url, Math.min(2500, remaining));
    if (!html) continue;
    if (pageProvesBusiness(html, { name: business.name, phone: business.phone })) {
      const digits = String(business.phone ?? "").replace(/\D/g, "").slice(-10);
      const byPhone =
        digits.length === 10 && html.toLowerCase().replace(/\D/g, "").includes(digits);
      return { found: true, url, provedBy: byPhone ? "phone" : "name" };
    }
  }
  return { found: false, checked };
}
