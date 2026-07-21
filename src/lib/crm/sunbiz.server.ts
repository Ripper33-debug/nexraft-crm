// New-business radar: brand-new Florida registrations, straight from the
// state's daily filings via the Sunbiz Daily API (sunbizdaily.com — free,
// key-based, plain HTTPS). A business registered THIS WEEK almost never has a
// website yet and hasn't been pitched by anyone — the highest-intent cold
// lead there is. Same config-gated pattern as Stripe/Gmail/AI: no SDK, no
// key → feature quietly off, and a failure returns [] instead of throwing
// ("the feed is a bonus, never a blocker").

export function isSunbizConfigured(): boolean {
  return Boolean(process.env.SUNBIZ_DAILY_API_KEY);
}

export type SunbizFiling = {
  name: string;
  city: string | null;
  zip: string | null;
  fileDate: string | null;
  /** First listed officer/agent — usually the owner. */
  person: string | null;
};

// State filings come back SHOUTING IN ALL CAPS; make them CRM-presentable.
export function titleCaseBusiness(s: string): string {
  const SMALL = new Set(["of", "and", "the", "for", "at", "in", "on"]);
  const KEEP = new Set(["LLC", "L.L.C.", "INC", "INC.", "CORP", "CORP.", "PA", "P.A.", "PLLC", "CO", "CO.", "LP", "LLP", "DBA", "USA", "FL", "II", "III", "IV", "A/C", "HVAC"]);
  return s
    .trim()
    .split(/\s+/)
    .map((w, i) => {
      const up = w.toUpperCase();
      if (KEEP.has(up)) return up === "INC" || up === "INC." ? up.charAt(0) + up.slice(1).toLowerCase() : up;
      const lower = w.toLowerCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

// Pull the freshest filings (yesterday's batch — the state publishes daily).
// The response shape is normalized defensively: we only depend on a name, and
// take city/zip/date/person opportunistically from whichever field carries
// them. Anything unparseable is skipped, never fatal.
export async function fetchNewFilings(timeoutMs = 10_000): Promise<SunbizFiling[]> {
  const key = process.env.SUNBIZ_DAILY_API_KEY;
  if (!key) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://sunbizdaily.com/api/v2/filings/?period=yesterday", {
      headers: { "X-API-Key": key, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    const rows: unknown[] = Array.isArray(json)
      ? json
      : Array.isArray((json as { results?: unknown[] }).results)
        ? (json as { results: unknown[] }).results
        : Array.isArray((json as { filings?: unknown[] }).filings)
          ? (json as { filings: unknown[] }).filings
          : [];
    const out: SunbizFiling[] = [];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const f = raw as Record<string, unknown>;
      const addr = (f.principal_address ?? {}) as Record<string, unknown>;
      const name = firstString(f.corporation_name, f.name, f.entity_name);
      if (!name) continue;
      // Only genuinely active filings — skip dissolutions/withdrawals.
      const status = firstString(f.status);
      if (status && !/^a/i.test(status)) continue;
      const officers = Array.isArray(f.officers) ? (f.officers as Record<string, unknown>[]) : [];
      const officerName = officers.length > 0 ? firstString(officers[0]?.name, officers[0]?.full_name) : null;
      out.push({
        name,
        city: firstString(f.principal_city, f.city, addr.city),
        zip: firstString(f.principal_zip, f.zip, addr.zip),
        fileDate: firstString(f.file_date, f.filing_date, f.date_filed),
        person: officerName ?? firstString(f.registered_agent_name),
      });
    }
    return out;
  } catch {
    return []; // network/timeout/bad JSON — the feed is a bonus, never a blocker
  } finally {
    clearTimeout(timer);
  }
}
