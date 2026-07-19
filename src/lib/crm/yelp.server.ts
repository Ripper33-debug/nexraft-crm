// Minimal Yelp Fusion client — the free fallback for the ratings signal.
// Config-gated exactly like Google Places: until YELP_API_KEY is set in Vercel,
// this module reports unconfigured and discovery skips the Yelp pass entirely.
//
// Why a fallback at all: Google's Places quota is capped per day (deliberately —
// the cap is free overdraft protection). When Google can't answer (quota burned,
// key missing, timeout), Yelp's free tier still tells us whether a business is
// busy — rating + review count — which is the whole point of the signal.

const YELP_URL = "https://api.yelp.com/v3/businesses/search";

export function isYelpConfigured(): boolean {
  return Boolean(process.env.YELP_API_KEY);
}

export type YelpRating = { rating: number | null; reviews: number | null };

// One lookup = one business search constrained to a single best match. Yelp
// wants the name and the location as separate params (unlike Places' single
// textQuery), so callers pass them split and key results however they like.
export type YelpQuery = { key: string; term: string; location: string };

async function lookupOne(q: YelpQuery, timeoutMs: number): Promise<YelpRating | null> {
  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const params = new URLSearchParams({ term: q.term, location: q.location, limit: "1" });
    const res = await fetch(`${YELP_URL}?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      businesses?: { rating?: number; review_count?: number }[];
    };
    const b = json.businesses?.[0];
    if (!b) return null;
    return {
      rating: typeof b.rating === "number" ? b.rating : null,
      reviews: typeof b.review_count === "number" ? b.review_count : 0,
    };
  } catch {
    return null; // timeouts / rate limits just skip the signal
  } finally {
    clearTimeout(timer);
  }
}

// Batch lookups under one hard deadline — same race contract as the website
// audits and the Places pass: whatever resolves in time is used, the rest are
// simply skipped. Returns a map keyed by each query's caller-provided key.
export async function fetchYelpRatings(
  queries: YelpQuery[],
  deadlineMs: number,
): Promise<Map<string, YelpRating>> {
  const out = new Map<string, YelpRating>();
  if (!isYelpConfigured() || queries.length === 0) return out;
  const perFetch = Math.max(1500, deadlineMs - 300);
  const work = (async () => {
    const results = await Promise.allSettled(
      queries.map(async (q) => {
        const r = await lookupOne(q, perFetch);
        if (r) out.set(q.key, r);
      }),
    );
    void results;
  })();
  await Promise.race([work, new Promise<void>((r) => setTimeout(r, deadlineMs))]);
  return out;
}
